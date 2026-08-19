"""Simulated hardware readouts for virtual heaters.

These mirror what a real metering Z-Wave plug exposes — a power sensor and the
diagnostic node-status sensor — so a virtual heater looks the same in Home
Assistant as a real one, and the app exercises identical code against both.
Real heaters use the device's own sensors and get none of these.
"""

from __future__ import annotations

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory, UnitOfPower
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, NODE_STATUS_OPTIONS
from .controller import HeaterController
from .logic import virtual_unique_id
from .switch import HeaterBaseEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    controller: HeaterController = hass.data[DOMAIN]["entries"][entry.entry_id]
    if not controller.is_virtual:
        return
    async_add_entities([SimulatedPowerSensor(controller), SimulatedNodeStatus(controller)])


class SimulatedPowerSensor(HeaterBaseEntity, SensorEntity):
    """Draws the configured wattage while on, zero while off."""

    _attr_name = "Power"
    _attr_device_class = SensorDeviceClass.POWER
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, controller: HeaterController) -> None:
        super().__init__(controller)
        self._attr_unique_id = virtual_unique_id(controller.entry.entry_id, "power")

    @property
    def native_value(self) -> float | None:
        return self.controller.power_w


class SimulatedNodeStatus(HeaterBaseEntity, SensorEntity):
    """`dead` while the simulate-offline toggle is on, else `alive`.

    Same vocabulary as the Z-Wave JS diagnostic sensor it stands in for.
    """

    _attr_name = "Node status"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = NODE_STATUS_OPTIONS

    def __init__(self, controller: HeaterController) -> None:
        super().__init__(controller)
        self._attr_unique_id = virtual_unique_id(
            controller.entry.entry_id, "node_status"
        )

    @property
    def native_value(self) -> str | None:
        return self.controller.node_status
