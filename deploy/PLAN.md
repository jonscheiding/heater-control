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

- `push.sh` (default) — rsync the iterating config over the SSH add-on, then
  apply the lightest action: `packages/` + `blueprints/automation/heater_control/`
  (YAML → `homeassistant.reload_all`, hot) and repo-tracked `custom_components/*`
  (Python → core restart, gated on a pre-restart config check). Preflights the
  token/URL first. Per-dir `--delete`, never at `custom_components/` root, so
  other components on the box are untouched.
- `push.sh --oidc` — the set-once OIDC bundle: materialize the pinned + patched
  `auth_oidc` component and ship it; render `auth_oidc.yaml` (`render_includes.py`,
  emitting the client secret as a `!secret` reference); upsert
  `sm_oidc_client_secret` into the box's `secrets.yaml`; restart. Kept behind a
  flag so routine pushes don't re-fetch the release.
- `push.sh --calendar` — ensure the `local_calendar` config entry named "Heater
  schedules" exists (entity `calendar.heater_schedules`, hard-coded by the
  scheduling package + SPA), via the config-entries flow like `ha-dev/setup.py`.
  A config entry, not YAML, so it can't be a package; idempotent, behind a flag.
- `heater.sh` — scaffold a new heater package from the `heater_1.yaml` template.
- CI (`deploy-haos.yml`) — runs the default `push.sh` on merge over Tailscale.

Maintained by hand on the box: onboarding, add-ons, `configuration.yaml` itself
(you keep the `auth_oidc`/`http` `!include` lines), and other integrations.

## What moved back to `ha-dev/`

Container provisioning returned to being self-contained: `ha-dev/setup.py`
(onboarding) and `ha-dev/render_config.py` (env → includes) run only at container
start. `deploy/lib/` (and `bootstrap.sh`) were removed. The prod include renderer
is a separate `deploy/render_includes.py` — the container inlines the OIDC secret
(ephemeral), while prod references it via `!secret` (lives in `secrets.yaml`).

## Out of scope by design

- **`configuration.yaml` itself:** edited by hand on the box — the `auth_oidc`
  `!include` line is added once, and a mistake in the top-level config can take
  HA down.
- **HTTP settings (CORS, reverse-proxy trust):** HA 2026.8+ moved the `http`
  integration to the UI, so these are a manual step on the box (see the README's
  manual checklist), no longer rendered/pushed. (The `ha-dev` container still
  renders `http.yaml` — it's HA Container, self-provisioned with no UI step.)
- **Golden backups / programmatic onboarding:** dropped.
