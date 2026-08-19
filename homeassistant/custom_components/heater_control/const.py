"""Constants for the heater control integration."""

import logging

DOMAIN = "heater_control"
LOGGER = logging.getLogger(__package__)

# --- config entry keys ------------------------------------------------------
# A heater is one config entry. A *real* heater wraps an existing switch entity
# (and optionally its power / Z-Wave node-status sensors); a *virtual* heater has
# no hardware behind it and simulates all three, so dev and the Fly demo run the
# same code path as the box.
CONF_NAME = "name"  # display name, also the device name (e.g. "N628FN")
CONF_MODE = "mode"
CONF_SOURCE_ENTITY = "source_entity"  # underlying switch (real mode)
CONF_POWER_ENTITY = "power_entity"  # optional
CONF_NODE_STATUS_ENTITY = "node_status_entity"  # optional, Z-Wave diagnostic
CONF_N_NUMBER = "n_number"
CONF_AIRCRAFT_TYPE = "aircraft_type"
CONF_AUTO_OFF = "auto_off"  # seconds the heater may stay on; 0 disables
CONF_VIRTUAL_WATTS = "virtual_watts"  # virtual mode only
CONF_HEATERS = "heaters"  # YAML import list
CONF_KEY = "key"  # stable identity of a YAML-imported heater

MODE_REAL = "real"
MODE_VIRTUAL = "virtual"

DEFAULT_AUTO_OFF = 2 * 60 * 60
DEFAULT_VIRTUAL_WATTS = 1200
MAX_VIRTUAL_WATTS = 3000

# --- the SPA contract -------------------------------------------------------
# State attributes the wrapper entity publishes. `heater` is the discovery
# marker — the SPA selects on it alone, so entity ids carry no meaning and can be
# renamed freely. `n_number` / `aircraft_type` are also what the schedulemaster
# integration maps a booking's tail number against (see its build_nnumber_map).
ATTR_HEATER = "heater"
ATTR_N_NUMBER = "n_number"
ATTR_AIRCRAFT_TYPE = "aircraft_type"
ATTR_POWER_W = "power_w"
ATTR_REACHABLE = "reachable"
ATTR_AUTO_OFF_AT = "auto_off_at"
ATTR_SOURCE_ENTITY = "source_entity"  # debug aid, not read by the SPA

# --- Home Assistant state vocabulary ----------------------------------------
# Repeated here rather than imported from homeassistant.const so this module (and
# logic.py, which imports it) stays HA-free and unit-testable in CI.
STATE_ON = "on"
STATE_OFF = "off"
STATE_UNKNOWN = "unknown"
STATE_UNAVAILABLE = "unavailable"
NO_READING_STATES = frozenset({STATE_UNKNOWN, STATE_UNAVAILABLE, "none", ""})

# Z-Wave node statuses that mean the mesh can still deliver a command. A
# sleeping node ("asleep") wakes for queued commands, so it counts as reachable;
# "dead" does not, and neither does an unknown/unavailable status sensor (the
# Z-Wave driver itself is down, so nothing gets through).
LIVE_NODE_STATUSES = frozenset({"alive", "awake", "asleep"})
NODE_STATUS_ALIVE = "alive"
NODE_STATUS_DEAD = "dead"
NODE_STATUS_OPTIONS = ["alive", "awake", "asleep", "dead", "unknown"]

# Auto-off deadlines, keyed by config entry id. Persisted in .storage rather than
# via RestoreEntity: a config entry reload (options edit, YAML re-import, or the
# core restart deploy/push.sh does) must not reset a running heater's deadline,
# and restore_state only dumps every 15 minutes.
STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.auto_off"
