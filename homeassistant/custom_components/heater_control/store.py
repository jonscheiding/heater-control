"""Persisted auto-off deadlines.

One domain-wide store keyed by config entry id, rather than RestoreEntity: a
config entry reload (an options edit, a YAML re-import, or the core restart
``deploy/push.sh`` performs) must not reset a running heater's deadline, and
``restore_state`` only dumps every 15 minutes — so a heater turned on a minute
before an unclean shutdown would come back with no record of it.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION
from .logic import AutoOff, dump_auto_off, load_auto_off

SAVE_DELAY = 1


class AutoOffStore:
    """Reads and writes the ``{entry_id: {turned_on_at, auto_off_at}}`` store."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, Any] = {}

    async def async_load(self) -> None:
        self._data = await self._store.async_load() or {}

    def get(self, entry_id: str) -> AutoOff:
        return load_auto_off(self._data.get(entry_id))

    def set(self, entry_id: str, state: AutoOff) -> None:
        self._data[entry_id] = dump_auto_off(state)
        self._save()

    def remove(self, entry_id: str) -> None:
        if self._data.pop(entry_id, None) is not None:
            self._save()

    def _save(self) -> None:
        # Delayed rather than immediate so a burst of transitions coalesces; HA
        # flushes pending delayed saves on final write.
        self._store.async_delay_save(lambda: self._data, SAVE_DELAY)
