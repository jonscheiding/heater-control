# Home Assistant configuration (reference)

Declarative HA config, tracked alongside the SPA — the reference `/config` plus
the heater roster + generator that renders the per-heater packages. Source of
truth for both the containerized dev/demo image and the HAOS box. The tooling
that builds and runs a container of this config lives in
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
- `packages/` — `scheduling.yaml` (calendar-triggered turn-on) plus one
  **generated** `heater_<id>.yaml` per heater. Enabled via
  `homeassistant: packages: !include_dir_named packages` in `configuration.yaml`.
- `heaters.demo.json` / `heaters.prod.json` — the heater roster (one per
  environment), the **source of truth**. `gen_packages.py` renders each entry into
  a `packages/heater_<id>.yaml` (simulated `input_boolean` + fake power, or a real
  `switch` + auto-off). The generated files are gitignored; `push.sh` and the
  container entrypoint regenerate them.
- `blueprints/automation/heater_control/` — reusable automation templates the
  per-heater packages reference. `switch_with_auto_off` encapsulates the
  timer-start / timer-cancel / timer-finish wiring so each per-heater file stays
  trivially small.
- `patches/` — local overrides applied on top of the `auth_oidc` integration
  (see `patches/README.md`). Both the container (at build time) and
  `deploy/push.sh --oidc` (which ships the pinned + pre-patched component to
  HAOS) overlay these, so no HACS install or manual reapply is needed.

## Adding a new heater

Add an entry to the roster JSON — `heaters.prod.json` and/or `heaters.demo.json`:

```json
{ "id": "heater_7", "label": "C172 N123AB", "simulated": true }
```

`gen_packages.py` renders it to `packages/heater_7.yaml` at deploy
(`deploy/push.sh`) / container start. `id` must be `heater_<n>` — the SPA keys off
`switch.heater_*` / `input_boolean.heater_*`; `label` is the display name.
Optional: `duration` (`HH:MM:SS`/`3h`/`90m`, default 2h), `simulated_power_initial`.
For a **real** heater, drop `simulated` — the device provides `switch.<id>` and its
power sensor, and the package adds only the timer + auto-off. The new entities
appear automatically; the SPA picks them up over WebSocket with no code change.

## What does NOT live here

- HA runtime state: `home-assistant_v2.db`, logs, `.storage/`, registry files.
- The generated `http.yaml` / `auth_oidc.yaml` and `packages/heater_*.yaml`
  (rendered from env / the roster; gitignored).
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
