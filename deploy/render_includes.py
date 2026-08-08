#!/usr/bin/env python3
"""Render the prod HAOS box's auth_oidc.yaml include from deploy/.env.

Called by push.sh --oidc into a staging dir (HA_CONFIG_DIR). Emits YAML text
directly (stdlib only, no PyYAML) so the ``!secret`` tag survives verbatim. The
client secret is a ``!secret`` reference; push.sh writes its value to the box's
secrets.yaml. HTTP/CORS settings live in the HA UI, not here.
"""
import os

OUT = os.environ["HA_CONFIG_DIR"]
SECRET_KEY = "sm_oidc_client_secret"


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


def main():
    with open(os.path.join(OUT, "auth_oidc.yaml"), "w") as f:
        f.write(render_auth_oidc())
    print("[render] wrote auth_oidc.yaml")


if __name__ == "__main__":
    main()
