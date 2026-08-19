"""Pure heater logic — no Home Assistant imports, so it unit-tests directly.

Everything worth testing lives here as plain functions over plain values:
reading a power sensor, deciding whether a Z-Wave node is reachable, the auto-off
state machine, the YAML-import reconciliation, and the state-attribute contract
the SPA consumes. The Home Assistant glue (entities, config entries, state
tracking) holds no logic of its own.

CI installs only pytest — no ``homeassistant`` package — so this module and
``const`` must import nothing beyond the standard library. See
``homeassistant/tests/heater_control/conftest.py``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Any

from .const import (
    ATTR_AIRCRAFT_TYPE,
    ATTR_AUTO_OFF_AT,
    ATTR_HEATER,
    ATTR_N_NUMBER,
    ATTR_POWER_W,
    ATTR_REACHABLE,
    ATTR_SOURCE_ENTITY,
    CONF_AIRCRAFT_TYPE,
    CONF_AUTO_OFF,
    CONF_MODE,
    CONF_N_NUMBER,
    CONF_NAME,
    CONF_NODE_STATUS_ENTITY,
    CONF_POWER_ENTITY,
    CONF_SOURCE_ENTITY,
    CONF_VIRTUAL_WATTS,
    DEFAULT_AUTO_OFF,
    DEFAULT_VIRTUAL_WATTS,
    LIVE_NODE_STATUSES,
    MODE_REAL,
    MODE_VIRTUAL,
    NO_READING_STATES,
    STATE_OFF,
    STATE_ON,
)

# --- value normalization ----------------------------------------------------


def clean(value: object) -> str | None:
    """Trimmed string, or None when empty/absent."""
    text = str(value).strip() if value is not None else ""
    return text or None


def normalize_tail(value: object) -> str | None:
    """Canonicalize a tail number: upper-case, no leading ``N``.

    The roster this replaces stored tails *without* the N (``"628FN"``) while
    labels carried it (``"N628FN"``), and schedulemaster's ``normalize_tail``
    only trims and upper-cases — so the two spellings were silently
    unmatchable. Storing the N-less form means a heater configured either way
    still binds to its bookings, and the published attribute keeps exactly the
    shape ScheduleMaster's ``N_NO`` field uses today.
    """
    tail = str(value or "").strip().upper()
    if len(tail) > 1 and tail.startswith("N"):
        tail = tail[1:]
    return tail or None


def parse_duration(value: object) -> int:
    """Seconds from any duration spelling this component accepts.

    Home Assistant's duration selector hands back
    ``{"hours": 2, "minutes": 0, "seconds": 0}``; YAML carries the roster's old
    ``HH:MM:SS`` / ``3h`` / ``90m`` forms (ported from gen_packages._duration);
    stored config entries carry a plain int. All normalize to seconds here so
    nothing downstream deals with more than one representation — and so a
    ``timedelta`` never reaches ``entry.data``, which must stay JSON-serializable.
    """
    if isinstance(value, bool):
        raise ValueError(f"invalid duration: {value!r}")
    if isinstance(value, (int, float)):
        return max(0, int(value))
    if isinstance(value, Mapping):
        return max(
            0,
            int(
                float(value.get("hours") or 0) * 3600
                + float(value.get("minutes") or 0) * 60
                + float(value.get("seconds") or 0)
            ),
        )
    if isinstance(value, str):
        text = value.strip().lower()
        if text.isdigit():
            return int(text)
        if text.endswith("h") and text[:-1].isdigit():
            return int(text[:-1]) * 3600
        if text.endswith("m") and text[:-1].isdigit():
            return int(text[:-1]) * 60
        parts = text.split(":")
        if len(parts) == 3 and all(p.strip().isdigit() for p in parts):
            h, m, s = (int(p) for p in parts)
            return h * 3600 + m * 60 + s
    raise ValueError(f"invalid duration: {value!r}")


def format_duration(seconds: int) -> str:
    """``HH:MM:SS`` for display and YAML round-tripping."""
    h, rem = divmod(max(0, int(seconds)), 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


# --- reading the source entities --------------------------------------------


def parse_power(state: object, unit: object = None) -> float | None:
    """Watts from a power sensor's state, or None when there is no reading.

    None for a missing/unavailable sensor and for anything unparseable — the SPA
    treats null as "no power signal, assume it's on" rather than as zero draw,
    which is the difference between "On" and "On, unplugged". Scales kW/mW so a
    device reporting kilowatts doesn't read as 1.2 W.
    """
    if state is None:
        return None
    text = str(state).strip()
    if text.lower() in NO_READING_STATES:
        return None
    try:
        watts = float(text)
    except ValueError:
        return None
    symbol = str(unit or "").strip().lower()
    if symbol == "kw":
        watts *= 1000
    elif symbol == "mw":
        watts /= 1000
    # Rounded so a chatty power sensor doesn't rewrite the wrapper's whole
    # attribute set (and a recorder row) on every insignificant fluctuation.
    return round(watts, 1)


def mirror_is_on(source_state: object) -> bool | None:
    """True/False from a source switch's state; None when it isn't knowable."""
    text = str(source_state or "").strip().lower()
    if text == STATE_ON:
        return True
    if text == STATE_OFF:
        return False
    return None


def is_reachable(source_state: object, node_status: object = None) -> bool:
    """Whether the heater can still be commanded.

    With a Z-Wave node-status sensor configured, that sensor is the only signal
    that counts: Z-Wave JS leaves a switch entity *available*, still reporting
    its last known on/off, after the node drops off the mesh. Without one, fall
    back to the switch's own availability, which is what non-Z-Wave integrations
    report honestly.

    ``asleep`` counts as reachable — a sleeping node wakes for queued commands.
    A configured status sensor that is itself missing or unavailable does not:
    that means the Z-Wave driver is down, so nothing gets through either way.
    """
    if node_status is None:
        return str(source_state or "").strip().lower() not in NO_READING_STATES
    return str(node_status).strip().lower() in LIVE_NODE_STATUSES


# --- the auto-off state machine ---------------------------------------------


@dataclass(frozen=True)
class AutoOff:
    """When a heater turned on, and when it must turn off."""

    turned_on_at: datetime | None = None
    auto_off_at: datetime | None = None


CLEARED = AutoOff()


@dataclass(frozen=True)
class Decision:
    """The outcome of an auto-off transition.

    ``state`` is authoritative: the caller cancels any pending callback and
    re-arms it at ``state.auto_off_at`` (None ⇒ nothing armed), which makes
    applying a decision idempotent. ``defer`` means the source's state isn't
    knowable yet and the caller should re-run the startup sweep once it is.
    """

    state: AutoOff
    turn_off: bool = False
    defer: bool = False


def deadline_for(turned_on_at: datetime, duration_s: int) -> datetime | None:
    """The auto-off instant, or None when auto-off is disabled (duration 0)."""
    if duration_s <= 0:
        return None
    return turned_on_at + timedelta(seconds=duration_s)


def _arm(now: datetime, duration_s: int) -> Decision:
    return Decision(AutoOff(now, deadline_for(now, duration_s)))


def on_source_state(
    prev: AutoOff,
    *,
    old_state: object,
    new_state: object,
    now: datetime,
    duration_s: int,
) -> Decision:
    """Transition on the *source* entity changing state.

    Arming keys off the underlying switch rather than off our own service calls,
    so a heater turned on by the calendar automation or by hand at the plug gets
    the same auto-off as one turned on from the app.
    """
    old = str(old_state or "").strip().lower()
    new = str(new_state or "").strip().lower()

    if new == STATE_ON:
        if old == STATE_ON:
            return Decision(prev)  # attribute-only change; state trackers fire on these
        if old in NO_READING_STATES:
            # A node that flapped unavailable and came back must not restart its
            # clock — otherwise a flapping heater silently extends its own
            # runtime, which is what the blueprint's `to: "on"` trigger did.
            if prev.auto_off_at is not None and prev.auto_off_at > now:
                return Decision(prev)
        return _arm(now, duration_s)

    if new == STATE_OFF:
        return Decision(CLEARED)

    # unavailable / unknown / anything else: hold, so a flap doesn't drop the
    # deadline of a heater that is still physically running.
    return Decision(prev)


def on_startup(
    prev: AutoOff, *, source_state: object, now: datetime, duration_s: int
) -> Decision:
    """Transition when the component starts up (or an entry is set up).

    Replaces the auto-off blueprint's startup sweep. The blueprint had to treat
    "switch on + timer idle" as a missed auto-off because a timer that expired
    during downtime came back idle and indistinguishable from one that never
    ran. We persist the deadline instead, so the two cases separate cleanly:
    a stored deadline in the past really is a missed auto-off and the heater goes
    off, while *no* stored deadline means we have simply never tracked this
    heater (a freshly added entry, or one switched on before this component
    existed) and it gets a fresh deadline rather than being yanked off.
    """
    is_on = mirror_is_on(source_state)
    if is_on is None:
        # Z-Wave is often still interviewing at startup; sweeping now would
        # fail-safe every heater off on every cold boot.
        return Decision(prev, defer=True)
    if not is_on:
        return Decision(CLEARED)
    if prev.auto_off_at is None:
        return _arm(now, duration_s)
    if prev.auto_off_at <= now:
        return Decision(CLEARED, turn_off=True)
    return Decision(prev)


def on_deadline(prev: AutoOff, *, source_state: object, now: datetime) -> Decision:
    """Transition when the armed deadline arrives."""
    del prev, now
    if mirror_is_on(source_state):
        return Decision(CLEARED, turn_off=True)
    return Decision(CLEARED)


def on_tick(prev: AutoOff, *, source_state: object, now: datetime) -> Decision:
    """Periodic safety net for a deadline whose callback never fired.

    Scheduled callbacks run on the event loop's clock, which a suspended Fly
    machine (auto_stop = suspend) freezes — on resume the callback is late by the
    whole suspend. Re-checking the deadline against wall-clock time makes it a
    fact about time rather than a fact about a timer handle, and covers clock
    jumps and DST as well.
    """
    if prev.auto_off_at is None or now < prev.auto_off_at:
        return Decision(prev)
    return on_deadline(prev, source_state=source_state, now=now)


def on_duration_changed(
    prev: AutoOff, *, source_state: object, now: datetime, duration_s: int
) -> Decision:
    """Transition when the configured auto-off duration is edited.

    Measured from when the heater actually turned on — which is why
    ``turned_on_at`` is persisted alongside the deadline — so shortening the
    duration of a running heater can retire it immediately.
    """
    if not mirror_is_on(source_state):
        return Decision(CLEARED)
    if prev.turned_on_at is None:
        return _arm(now, duration_s)
    deadline = deadline_for(prev.turned_on_at, duration_s)
    if deadline is None:
        return Decision(replace(prev, auto_off_at=None))
    if deadline <= now:
        return Decision(CLEARED, turn_off=True)
    return Decision(AutoOff(prev.turned_on_at, deadline))


# --- persistence codec ------------------------------------------------------


def dump_auto_off(state: AutoOff) -> dict[str, str | None]:
    """JSON-safe form for .storage."""
    return {
        "turned_on_at": state.turned_on_at.isoformat() if state.turned_on_at else None,
        "auto_off_at": state.auto_off_at.isoformat() if state.auto_off_at else None,
    }


def load_auto_off(data: Mapping[str, Any] | None) -> AutoOff:
    """Read back a stored deadline, tolerating anything unparseable."""

    def _dt(value: object) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    if not data:
        return CLEARED
    return AutoOff(_dt(data.get("turned_on_at")), _dt(data.get("auto_off_at")))


# --- identity ---------------------------------------------------------------


def wrapper_unique_id(entry_id: str) -> str:
    """Registry id of the heater entity itself."""
    return f"{entry_id}_heater"


def virtual_unique_id(entry_id: str, role: str) -> str:
    """Registry id of a simulated sibling (``power``, ``node_status``, …).

    The wrapper resolves its virtual siblings through the entity registry by
    unique id rather than by guessing an entity id, so a user rename can't
    detach them.
    """
    return f"{entry_id}_sim_{role}"


def import_unique_id(key: str) -> str:
    """Registry id of a YAML-imported heater, derived from its roster key.

    Stable across a wiped ``.storage`` — which is exactly what makes the dev
    container and a fresh Fly volume re-provision the same heaters instead of
    duplicating them.
    """
    return f"import:{key}"


# --- config payloads --------------------------------------------------------


def normalize_heater(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Canonical config-entry data from a YAML entry or a config-flow result.

    One normalization point for both paths, so an imported heater and a
    UI-created one are indistinguishable at runtime.
    """
    virtual = bool(raw.get("virtual")) or raw.get(CONF_MODE) == MODE_VIRTUAL
    name = clean(raw.get(CONF_NAME)) or clean(raw.get("label")) or "Heater"
    return {
        CONF_NAME: name,
        CONF_MODE: MODE_VIRTUAL if virtual else MODE_REAL,
        CONF_SOURCE_ENTITY: None
        if virtual
        else clean(raw.get(CONF_SOURCE_ENTITY) or raw.get("switch")),
        CONF_POWER_ENTITY: None
        if virtual
        else clean(raw.get(CONF_POWER_ENTITY) or raw.get("power")),
        CONF_NODE_STATUS_ENTITY: None
        if virtual
        else clean(raw.get(CONF_NODE_STATUS_ENTITY) or raw.get("node_status")),
        CONF_N_NUMBER: normalize_tail(raw.get(CONF_N_NUMBER)),
        CONF_AIRCRAFT_TYPE: clean(raw.get(CONF_AIRCRAFT_TYPE)),
        CONF_AUTO_OFF: parse_duration(raw.get(CONF_AUTO_OFF, DEFAULT_AUTO_OFF)),
        CONF_VIRTUAL_WATTS: int(
            raw.get(CONF_VIRTUAL_WATTS, DEFAULT_VIRTUAL_WATTS) or 0
        )
        if virtual
        else 0,
    }


@dataclass(frozen=True)
class ImportPlan:
    """What YAML import must do to reconcile config entries with the roster."""

    create: list[tuple[str, dict[str, Any]]]
    update: list[tuple[str, dict[str, Any]]]
    remove: list[str]


def plan_import(
    desired: Mapping[str, Mapping[str, Any]],
    existing: Mapping[str, Mapping[str, Any]],
) -> ImportPlan:
    """Reconcile the rendered roster against the import-sourced config entries.

    Keyed by unique id. Entries that are unchanged are left alone so a container
    restart doesn't reload every heater; entries dropped from the roster are
    removed, which is what a plain create-if-absent provisioner can't do.
    """
    create = sorted((uid, dict(p)) for uid, p in desired.items() if uid not in existing)
    update = sorted(
        (uid, dict(p))
        for uid, p in desired.items()
        if uid in existing and dict(p) != dict(existing[uid])
    )
    remove = sorted(uid for uid in existing if uid not in desired)
    return ImportPlan(create=create, update=update, remove=remove)


# --- the SPA contract -------------------------------------------------------


def heater_attributes(
    *,
    n_number: str | None,
    aircraft_type: str | None,
    power_w: float | None,
    reachable: bool,
    auto_off_at: datetime | None,
    source_entity: str | None,
) -> dict[str, Any]:
    """State attributes the SPA reads off a heater entity.

    ``heater: True`` is the discovery marker — the SPA's only selector — so
    entity ids carry no meaning and stay renameable. Every key is always
    present: a stable attribute shape is easier to consume than one where
    absence and null mean different things.

    ``auto_off_at`` must be timezone-aware; a zone-less timestamp is read in the
    browser's own zone by ``new Date(...)``, which is a bug this project has
    already fixed once in the schedule parsing.
    """
    return {
        ATTR_HEATER: True,
        ATTR_N_NUMBER: n_number,
        ATTR_AIRCRAFT_TYPE: aircraft_type,
        ATTR_POWER_W: power_w,
        ATTR_REACHABLE: reachable,
        ATTR_AUTO_OFF_AT: auto_off_at.isoformat() if auto_off_at else None,
        ATTR_SOURCE_ENTITY: source_entity,
    }
