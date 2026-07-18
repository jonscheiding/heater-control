#!/usr/bin/env python3
"""Post-boot HA setup for the dev stack: onboarding + config entries.

Runs after HA is healthy (see docker-compose.yml). Idempotent — safe to run on
every `up`:

  1. Completes the "Create my smart home" wizard (owner account) if not done.
  2. Ensures a local_calendar named "Heater schedules" exists, so the
     calendar.heater_schedules entity the scheduling package triggers on is real.
  3. Reloads automations so calendar-triggered ones attach after the calendar
     entity is up (avoids a boot-order KeyError).

Mirrors the frontend by driving REST endpoints, so HA writes its own state.
Dev convenience only — the default credentials are intentionally trivial.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

HA_URL = os.environ.get("HA_URL", "http://localhost:8123").rstrip("/")
NAME = os.environ.get("HA_ONBOARD_NAME", "Dev")
USERNAME = os.environ.get("HA_ONBOARD_USERNAME", "dev")
PASSWORD = os.environ.get("HA_ONBOARD_PASSWORD", "dev")
LANGUAGE = os.environ.get("HA_ONBOARD_LANGUAGE", "en")
CALENDAR_NAME = os.environ.get("HA_CALENDAR_NAME", "Heater schedules")
CLIENT_ID = HA_URL + "/"


def _req(method, path, data=None, token=None, form=False):
    headers = {}
    body = None
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(HA_URL + path, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else {}


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


def main():
    steps = wait_for_ha()
    done = {s["step"]: s["done"] for s in steps} if steps else {"user": True}
    token = login() if done.get("user") else onboard(done)
    ensure_local_calendar(token)
    wait_for_calendar(token)
    reload_automations(token)
    print(f"[setup] complete — sign in as {USERNAME} / {PASSWORD}")


if __name__ == "__main__":
    main()
