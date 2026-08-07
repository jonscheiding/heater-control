#!/usr/bin/env python3
"""Render the prod HAOS box's auth_oidc.yaml + http.yaml includes from deploy/.env.

Called by push.sh --oidc into a staging dir (HA_CONFIG_DIR). Emits YAML text
directly — stdlib only (no PyYAML on the operator's machine), and so HA's
``!secret`` tag survives verbatim rather than being quoted into a plain string.

Unlike the container's ha-dev/render_config.py (which inlines the secret), the
prod auth_oidc.yaml references the client secret via ``!secret``, so the value
lives in the box's secrets.yaml (push.sh upserts it there). configuration.yaml on
the box pulls both files in by hand:  auth_oidc: !include auth_oidc.yaml  and
http: !include http.yaml.
"""
import os

OUT = os.environ["HA_CONFIG_DIR"]
SECRET_KEY = "sm_oidc_client_secret"


def _list(name):
    return [v.strip() for v in os.environ.get(name, "").split(",") if v.strip()]


def _bool(name):
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _q(s):
    """Double-quote + escape a scalar (always valid YAML; HA parses it fine)."""
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_auth_oidc():
    return (
        "\n".join(
            [
                f"client_id: {_q(os.environ.get('OIDC_CLIENT_ID', 'home-assistant'))}",
                # Value lives in secrets.yaml (push.sh manages it), not inline.
                f"client_secret: !secret {SECRET_KEY}",
                f"discovery_url: {_q(os.environ.get('OIDC_DISCOVERY_URL', ''))}",
                f"display_name: {_q(os.environ.get('OIDC_DISPLAY_NAME', 'OpenID Connect (SSO)'))}",
                "features:",
                "  automatic_user_linking: true",
                "  automatic_person_creation: true",
                "  include_groups_scope: false",
                f"  force_https: {'true' if _bool('OIDC_FORCE_HTTPS') else 'false'}",
                "claims:",
                "  display_name: name",
                "  username: preferred_username",
            ]
        )
        + "\n"
    )


def render_http():
    """Full http block (this becomes the box's `http: !include http.yaml`).
    Reverse-proxy trust only when BOTH the flag and trusted_proxies are set — HA
    rejects a half-set 'proxy' inclusion group."""
    lines = []
    origins = _list("HA_CORS_ORIGINS")
    if origins:
        lines.append("cors_allowed_origins:")
        lines += [f"- {_q(o)}" for o in origins]
    proxies = _list("HA_TRUSTED_PROXIES")
    if _bool("HA_USE_X_FORWARDED_FOR") and proxies:
        lines.append("use_x_forwarded_for: true")
        lines.append("trusted_proxies:")
        lines += [f"- {_q(p)}" for p in proxies]
    return ("\n".join(lines) + "\n") if lines else "{}\n"


def main():
    with open(os.path.join(OUT, "auth_oidc.yaml"), "w") as f:
        f.write(render_auth_oidc())
    with open(os.path.join(OUT, "http.yaml"), "w") as f:
        f.write(render_http())
    print("[render] wrote auth_oidc.yaml + http.yaml")


if __name__ == "__main__":
    main()
