# ha-dev — Home Assistant container build & run tooling

Builds and runs a **self-provisioning** Home Assistant container from the pure
reference config in [`../homeassistant/`](../homeassistant/). One image serves
both local dev and a low-cost Fly.io demo; everything environment-specific (OIDC
issuer, CORS, reverse-proxy trust) is rendered from env vars at container start,
so nothing is hardcoded.

## What's here

- **`Dockerfile`** — extends the official HA image; at build time downloads
  `auth_oidc` and applies `../homeassistant/patches/` to it, and bakes the
  reference config into `/opt/provision`. Build context is the **repo root**
  (so it can COPY from both `homeassistant/` and `ha-dev/`).
- **`docker-entrypoint.sh`** — the image ENTRYPOINT. Stages `/config` from
  `/opt/provision`, renders the env-driven includes, optionally stages
  packages/blueprints (`HC_STAGE_CONFIG=1`) and self-onboards (`HC_AUTO_SETUP=1`),
  then `exec /init`.
- **`render_config.py`** — writes `/config/http.yaml` + `/config/auth_oidc.yaml`
  from env (`OIDC_*`, `HA_CORS_ORIGINS`, `HA_TRUSTED_PROXIES`, …).
- **`setup.py`** — drives HA's REST API to onboard the owner and create the
  `local_calendar` the scheduling package needs. Idempotent; usable standalone.
- **`docker-compose.yml`** — the single-service local dev stack.
- **`fly.toml`** — the scale-to-zero, volume-less Fly demo.

## Environment variables

| Var                                             | Purpose                                       | Dev                    | Fly demo         |
| ----------------------------------------------- | --------------------------------------------- | ---------------------- | ---------------- |
| `OIDC_DISCOVERY_URL`                            | issuer well-known URL                         | host proxy             | `sm-oidc-proxy`  |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`         | HA's client registration                      | `dev-ha-secret`        | `fly secrets`    |
| `OIDC_DISPLAY_NAME`                             | login button label                            | `ScheduleMaster (dev)` | `ScheduleMaster` |
| `OIDC_FORCE_HTTPS`                              | https redirect URIs (behind TLS proxy)        | `false`                | `true`           |
| `HA_CORS_ORIGINS`                               | SPA origins (comma list)                      | localhost              | SPA domain       |
| `HA_USE_X_FORWARDED_FOR` / `HA_TRUSTED_PROXIES` | reverse-proxy trust                           | off                    | on               |
| `HC_STAGE_CONFIG`                               | copy baked packages/blueprints into `/config` | unset                  | `1`              |
| `HC_AUTO_SETUP`                                 | self-onboard + create calendar on boot        | `1`                    | `1`              |

## Local dev (OIDC proxy on the host)

The proxy runs on the **host** so it's debuggable (hot reload / `--inspect`); HA
runs in Docker and reaches it via `extra_hosts: oidc-proxy.test:host-gateway`.

```bash
# one-time: let the browser resolve the proxy the way HA does
echo "127.0.0.1 oidc-proxy.test" | sudo tee -a /etc/hosts

# proxy config (host): copy the template and generate a signing key
cp packages/oidc-proxy/.env.local.example packages/oidc-proxy/.env.local
pnpm --filter @heater-control/oidc-proxy gen-keys   # paste into OIDC_JWKS

# terminal A — the proxy (host, hot reload):
pnpm --filter @heater-control/oidc-proxy dev

# terminal B — Home Assistant:
cd ha-dev && docker compose up --build
open http://localhost:8123        # sign in dev/dev, or "ScheduleMaster (dev)"
```

`packages/`, `blueprints/`, `configuration.yaml` come from `../homeassistant/`
(packages/blueprints bind-mounted for live editing; `configuration.yaml` is baked,
so changes to it need `up --build`). Runtime state lives in the gitignored
`ha-dev/.dev/`. Full reset: `docker compose down && rm -rf .dev`.

Debugging the proxy: `pnpm --filter @heater-control/oidc-proxy exec tsx --inspect --watch src/server.ts` and attach your Node debugger.

## Fly demo (scale-to-zero, volume-less)

A hosted demo that costs ~nothing idle. `/config` is ephemeral — the container
re-provisions and re-onboards on a cold boot, so there's no volume to manage.

```bash
fly launch --no-deploy -c ha-dev/fly.toml        # first time, or `fly apps create`
fly secrets set -c ha-dev/fly.toml \
  OIDC_CLIENT_SECRET=... HA_ONBOARD_PASSWORD=...  # strong, non-dev
fly deploy -c ha-dev/fly.toml                     # run from the repo root
```

Notes:

- `auto_stop_machines='suspend'` snapshots RAM so an idle instance resumes in
  seconds with state intact; a full cold boot re-onboards via `HC_AUTO_SETUP`.
- After the first deploy, check `fly logs` for HA's "untrusted proxy `<IP>`"
  warning and **pin `HA_TRUSTED_PROXIES`** to that address (avoid `0.0.0.0/0`).
- Set `HA_CORS_ORIGINS` to the SPA's origin, and `OIDC_DISCOVERY_URL` to the
  proxy's public URL.
- Cross-config on the **proxy** app (`sm-oidc-proxy`): `HA_REDIRECT_URIS` must
  include `https://<fly-ha-host>/auth/oidc/callback`, and `OIDC_ISSUER` must be
  the proxy's public URL.
- Demo tradeoffs: automations/timers don't run while idle; a full cold boot
  resets history/DB/sessions/calendar events. Want persistence? Add a
  `[[mounts]]` block + a `fly volume` at `/config`.
