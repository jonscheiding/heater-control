# deploy — HAOS provisioning & deploy toolkit

Automates standing up and updating the **production Home Assistant OS box**: the
initial setup, adding heaters, and shipping config / integration updates.

HAOS is a locked appliance — no `docker`, no host shell, no custom entrypoint —
so the self-provisioning container in [`../ha-dev/`](../ha-dev/) can't run there.
This toolkit runs the **same provisioning logic remotely** instead: SSH for
files, HA's REST + Supervisor API for everything else. The shared logic lives in
[`lib/`](lib/) and is imported by both the container and these scripts (one
source of truth). See [`PLAN.md`](PLAN.md) for the design and rationale.

## Contents

| File           | What it does                                                                               |
| -------------- | ------------------------------------------------------------------------------------------ |
| `bootstrap.sh` | One-time first-run: onboard owner + install SSH add-on + first push                        |
| `push.sh`      | Repeatable deploy: rsync config/components, then reload or restart                         |
| `heater.sh`    | Scaffold a new `packages/heater_<n>.yaml`                                                  |
| `lib/`         | Shared provisioning modules (`provision.py`, `render_config.py`, `ha_api.py`, `common.sh`) |
| `.env.example` | Copy to `.env` (gitignored) and fill in                                                    |

## Prerequisites

- On your machine: `bash`, `python3`, `rsync`, `ssh` (all standard on macOS/Linux).
  No Python packages needed — the toolkit is stdlib-only.
- A HAOS box flashed, booted, and reachable on your network.
- A way to reach it once deployed — this stack uses the first-party
  [Tailscale add-on](https://www.home-assistant.io/integrations/tailscale/), so
  the box joins your tailnet and CI/your laptop reach it with no inbound ports.

Copy the env template and fill it in:

```bash
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env
```

## 1. Initial setup (`bootstrap.sh`)

Manual, once per box: flash HAOS + get it on the network, mint a token, install
the SSH add-on, set up Tailscale/public exposure. Everything else is scripted.

```bash
# Point HA_URL at the box on the LAN, set HA_ONBOARD_USERNAME/PASSWORD in .env.
deploy/bootstrap.sh
```

`bootstrap.sh` onboards the owner and creates the calendar/location/weather
baseline, then stops and tells you to **mint a long-lived token** (Profile →
Security → Long-lived access tokens). Put it in `deploy/.env` as `HA_TOKEN`.

Next, **install the SSH add-on via the HA UI** (one-time) — Settings → Add-ons →
Add-on store → **Advanced SSH & Web Terminal**:

- add your public key under `authorized_keys`,
- add `rsync` under `packages` (the deploy needs it on the box),
- start it (and enable "Start on boot").

> **Why manual?** The Supervisor API (`/api/hassio/*`) rejects HA long-lived
> access tokens (`/api/ → 200` but `/api/hassio/… → 401`) — it wants an add-on's
> `SUPERVISOR_TOKEN`, so add-on install can't be driven from outside the box. The
> SSH add-on is the transport everything else rides on, so it's the honest
> chicken-and-egg step. Everything after it uses core `/api/`, which the token
> authorizes.

Confirm where the add-on mounts HA's config (recent add-ons use `/homeassistant`,
not `/config`) and set `REMOTE_CONFIG` + `SSH_TARGET` in `.env`. Then:

```bash
deploy/bootstrap.sh --skip-onboard   # verifies SSH, then does the first push
```

This runs `push.sh --render-config --restart`.

## 2. Add a heater (`heater.sh`)

```bash
deploy/heater.sh add --n 4 --name "Cessna 172" --duration 3h
deploy/push.sh                       # ships it + reload_all (no restart)
```

Duration accepts `HH:MM:SS`, `3h`, or `90m` (default: the template's 2h). The new
`input_boolean`/`timer` appear in HA on reload; the SPA picks them up over
WebSocket with no code change. For a **real metering switch**, pair the device in
HA first (physical, manual), then swap `input_boolean.heater_<n>` for the switch
entity and delete the POC block in the generated file.

## 3. Deploy updates (`push.sh`)

```bash
deploy/push.sh                # sync YAML + components, auto reload-or-restart
deploy/push.sh --render-config  # also refresh http.yaml/auth_oidc.yaml from .env
deploy/push.sh --dry-run      # show what would transfer + the action, change nothing
```

It picks the lightest action from what actually changed:

| Changed                                   | Action                            |
| ----------------------------------------- | --------------------------------- |
| `packages/`, `blueprints/`, automations   | `homeassistant.reload_all` (hot)  |
| `custom_components/*`, `http`/`auth_oidc` | `ha core restart` (Python reload) |
| nothing                                   | no-op                             |

A core **config check runs before any restart** and aborts the restart if it
fails. Override with `--reload` / `--restart` / `--no-reload`.

`auth_oidc` is shipped as the pinned + patched copy (materialized like
[`../ha-dev/Dockerfile`](../ha-dev/Dockerfile)), **not** via HACS — so updates
never clobber the patch. Bump `AUTH_OIDC_VERSION` in both places together.

## 4. CI

[`.github/workflows/deploy-haos.yml`](../.github/workflows/deploy-haos.yml) runs
`push.sh` on merge to `main` (paths `homeassistant/**`, `deploy/**`), connecting
over Tailscale. Required secrets: `HAOS_HA_URL`, `HAOS_HA_TOKEN`,
`HAOS_SSH_TARGET`, `HAOS_SSH_KEY`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`. CI
does not render includes (keeps OIDC secrets out of CI) — run
`push.sh --render-config` by hand when OIDC/CORS settings change.

## What stays manual

Flash HAOS · network · Tailscale/public exposure · mint the long-lived token
(one UI click) · pair real heater switches. Everything else is scripted.
