# Home Assistant configuration

Declarative HA config tracked alongside the SPA. The HA instance itself runs in Docker; see `DEPLOY.md` for host setup.

## Layout

- `packages/` — one YAML file per heater. Each bundles its `input_boolean` (or eventual `switch`), `timer`, and the auto-off wiring automation. Enabled in HA by adding `homeassistant: packages: !include_dir_named packages/` to `configuration.yaml`.
- `blueprints/automation/heater_control/` — reusable automation templates referenced by the per-heater packages. The `switch_with_auto_off` blueprint encapsulates the timer-start / timer-cancel / timer-finish wiring so each per-heater file stays trivially small.
- `configuration.yaml` and its includes — global HA settings (CORS, packages directive, etc.). Not yet tracked; will be added once the POC config stabilizes.
- `secrets.yaml.example` — template only; real `secrets.yaml` is gitignored.

## Adding a new heater

1. Copy `packages/heater_1.yaml` to `packages/heater_<n>.yaml`.
2. Find/replace `heater_1` with `heater_<n>`.
3. Adjust `duration` if this heater needs a different auto-off window.
4. Deploy (see below). Restart or reload-YAML in HA.

The new entities (`input_boolean.heater_<n>`, `timer.heater_<n>_autooff`) appear automatically; the SPA picks them up via WebSocket without any code change.

## What does NOT live here

- HA runtime state: `home-assistant_v2.db`, logs, `.storage/`, registry files
- UI-created helpers/automations (those persist in `.storage/` and aren't version-controlled — recreate them here instead)
- Real secrets — only the template is tracked

## Phase 3

The ScheduleMaster integration will live at `custom_components/schedulemaster/` (sibling of this directory) when Phase 3 begins.

## Deployment to the HA instance

TBD. Options under consideration:

- Bind-mount this directory into HA's config volume (POC convenience)
- `rsync` on commit
- Git pull on the HA host

For the POC, the simplest path is `docker cp` of the relevant files into the HA container's `/config/` directory, then a YAML-reload or restart from the HA UI. Long-term, a bind-mount is cleaner.
