# HAOS deploy — design record

Status: **built and in use.** `deploy/` ships app-config updates to the prod
HAOS box; the box is provisioned by hand. See [`README.md`](README.md) for usage.

## Scope (and why it shrank)

An earlier iteration tried to automate the whole HAOS lifecycle — onboarding,
SSH add-on install, idempotent config provisioning, `http`/`auth_oidc` include
rendering, patched `auth_oidc` shipping, reload-or-restart — reusing the
container's provisioning logic from a shared `deploy/lib/`. First contact with
real hardware made the case for cutting it back to **push-only**:

- **Provisioning a HAOS box by hand is simpler than automating it.** It's a
  once-per-box activity, and the UI does it well. Scripting it bought little.
- **The Supervisor API can't be driven from outside.** `/api/hassio/*` rejects HA
  long-lived access tokens (verified: `/api/ → 200`, `/api/hassio/… → 401`); it
  wants an add-on's `SUPERVISOR_TOKEN`. So add-on install was never truly
  scriptable — it was already a manual UI step. That undercut the "one-command
  bootstrap" premise.
- **The dual-deployment sharing added coupling for little gain.** The container
  (`ha-dev/`) self-provisions; the prod box doesn't need the same code. Keeping
  `provision.py`/`render_config.py` shared in `deploy/lib/` just entangled two
  unrelated concerns.

## What `deploy/` does now

- `push.sh` — rsync the iterating config to the box over the SSH add-on, then
  apply the lightest action: `packages/` + `blueprints/automation/heater_control/`
  (YAML → `homeassistant.reload_all`, hot) and repo-tracked `custom_components/*`
  (Python → core restart, gated on a pre-restart config check). Preflights the
  token/URL first. Per-dir `--delete`, never at `custom_components/` root, so the
  hand-installed `auth_oidc` and any HACS installs are untouched.
- `heater.sh` — scaffold a new heater package from the `heater_1.yaml` template.
- CI (`deploy-haos.yml`) — runs `push.sh` on merge over Tailscale.

Everything set-once on the box — onboarding, add-ons, `configuration.yaml`, the
`http`/`auth_oidc` includes, the hand-installed `auth_oidc` component, other
integrations — is maintained by hand.

## What moved back to `ha-dev/`

Container provisioning returned to being self-contained: `ha-dev/setup.py`
(onboarding) and `ha-dev/render_config.py` (env → includes) run only at container
start. `deploy/lib/` (and `bootstrap.sh`) were removed.

Repo-tracked `custom_components/` (e.g. the schedulemaster integration) **are** in
scope — they iterate, so `push.sh` ships them and restarts. The `auth_oidc`
component stays out because it's set-once and not in the repo.

## Out of scope by design

- **Base-config / include changes** (`configuration.yaml`, `http.yaml`,
  `auth_oidc.yaml`): edited by hand on the box — they change rarely and a mistake
  can take HA down, so they don't belong in an automated push.
- **Golden backups / programmatic onboarding:** dropped.
