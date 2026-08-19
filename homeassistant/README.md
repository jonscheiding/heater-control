# Home Assistant configuration (reference)

Declarative HA config, tracked alongside the SPA — the reference `/config` plus
the heater roster + generator that renders the per-heater packages. Source of
truth for both the containerized dev/demo image and the HAOS box. The tooling
that builds and runs a container of this config lives in
[`../ha-dev/`](../ha-dev/); see its README to run the dev stack or deploy the Fly
demo.

## Layout

- `configuration.yaml` — top-level config. Enables only what the app needs
  (deliberately no `default_config`, for a faster boot), the packages dir, and the
  **environment-rendered includes** `auth_oidc: !include auth_oidc.yaml` and
  `schedulemaster: !include schedulemaster.yaml`. Those files are **not tracked** —
  they're generated at container start from env vars by
  `../ha-dev/render_config.py` (so the OIDC issuer and the ScheduleMaster account
  differ per environment without editing this file). On a prod HAOS box
  `deploy/push.sh --oidc` renders `auth_oidc.yaml` and `schedulemaster.yaml` is
  written by hand.
- **HTTP settings** (CORS origins + reverse-proxy trust) are deliberately **not**
  in this file. HA 2026.8 moved the `http` integration out of YAML into the UI
  (Settings → System → Network), backed by `.storage/http`; YAML stops working in
  2027.2. The container seeds that store from `HA_CORS_ORIGINS` /
  `HA_USE_X_FORWARDED_FOR` / `HA_TRUSTED_PROXIES` before HA starts
  (`../ha-dev/render_config.py`), so it needs a base image on 2026.8+; on a HAOS
  box it's a one-time setting in the UI (see [`../deploy/`](../deploy/)).
- **Calendar event schema** — both calendars (`calendar.heater_schedules` and
  `calendar.schedulemaster`) use the same shape: the event **summary** is a human
  label (`"Name - Tail"`) for the HA calendar UI, and the **description** is a JSON
  payload — `{entity_id, source, username, user_id, user_email, n_number,
aircraft_type, comment}`. The turn-on automation reads `entity_id` from it (and
  still tolerates a legacy plain-`entity_id` description); the SPA reads the rest.
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
- `custom_components/schedulemaster/` — the ScheduleMaster integration (see
  "ScheduleMaster integration" below). Shipped to HAOS by `deploy/push.sh` (part
  of the repo `custom_components/` sync) and baked into the dev image.

## Adding a new heater

Add an entry to the roster JSON — `heaters.prod.json` and/or `heaters.demo.json`:

```json
{ "id": "heater_7", "label": "C172 N123AB", "simulated": true }
```

`gen_packages.py` renders it to `packages/heater_7.yaml` at deploy
(`deploy/push.sh`) / container start. `id` must be `heater_<n>` — the SPA keys off
`switch.heater_*` / `input_boolean.heater_*`; `label` is the display name.
Optional: `duration` (`HH:MM:SS`/`3h`/`90m`, default 2h), `simulated_power_initial`,
`n_number` (aircraft tail number, e.g. `N123AB`), and `aircraft_type` (e.g. `C172`).
`n_number` / `aircraft_type` are emitted as entity attributes via
`homeassistant: customize:`; the ScheduleMaster integration maps a booking's tail
number to the heater with the matching `n_number`, so set it to exactly the value
ScheduleMaster reports in `N_NO`.
For a **real** heater, drop `simulated` — the device provides `switch.<id>` and its
power sensor, and the package adds only the timer + auto-off. The new entities
appear automatically; the SPA picks them up over WebSocket with no code change.

## Reachability (`sensor.<id>_node_status`)

Z-Wave JS does **not** mark a switch entity `unavailable` when its node stops
answering — entity availability there tracks the driver connection and the node
interview, not the node's current status, so `switch.heater_1` keeps serving its
last known `on`/`off` and the SPA would happily offer to toggle a device that
can't hear it. The reachability signal lives in the node's diagnostic **Node
status** sensor (`alive` / `awake` / `asleep` / `dead` / `unknown`).

So the SPA correlates one by convention: **rename that sensor to
`sensor.<heater id>_node_status`** (Settings → Devices → the switch's device →
Node status → gear → Entity ID; e.g. `sensor.node_2_node_status` →
`sensor.heater_1_node_status`). Anything other than alive/awake/asleep renders
the heater as "Unreachable" with its power button disabled. The sensor is
optional — heaters without one fall back to the switch entity's own
`unavailable`/`unknown` state, which is what non-Z-Wave integrations do.

Simulated heaters generate their own `sensor.<id>_node_status` from an
`input_boolean.simulated_offline_<id>` toggle, so dev and the Fly demo can
exercise the same path (see [`../ha-dev/README.md`](../ha-dev/README.md)). That
helper is deliberately named outside the `heater_*` namespace — the SPA reads
every `input_boolean.heater_*` as a heater, so `heater_2_simulated_offline`
would appear as a phantom heater row.

### Entity ids are frozen at creation

The SPA correlates a heater's companions **by entity id** —
`sensor.<id>_power`, `sensor.<id>_node_status`, `timer.<id>_autooff` — so the
generated template sensors are named `heater_<n>_power` /
`heater_<n>_node_status` and get their display names back through
`customize: friendly_name`. That indirection is deliberate: a template entity's
entity id is slugified from its `name`, and the entity registry pins it at first
creation, keyed by `unique_id`. Naming the sensors after the label instead
produced ids like `sensor.c182_n9525d_power` that the SPA never found — and
editing the label afterwards did **not** move them (nor the registry's
`original_name`, so those entities also kept showing a stale friendly name).

The practical consequence: an entity keeps whatever id it was born with. Fixing
one means renaming it in the UI (Settings → Devices & Services → Entities → the
entity → gear → Entity ID) or deleting its registry entry so it gets recreated.
For the dev container, `docker compose down && rm -rf .dev` does it wholesale.

## ScheduleMaster integration

`custom_components/schedulemaster/` auto-preheats aircraft from ScheduleMaster
flight bookings. It polls the ScheduleMaster JSON API
(`smapi.schedulemaster.com`: `findToken` → `schlist`, re-authenticating each
cycle since tokens are short-lived) and exposes a **`calendar.schedulemaster`**
entity that is a live projection of the upcoming airplane reservations:

- For each booking it maps `N_NO` → the heater with the matching `n_number`
  attribute and emits a preheat event starting **2h before** the flight
  (`preheat_lead`, configurable). The `scheduling.yaml` turn-on automation (which
  also triggers on this calendar) reads the target heater out of the event and
  turns it on; the per-heater auto-off timer turns it off.
- Bookings that **disappear** drop out of the projection automatically. A booking
  whose forecast temperature at flight time is **above `warm_threshold_f`** is
  omitted (no preheat needed) — so the threshold is the temperature above which
  preheating is unnecessary (~45°F for real use; set it high, e.g. 100, to see
  everything while testing in warm weather). Flights beyond the forecast horizon
  have no temperature yet, so they're kept (fail toward preheating). Cancelling an
  event from the SPA records a suppression (persisted) so it stays cancelled —
  and, because identity is the durable `orig_key`, survives a booking date change.
- Reservation times (`sch_start`) are **wall-clock in the club's timezone**. The
  component interprets them in HA's own timezone by default; if the HA box isn't
  set to the club's local time, set `timezone` (`SM_TIMEZONE`, e.g.
  `America/New_York`) to the club's zone. (The API's `sec_start` epoch is not used
  — it's the same wall-time reinterpreted as UTC, so it's off by the local offset.)
- The calendar entity is **always created** (so the SPA has something to read);
  ScheduleMaster is only polled when `username` + `password` are configured.

Config lives in the env-rendered `schedulemaster.yaml` include (like
`auth_oidc.yaml`), pulled in by `configuration.yaml`. In the container it's
rendered by `ha-dev/render_config.py` from `SM_USERNAME` / `SM_PASSWORD` (and
optional `SM_BASE_URL`, `SM_TIMEZONE`, `SM_WARM_THRESHOLD_F`, `SM_PREHEAT_LEAD`,
`SM_WEATHER_ENTITY`, `SM_SCAN_INTERVAL`, `SM_LOOKAHEAD_DAYS`). On a **prod HAOS
box**, add `schedulemaster: !include schedulemaster.yaml` to the hand-maintained
`configuration.yaml` and create `schedulemaster.yaml` with the account
credentials:

```yaml
username: "your-schedulemaster-username"
password: "your-schedulemaster-password"
```

Offline unit tests (parsing + projection) live in
`homeassistant/tests/schedulemaster/` and run in CI; a live API smoke test runs
weekly (`schedulemaster-regression` workflow).

## What does NOT live here

- HA runtime state: `home-assistant_v2.db`, logs, `.storage/`, registry files.
- The generated `auth_oidc.yaml` / `schedulemaster.yaml` and
  `packages/heater_*.yaml` (rendered from env / the roster at container start; on
  a prod HAOS box the includes are created by hand / `deploy/push.sh`).
- The HTTP/CORS settings — HA owns them in `.storage/http` (seeded from env in
  the container, set in the UI on HAOS).
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
