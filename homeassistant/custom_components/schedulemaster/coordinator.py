"""Polling coordinator: fetch reservations, project preheat events."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
import homeassistant.util.dt as dt_util

from .api import ScheduleMasterApi, ScheduleMasterError
from .const import DOMAIN, LOGGER, UID_PREFIX
from .logic import (
    PreheatEvent,
    build_nnumber_map,
    make_forecast_lookup,
    normalize_tail,
    project_events,
)

# Forecast granularity is hourly; don't trust a point more than this far from
# the flight time (also filters flights beyond the forecast horizon).
MAX_FORECAST_GAP = timedelta(minutes=90)

# A read (e.g. the SPA listing the calendar) triggers a re-poll if the data is
# older than this. Keeps the Fly demo fresh when it wakes from suspend — the
# process (and its poll timer) freezes while suspended, so a resume would
# otherwise serve stale data until the next interval.
READ_STALE_AFTER = timedelta(minutes=10)


class ScheduleMasterCoordinator(DataUpdateCoordinator[list[PreheatEvent]]):
    """Keeps the projected preheat events fresh."""

    def __init__(
        self,
        hass: HomeAssistant,
        api: ScheduleMasterApi | None,
        store: Store,
        suppressed: set[str],
        *,
        scan_interval: int,
        preheat_lead: int,
        warm_threshold_f: float,
        lookahead_days: int,
        weather_entity: str,
        timezone: str | None = None,
    ) -> None:
        super().__init__(
            hass,
            LOGGER,
            name=DOMAIN,
            # No credentials -> the entity still exists, we just never poll.
            update_interval=timedelta(minutes=scan_interval) if api else None,
        )
        self._api = api
        self._store = store
        self._suppressed = suppressed
        self._preheat_lead = timedelta(minutes=preheat_lead)
        self._warm_threshold_f = warm_threshold_f
        self._lookahead = timedelta(days=lookahead_days)
        self._weather_entity = weather_entity
        self._timezone = timezone
        self._last_success: datetime | None = None
        self._read_refresh_lock = asyncio.Lock()

    async def async_refresh_if_stale(self) -> None:
        """Re-poll if the data is older than READ_STALE_AFTER (called on read).

        Uses wall-clock age, so a Fly resume (where the poll timer was frozen)
        looks stale and refreshes. The lock + re-check collapses concurrent
        reads into a single poll.
        """
        if self._api is None:
            return

        def fresh() -> bool:
            return (
                self._last_success is not None
                and dt_util.utcnow() - self._last_success <= READ_STALE_AFTER
            )

        if fresh():
            return
        async with self._read_refresh_lock:
            if not fresh():
                await self.async_refresh()

    async def _async_update_data(self) -> list[PreheatEvent]:
        if self._api is None:
            return []

        # The reservation wall-times are in the club's timezone: use the configured
        # override if set, else HA's own timezone. This also bounds the st_date/
        # en_date day filters (which are that same local calendar).
        tz = (self._timezone and dt_util.get_time_zone(self._timezone)) or (
            dt_util.DEFAULT_TIME_ZONE
        )
        start = dt_util.now(tz)
        try:
            reservations = await self._api.async_list_reservations(
                start, start + self._lookahead, tz
            )
        except ScheduleMasterError as err:
            raise UpdateFailed(str(err)) from err

        # Prune suppressions for reservations that no longer exist (past/removed),
        # keeping the store bounded. A rescheduled flight keeps its orig_key, so
        # its cancel survives the date change.
        current_keys = {r.key for r in reservations}
        stale = self._suppressed - current_keys
        if stale:
            self._suppressed -= stale
            await self._save_suppressed()

        nnumber_map = build_nnumber_map(
            (state.entity_id, state.attributes) for state in self.hass.states.async_all()
        )
        forecast_lookup = await self._async_forecast_lookup()

        events = project_events(
            reservations,
            nnumber_map,
            self._suppressed,
            forecast_lookup,
            preheat_lead=self._preheat_lead,
            warm_threshold_f=self._warm_threshold_f,
        )

        # One observable line per poll (see configuration.yaml logger config).
        unmapped = sorted(
            {normalize_tail(r.n_number) for r in reservations}
            - set(nnumber_map)
        )
        LOGGER.info(
            "polled %d reservation(s) -> %d preheat event(s) "
            "[%d heater(s) mapped, forecast %s]%s",
            len(reservations),
            len(events),
            len(nnumber_map),
            "available" if forecast_lookup else "unavailable",
            f"; no heater for tail(s): {', '.join(unmapped)}" if unmapped else "",
        )
        self._last_success = dt_util.utcnow()
        return events

    async def _async_forecast_lookup(self):
        """Build a temperature lookup from the weather entity, or None on error."""
        try:
            resp = await self.hass.services.async_call(
                "weather",
                "get_forecasts",
                {"type": "hourly"},
                target={"entity_id": self._weather_entity},
                blocking=True,
                return_response=True,
            )
        except Exception as err:  # noqa: BLE001 — forecast is best-effort
            LOGGER.debug("weather forecast unavailable (%s); not filtering warm flights", err)
            return None

        forecast = (resp or {}).get(self._weather_entity, {}).get("forecast") or []
        points = []
        for entry in forecast:
            when = dt_util.parse_datetime(entry.get("datetime", ""))
            temp = entry.get("temperature")
            if when is not None and temp is not None:
                points.append((dt_util.as_utc(when), float(temp)))
        if not points:
            return None
        return make_forecast_lookup(points, MAX_FORECAST_GAP)

    async def async_suppress(self, uid: str) -> None:
        """Cancel (suppress) an event by uid; persists and refreshes."""
        key = uid[len(UID_PREFIX) :] if uid.startswith(UID_PREFIX) else uid
        if key not in self._suppressed:
            self._suppressed.add(key)
            await self._save_suppressed()
        await self.async_request_refresh()

    async def _save_suppressed(self) -> None:
        await self._store.async_save({"suppressed": sorted(self._suppressed)})
