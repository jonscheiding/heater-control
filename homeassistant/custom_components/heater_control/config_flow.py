"""Config and options flows — where heaters are actually configured."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
    SOURCE_IMPORT,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    DurationSelector,
    DurationSelectorConfig,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    TextSelector,
)
import voluptuous as vol

from .const import (
    CONF_AIRCRAFT_TYPE,
    CONF_AUTO_OFF,
    CONF_MODE,
    CONF_N_NUMBER,
    CONF_NAME,
    CONF_NODE_STATUS_ENTITY,
    CONF_POWER_ENTITY,
    CONF_SOURCE_ENTITY,
    CONF_VIRTUAL_WATTS,
    DEFAULT_VIRTUAL_WATTS,
    DOMAIN,
    MAX_VIRTUAL_WATTS,
    MODE_REAL,
    MODE_VIRTUAL,
)
from .logic import format_duration, normalize_heater, parse_duration

DEFAULT_DURATION = {"hours": 2, "minutes": 0, "seconds": 0}

_METADATA = {
    vol.Optional(CONF_N_NUMBER): TextSelector(),
    vol.Optional(CONF_AIRCRAFT_TYPE): TextSelector(),
    vol.Required(CONF_AUTO_OFF, default=DEFAULT_DURATION): DurationSelector(
        DurationSelectorConfig(enable_day=False)
    ),
}

REAL_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_NAME): TextSelector(),
        vol.Required(CONF_SOURCE_ENTITY): EntitySelector(
            EntitySelectorConfig(domain=["switch", "input_boolean"])
        ),
        vol.Optional(CONF_POWER_ENTITY): EntitySelector(
            EntitySelectorConfig(domain="sensor", device_class="power")
        ),
        # Deliberately unfiltered: the Z-Wave node-status sensor is a diagnostic
        # enum, and a hand-rolled template sensor should qualify too.
        vol.Optional(CONF_NODE_STATUS_ENTITY): EntitySelector(
            EntitySelectorConfig(domain="sensor")
        ),
        **_METADATA,
    }
)

VIRTUAL_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_NAME): TextSelector(),
        vol.Required(
            CONF_VIRTUAL_WATTS, default=DEFAULT_VIRTUAL_WATTS
        ): NumberSelector(
            NumberSelectorConfig(
                min=0,
                max=MAX_VIRTUAL_WATTS,
                step=50,
                unit_of_measurement="W",
                mode=NumberSelectorMode.BOX,
            )
        ),
        **_METADATA,
    }
)


def _as_duration_dict(seconds: int) -> dict[str, int]:
    """Seconds back into what the duration selector expects."""
    hours, minutes, secs = (int(p) for p in format_duration(seconds).split(":"))
    return {"hours": hours, "minutes": minutes, "seconds": secs}


class HeaterControlConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add a heater."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        return self.async_show_menu(step_id="user", menu_options=["real", "virtual"])

    async def async_step_real(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is None:
            return self.async_show_form(step_id="real", data_schema=REAL_SCHEMA)
        data = normalize_heater({**user_input, CONF_MODE: MODE_REAL})
        # One heater per underlying switch: two wrappers would both arm an
        # auto-off and both publish the same tail number.
        await self.async_set_unique_id(f"entity:{data[CONF_SOURCE_ENTITY]}")
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=data[CONF_NAME], data=data)

    async def async_step_virtual(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is None:
            return self.async_show_form(step_id="virtual", data_schema=VIRTUAL_SCHEMA)
        data = normalize_heater({**user_input, CONF_MODE: MODE_VIRTUAL})
        await self.async_set_unique_id(f"virtual:{data[CONF_NAME].lower()}")
        self._abort_if_unique_id_configured()
        return self.async_create_entry(title=data[CONF_NAME], data=data)

    async def async_step_import(
        self, import_data: dict[str, Any]
    ) -> ConfigFlowResult:
        """Create an entry from configuration.yaml (dev/demo self-provisioning)."""
        await self.async_set_unique_id(import_data["unique_id"])
        self._abort_if_unique_id_configured()
        payload = import_data["payload"]
        return self.async_create_entry(title=payload[CONF_NAME], data=payload)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return HeaterControlOptionsFlow()


class HeaterControlOptionsFlow(OptionsFlow):
    """Edit an existing heater."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        entry = self.config_entry
        if entry.source == SOURCE_IMPORT:
            # Imported heaters are wholly owned by configuration.yaml; letting
            # the UI half-override them makes "why didn't my edit take"
            # unanswerable.
            return self.async_abort(reason="yaml_managed")

        current = {**entry.data, **entry.options}
        virtual = current.get(CONF_MODE) == MODE_VIRTUAL

        if user_input is not None:
            return self.async_create_entry(
                data=normalize_heater({**current, **user_input})
            )

        schema = VIRTUAL_SCHEMA if virtual else REAL_SCHEMA
        suggested = {
            key: value
            for key, value in current.items()
            if value is not None and key != CONF_MODE
        }
        suggested[CONF_AUTO_OFF] = _as_duration_dict(
            parse_duration(current.get(CONF_AUTO_OFF) or 0)
        )
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(schema, suggested),
        )
