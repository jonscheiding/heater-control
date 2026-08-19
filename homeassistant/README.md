# Home Assistant configuration (reference)

Declarative HA config, tracked alongside the SPA — the reference `/config` plus
the custom integrations that back it. Source of
truth for both the containerized dev/demo image and the HAOS box. The tooling
that builds and runs a container of this config lives in
[`../ha-dev/`](../ha-dev/); see its README to run the dev stack or deploy the Fly
demo.

## Layout

- `configuration.yaml` — top-level config. Enables only what the app needs
  (deliberately no `default_config`, for a faster boot), the packages dir, and the
  **environment-rendered includes** `auth_oidc: !include auth_oidc.yaml`,
  `schedulemaster: !include schedulemaster.yaml`, and — in the container only —
  `heater_control: !include heater_control.yaml`. Those files are **not tracked** —
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
- `packages/` — `scheduling.yaml` (calendar-triggered turn-on), plus the Fly-only
  keepalive rendered at container start. Enabled via
  `homeassistant: packages: !include_dir_named packages` in `configuration.yaml`.
  Heaters are **not** here — they're config entries (see "Adding a heater").
- `custom_components/heater_control/` — the heater integration: one config entry
  per heater, a switch entity per heater that wraps the real device and publishes
  the app's contract, and the auto-off machinery. See "Adding a heater" below.
- `heaters.demo.json` — the demo/dev heater roster. Only used by the container:
  `ha-dev/render_config.py` turns it into the `heater_control.yaml` include that
  the integration imports as config entries, because dev wipes `.storage` on
  reset and can't be configured by clicking. The prod box has no roster.
- `patches/` — local overrides applied on top of the `auth_oidc` integration
  (see `patches/README.md`). Both the container (at build time) and
  `deploy/push.sh --oidc` (which ships the pinned + pre-patched component to
  HAOS) overlay these, so no HACS install or manual reapply is needed.
- `custom_components/schedulemaster/` — the ScheduleMaster integration (see
  "ScheduleMaster integration" below). Shipped to HAOS by `deploy/push.sh` (part
  of the repo `custom_components/` sync) and baked into the dev image.

## Adding a heater

Heaters are **config entries**, not YAML. On the box: Settings → Devices &
Services → **Add integration** → **Heater Control**, then choose

- **Real heater** — pick the switch entity that controls it. Optionally pick its
  power sensor and, on Z-Wave devices, its diagnostic **Node status** sensor.
  Set the tail number, aircraft type, and how long it may stay on.
- **Virtual heater** — a simulated heater with no hardware behind it, for dev and
  the demo. It brings its own power sensor, node-status sensor, simulate-offline
  toggle, and adjustable wattage.

Nothing needs deploying, and nothing needs renaming: the integration owns a
switch entity per heater and publishes everything about it as attributes, so no
entity id anywhere carries meaning. Rename entities freely.

Edit a heater later via its **Configure** button; delete the config entry to
remove it.

## The attribute contract

The heater entity is the whole interface between Home Assistant and the app.
Everything the app knows comes from these attributes:

| attribute       | meaning                                                       |
| --------------- | ------------------------------------------------------------- |
| `heater: true`  | the discovery marker — the app's only selector                |
| `n_number`      | tail number, stored without the leading `N`                   |
| `aircraft_type` | e.g. `C182`                                                   |
| `power_w`       | current draw, or `null` when no power sensor is configured    |
| `reachable`     | `false` when the device can't be commanded                    |
| `auto_off_at`   | when the heater switches itself off, or `null` when not armed |

`n_number` / `aircraft_type` are also what the ScheduleMaster integration maps a
booking against — it scans every entity for an `n_number` attribute, so heaters
bind to bookings without either component knowing about the other.

## Reachability

Z-Wave JS does **not** mark a switch entity `unavailable` when its node stops
answering — entity availability there tracks the driver connection and the node
interview, not the node's current status, so the switch keeps serving its last
known `on`/`off` and the app would happily offer to toggle a device that can't
hear it. The reachability signal lives in the node's diagnostic **Node status**
sensor (`alive` / `awake` / `asleep` / `dead` / `unknown`), which is why the
config flow asks for it.

The component reads that sensor and publishes the verdict as `reachable`;
anything other than alive/awake/asleep renders the heater as "Unreachable" with
its power button disabled. `asleep` counts as reachable — a sleeping node wakes
for queued commands. The sensor is optional: heaters without one fall back to the
switch entity's own `unavailable`/`unknown` state, which is what non-Z-Wave
integrations report honestly.

Note the heater entity stays **available** even when unreachable. Home Assistant
drops custom attributes from an unavailable entity, so going unavailable would
take `n_number` and `aircraft_type` with it and break the app's scheduling
dialog.

## Auto-off

When a heater turns on, the component computes `turned_on_at + duration` and
schedules a one-shot callback at exactly that instant — it isn't polled. It keys
off the _underlying_ switch rather than off our own service calls, so a heater
turned on by the calendar automation or by hand at the plug is treated exactly
like one turned on from the app.

The deadline is the source of truth and the callback is only an optimization over
consulting it. It's persisted to `.storage/heater_control.auto_off` (keyed by
config entry, so it survives an entry reload as well as a restart) and published
as the `auto_off_at` attribute. Two things re-derive from it:

- **Startup** — deadline in the past ⇒ switch off (the case the old blueprint
  caught with its startup sweep), in the future ⇒ re-arm, absent ⇒ arm fresh.
- **A one-minute tick** — a backstop, because scheduled callbacks run on the
  event loop's clock, which a suspended Fly machine freezes; on resume the
  one-shot would fire late by the whole suspend. Also covers clock jumps and DST.

The duration is editable from the heater's device page as **Auto-off after**
(`number.<name>_auto_off_after`), in minutes; 0 disables auto-off. Changing it
re-measures from when the heater actually turned on, so shortening it can retire a
running heater immediately — which is also the quickest way to watch auto-off
fire: set it to 1 minute. It writes straight back to the config entry, so it and
the options flow are two views of one value, and the entry is adopted in place
rather than reloaded.

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
- The generated `auth_oidc.yaml` / `schedulemaster.yaml` / `heater_control.yaml`
  (rendered from env at container start; on a prod HAOS box the first is created
  by `deploy/push.sh`, the second by hand, and the third not at all — heaters
  there are config entries).
- Heaters themselves. They're config entries in `.storage`, added in the UI.
- The HTTP/CORS settings — HA owns them in `.storage/http` (seeded from env in
  the container, set in the UI on HAOS).
- UI-created helpers/automations (persist in `.storage/`; recreate them here).
- Secrets — the OIDC client secret flows via the `OIDC_CLIENT_SECRET` env var.

## Running / deploying

- **Local dev + Fly demo:** see [`../ha-dev/README.md`](../ha-dev/README.md).
- **HAOS (real deployment):** the box is **provisioned by hand** (onboarding,
  add-ons, HTTP/CORS settings in the UI, and `configuration.yaml` — where you keep
  the `auth_oidc: !include auth_oidc.yaml` line). [`../deploy/`](../deploy/) then
  ships the iterating config via `deploy/push.sh` — `packages/` and repo-tracked
  `custom_components/` (reload for YAML, restart for components). Heaters
  themselves are config entries and need no deploy at all. `deploy/push.sh --oidc` handles the set-once OIDC
  bundle: the pinned + patched `auth_oidc` component, the rendered `auth_oidc.yaml`
  include, and the `sm_oidc_client_secret` in `secrets.yaml`.
