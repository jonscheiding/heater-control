"""Per-heater runtime: source resolution, state tracking, and auto-off.

One controller per config entry. It owns the only mutable state in the
component — what the heater's source entities currently say, and when the heater
must switch off — and the entities are thin views over it.

Real and virtual heaters run the same path: the controller resolves "is it on",
"how many watts", and "is the node alive" either from configured entities or
from its own simulated values, and nothing downstream knows the difference.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import (
    EventStateChangedData,
    async_track_point_in_utc_time,
    async_track_state_change_event,
    async_track_time_interval,
)
import homeassistant.util.dt as dt_util

from . import logic
from .const import (
    CONF_AIRCRAFT_TYPE,
    CONF_AUTO_OFF,
    CONF_MODE,
    CONF_N_NUMBER,
    CONF_NODE_STATUS_ENTITY,
    CONF_POWER_ENTITY,
    CONF_SOURCE_ENTITY,
    CONF_VIRTUAL_WATTS,
    LOGGER,
    MODE_VIRTUAL,
    NODE_STATUS_ALIVE,
    NODE_STATUS_DEAD,
    STATE_OFF,
    STATE_ON,
    STATE_UNAVAILABLE,
)
from .logic import AutoOff
from .store import AutoOffStore

# Wall-clock safety net for a deadline whose scheduled callback never fired —
# see logic.on_tick for why a suspended machine makes that possible.
TICK = timedelta(minutes=1)


def merged_config(entry: ConfigEntry) -> dict[str, Any]:
    """Entry data with any options edits layered on top."""
    return {**entry.data, **entry.options}


class HeaterController:
    """Runtime for a single heater."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, store: AutoOffStore
    ) -> None:
        self.hass = hass
        self.entry = entry
        self.config = merged_config(entry)
        self._store = store
        self._auto_off = store.get(entry.entry_id)
        self._listeners: list[Callable[[], None]] = []
        self._unsubs: list[Callable[[], None]] = []
        self._cancel_deadline: Callable[[], None] | None = None
        self._last_source_state: str | None = None
        self._snapshot: tuple[Any, ...] | None = None
        self._pending_startup = False

        # Simulated hardware. Only meaningful in virtual mode. The switch
        # position and the offline toggle are runtime state (restored from the
        # entities); the wattage is configuration, so it lives in the entry.
        self._virtual_on = False
        self._virtual_offline = False

    # --- identity -----------------------------------------------------------

    @property
    def is_virtual(self) -> bool:
        return self.config.get(CONF_MODE) == MODE_VIRTUAL

    @property
    def name(self) -> str:
        return str(self.config.get("name") or "Heater")

    @property
    def source_entity(self) -> str | None:
        return None if self.is_virtual else self.config.get(CONF_SOURCE_ENTITY)

    @property
    def duration_s(self) -> int:
        return logic.parse_duration(self.config.get(CONF_AUTO_OFF) or 0)

    # --- what the heater currently reports -----------------------------------

    @property
    def source_state(self) -> str | None:
        """The underlying switch's state, or None when it can't be read."""
        if self.is_virtual:
            return STATE_ON if self._virtual_on else STATE_OFF
        if not self.source_entity:
            return None
        state = self.hass.states.get(self.source_entity)
        return state.state if state else None

    @property
    def is_on(self) -> bool | None:
        return logic.mirror_is_on(self.source_state)

    @property
    def power_w(self) -> float | None:
        if self.is_virtual:
            return self.virtual_watts if self._virtual_on else 0.0
        entity_id = self.config.get(CONF_POWER_ENTITY)
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        return logic.parse_power(state.state, state.attributes.get("unit_of_measurement"))

    @property
    def node_status(self) -> str | None:
        """None means no node-status sensor is configured for this heater."""
        if self.is_virtual:
            return NODE_STATUS_DEAD if self._virtual_offline else NODE_STATUS_ALIVE
        entity_id = self.config.get(CONF_NODE_STATUS_ENTITY)
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        # Configured but missing: the Z-Wave driver itself is down, which is
        # every bit as unreachable as a dead node.
        return state.state if state else STATE_UNAVAILABLE

    @property
    def reachable(self) -> bool:
        return logic.is_reachable(self.source_state, self.node_status)

    @property
    def auto_off_at(self) -> datetime | None:
        return self._auto_off.auto_off_at

    def attributes(self) -> dict[str, Any]:
        return logic.heater_attributes(
            n_number=self.config.get(CONF_N_NUMBER),
            aircraft_type=self.config.get(CONF_AIRCRAFT_TYPE),
            power_w=self.power_w,
            reachable=self.reachable,
            auto_off_at=self.auto_off_at,
            source_entity=self.source_entity,
        )

    # --- commands ------------------------------------------------------------

    async def async_turn(self, on: bool) -> None:
        """Turn the heater on or off.

        Note this only commands the source; it never arms the auto-off directly.
        Arming happens when the source *reports* on, so a heater switched on by
        the calendar automation or by hand at the plug behaves identically to
        one switched on from the app.
        """
        if self.is_virtual:
            self._virtual_on = on
            self._sync()
            return
        if not self.source_entity:
            LOGGER.warning(
                "%s: no source entity configured; ignoring turn_%s",
                self.name,
                "on" if on else "off",
            )
            return
        # The `homeassistant` domain, not `switch`, because the source may be an
        # input_boolean (as the generated dev heaters were).
        await self.hass.services.async_call(
            "homeassistant",
            "turn_on" if on else "turn_off",
            {"entity_id": self.source_entity},
            blocking=True,
        )

    # --- simulated hardware --------------------------------------------------

    @callback
    def set_virtual_offline(self, offline: bool) -> None:
        self._virtual_offline = offline
        self._sync()

    @property
    def virtual_offline(self) -> bool:
        return self._virtual_offline

    @property
    def virtual_watts(self) -> float:
        return float(self.config.get(CONF_VIRTUAL_WATTS) or 0)

    @callback
    def restore_virtual_on(self, on: bool) -> None:
        """Seed the simulated switch position from restored state at startup."""
        self._virtual_on = on

    # --- configuration edited at runtime -------------------------------------

    @callback
    def async_set_option(self, key: str, value: Any) -> None:
        """Persist one config value, from a settings entity on the device page.

        Writing to the entry keeps it the single source of truth — the same
        value the options flow shows — rather than introducing a second,
        entity-local copy that the two could disagree about.
        """
        self.hass.config_entries.async_update_entry(
            self.entry, options={**self.entry.options, key: value}
        )

    @callback
    def async_update_config(self, entry: ConfigEntry) -> None:
        """Adopt an edited config in place, without tearing the entry down.

        Only safe for values that don't change the entity set; see the reload
        listener in __init__.py for which ones those are.
        """
        self.config = merged_config(entry)
        self._apply(
            logic.on_duration_changed(
                self._auto_off,
                source_state=self.source_state,
                now=dt_util.utcnow(),
                duration_s=self.duration_s,
            )
        )
        self._notify(force=True)

    # --- lifecycle -----------------------------------------------------------

    async def async_start(self) -> None:
        """Begin tracking and run the startup sweep."""
        self._resubscribe()
        self._unsubs.append(async_track_time_interval(self.hass, self._handle_tick, TICK))
        self._last_source_state = self.source_state
        self._snapshot = self._current_snapshot()
        self._run_startup()

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        self._cancel_pending_deadline()

    @callback
    def async_add_listener(self, update: Callable[[], None]) -> Callable[[], None]:
        """Register an entity's state-write callback."""
        self._listeners.append(update)

        def _remove() -> None:
            self._listeners.remove(update)

        return _remove

    # --- internals -----------------------------------------------------------

    @callback
    def _resubscribe(self) -> None:
        tracked = [
            entity_id
            for entity_id in (
                self.source_entity,
                self.config.get(CONF_POWER_ENTITY),
                self.config.get(CONF_NODE_STATUS_ENTITY),
            )
            if entity_id
        ]
        if not tracked:
            return
        self._unsubs.append(
            async_track_state_change_event(self.hass, tracked, self._handle_state_event)
        )

    @callback
    def _handle_state_event(self, event: Event[EventStateChangedData]) -> None:
        del event
        self._sync()

    @callback
    def _handle_tick(self, now: datetime) -> None:
        self._apply(
            logic.on_tick(self._auto_off, source_state=self.source_state, now=now)
        )

    @callback
    def _sync(self) -> None:
        """Re-read the source entities and run any auto-off transition."""
        current = self.source_state
        if current != self._last_source_state:
            old, self._last_source_state = self._last_source_state, current
            self._apply(
                logic.on_source_state(
                    self._auto_off,
                    old_state=old,
                    new_state=current,
                    now=dt_util.utcnow(),
                    duration_s=self.duration_s,
                )
            )
        if self._pending_startup and logic.mirror_is_on(current) is not None:
            self._run_startup()
        self._notify()

    @callback
    def _run_startup(self) -> None:
        decision = logic.on_startup(
            self._auto_off,
            source_state=self.source_state,
            now=dt_util.utcnow(),
            duration_s=self.duration_s,
        )
        # A source that isn't readable yet (Z-Wave still interviewing) gets swept
        # again on its first real state, rather than being failed safe off.
        self._pending_startup = decision.defer
        if not decision.defer:
            self._apply(decision)

    @callback
    def _apply(self, decision: logic.Decision) -> None:
        changed = decision.state != self._auto_off
        self._auto_off = decision.state
        self._cancel_pending_deadline()
        if self._auto_off.auto_off_at is not None:
            self._cancel_deadline = async_track_point_in_utc_time(
                self.hass, self._handle_deadline, self._auto_off.auto_off_at
            )
        if changed:
            self._store.set(self.entry.entry_id, self._auto_off)
        if decision.turn_off:
            LOGGER.info("%s: auto-off reached, turning off", self.name)
            self.hass.async_create_task(self.async_turn(False))
        self._notify()

    @callback
    def _handle_deadline(self, now: datetime) -> None:
        self._apply(
            logic.on_deadline(self._auto_off, source_state=self.source_state, now=now)
        )

    @callback
    def _cancel_pending_deadline(self) -> None:
        if self._cancel_deadline is not None:
            self._cancel_deadline()
            self._cancel_deadline = None

    def _current_snapshot(self) -> tuple[Any, ...]:
        return (self.source_state, self.power_w, self.reachable, self.auto_off_at)

    @callback
    def _notify(self, force: bool = False) -> None:
        """Write entity states, but only when something the SPA reads changed.

        A chatty power sensor would otherwise rewrite the whole attribute set —
        and a recorder row — on every insignificant fluctuation. ``force`` is for
        config edits, which change what the settings entities display without
        necessarily changing anything in the snapshot.
        """
        snapshot = self._current_snapshot()
        if snapshot == self._snapshot and not force:
            return
        self._snapshot = snapshot
        for update in self._listeners:
            update()
