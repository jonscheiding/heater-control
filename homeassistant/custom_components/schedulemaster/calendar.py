"""The calendar.schedulemaster entity — a live projection of SM bookings."""

from __future__ import annotations

from datetime import datetime
import json

from homeassistant.components.calendar import (
    CalendarEntity,
    CalendarEntityFeature,
    CalendarEvent,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.typing import ConfigType, DiscoveryInfoType
from homeassistant.helpers.update_coordinator import CoordinatorEntity
import homeassistant.util.dt as dt_util

from .const import CALENDAR_NAME, CALENDAR_UNIQUE_ID, DOMAIN, SOURCE
from .coordinator import ScheduleMasterCoordinator
from .logic import PreheatEvent


async def async_setup_platform(
    hass: HomeAssistant,
    config: ConfigType,
    async_add_entities: AddEntitiesCallback,
    discovery_info: DiscoveryInfoType | None = None,
) -> None:
    """Set up the calendar from the component's YAML setup (via discovery)."""
    coordinator: ScheduleMasterCoordinator = hass.data[DOMAIN]["coordinator"]
    async_add_entities([ScheduleMasterCalendar(coordinator)])


def _to_event(ev: PreheatEvent) -> CalendarEvent:
    # summary: human label for the HA calendar UI ("Name - Tail").
    label_parts = [p for p in (ev.username, ev.n_number) if p]
    summary = " - ".join(label_parts) if label_parts else (ev.n_number or SOURCE)
    # description: structured payload shared with the SPA + turn-on automation.
    # The automation reads entity_id out of this JSON.
    description = json.dumps(
        {
            "entity_id": ev.entity_id,
            "source": SOURCE,
            "username": ev.username,
            "user_id": ev.user_id,
            "user_email": ev.user_email,
            "n_number": ev.n_number,
            "aircraft_type": ev.aircraft_type,
            "comment": ev.comment,
            "flight_start": ev.flight_start.isoformat(),
            "flight_end": ev.flight_end.isoformat() if ev.flight_end else None,
        }
    )
    return CalendarEvent(
        summary=summary,
        start=ev.start,
        end=ev.end,
        description=description,
        uid=ev.uid,
    )


class ScheduleMasterCalendar(CoordinatorEntity[ScheduleMasterCoordinator], CalendarEntity):
    """Read-only-ish calendar; deletion records a cancel suppression."""

    _attr_has_entity_name = False
    _attr_name = CALENDAR_NAME
    _attr_unique_id = CALENDAR_UNIQUE_ID
    _attr_icon = "mdi:airplane-clock"
    _attr_supported_features = CalendarEntityFeature.DELETE_EVENT

    @property
    def event(self) -> CalendarEvent | None:
        """The current or next upcoming preheat event."""
        now = dt_util.utcnow()
        upcoming = sorted(
            (e for e in self.coordinator.data or [] if e.end > now),
            key=lambda e: e.start,
        )
        return _to_event(upcoming[0]) if upcoming else None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        return [
            _to_event(e)
            for e in self.coordinator.data or []
            if e.end > start_date and e.start < end_date
        ]

    async def async_delete_event(
        self,
        uid: str,
        recurrence_id: str | None = None,
        recurrence_range: str | None = None,
    ) -> None:
        """Cancel a preheat: suppress it so it stays gone across syncs."""
        await self.coordinator.async_suppress(uid)
