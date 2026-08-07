# deploy — HAOS config push

Ships ongoing app-config updates to the **production Home Assistant OS box** and
applies them. Scope is the config that iterates: `packages/` (heaters + their
automations), the `heater_control` blueprint, and repo-tracked
`custom_components/` (e.g. the schedulemaster integration).

The box's **set-once** pieces stay by-hand and are never touched: onboarding,
add-ons, `configuration.yaml`, the `http.yaml`/`auth_oidc.yaml` includes, and the
hand-installed `auth_oidc` component (it's not in the repo, so it's never synced
or deleted). For a throwaway local/demo HA that self-provisions from the same
reference config, see the container in [`../ha-dev/`](../ha-dev/) instead.

## Contents

| File           | What it does                                                            |
| -------------- | ----------------------------------------------------------------------- |
| `push.sh`      | rsync packages/ + blueprints/ + custom_components/, then reload/restart |
| `heater.sh`    | scaffold a new `homeassistant/packages/heater_<n>.yaml`                 |
| `.env.example` | copy to `.env` (gitignored) and fill in                                 |

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

## Add a heater

```bash
deploy/heater.sh add --n 4 --name "Cessna 172" --duration 3h
deploy/push.sh
```

Duration accepts `HH:MM:SS`, `3h`, or `90m` (default: the template's 2h). The new
`input_boolean`/`timer` appear in HA on reload; the SPA picks them up over
WebSocket with no code change. For a **real metering switch**, pair the device in
HA first (manual), then swap `input_boolean.heater_<n>` for the switch entity and
delete the POC block in the generated file.

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

> **What's still by-hand:** the `auth_oidc` component and the
> `http.yaml`/`auth_oidc.yaml` includes are set-once and live only on the box.
> `push.sh` only syncs `custom_components/` dirs that exist **in the repo**, so it
> never overwrites or deletes them.

## CI

[`.github/workflows/deploy-haos.yml`](../.github/workflows/deploy-haos.yml) runs
`push.sh` on merge to `main` when `homeassistant/packages/**`,
`homeassistant/blueprints/**`, or `homeassistant/custom_components/**` change,
connecting over Tailscale. Required
secrets: `HAOS_HA_URL`, `HAOS_HA_TOKEN`, `HAOS_SSH_TARGET`, `HAOS_SSH_KEY`,
`TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` (and optional `HAOS_REMOTE_CONFIG` /
`HAOS_SSH_PORT` repo vars).
