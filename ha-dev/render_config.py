#!/usr/bin/env python3
"""Render env-driven Home Assistant config at container start.

Writes ``<config>/auth_oidc.yaml``, ``<config>/schedulemaster.yaml`` and
``<config>/heater_control.yaml`` from environment variables so one image serves
both local dev (host proxy over http) and the Fly demo (proxy over https)
without hardcoding the OIDC issuer, the ScheduleMaster account, or the demo
heaters. ``configuration.yaml`` pulls those in via ``!include``.
The HTTP settings (CORS + reverse-proxy trust) are no longer YAML at all — they
are seeded straight into ``<config>/.storage/http`` (see ``render_http``). Also
renders the Fly-only keepalive package into ``<config>/packages/`` when
``HC_KEEPALIVE_URL`` is set.

Runs only at container start (see ha-dev/docker-entrypoint.sh); the prod HAOS box
is provisioned by hand, so this is container-only. PyYAML ships with Home
Assistant core, so ``import yaml`` is always available here.
"""
import json
import os
from datetime import datetime, timezone
from ipaddress import ip_network

import yaml

CONFIG = os.environ.get("HA_CONFIG_DIR", "/config")

# HA's own defaults for the settings we don't manage, so the seeded store is a
# complete config (HA reads several of these keys without a default).
# Mirrors HTTP_STORAGE_SCHEMA in homeassistant/components/http/config.py.
HTTP_DEFAULTS = {
    "server_port": 8123,
    "cors_allowed_origins": ["https://cast.home-assistant.io"],
    "login_attempts_threshold": -1,
    "ip_ban_enabled": True,
    "ssl_profile": "modern",
    "use_x_frame_options": True,
}


def _bool(name, default=False):
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _list(name):
    return [v.strip() for v in os.environ.get(name, "").split(",") if v.strip()]


def render_auth_oidc():
    """auth_oidc block. Always written; discovery failures are non-fatal (HA
    still boots), so an unset issuer degrades gracefully rather than blocking."""
    return {
        "client_id": os.environ.get("OIDC_CLIENT_ID", "home-assistant"),
        "client_secret": os.environ.get("OIDC_CLIENT_SECRET", ""),
        "discovery_url": os.environ.get("OIDC_DISCOVERY_URL", ""),
        "display_name": os.environ.get("OIDC_DISPLAY_NAME", "OpenID Connect (SSO)"),
        "features": {
            "automatic_user_linking": True,
            "automatic_person_creation": True,
            # The proxy serves only openid/profile/email — no groups scope.
            "include_groups_scope": False,
            # Force https on generated URLs behind a TLS-terminating proxy (Fly).
            "force_https": _bool("OIDC_FORCE_HTTPS", False),
        },
        "claims": {
            "display_name": "name",
            "username": "preferred_username",
        },
    }


def render_http():
    """http config. cors always; reverse-proxy trust only when BOTH the flag and
    trusted_proxies are set. HA requires use_x_forwarded_for and trusted_proxies
    together (one inclusion group), so emitting the flag alone is invalid config
    ("some but not all values in the same group of inclusion 'proxy'").

    Not YAML: HA 2026.8 moved the http integration out of `configuration.yaml`
    into the UI (Settings -> System -> Network), backed by `.storage/http`, and
    YAML stops working in 2027.2. Trusted proxies are stored as normalized
    network strings ("0.0.0.0/0"), the shape HA feeds back to ip_network()."""
    conf = dict(HTTP_DEFAULTS)
    origins = _list("HA_CORS_ORIGINS")
    if origins:
        conf["cors_allowed_origins"] = origins
    proxies = [str(ip_network(p)) for p in _list("HA_TRUSTED_PROXIES")]
    if _bool("HA_USE_X_FORWARDED_FOR", False) and proxies:
        conf["use_x_forwarded_for"] = True
        conf["trusted_proxies"] = proxies
    return conf


def render_schedulemaster():
    """schedulemaster block. Always written (so the `!include` resolves), but the
    ScheduleMaster credentials are included only when both are set — without them
    the component still creates an (empty) calendar.schedulemaster and skips
    polling. Options are emitted only when overridden; the component defaults
    otherwise."""
    conf = {}
    user = os.environ.get("SM_USERNAME", "").strip()
    pwd = os.environ.get("SM_PASSWORD", "").strip()
    if user and pwd:
        conf["username"] = user
        conf["password"] = pwd
    for env, key, cast in (
        ("SM_BASE_URL", "base_url", str),
        ("SM_WEATHER_ENTITY", "weather_entity", str),
        ("SM_TIMEZONE", "timezone", str),
        ("SM_WARM_THRESHOLD_F", "warm_threshold_f", float),
        ("SM_PREHEAT_LEAD", "preheat_lead", int),
        ("SM_SCAN_INTERVAL", "scan_interval", int),
        ("SM_LOOKAHEAD_DAYS", "lookahead_days", int),
    ):
        val = os.environ.get(env, "").strip()
        if val:
            conf[key] = cast(val)
    return conf


def render_heater_control():
    """heater_control block — the demo/dev heater roster.

    Config entries live in .storage, which a dev reset wipes and a fresh Fly
    volume never had, so these environments can't be configured by clicking
    through the config flow the way the prod box is. Declaring them here instead
    makes the container self-provisioning: the component reconciles this list
    into config entries on every start (create / update / remove), keyed by each
    heater's stable `key`.

    The roster is the demo JSON that used to feed gen_packages.py. Everything in
    it is virtual — dev has no hardware to wrap."""
    path = os.environ.get("HEATERS_JSON", "/opt/provision/heaters.demo.json")
    try:
        with open(path) as f:
            roster = json.load(f)
    except (OSError, ValueError) as err:
        print(f"[render-config] no heater roster at {path} ({err}); no heaters")
        roster = []
    heaters = []
    for entry in roster:
        heater = {
            "key": entry["id"],
            "name": entry.get("label") or entry["id"],
            "virtual": True,
        }
        for src, dest in (
            ("n_number", "n_number"),
            ("aircraft_type", "aircraft_type"),
            ("duration", "auto_off"),
            ("simulated_power_initial", "virtual_watts"),
        ):
            if entry.get(src) is not None:
                heater[dest] = entry[src]
        heaters.append(heater)
    # Always write the key, even empty, so the `!include` resolves.
    return {"heaters": heaters}


def render_keepalive(url):
    """Fly-only keepalive package. Fly's auto_stop suspends the machine after a
    few idle minutes (not configurable), so an auto-off that outlives the last
    visitor never fires. While any heater has an auto-off armed, ping our own
    PUBLIC URL every 2 minutes — the request re-enters via fly-proxy, which is
    what resets the idle clock (localhost traffic doesn't count). Auto-offs only
    arm when a heater turns on, so the machine is always awake when pinging needs
    to begin; once the last one clears the pings stop and the machine suspends as
    usual."""
    return {
        "rest_command": {
            "fly_keepalive": {"url": url},
        },
        "automation": [
            {
                "alias": "Fly demo: keep machine awake while an auto-off is armed",
                "mode": "single",
                "trigger": [{"platform": "time_pattern", "minutes": "/2"}],
                "condition": [
                    {
                        "condition": "template",
                        "value_template": (
                            "{{ states.switch"
                            " | selectattr('attributes.heater', 'defined')"
                            " | selectattr('attributes.auto_off_at', 'defined')"
                            " | rejectattr('attributes.auto_off_at', 'none')"
                            " | list | count > 0 }}"
                        ),
                    }
                ],
                "action": [{"service": "rest_command.fly_keepalive"}],
            }
        ],
    }


def _write(name, data):
    path = os.path.join(CONFIG, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        yaml.safe_dump(data, f, default_flow_style=False, sort_keys=False)
    print(f"[render-config] wrote {path}")


def _remove_stale(name):
    """Drop a file we no longer render, in case a persisted /config still has
    one (dev bind mount or Fly volume)."""
    path = os.path.join(CONFIG, name)
    if os.path.exists(path):
        os.remove(path)
        print(f"[render-config] removed {path}")


def _http_store_version():
    """(version, minor_version) of HA's http config store.

    Read from the installed Home Assistant rather than hardcoded: HA migrates an
    older stored payload forward on load, but one NEWER than it knows about
    fails, so following the running version is the safe direction. Missing
    entirely means the image predates 2026.8 (http was still YAML-only then) —
    that's a stale base image, and failing loudly beats silently booting without
    the CORS origins the SPA needs."""
    try:
        from homeassistant.components.http.config import (
            STORAGE_MINOR_VERSION,
            STORAGE_VERSION,
        )
    except ImportError as err:
        raise SystemExit(
            "[render-config] this image's Home Assistant has no .storage-backed "
            f"http config ({err}); it predates 2026.8. Rebuild against a current "
            "base image: `docker compose build --pull` (Fly deploys build fresh)."
        )
    return STORAGE_VERSION, STORAGE_MINOR_VERSION


def _load_http_store(path):
    """The stored http payload, or None if absent/unreadable/pre-2026.8 (v1 was
    a flat config under "data"; it's superseded by what we're about to write)."""
    try:
        with open(path) as f:
            raw = json.load(f)
    except (OSError, ValueError):
        return None
    return raw if isinstance(raw.get("data", {}).get("stable"), dict) else None


def write_http_storage(conf):
    """Seed the http settings HA 2026.8+ keeps in `.storage/http`.

    Written before HA starts, straight into the `stable` slot, with the YAML
    migration marked done. Letting HA import a `http:` block instead would stage
    it as `pending` — a five-minute trial that a human has to confirm in the UI
    (Settings -> System -> Network) or HA restarts and reverts to `stable`,
    i.e. the container would drop its CORS origins five minutes in. Env stays
    the source of truth (as `http.yaml` was), so this rewrites the whole config
    on every start and clears any pending trial staged from the UI."""
    version, minor_version = _http_store_version()
    path = os.path.join(CONFIG, ".storage", "http")
    stable = {**conf, "error": None, "error_message": None}

    # Keep the original created_at while the config is unchanged; it's what the
    # UI shows as when these settings were last modified.
    existing = _load_http_store(path)
    prev = existing["data"]["stable"] if existing else {}
    unchanged = {k: v for k, v in prev.items() if k != "created_at"} == stable
    stable["created_at"] = (
        prev["created_at"]
        if unchanged and "created_at" in prev
        else datetime.now(timezone.utc).isoformat()
    )

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(
            {
                "version": version,
                "minor_version": minor_version,
                "key": "http",
                "data": {
                    "stable": stable,
                    "pending": None,
                    "yaml_migration_done": True,
                },
            },
            f,
            indent=2,
        )
    os.chmod(path, 0o600)  # HA writes this store with private=True
    print(f"[render-config] wrote {path} (v{version}.{minor_version})")


def main():
    _write("auth_oidc.yaml", render_auth_oidc())
    _write("schedulemaster.yaml", render_schedulemaster())
    _write("heater_control.yaml", render_heater_control())
    write_http_storage(render_http())

    # http.yaml predates the move to .storage/http; drop a copy left on a
    # persisted /config (dev bind mount or Fly volume) so nothing reads as if
    # the HTTP settings still came from YAML.
    _remove_stale("http.yaml")

    # Keepalive lands in packages/ so !include_dir_named picks it up with no
    # configuration.yaml change. Only rendered when HC_KEEPALIVE_URL is set
    # (ha-dev/fly.toml); in dev packages/ is a read-only bind mount and the var
    # is unset, so nothing is written there. Remove a stale copy on a persisted
    # Fly volume if the var goes away.
    keepalive = os.path.join("packages", "fly_keepalive.yaml")
    keepalive_url = os.environ.get("HC_KEEPALIVE_URL", "").strip()
    if keepalive_url:
        _write(keepalive, render_keepalive(keepalive_url))
    else:
        _remove_stale(keepalive)


if __name__ == "__main__":
    main()
