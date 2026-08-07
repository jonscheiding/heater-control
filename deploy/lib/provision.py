#!/usr/bin/env python3
"""Post-boot Home Assistant provisioning: onboarding + config entries.

Drives HA's REST API to bring a fresh instance to a usable baseline. Idempotent
— safe to run on every boot (dev/Fly) or repeatedly against the prod HAOS box:

  1. Completes the "Create my smart home" wizard (owner account) if not done.
  2. Ensures a local_calendar named "Heater schedules" exists, so the
     calendar.heater_schedules entity the scheduling package triggers on is real.
  3. Sets a placeholder home location (so the dashboard has coordinates to show
     local weather for) unless a real location was already configured.
  4. Ensures a met.no weather entry exists at the home location, giving the SPA
     a weather.* entity with the current local temperature.
  5. Reloads automations so calendar-triggered ones attach after the calendar
     entity is up (avoids a boot-order KeyError).

Mirrors the frontend by driving REST endpoints, so HA writes its own state.

Runs in two contexts from one implementation (see deploy/PLAN.md):
  - the container entrypoint (dev + Fly demo), self-onboarding on boot with
    trivial default credentials;
  - the deploy/ toolkit's bootstrap.sh, onboarding the real HAOS box once with
    real credentials supplied via env.
"""
import os
import time
import urllib.error

from ha_api import bind

HA_URL = os.environ.get("HA_URL", "http://localhost:8123").rstrip("/")
NAME = os.environ.get("HA_ONBOARD_NAME", "Dev")
USERNAME = os.environ.get("HA_ONBOARD_USERNAME", "dev")
PASSWORD = os.environ.get("HA_ONBOARD_PASSWORD", "dev")
LANGUAGE = os.environ.get("HA_ONBOARD_LANGUAGE", "en")
CALENDAR_NAME = os.environ.get("HA_CALENDAR_NAME", "Heater schedules")
CLIENT_ID = HA_URL + "/"

# All REST calls go through a _req bound to HA_URL (see deploy/lib/ha_api.py),
# keeping the terse call sites below.
_req = bind(HA_URL)

# Placeholder home location (Minneapolis, MN — cold enough to need block heaters,
# and consistent with the TZ=America/Chicago the dev stack sets). Only applied
# when HA has no real location yet; override via env for a different demo spot.
HOME_LOCATION_NAME = os.environ.get("HA_LOCATION_NAME", "Home")
HOME_LATITUDE = float(os.environ.get("HA_LATITUDE", "44.9778"))
HOME_LONGITUDE = float(os.environ.get("HA_LONGITUDE", "-93.2650"))
HOME_ELEVATION = float(os.environ.get("HA_ELEVATION", "265"))

# HA's built-in default coordinates (near San Diego) when onboarding can't
# geolocate — treated as "unset" so we know it's safe to drop in the placeholder.
HA_DEFAULT_LATITUDE = 32.87336
HA_DEFAULT_LONGITUDE = -117.22743


def wait_for_ha(timeout=180):
    """Block until HA responds. Returns the onboarding steps, or None if the
    wizard is already complete (the /api/onboarding endpoint 404s once done)."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            return _req("GET", "/api/onboarding")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None  # already onboarded — endpoint is gone
            if time.monotonic() > deadline:
                raise SystemExit(f"[setup] HA unhealthy after {timeout}s: {e}")
            time.sleep(3)
        except (urllib.error.URLError, ConnectionError) as e:
            if time.monotonic() > deadline:
                raise SystemExit(f"[setup] HA not reachable after {timeout}s: {e}")
            time.sleep(3)


def _token_from_code(code):
    return _req(
        "POST",
        "/auth/token",
        {"grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID},
        form=True,
    )["access_token"]


def onboard(done):
    """Create the owner account (+ remaining wizard steps). Returns a token."""
    print(f"[setup] creating owner '{USERNAME}'")
    code = _req(
        "POST",
        "/api/onboarding/users",
        {
            "client_id": CLIENT_ID,
            "name": NAME,
            "username": USERNAME,
            "password": PASSWORD,
            "language": LANGUAGE,
        },
    )["auth_code"]
    token = _token_from_code(code)
    for step, payload in (
        ("core_config", {}),
        ("analytics", {}),
        ("integration", {"client_id": CLIENT_ID, "redirect_uri": CLIENT_ID}),
    ):
        if not done.get(step):
            _req("POST", "/api/onboarding/" + step, payload, token=token)
            print(f"[setup] {step} done")
    return token


def login():
    """Authenticate with the owner credentials; returns a token."""
    flow = _req(
        "POST",
        "/auth/login_flow",
        {"client_id": CLIENT_ID, "handler": ["homeassistant", None], "redirect_uri": CLIENT_ID},
    )["flow_id"]
    result = _req(
        "POST",
        "/auth/login_flow/" + flow,
        {"client_id": CLIENT_ID, "username": USERNAME, "password": PASSWORD},
    )
    if result.get("type") != "create_entry":
        raise SystemExit(f"[setup] login failed: {result}")
    return _token_from_code(result["result"])


def ensure_local_calendar(token):
    """Create a local_calendar named CALENDAR_NAME if none exists yet."""
    entries = _req("GET", "/api/config/config_entries/entry", token=token)
    for e in entries:
        if e.get("domain") == "local_calendar" and e.get("title") == CALENDAR_NAME:
            print(f"[setup] calendar '{CALENDAR_NAME}' already present")
            return
    print(f"[setup] creating local_calendar '{CALENDAR_NAME}'")
    flow = _req(
        "POST",
        "/api/config/config_entries/flow",
        {"handler": "local_calendar", "show_advanced_options": False},
        token=token,
    )["flow_id"]
    _req(
        "POST",
        "/api/config/config_entries/flow/" + flow,
        {"calendar_name": CALENDAR_NAME, "import": "create_empty"},
        token=token,
    )


def wait_for_running(token, timeout=180):
    """Block until HA reports state == RUNNING. wait_for_ha() only checks that
    onboarding is done, which is true immediately on a persisted volume (Fly)
    while integrations/services are still starting. Calling set_location or a
    config-entries flow before then 400s, so gate service calls on RUNNING."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if _req("GET", "/api/config", token=token).get("state") == "RUNNING":
                return True
        except (urllib.error.HTTPError, urllib.error.URLError, ConnectionError):
            pass
        time.sleep(3)
    print("[setup] warning: HA not 'RUNNING' after wait; proceeding anyway")
    return False


def _is_unset_location(lat, lon):
    """True if the coords look like HA's un-geolocated default (or 0,0), meaning
    no real location has been configured and it's safe to set the placeholder."""
    near = lambda a, b: abs(a - b) < 0.001
    if near(lat, 0) and near(lon, 0):
        return True
    return near(lat, HA_DEFAULT_LATITUDE) and near(lon, HA_DEFAULT_LONGITUDE)


def ensure_home_location(token):
    """Set the placeholder home location unless a real one is already configured.
    Persisted by hass.config.async_update, so it survives restarts (Fly volume).
    Returns the effective (lat, lon, elevation) for downstream use."""
    cfg = _req("GET", "/api/config", token=token)
    lat, lon = cfg.get("latitude", 0), cfg.get("longitude", 0)
    if not _is_unset_location(lat, lon):
        print(f"[setup] home location already set ({lat}, {lon}); leaving it")
        return lat, lon, cfg.get("elevation", 0)
    print(f"[setup] setting placeholder home location ({HOME_LATITUDE}, {HOME_LONGITUDE})")
    try:
        _req(
            "POST",
            "/api/services/homeassistant/set_location",
            {
                "latitude": HOME_LATITUDE,
                "longitude": HOME_LONGITUDE,
                "elevation": HOME_ELEVATION,
            },
            token=token,
        )
        return HOME_LATITUDE, HOME_LONGITUDE, HOME_ELEVATION
    except urllib.error.HTTPError as e:
        # Don't let a location hiccup abort the rest of setup (esp. met); met can
        # still be created at the current coords.
        print(f"[setup] set_location failed ({e.code}); leaving location at ({lat}, {lon})")
        return lat, lon, cfg.get("elevation", 0)


def ensure_met_weather(token, lat, lon, elevation):
    """Create a met.no weather entry at (lat, lon) if none exists, so the SPA has
    a weather.* entity to read the local temperature from. The trimmed
    configuration.yaml omits default_config, so no weather source exists by
    default — this adds one via the same config-entries flow the UI uses."""
    entries = _req("GET", "/api/config/config_entries/entry", token=token)
    for e in entries:
        if e.get("domain") == "met":
            print("[setup] met weather already present")
            return
    print(f"[setup] creating met weather at ({lat}, {lon})")
    flow = _req(
        "POST",
        "/api/config/config_entries/flow",
        {"handler": "met", "show_advanced_options": False},
        token=token,
    )
    # A freshly-onboarded HA may auto-create met itself; if so the flow aborts
    # (single_instance_allowed) and there's nothing more to do.
    if flow.get("type") == "abort":
        print(f"[setup] met flow aborted ({flow.get('reason')}); assuming present")
        return
    _req(
        "POST",
        "/api/config/config_entries/flow/" + flow["flow_id"],
        {
            "name": HOME_LOCATION_NAME,
            "latitude": lat,
            "longitude": lon,
            "elevation": elevation,
        },
        token=token,
    )


def wait_for_calendar(token, timeout=90):
    """Wait until the local calendar entity is registered. Reloading the
    calendar-triggered automation before its platform finishes setting up races
    HA and makes the reload service call 400, so gate on the entity first."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for s in _req("GET", "/api/states", token=token):
            if s.get("entity_id", "").startswith("calendar.") and (
                s.get("attributes", {}).get("friendly_name") == CALENDAR_NAME
            ):
                return s["entity_id"]
        time.sleep(2)
    print(f"[setup] warning: calendar '{CALENDAR_NAME}' not up after {timeout}s")
    return None


def reload_automations(token):
    """Re-attach automations (best-effort) now the calendar entity exists."""
    try:
        _req("POST", "/api/services/automation/reload", {}, token=token)
        print("[setup] automations reloaded")
    except urllib.error.HTTPError as e:
        print(f"[setup] automation reload returned {e.code}; the calendar "
              "automation will attach on the next reload/restart")


def _safe(step, fn, *args):
    """Run a setup step; log and swallow failures so one bad step (e.g. a
    transient 400 on cold boot) can't abort the rest of provisioning."""
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001 — best-effort provisioning
        print(f"[setup] {step} failed ({type(e).__name__}: {e}); continuing")
        return None


def main():
    steps = wait_for_ha()
    done = {s["step"]: s["done"] for s in steps} if steps else {"user": True}
    token = login() if done.get("user") else onboard(done)
    # Gate service/config-entry calls on HA being fully up (see wait_for_running).
    wait_for_running(token)
    _safe("ensure_local_calendar", ensure_local_calendar, token)
    lat, lon, elevation = _safe("ensure_home_location", ensure_home_location, token) or (
        HOME_LATITUDE,
        HOME_LONGITUDE,
        HOME_ELEVATION,
    )
    _safe("ensure_met_weather", ensure_met_weather, token, lat, lon, elevation)
    _safe("wait_for_calendar", wait_for_calendar, token)
    _safe("reload_automations", reload_automations, token)
    print(f"[setup] complete — sign in as {USERNAME} / {PASSWORD}")


if __name__ == "__main__":
    main()
