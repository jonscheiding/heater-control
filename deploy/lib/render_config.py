#!/usr/bin/env python3
"""Render env-driven Home Assistant config includes at container start.

Writes ``<config>/auth_oidc.yaml`` and ``<config>/http.yaml`` from environment
variables so one image serves both local dev (host proxy over http) and the Fly
demo (proxy over https) without hardcoding the OIDC issuer or reverse-proxy
settings. ``configuration.yaml`` pulls these in via ``!include``. Also renders
the Fly-only keepalive package into ``<config>/packages/`` when
``HC_KEEPALIVE_URL`` is set.

Serialization: PyYAML ships with Home Assistant core, so inside the container we
use it. But this module is shared with the deploy toolkit, which runs on an
operator's laptop / CI runner where PyYAML may be absent — so we fall back to a
tiny built-in emitter there. The fallback only needs to handle the flat include
structures (http/auth_oidc); the nested keepalive package is only ever rendered
inside the container, where PyYAML is present.
"""
import os

try:
    import yaml
except ModuleNotFoundError:  # operator laptop / CI without PyYAML
    yaml = None

CONFIG = os.environ.get("HA_CONFIG_DIR", "/config")


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
    """http block. cors always; reverse-proxy trust only when BOTH the flag and
    trusted_proxies are set. HA requires use_x_forwarded_for and trusted_proxies
    together (one inclusion group), so emitting the flag alone is invalid config
    ("some but not all values in the same group of inclusion 'proxy'")."""
    block = {}
    origins = _list("HA_CORS_ORIGINS")
    if origins:
        block["cors_allowed_origins"] = origins
    proxies = _list("HA_TRUSTED_PROXIES")
    if _bool("HA_USE_X_FORWARDED_FOR", False) and proxies:
        block["use_x_forwarded_for"] = True
        block["trusted_proxies"] = proxies
    return block


def render_keepalive(url):
    """Fly-only keepalive package. Fly's auto_stop suspends the machine after a
    few idle minutes (not configurable), so an auto-off timer that outlives the
    last visitor never fires. While any timer is active, ping our own PUBLIC URL
    every 2 minutes — the request re-enters via fly-proxy, which is what resets
    the idle clock (localhost traffic doesn't count). Timers only start from SPA
    interaction, so the machine is always awake when pinging needs to begin; once
    the last timer goes idle the pings stop and the machine suspends as usual."""
    return {
        "rest_command": {
            "fly_keepalive": {"url": url},
        },
        "automation": [
            {
                "alias": "Fly demo: keep machine awake while auto-off timers run",
                "mode": "single",
                "trigger": [{"platform": "time_pattern", "minutes": "/2"}],
                "condition": [
                    {
                        "condition": "template",
                        "value_template": (
                            "{{ states.timer"
                            " | selectattr('state', 'eq', 'active')"
                            " | list | count > 0 }}"
                        ),
                    }
                ],
                "action": [{"service": "rest_command.fly_keepalive"}],
            }
        ],
    }


def _scalar(v):
    """Serialize a scalar for the fallback emitter. Bools as YAML true/false;
    everything else double-quoted + escaped (always valid, HA parses it fine)."""
    if isinstance(v, bool):
        return "true" if v else "false"
    s = str(v).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def _emit(data, indent=0):
    """Minimal block-YAML for dicts, nested dicts, and lists of scalars — enough
    for http.yaml / auth_oidc.yaml. Refuses nested collections (only the keepalive
    package needs those, and it's rendered only where PyYAML is present)."""
    lines = []
    pad = " " * indent
    for key, val in data.items():
        if isinstance(val, dict):
            lines.append(f"{pad}{key}:")
            lines += _emit(val, indent + 2)
        elif isinstance(val, list):
            lines.append(f"{pad}{key}:")
            for item in val:
                if isinstance(item, (dict, list)):
                    raise TypeError("fallback emitter can't serialize nested collections; PyYAML required")
                lines.append(f"{pad}- {_scalar(item)}")
        else:
            lines.append(f"{pad}{key}: {_scalar(val)}")
    return lines


def _dump(data):
    if yaml is not None:
        return yaml.safe_dump(data, default_flow_style=False, sort_keys=False)
    return ("\n".join(_emit(data)) + "\n") if data else "{}\n"


def _write(name, data):
    path = os.path.join(CONFIG, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(_dump(data))
    print(f"[render-config] wrote {path}")


def main():
    _write("auth_oidc.yaml", render_auth_oidc())
    _write("http.yaml", render_http())

    # Keepalive lands in packages/ so !include_dir_named picks it up with no
    # configuration.yaml change. Only rendered when HC_KEEPALIVE_URL is set
    # (ha-dev/fly.toml); in dev packages/ is a read-only bind mount and the var
    # is unset, so nothing is written there. Remove a stale copy on a persisted
    # Fly volume if the var goes away.
    keepalive_path = os.path.join(CONFIG, "packages", "fly_keepalive.yaml")
    keepalive_url = os.environ.get("HC_KEEPALIVE_URL", "").strip()
    if keepalive_url:
        _write(os.path.join("packages", "fly_keepalive.yaml"), render_keepalive(keepalive_url))
    elif os.path.exists(keepalive_path):
        os.remove(keepalive_path)
        print(f"[render-config] removed {keepalive_path}")


if __name__ == "__main__":
    main()
