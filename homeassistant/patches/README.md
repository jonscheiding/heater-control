# HA integration patches

Local overrides layered on top of the `auth_oidc` component. Both the `ha-dev`
container (at image build) and `deploy/push.sh --oidc` (for the HAOS box) fetch
the pinned upstream release and overlay these files — no HACS, no manual step.

## Contents

- `auth_oidc/endpoints/finish.py` — auto-continues past the "Continue on this
  device / Use a code from another device" screen, so browser login is one step.
  Trade-off: the cross-device code flow breaks (irrelevant — pilots log in in
  their own browsers).

## Maintaining

Pinned via `AUTH_OIDC_VERSION` (kept in sync in `ha-dev/Dockerfile` and
`deploy/push.sh`). On a version bump, diff the patched file against the fresh
upstream copy and re-derive if it changed. Remove the patch entirely if upstream
adds an option to bypass the finish screen —
track https://github.com/christiaangoossens/hass-oidc-auth/issues.
