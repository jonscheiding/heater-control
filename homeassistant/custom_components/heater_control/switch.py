"""The heater entity, plus the simulated-offline toggle for virtual heaters."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory, STATE_ON
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN
from .controller import HeaterController
from .logic import virtual_unique_id, wrapper_unique_id


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    controller: HeaterController = hass.data[DOMAIN]["entries"][entry.entry_id]
    entities: list[SwitchEntity] = [HeaterSwitch(controller)]
    if controller.is_virtual:
        entities.append(SimulateOfflineSwitch(controller))
    async_add_entities(entities)


class HeaterBaseEntity:
    """Shared device identity and controller subscription."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, controller: HeaterController) -> None:
        self.controller = controller
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, controller.entry.entry_id)},
            name=controller.name,
            manufacturer="heater-control",
            model="Virtual heater" if controller.is_virtual else "Heater",
        )

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()  # type: ignore[misc]
        self.async_on_remove(  # type: ignore[attr-defined]
            self.controller.async_add_listener(self.async_write_ha_state)  # type: ignore[attr-defined]
        )


class HeaterSwitch(HeaterBaseEntity, RestoreEntity, SwitchEntity):
    """The heater itself — the only entity the app looks at.

    Deliberately always ``available``: Home Assistant drops custom attributes
    from an unavailable entity, so going unavailable when the Z-Wave node dies
    would take ``n_number`` and ``aircraft_type`` with it and break the app's
    scheduling dialog. Unreachability is published as the ``reachable``
    attribute instead, and an unreadable source shows up as an ``unknown``
    state, which keeps the attributes.
    """

    _attr_name = None  # named after its device
    _attr_icon = "mdi:radiator"

    def __init__(self, controller: HeaterController) -> None:
        super().__init__(controller)
        self._attr_unique_id = wrapper_unique_id(controller.entry.entry_id)

    @property
    def available(self) -> bool:
        return True

    @property
    def is_on(self) -> bool | None:
        return self.controller.is_on

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return self.controller.attributes()

    async def async_added_to_hass(self) -> None:
        # A virtual heater has no hardware to read its position back from, so
        # restore it before the controller runs its startup sweep.
        if self.controller.is_virtual:
            last = await self.async_get_last_state()
            if last is not None:
                self.controller.restore_virtual_on(last.state == STATE_ON)
        await super().async_added_to_hass()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.controller.async_turn(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.controller.async_turn(False)


class SimulateOfflineSwitch(HeaterBaseEntity, RestoreEntity, SwitchEntity):
    """Fakes a dead Z-Wave node, so dev and the demo can exercise that path.

    Replaces the generated ``input_boolean.simulated_offline_<id>`` helper —
    which had to be named outside the heater namespace so the app's old prefix
    scan wouldn't render it as a phantom heater. Being a plain entity on the
    heater's device with no ``heater`` attribute, it now simply can't be
    mistaken for one.
    """

    _attr_name = "Simulate offline"
    _attr_icon = "mdi:lan-disconnect"
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, controller: HeaterController) -> None:
        super().__init__(controller)
        self._attr_unique_id = virtual_unique_id(controller.entry.entry_id, "offline")

    @property
    def is_on(self) -> bool:
        return self.controller.virtual_offline

    async def async_added_to_hass(self) -> None:
        last = await self.async_get_last_state()
        if last is not None:
            self.controller.set_virtual_offline(last.state == STATE_ON)
        await super().async_added_to_hass()

    async def async_turn_on(self, **kwargs: Any) -> None:
        self.controller.set_virtual_offline(True)
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs: Any) -> None:
        self.controller.set_virtual_offline(False)
        self.async_write_ha_state()
