"""Settings exposed on the heater's device page.

Both write straight back to the config entry, so the device page and the options
flow are two views of one value rather than two copies that can disagree. Editing
either applies in place — no entry reload, so nudging a number doesn't tear the
device's entities down and rebuild them.
"""

from __future__ import annotations

from homeassistant.components.number import NumberDeviceClass, NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory, UnitOfPower, UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_AUTO_OFF, CONF_VIRTUAL_WATTS, DOMAIN, MAX_VIRTUAL_WATTS
from .controller import HeaterController
from .logic import virtual_unique_id
from .switch import HeaterBaseEntity

# 12h ceiling: long enough for any real preheat, short enough that a fat finger
# can't leave a heater running for days.
MAX_AUTO_OFF_MINUTES = 720


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    controller: HeaterController = hass.data[DOMAIN]["entries"][entry.entry_id]
    entities: list[NumberEntity] = [AutoOffNumber(controller)]
    if controller.is_virtual:
        entities.append(SimulatedWattsNumber(controller))
    async_add_entities(entities)


class AutoOffNumber(HeaterBaseEntity, NumberEntity):
    """How long the heater may stay on before switching itself off.

    Changing it while the heater is running re-measures from when it actually
    turned on, so shortening it can retire a running heater immediately — which
    is also the quickest way to watch auto-off fire: set it to 1 minute.
    Zero disables auto-off entirely.
    """

    _attr_name = "Auto-off after"
    _attr_entity_category = EntityCategory.CONFIG
    _attr_device_class = NumberDeviceClass.DURATION
    _attr_native_min_value = 0
    _attr_native_max_value = MAX_AUTO_OFF_MINUTES
    _attr_native_step = 1
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_mode = NumberMode.BOX
    _attr_icon = "mdi:timer-off-outline"

    def __init__(self, controller: HeaterController) -> None:
        super().__init__(controller)
        self._attr_unique_id = f"{controller.entry.entry_id}_auto_off"

    @property
    def native_value(self) -> float:
        return self.controller.duration_s / 60

    async def async_set_native_value(self, value: float) -> None:
        self.controller.async_set_option(CONF_AUTO_OFF, int(value * 60))


class SimulatedWattsNumber(HeaterBaseEntity, NumberEntity):
    """How many watts this virtual heater draws while it is on.

    Setting it to 0 is how you exercise the app's "On, unplugged" state without
    unplugging anything.
    """

    _attr_name = "Simulated wattage"
    _attr_entity_category = EntityCategory.CONFIG
    _attr_device_class = NumberDeviceClass.POWER
    _attr_native_min_value = 0
    _attr_native_max_value = MAX_VIRTUAL_WATTS
    _attr_native_step = 50
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_mode = NumberMode.BOX
    _attr_icon = "mdi:flash"

    def __init__(self, controller: HeaterController) -> None:
        super().__init__(controller)
        self._attr_unique_id = virtual_unique_id(controller.entry.entry_id, "watts")

    @property
    def native_value(self) -> float:
        return self.controller.virtual_watts

    async def async_set_native_value(self, value: float) -> None:
        self.controller.async_set_option(CONF_VIRTUAL_WATTS, int(value))
