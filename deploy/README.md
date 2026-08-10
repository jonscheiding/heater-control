# deploy — HAOS config push

Ships config updates to the **production Home Assistant OS box** and applies
them. Default scope is the config that iterates: `packages/` (heaters + their
automations), the `heater_control` blueprint, and repo-tracked
`custom_components/` (e.g. the schedulemaster integration). A separate `--oidc`
flag handles the set-once OIDC bundle (patched `auth_oidc` component + rendered
includes + secret).

The box's other set-once pieces stay by-hand and are never touched: onboarding,
add-ons, and `configuration.yaml` itself (you keep the `!include` lines there).
For a throwaway local/demo HA that self-provisions from the same reference
config, see the container in [`../ha-dev/`](../ha-dev/) instead.

## Contents

| File                 | What it does                                                            |
| -------------------- | ----------------------------------------------------------------------- |
| `push.sh`            | rsync packages/ + blueprints/ + custom_components/, then reload/restart |
| `render_includes.py` | render auth_oidc.yaml for `push.sh --oidc`                              |
| `.env.example`       | copy to `.env` (gitignored) and fill in                                 |

(Heaters come from `homeassistant/heaters.prod.json`, rendered by
`homeassistant/gen_packages.py` — see "Add a heater".)

## Prerequisites

- On your machine: `bash`, `python3`, `rsync`, `ssh` — all stdlib/standard, no
  packages to install.
- A HAOS box you've set up by hand, with the **SSH add-on** running (Advanced SSH
  & Web Terminal, with `rsync` added under its `packages` option and your key
  authorized) and a **long-lived token** (Profile → Security).
- A way to reach it: local LAN while testing, [Tailscale](https://www.home-assistant.io/integrations/tailscale/)
  once deployed.

```bash
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env   # HA_URL, HA_TOKEN, SSH_TARGET, REMOTE_CONFIG
```

`REMOTE_CONFIG` is the dir on the box that already contains `configuration.yaml`
(varies by add-on: `/root/config`, `/homeassistant`, or `/config` — confirm with
`ssh <SSH_TARGET> ls config/configuration.yaml`).

## Manual box setup (one-time)

Done by hand on a fresh box; `deploy/` handles everything after:

1. Onboard the owner, install the **SSH add-on** (Advanced SSH & Web Terminal —
   add `rsync` under `packages`, your key under `authorized_keys`), mint a
   long-lived token.
2. **HTTP settings in the UI** — Settings → System → Network (HA 2026.8+ moved the
   `http` integration here from YAML). Add your **SPA origin** to
   _Allowed CORS origins_ (else the SPA's cross-origin API calls fail), and set
   reverse-proxy trust (`use_x_forwarded_for` + trusted proxies) if HA sits behind
   one. Saving restarts HA and asks you to confirm within 5 min.
3. Add the auth_oidc include to `configuration.yaml`: `auth_oidc: !include auth_oidc.yaml`.
4. `deploy/push.sh --oidc` (auth_oidc component + config + secret), then
   `deploy/push.sh --calendar` (the scheduling calendar). Both idempotent.

## Add a heater

Edit the roster `homeassistant/heaters.prod.json`, then `deploy/push.sh`
(regenerates the packages + reloads):

```json
{ "id": "heater_7", "label": "C172 N123AB", "simulated": true }
```

`id` must be `heater_<n>`; `label` is the display name. Optional: `duration`
(`HH:MM:SS`/`3h`/`90m`, default 2h), `simulated_power_initial`. For a **real**
heater, pair the device in HA as `switch.<id>`, then drop `simulated`
(`{ "id": "heater_7", "label": "…" }`) — the package wires the timer + auto-off to
the device's switch and the device supplies the power sensor. The new entities
appear on reload; the SPA picks them up over WebSocket with no code change.

## Push updates

```bash
deploy/push.sh              # rsync, then apply the lightest action
deploy/push.sh --dry-run    # show what would transfer + the action
deploy/push.sh --no-apply   # sync only, take no reload/restart action
```

`push.sh` runs a preflight (`GET /api/` — fails fast on a bad token/URL), rsyncs
the tracked dirs (`--delete`, scoped per-dir so removing a heater/component file
prunes it on the box), and picks the lightest action from what changed:

| Changed                    | Action                                              |
| -------------------------- | --------------------------------------------------- |
| `packages/`, `blueprints/` | `homeassistant.reload_all` (hot, no downtime)       |
| `custom_components/*`      | `ha core restart` (Python needs it; brief downtime) |
| nothing                    | no-op                                               |

A config check runs before any restart and aborts it on errors (a
freshly-pushed component showing as an "integration not found" _warning_ is
expected and non-fatal — the restart loads it).

`push.sh` only syncs `custom_components/` dirs that exist **in the repo**, so a
hand-installed component (or HACS install) on the box is never overwritten or
deleted — `--delete` is scoped inside each dir, never at `custom_components/` root.

### The OIDC bundle (`--oidc`)

```bash
deploy/push.sh --oidc        # deploy/refresh the OIDC integration + config
```

Run this at setup, or to bump the pinned version / rotate the client secret. It:

- materializes the pinned + **patched** `auth_oidc` component (the patch is the
  "Continue on this device" fix in `homeassistant/patches/`) and ships it,
- renders `auth_oidc.yaml` from `.env` (`OIDC_*`) and ships it,
- upserts `sm_oidc_client_secret` into the box's `secrets.yaml` (auth_oidc.yaml
  references it via `!secret`), preserving your other secrets,
- restarts (all of the above need it).

**One-time by hand:** add the include line to the box's `configuration.yaml`:

```yaml
auth_oidc: !include auth_oidc.yaml
```

(HTTP/CORS is not shipped here — see the manual checklist below.)

### The calendar (`--calendar`)

```bash
deploy/push.sh --calendar    # ensure the "Heater schedules" local_calendar
```

Creates the `local_calendar` config entry named **Heater schedules** (→ entity
`calendar.heater_schedules`) if it's missing, then reloads so the scheduling
automation attaches. Idempotent (no-op once it exists). This is a config entry,
not YAML, so it can't live in a package — run this once when standing up a box
(without it, the scheduling automation and the SPA's calendar view 404, which the
browser reports as a misleading CORS error). The name must be exactly
`Heater schedules` — the package and SPA hard-code the resulting entity id.

## CI

[`.github/workflows/deploy-haos.yml`](../.github/workflows/deploy-haos.yml) runs
`push.sh` on merge to `main` when `homeassistant/packages/**`,
`homeassistant/blueprints/**`, or `homeassistant/custom_components/**` change,
connecting over Tailscale. Required
secrets: `HAOS_HA_URL`, `HAOS_HA_TOKEN`, `HAOS_SSH_TARGET`, `HAOS_SSH_KEY`,
`TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` (and optional `HAOS_REMOTE_CONFIG` /
`HAOS_SSH_PORT` repo vars).
