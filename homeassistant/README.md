# Home Assistant configuration (reference)

Declarative HA config, tracked alongside the SPA. This directory is **pure
reference config** — what a Home Assistant `/config` should contain — and is the
source of truth for both the containerized dev/demo image and the HAOS box. The
tooling that builds and runs a container of this config lives in
[`../ha-dev/`](../ha-dev/); see its README to run the dev stack or deploy the Fly
demo.

## Layout

- `configuration.yaml` — top-level config. Enables only what the app needs
  (deliberately no `default_config`, for a faster boot), the packages dir, and two
  **environment-rendered includes**: `http: !include http.yaml` and
  `auth_oidc: !include auth_oidc.yaml`. Those two files are **not tracked** —
  they're generated at container start from env vars by
  `../ha-dev/render_config.py` (so the OIDC issuer, CORS origins, and reverse-proxy
  trust differ per environment without editing this file). This layout is for the
  **container**; on a prod HAOS box `deploy/push.sh --oidc` renders `auth_oidc.yaml`
  and HTTP/CORS is configured in the UI (2026.8+), so `http.yaml` isn't used there.
- `packages/` — one YAML file per heater. Each bundles its `input_boolean` (or
  eventual `switch`), `timer`, and the auto-off wiring automation. Enabled via
  `homeassistant: packages: !include_dir_named packages` in `configuration.yaml`.
- `blueprints/automation/heater_control/` — reusable automation templates the
  per-heater packages reference. `switch_with_auto_off` encapsulates the
  timer-start / timer-cancel / timer-finish wiring so each per-heater file stays
  trivially small.
- `patches/` — local overrides applied on top of the `auth_oidc` integration
  (see `patches/README.md`). Both the container (at build time) and
  `deploy/push.sh --oidc` (which ships the pinned + pre-patched component to
  HAOS) overlay these, so no HACS install or manual reapply is needed.

## Adding a new heater

```bash
deploy/heater.sh add --n 4 --name "Cessna 172" --duration 3h
```

Scaffolds `packages/heater_<n>.yaml` from the `heater_1.yaml` template. Then
`deploy/push.sh` (prod) or `up --build` / a YAML reload (dev) loads it. The new
entities (`input_boolean.heater_<n>`, `timer.heater_<n>_autooff`) appear
automatically; the SPA picks them up via WebSocket with no code change.

## What does NOT live here

- HA runtime state: `home-assistant_v2.db`, logs, `.storage/`, registry files.
- The generated `http.yaml` / `auth_oidc.yaml` (rendered at container start).
- UI-created helpers/automations (persist in `.storage/`; recreate them here).
- Secrets — the OIDC client secret flows via the `OIDC_CLIENT_SECRET` env var.

## Running / deploying

- **Local dev + Fly demo:** see [`../ha-dev/README.md`](../ha-dev/README.md).
- **HAOS (real deployment):** the box is **provisioned by hand** (onboarding,
  add-ons, HTTP/CORS settings in the UI, and `configuration.yaml` — where you keep
  the `auth_oidc: !include auth_oidc.yaml` line). [`../deploy/`](../deploy/) then
  ships the iterating config via `deploy/push.sh` — `packages/`, the
  `heater_control` blueprint, and repo-tracked `custom_components/` (reload for
  YAML, restart for components). `deploy/push.sh --oidc` handles the set-once OIDC
  bundle: the pinned + patched `auth_oidc` component, the rendered `auth_oidc.yaml`
  include, and the `sm_oidc_client_secret` in `secrets.yaml`.
