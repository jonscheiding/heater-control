"""Reservation model + parsing — dependency-free so it unit-tests directly."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, tzinfo


@dataclass(frozen=True)
class Reservation:
    """A single airplane reservation, normalized for our use."""

    key: str  # durable identity: orig_key, else sch_id
    n_number: str
    start: datetime  # tz-aware (UTC), localized from sch_start
    end: datetime | None
    pilot_first: str
    pilot_last: str
    pilot_email: str
    destination: str
    maint: bool
    user_id: str | None  # made_by_user
    raw: dict = field(default_factory=dict, compare=False, repr=False)

    @property
    def pilot_name(self) -> str:
        return " ".join(p for p in (self.pilot_first, self.pilot_last) if p).strip()


def _to_utc(value: object, tz: tzinfo) -> datetime | None:
    """Parse a ``sch_start``/``sch_end`` wall-time string to an aware UTC datetime.

    The strings are naive local wall-clock in the club's (HA's) timezone, e.g.
    ``"2026-08-11T15:00:00"``. We localize with ``tz`` then convert to UTC. (The
    sibling ``sec_start`` epoch is NOT used — it's that same wall-time reinterpreted
    as UTC, so it's off by the local offset.)
    """
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(UTC)


def parse_reservation(raw: dict, tz: tzinfo) -> Reservation | None:
    """Map one raw schlist entry to a Reservation, or None if unusable.

    ``tz`` is the timezone the ``sch_start``/``sch_end`` wall-times are in (the
    club's / HA's timezone). ``orig_key`` is durable across date edits (which mint
    a new ``sch_id``), so it's our identity when present.
    """
    n_number = str(raw.get("N_NO", "")).strip()
    start = _to_utc(raw.get("sch_start"), tz)
    if start is None or not n_number:
        return None

    key = str(raw.get("orig_key") or raw.get("sch_id") or "").strip()
    if not key:
        return None

    return Reservation(
        key=key,
        n_number=n_number,
        start=start,
        end=_to_utc(raw.get("sch_end"), tz),
        pilot_first=str(raw.get("firstname", "")).strip(),
        pilot_last=str(raw.get("lastname", "")).strip(),
        pilot_email=str(raw.get("email", "")).strip(),
        destination=str(raw.get("destination", "")).strip(),
        user_id=str(raw.get("made_by_user") or "").strip() or None,
        maint=raw.get("maint"),
        raw=raw,
    )


def yymmdd(d: datetime) -> str:
    """Format a datetime as the API's YYMMDD date string."""
    return d.strftime("%y%m%d")
