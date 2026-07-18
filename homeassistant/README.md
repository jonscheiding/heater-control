# Home Assistant configuration (reference)

Declarative HA config, tracked alongside the SPA. This directory is **pure
reference config** — what a Home Assistant `/config` should contain — and is the
source of truth for both the containerized dev/demo image and the eventual HAOS
box. The tooling that builds and runs a container of this config lives in
[`../ha-dev/`](../ha-dev/); see its README to run the dev stack or deploy the Fly
demo.

## Layout

- `configuration.yaml` — top-level config. Loads `default_config`, the packages
  dir, and two **environment-rendered includes**: `http: !include http.yaml` and
  `auth_oidc: !include auth_oidc.yaml`. Those two files are **not tracked** —
  they're generated at container start from env vars by
  `../ha-dev/render_config.py` (so the OIDC issuer, CORS origins, and reverse-proxy
  trust differ per environment without editing this file). On a plain HAOS box,
  create `http.yaml` and `auth_oidc.yaml` by hand.
- `packages/` — one YAML file per heater. Each bundles its `input_boolean` (or
  eventual `switch`), `timer`, and the auto-off wiring automation. Enabled via
  `homeassistant: packages: !include_dir_named packages` in `configuration.yaml`.
- `blueprints/automation/heater_control/` — reusable automation templates the
  per-heater packages reference. `switch_with_auto_off` encapsulates the
  timer-start / timer-cancel / timer-finish wiring so each per-heater file stays
  trivially small.
- `patches/` — local overrides applied on top of the `auth_oidc` integration
  (see `patches/README.md`). The container image applies these at build time; on
  HAOS (where HACS installs the integration) reapply them after updates.
- `auth_oidc.example.yaml` — a reference `auth_oidc` block. The dev/demo image
  generates the live one from env, so this is documentation for the HAOS case.

## Adding a new heater

1. Copy `packages/heater_1.yaml` to `packages/heater_<n>.yaml`.
2. Find/replace `heater_1` with `heater_<n>`.
3. Adjust `duration` if this heater needs a different auto-off window.
4. Rebuild/redeploy (or reload-YAML in HA).

The new entities (`input_boolean.heater_<n>`, `timer.heater_<n>_autooff`) appear
automatically; the SPA picks them up via WebSocket without any code change.

## What does NOT live here

- HA runtime state: `home-assistant_v2.db`, logs, `.storage/`, registry files.
- The generated `http.yaml` / `auth_oidc.yaml` (rendered at container start).
- UI-created helpers/automations (persist in `.storage/`; recreate them here).
- Secrets — the OIDC client secret flows via the `OIDC_CLIENT_SECRET` env var.

## Running / deploying

- **Local dev + Fly demo:** see [`../ha-dev/README.md`](../ha-dev/README.md).
- **HAOS (eventual real deployment):** TBD. HAOS is a locked appliance with no
  `docker`/host shell, so `/config` is reachable only via add-ons. Leading option:
  a deploy script that `rsync`s this directory into `/config` over the SSH add-on,
  hand-creates `http.yaml`/`auth_oidc.yaml`, reapplies `patches/`, then triggers
  `homeassistant.reload_all` (or a restart) via the REST API.
