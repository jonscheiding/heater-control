# Home Assistant configuration

Declarative HA config tracked alongside the SPA. The HA instance itself runs in Docker; see `DEPLOY.md` for host setup.

## What lives here

- `configuration.yaml` and its includes (automations, scripts, helpers, calendars)
- `secrets.yaml.example` — template only; real `secrets.yaml` is gitignored

## What does NOT live here

- HA runtime state: `home-assistant_v2.db`, logs, `.storage/`, registry files
- Real secrets — only the template is tracked

## Phase 3

The ScheduleMaster integration will live at `custom_components/schedulemaster/` (sibling of this directory) when Phase 3 begins.

## Deployment to the HA instance

TBD. Options under consideration:

- Bind-mount this directory into HA's config volume (POC convenience)
- `rsync` on commit
- Git pull on the HA host
