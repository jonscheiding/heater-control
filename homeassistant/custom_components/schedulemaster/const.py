"""Constants for the ScheduleMaster integration."""

import logging

DOMAIN = "schedulemaster"
LOGGER = logging.getLogger(__package__)

# --- config keys (all optional; the component always creates the calendar
# entity, and only polls ScheduleMaster when username + password are set). ---
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_BASE_URL = "base_url"
CONF_SCAN_INTERVAL = "scan_interval"  # minutes
CONF_PREHEAT_LEAD = "preheat_lead"  # minutes before flight to start the heater
CONF_WARM_THRESHOLD_F = "warm_threshold_f"  # skip preheat when warmer than this
CONF_LOOKAHEAD_DAYS = "lookahead_days"
CONF_WEATHER_ENTITY = "weather_entity"
# Timezone the reservation wall-times are in. Defaults to HA's own timezone;
# override when the HA box isn't set to the club's local time.
CONF_TIMEZONE = "timezone"

DEFAULT_BASE_URL = "https://smapi.schedulemaster.com"
DEFAULT_SCAN_INTERVAL = 60
DEFAULT_PREHEAT_LEAD = 90
DEFAULT_WARM_THRESHOLD_F = 45.0
DEFAULT_LOOKAHEAD_DAYS = 1
DEFAULT_WEATHER_ENTITY = "weather.forecast_home"

# Only airplane reservations get a heater.
RES_LIST = "CATEGORY->AIRPLANE,"

# Attributes the heater packages carry (see homeassistant/gen_packages.py): the
# aircraft tail number (used to map a booking to a heater) and its type.
ATTR_N_NUMBER = "n_number"
ATTR_AIRCRAFT_TYPE = "aircraft_type"

# Event source, recorded in the calendar event's JSON description.
SOURCE = "schedulemaster"

CALENDAR_UNIQUE_ID = "schedulemaster_preheat"
CALENDAR_NAME = "ScheduleMaster"

# uid prefix on projected calendar events; the suffix is the reservation's
# durable orig_key (falls back to sch_id).
UID_PREFIX = "sm-"

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.suppressed"
