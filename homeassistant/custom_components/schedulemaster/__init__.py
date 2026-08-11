"""The ScheduleMaster integration.

YAML-configured (``schedulemaster:`` in configuration.yaml). The calendar entity
is always created so the SPA has something to read; ScheduleMaster is only polled
when both ``username`` and ``password`` are configured.
"""

from __future__ import annotations

from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, Platform
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers import config_validation as cv, discovery
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
import voluptuous as vol

from .api import ScheduleMasterApi
from .const import (
    CONF_BASE_URL,
    CONF_LOOKAHEAD_DAYS,
    CONF_PASSWORD,
    CONF_PREHEAT_LEAD,
    CONF_SCAN_INTERVAL,
    CONF_TIMEZONE,
    CONF_USERNAME,
    CONF_WARM_THRESHOLD_F,
    CONF_WEATHER_ENTITY,
    DEFAULT_BASE_URL,
    DEFAULT_LOOKAHEAD_DAYS,
    DEFAULT_PREHEAT_LEAD,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_WARM_THRESHOLD_F,
    DEFAULT_WEATHER_ENTITY,
    DOMAIN,
    LOGGER,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .coordinator import ScheduleMasterCoordinator

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Optional(CONF_USERNAME): cv.string,
                vol.Optional(CONF_PASSWORD): cv.string,
                vol.Optional(CONF_BASE_URL, default=DEFAULT_BASE_URL): cv.string,
                vol.Optional(
                    CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL
                ): cv.positive_int,
                vol.Optional(
                    CONF_PREHEAT_LEAD, default=DEFAULT_PREHEAT_LEAD
                ): cv.positive_int,
                vol.Optional(
                    CONF_WARM_THRESHOLD_F, default=DEFAULT_WARM_THRESHOLD_F
                ): vol.Coerce(float),
                vol.Optional(
                    CONF_LOOKAHEAD_DAYS, default=DEFAULT_LOOKAHEAD_DAYS
                ): cv.positive_int,
                vol.Optional(
                    CONF_WEATHER_ENTITY, default=DEFAULT_WEATHER_ENTITY
                ): cv.entity_id,
                vol.Optional(CONF_TIMEZONE): cv.time_zone,
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    conf = config.get(DOMAIN)
    if conf is None:
        return True  # domain present but not configured — nothing to do

    store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
    stored = await store.async_load() or {}
    suppressed: set[str] = set(stored.get("suppressed", []))

    username = conf.get(CONF_USERNAME)
    password = conf.get(CONF_PASSWORD)
    api: ScheduleMasterApi | None = None
    if username and password:
        api = ScheduleMasterApi(
            async_get_clientsession(hass), username, password, conf[CONF_BASE_URL]
        )
    else:
        LOGGER.warning(
            "schedulemaster: no username/password configured — the calendar will "
            "be created but empty (polling disabled)"
        )

    coordinator = ScheduleMasterCoordinator(
        hass,
        api,
        store,
        suppressed,
        scan_interval=conf[CONF_SCAN_INTERVAL],
        preheat_lead=conf[CONF_PREHEAT_LEAD],
        warm_threshold_f=conf[CONF_WARM_THRESHOLD_F],
        lookahead_days=conf[CONF_LOOKAHEAD_DAYS],
        weather_entity=conf[CONF_WEATHER_ENTITY],
        timezone=conf.get(CONF_TIMEZONE),
    )
    await coordinator.async_refresh()

    async def _on_started(_event: Event) -> None:
        # 1) The first refresh above ran mid-boot, before the heater/weather
        #    entities existed (so it mapped nothing) — re-poll now they're up.
        if api is not None:
            await coordinator.async_request_refresh()
        # 2) calendar.schedulemaster is created late (via platform discovery), so
        #    a calendar trigger on it (scheduling.yaml) fails to attach at cold
        #    boot — which can drop the whole turn-on automation until a manual
        #    reload, leaving heaters un-triggered. Now that the entity exists,
        #    reload automations so the trigger(s) attach.
        if hass.services.has_service("automation", "reload"):
            await hass.services.async_call("automation", "reload", blocking=True)

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _on_started)

    hass.data.setdefault(DOMAIN, {})["coordinator"] = coordinator

    hass.async_create_task(
        discovery.async_load_platform(hass, Platform.CALENDAR, DOMAIN, {}, config)
    )
    return True
