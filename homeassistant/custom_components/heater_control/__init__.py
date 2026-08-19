"""The heater control integration.

Each heater is one config entry, added through the UI (Settings → Devices &
services → Add integration → Heater Control). The integration owns a switch
entity per heater that wraps the real device's switch and publishes everything
the app needs as state attributes — so nothing is discovered or correlated by
entity id, and entities can be renamed freely.

Dev and demo environments can't click through a config flow (and wipe
``.storage`` on reset), so a ``heater_control:`` block in configuration.yaml
declares heaters instead; those are imported into config entries and reconciled
on every start. See ha-dev/render_config.py.
"""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import SOURCE_IMPORT, ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
import voluptuous as vol

from .const import (
    CONF_AIRCRAFT_TYPE,
    CONF_AUTO_OFF,
    CONF_HEATERS,
    CONF_KEY,
    CONF_MODE,
    CONF_N_NUMBER,
    CONF_NAME,
    CONF_NODE_STATUS_ENTITY,
    CONF_POWER_ENTITY,
    CONF_SOURCE_ENTITY,
    CONF_VIRTUAL_WATTS,
    DOMAIN,
    LOGGER,
)
from .controller import HeaterController
from .logic import import_unique_id, normalize_heater, plan_import
from .store import AutoOffStore

PLATFORMS = [Platform.SWITCH, Platform.SENSOR, Platform.NUMBER]

HEATER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_KEY): cv.string,
        vol.Required(CONF_NAME): cv.string,
        vol.Optional("virtual", default=False): cv.boolean,
        vol.Optional("switch"): cv.entity_id,
        vol.Optional("power"): cv.entity_id,
        vol.Optional("node_status"): cv.entity_id,
        vol.Optional(CONF_N_NUMBER): cv.string,
        vol.Optional(CONF_AIRCRAFT_TYPE): cv.string,
        # Kept as a string/int and parsed by logic.parse_duration rather than
        # cv.positive_time_period: a timedelta isn't JSON-serializable into a
        # config entry.
        vol.Optional(CONF_AUTO_OFF): vol.Any(cv.positive_int, cv.string),
        vol.Optional(CONF_VIRTUAL_WATTS): vol.Coerce(int),
    }
)

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.All(
            # An empty `!include` file parses as None.
            lambda value: value or {},
            vol.Schema(
                {
                    vol.Optional(CONF_HEATERS, default=list): vol.All(
                        cv.ensure_list, [HEATER_SCHEMA]
                    )
                }
            ),
        )
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Import declaratively-configured heaters (dev/demo only)."""
    conf = config.get(DOMAIN)
    if conf is None:
        return True
    hass.async_create_task(_async_import_heaters(hass, conf[CONF_HEATERS]))
    return True


async def _async_import_heaters(
    hass: HomeAssistant, heaters: list[dict[str, Any]]
) -> None:
    """Reconcile the declared heaters against the imported config entries.

    Create/update/remove rather than create-if-absent, so editing or dropping a
    heater in YAML actually takes effect. Entries added through the UI are never
    touched — only ones this import created.
    """
    desired = {import_unique_id(h[CONF_KEY]): normalize_heater(h) for h in heaters}
    entries = {
        entry.unique_id: entry
        for entry in hass.config_entries.async_entries(DOMAIN)
        if entry.source == SOURCE_IMPORT and entry.unique_id
    }
    plan = plan_import(desired, {uid: dict(e.data) for uid, e in entries.items()})

    for unique_id, payload in plan.create:
        LOGGER.info("importing heater %s", payload[CONF_NAME])
        await hass.config_entries.flow.async_init(
            DOMAIN,
            context={"source": SOURCE_IMPORT},
            data={"unique_id": unique_id, "payload": payload},
        )
    for unique_id, payload in plan.update:
        LOGGER.info("updating imported heater %s", payload[CONF_NAME])
        # options={} because YAML wholly owns an imported heater; leaving stale
        # options behind would let the UI silently override the file.
        hass.config_entries.async_update_entry(
            entries[unique_id], data=payload, options={}, title=payload[CONF_NAME]
        )
    for unique_id in plan.remove:
        LOGGER.info("removing heater dropped from configuration: %s", unique_id)
        await hass.config_entries.async_remove(entries[unique_id].entry_id)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up one heater."""
    data = hass.data.setdefault(DOMAIN, {"entries": {}})
    if "store" not in data:
        # Assigned before the first await so concurrent entry setups share one
        # store rather than racing to create two.
        data["store"] = AutoOffStore(hass)
        data["store_loaded"] = hass.async_create_task(data["store"].async_load())
    await data["store_loaded"]

    controller = HeaterController(hass, entry, data["store"])
    data["entries"][entry.entry_id] = controller

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    # After the platforms, so virtual heaters have restored their switch
    # position before the startup sweep decides what to do about it.
    await controller.async_start()

    entry.async_on_unload(entry.add_update_listener(_async_reload_entry))
    return True


# Config keys whose change alters which entities exist (or what they're called),
# so the entry has to be rebuilt. Everything else — the auto-off duration, the
# simulated wattage, the tail metadata — is adopted in place, so adjusting a
# setting from the device page doesn't tear the device down and recreate it.
STRUCTURAL_KEYS = (
    CONF_NAME,
    CONF_MODE,
    CONF_SOURCE_ENTITY,
    CONF_POWER_ENTITY,
    CONF_NODE_STATUS_ENTITY,
)


async def _async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    controller: HeaterController | None = (
        hass.data.get(DOMAIN, {}).get("entries", {}).get(entry.entry_id)
    )
    updated = {**entry.data, **entry.options}
    if controller is not None and all(
        controller.config.get(key) == updated.get(key) for key in STRUCTURAL_KEYS
    ):
        controller.async_update_config(entry)
        return
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        controller: HeaterController = hass.data[DOMAIN]["entries"].pop(entry.entry_id)
        controller.async_stop()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Forget a deleted heater's auto-off deadline."""
    store: AutoOffStore | None = hass.data.get(DOMAIN, {}).get("store")
    if store is not None:
        store.remove(entry.entry_id)
