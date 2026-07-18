#!/usr/bin/env python3
"""Render env-driven Home Assistant config includes at container start.

Writes ``<config>/auth_oidc.yaml`` and ``<config>/http.yaml`` from environment
variables so one image serves both local dev (host proxy over http) and the Fly
demo (proxy over https) without hardcoding the OIDC issuer or reverse-proxy
settings. ``configuration.yaml`` pulls these in via ``!include``.

PyYAML ships with Home Assistant core, so ``import yaml`` is always available.
"""
import os

import yaml

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
    """http block. cors always; reverse-proxy trust only when enabled."""
    block = {}
    origins = _list("HA_CORS_ORIGINS")
    if origins:
        block["cors_allowed_origins"] = origins
    if _bool("HA_USE_X_FORWARDED_FOR", False):
        block["use_x_forwarded_for"] = True
        proxies = _list("HA_TRUSTED_PROXIES")
        if proxies:
            block["trusted_proxies"] = proxies
    return block


def _write(name, data):
    path = os.path.join(CONFIG, name)
    with open(path, "w") as f:
        yaml.safe_dump(data, f, default_flow_style=False, sort_keys=False)
    print(f"[render-config] wrote {path}")


def main():
    _write("auth_oidc.yaml", render_auth_oidc())
    _write("http.yaml", render_http())


if __name__ == "__main__":
    main()
