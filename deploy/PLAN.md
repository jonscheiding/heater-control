# HAOS provisioning & deploy — plan

Status: **proposal, not yet built.** This is the written plan for automating the
production HAOS box. Reviewed before scaffolding `deploy/`.

## The reframe

Almost all provisioning logic already exists — it's just wired to run as a
_container entrypoint_:

- `ha-dev/setup.py` — REST-driven onboarding, `local_calendar`, home location,
  met weather, automation reload. **Runs against any HA over HTTP, including a
  fresh HAOS box** — nothing container-specific in it.
- `ha-dev/render_config.py` — env → `/config/http.yaml` + `/config/auth_oidc.yaml`.
- `ha-dev/docker-entrypoint.sh` — refresh `auth_oidc`, stage `packages/` +
  `blueprints/`, reload.

HAOS is a locked appliance: no `docker`, no host shell, no custom entrypoint;
`/config` is reachable only through add-ons. So we can't bake an image. But we
**can** run the exact same steps _remotely_ — SSH for files, REST + Supervisor
API for everything else. Given network reachability + one token, even add-on
installs are scriptable (`/api/hassio/...` accepts the core bearer token).

**Conclusion:** don't rewrite the logic — externalize it into a `deploy/`
toolkit that pushes to the box instead of running inside it.

## Target layout

```
deploy/
  PLAN.md              # this file
  README.md            # operator docs (replaces homeassistant/README.md "HAOS: TBD")
  lib/                 # shared, reused by all commands
    ha_api.py          # thin REST/Supervisor client (extract _req() from setup.py)
    provision.py       # setup.py's onboarding/calendar/location/weather steps
    render_config.py   # moved from ha-dev/ (or imported; single source)
  bootstrap.sh         # one-time: onboard + install SSH add-on + first push
  push.sh              # repeatable: rsync config/components + reload-or-restart
  heater.sh            # scaffold packages/heater_<n>.yaml from template
  .env.example         # HA_URL, HA_TOKEN, SSH target, OIDC_*, HA_CORS_ORIGINS, ...
```

`ha-dev/setup.py` and `render_config.py` get refactored so the shared steps live
in `deploy/lib/` and both the container and the HAOS toolkit import them — one
source of truth, no fork.

## Irreducible manual steps (once per box)

These stay manual no matter what; everything else is scripted.

1. Flash HAOS, boot it, get it on the network (find its IP / `homeassistant.local`).
2. Choose + configure **public exposure**: Nabu Casa subscription, _or_ reverse
   proxy + DDNS + TLS, _or_ Tailscale. (Account/DNS work.)
3. Physical heater pairing when a real metering switch replaces `input_boolean`
   (Z-Wave/Zigbee/WiFi device join) — belongs to "add heaters," see below.

Everything after step 1 (onboarding, add-on install, token mint, config push)
is driven by `bootstrap.sh`.

## Goal 1 — Initial setup (`bootstrap.sh`)

Given `HA_URL` reachable on the LAN:

1. Run `provision.py` against `HA_URL` → owner account + `core_config` +
   `analytics` + `integration` onboarding steps; capture the resulting token.
2. Mint a **long-lived token** from that session (`/auth/long_lived_access_token`)
   and print it — operator stores it as `HA_TOKEN` (local `.env`) and as the CI
   repo secret.
3. Install the SSH add-on via Supervisor API:
   `POST /api/hassio/addons/{slug}/install` → set options (authorized_keys) →
   `.../start`. (Slug TBD — verify official `core_ssh` vs community
   `a0d7b954_ssh`; the community "Advanced SSH & Web Terminal" also exposes a
   host shell, which is handy.)
4. `provision.py` remainder: `local_calendar`, home location, met weather,
   automation reload (already idempotent).
5. Hand off to `push.sh` for the first config push.

Optional accelerator (not the default): a **golden partial backup** (`.tar`
restorable via `ha backups` / Supervisor API) collapses steps 1–4 into one
restore. Rejected as source of truth — opaque, bakes secrets in — but worth
documenting as a fast-rebuild shortcut once a box is known-good.

## Goal 2 — Add heaters (`heater.sh`)

Software side is fully scriptable; only physical pairing is manual.

- `deploy/heater.sh add --n 4 --name "Cessna 172" --duration 3h` scaffolds
  `homeassistant/packages/heater_4.yaml` from the `heater_1.yaml` template
  (find/replace + duration substitution, per `homeassistant/README.md:33-40`).
- Then `push.sh` ships it and calls `homeassistant.reload_all` — no restart. SPA
  picks up the new `input_boolean`/`timer` over WebSocket with no code change.
- **Real switch:** when a metering switch replaces `input_boolean.heater_n`,
  pair the device in HA (manual, physical), then the generated package
  references `switch.heater_n` and drops the POC simulated-power block
  (`heater_1.yaml:19-46`).

## Goal 3 — Deploy updates (`push.sh`)

Externalizes the entrypoint's staging, over SSH + REST:

1. `render_config.py` locally (or over SSH) → refresh `http.yaml` /
   `auth_oidc.yaml` when env changed.
2. rsync over the SSH add-on:
   - `homeassistant/configuration.yaml` + `packages/` + `blueprints/` → `/config`
   - `custom_components/schedulemaster` + **patched `auth_oidc`** →
     `/config/custom_components`
3. Reload **or** restart (matrix below).

### Reload-vs-restart matrix (the one gotcha)

| Changed                                                                        | Action                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `packages/`, `blueprints/`, `automations`, helpers                             | `homeassistant.reload_all` (hot, no downtime)              |
| Anything under `/config/custom_components` (schedulemaster, `auth_oidc` patch) | **`ha core restart`** — Python components don't hot-reload |
| Env includes (`http.yaml`, `auth_oidc.yaml`)                                   | restart                                                    |

`push.sh` diffs what it pushed and picks the lighter action automatically.

### Drop HACS for `auth_oidc` on prod

Ship the pinned + patched copy by rsync, exactly as `ha-dev/Dockerfile:24-31`
already does. This **eliminates the "HACS overwrites the patch on update"**
problem in `homeassistant/patches/README.md` — the deploy always ships the
correct patched copy, and version bumps are a one-line `AUTH_OIDC_VERSION` change

- redeploy. Same approach for the schedulemaster custom_component.

## CI wiring

Extend the existing GitHub Actions (alongside `build-test.yml` and
`schedulemaster-regression.yml`):

- On merge to `main` touching `homeassistant/**` or the schedulemaster component:
  connect to the box (**Tailscale SSH** preferred — no inbound ports, fits the
  stack) and run `deploy/push.sh`.
- `HA_URL` + `HA_TOKEN` + SSH key as repo secrets.
- Nabu Casa alternative: no inbound SSH, so push files via the Supervisor API
  over the Nabu Casa HTTPS endpoint instead — clunkier; Tailscale is the
  recommendation.

## Order of work (build phases)

1. **Refactor** `setup.py` + `render_config.py` → `deploy/lib/` shared modules;
   keep `ha-dev/` working by importing from there. (No behavior change; verify
   the dev stack + Fly demo still onboard.)
2. **`push.sh`** + reload/restart matrix — the highest-leverage piece; testable
   against the Fly demo or a local HAOS VM before there's a real box.
3. **`heater.sh`** generator.
4. **`bootstrap.sh`** — onboarding + add-on install + token mint.
5. **CI** deploy job over Tailscale.
6. **Docs**: write `deploy/README.md`, replace `homeassistant/README.md:52-56`
   "HAOS: TBD" with a pointer, update `DEPLOY.md` section 1.

## Open decisions (need answers before/while building)

- **Transport for CI → box:** Tailscale SSH (recommended) vs Nabu Casa API vs
  exposed reverse-proxy SSH.
- **SSH add-on:** official `core_ssh` vs community Advanced SSH & Web Terminal
  (the latter gives a host shell — verify which slug + whether host shell is
  wanted).
- **Golden backup:** document as a rebuild shortcut, or skip entirely?
- **Language:** shell wrappers calling Python `lib/` (matches existing `.py`
  tooling) vs a single Python CLI vs a pnpm/TS task (matches the JS monorepo).
  Leaning shell + Python to reuse `setup.py` directly.

```

```
