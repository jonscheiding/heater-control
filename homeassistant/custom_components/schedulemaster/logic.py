"""Pure projection logic — no Home Assistant imports, so it unit-tests directly.

Turns a list of ScheduleMaster reservations into the preheat calendar events we
want to show and act on, applying the tail-number → heater mapping, the
warm-forecast skip, and the cancel suppression set.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

from .const import ATTR_AIRCRAFT_TYPE, ATTR_N_NUMBER, UID_PREFIX
from .models import Reservation


def normalize_tail(value: object) -> str:
    """Canonicalize a tail number for matching (trim + upper-case)."""
    return str(value or "").strip().upper()


@dataclass(frozen=True)
class HeaterRef:
    """A heater a booking maps to, plus metadata for the event payload."""

    entity_id: str
    aircraft_type: str | None


def build_nnumber_map(
    entities: Iterable[tuple[str, Mapping[str, object]]],
) -> dict[str, HeaterRef]:
    """Map normalized tail number -> HeaterRef from entity attributes.

    ``entities`` is an iterable of ``(entity_id, attributes)``. Any entity that
    carries a non-empty ``n_number`` attribute is eligible (the heater packages
    set it via ``homeassistant: customize:``). First one wins on a collision.
    """
    out: dict[str, HeaterRef] = {}
    for entity_id, attrs in entities:
        attrs = attrs or {}
        tail = normalize_tail(attrs.get(ATTR_N_NUMBER))
        if tail:
            aircraft_type = attrs.get(ATTR_AIRCRAFT_TYPE)
            out.setdefault(
                tail,
                HeaterRef(entity_id, str(aircraft_type).strip() or None if aircraft_type else None),
            )
    return out


@dataclass(frozen=True)
class PreheatEvent:
    """A projected heater-on event derived from a reservation."""

    uid: str
    key: str
    entity_id: str  # heater to turn on
    username: str | None  # pilot name
    user_id: str | None
    user_email: str | None
    n_number: str | None
    aircraft_type: str | None
    comment: str | None  # flight comment / destination
    start: datetime  # when the heater turns on (flight start - lead)
    end: datetime  # flight start


def project_events(
    reservations: Iterable[Reservation],
    nnumber_map: Mapping[str, HeaterRef],
    suppressed: set[str],
    forecast_lookup: Callable[[datetime], float | None] | None,
    *,
    preheat_lead: timedelta,
    warm_threshold_f: float,
) -> list[PreheatEvent]:
    """Project reservations into preheat events.

    A reservation is omitted when: it's cancelled (key in ``suppressed``), its
    tail number maps to no heater, or the forecast at flight time is above the
    warm threshold. If the forecast is unknown we keep the event (fail toward
    preheating).
    """
    events: list[PreheatEvent] = []
    for res in reservations:
        if res.key in suppressed:
            continue
        ref = nnumber_map.get(normalize_tail(res.n_number))
        if ref is None:
            continue
        if forecast_lookup is not None:
            temp = forecast_lookup(res.start)
            if temp is not None and temp > warm_threshold_f:
                continue
        events.append(
            PreheatEvent(
                uid=f"{UID_PREFIX}{res.key}",
                key=res.key,
                entity_id=ref.entity_id,
                username=res.pilot_name or None,
                user_id=res.user_id,
                user_email=res.pilot_email or None,
                n_number=res.n_number or None,
                aircraft_type=ref.aircraft_type,
                comment=res.destination or None,
                start=res.start - preheat_lead,
                end=res.start,
            )
        )
    return events


def make_forecast_lookup(
    points: list[tuple[datetime, float]],
    max_gap: timedelta,
) -> Callable[[datetime], float | None]:
    """Build a nearest-hour temperature lookup from (datetime, temp) points.

    Returns None when there is no point within ``max_gap`` of the queried time
    (e.g. a flight beyond the forecast horizon).
    """
    pts = sorted((dt, temp) for dt, temp in points if dt is not None)

    def lookup(when: datetime) -> float | None:
        best: float | None = None
        best_gap: float | None = None
        for dt, temp in pts:
            gap = abs((dt - when).total_seconds())
            if best_gap is None or gap < best_gap:
                best_gap, best = gap, temp
        if best is None or best_gap is None:
            return None
        if best_gap > max_gap.total_seconds():
            return None
        return best

    return lookup
