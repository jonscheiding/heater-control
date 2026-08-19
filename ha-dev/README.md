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
  `/opt/provision`: renders the env-driven includes (including the heater roster),
  stages packages, self-onboards (`HC_AUTO_SETUP=1`), then launches Home Assistant
  **directly** (bypassing the base image's s6 init, which requires PID 1 —
  unavailable on Fly's managed-init Machines).
- **`render_config.py`** — writes `/config/auth_oidc.yaml`,
  `/config/schedulemaster.yaml` and `/config/heater_control.yaml` (the demo
  heaters, from `HEATERS_JSON`) from env, and seeds the HTTP
  settings (`HA_CORS_ORIGINS`, `HA_TRUSTED_PROXIES`, …) into `/config/.storage/http`,
  plus the Fly-only keepalive package when `HC_KEEPALIVE_URL` is set.
- **`setup.py`** — drives HA's REST API to onboard the owner and create the
  `local_calendar` the scheduling package needs. Idempotent; usable standalone.
- **`docker-compose.yml`** — the single-service local dev stack.
- **`fly.toml`** — the scale-to-zero Fly demo (small persistent `/config` volume).

## Environment variables

| Var                                             | Purpose                                       | Dev                    | Fly demo            |
| ----------------------------------------------- | --------------------------------------------- | ---------------------- | ------------------- |
| `OIDC_DISCOVERY_URL`                            | issuer well-known URL                         | host proxy             | `sm-oidc-proxy`     |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`         | HA's client registration                      | `dev-ha-secret`        | `fly secrets`       |
| `OIDC_DISPLAY_NAME`                             | login button label                            | `ScheduleMaster (dev)` | `ScheduleMaster`    |
| `OIDC_FORCE_HTTPS`                              | https redirect URIs (behind TLS proxy)        | `false`                | `true`              |
| `HA_CORS_ORIGINS`                               | SPA origins (comma list)                      | localhost              | SPA domain          |
| `HA_USE_X_FORWARDED_FOR` / `HA_TRUSTED_PROXIES` | reverse-proxy trust                           | off                    | on                  |
| `HEATERS_JSON`                                  | roster the demo heaters are imported from     | `heaters.demo.json`    | `heaters.demo.json` |
| `HC_AUTO_SETUP`                                 | self-onboard + create calendar on boot        | `1`                    | `1`                 |
| `HC_KEEPALIVE_URL`                              | self-ping URL so timers outlive Fly auto_stop | unset                  | public HA URL       |

### HTTP settings (CORS + proxy trust) — requires a 2026.8+ base image

HA 2026.8 moved the `http` integration out of `configuration.yaml` into the UI
(Settings → System → Network), stored in `.storage/http`; YAML stops working in
2027.2. So `render_config.py` writes that store directly from
`HA_CORS_ORIGINS` / `HA_USE_X_FORWARDED_FOR` / `HA_TRUSTED_PROXIES` before HA
starts, into the **stable** slot with the YAML migration marked done.

That last part matters: HA imports a leftover `http:` block into the **pending**
slot instead — a 5-minute trial that a human has to confirm in the UI, or HA
restarts and reverts it. A headless container has nobody to confirm, so it would
lose its CORS origins five minutes after boot. Seeding the store avoids the trial
entirely, and env stays the source of truth (the store is rewritten every start,
so UI edits to these settings don't stick — change the env instead).

Because the store didn't exist before 2026.8, the entrypoint **fails fast** on an
older base image rather than booting without CORS. If you see that, rebuild:
`docker compose build --pull`.

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

Config comes from `../homeassistant/`: `configuration.yaml` is baked (changes need
`up --build`), while the roster (`heaters.demo.json`), `packages/`, and the
custom components are bind-mounted over `/opt/provision` — edit them +
`docker compose restart` to restage `/config` without a rebuild. Runtime state
lives in the gitignored `ha-dev/.dev/`. Full reset:
`docker compose down && rm -rf .dev`.

Heaters come from the roster: `render_config.py` turns it into
`/config/heater_control.yaml`, which the `heater_control` integration reconciles
into config entries every start — so editing the roster adds, updates, or removes
heaters on the next `docker compose restart`, and a wiped `.dev` re-creates
exactly the same set.

Debugging the proxy: `pnpm --filter @heater-control/oidc-proxy exec tsx --inspect --watch src/server.ts` and attach your Node debugger.

### Simulating hardware faults

Each virtual heater's device carries two entities for this, alongside its switch,
power sensor, and node-status sensor:

- **`switch.<name>_simulate_offline`** — turn it on and the heater's node status
  goes `dead`, exactly like a real Z-Wave node that dropped off the mesh. The
  heater publishes `reachable: false` and the SPA renders it "Unreachable" with
  its power button disabled, while the entity itself stays available with its
  last known on/off — which is precisely how Z-Wave JS behaves.
- **`number.<name>_simulated_wattage`** — set it to 0 and a heater that is on
  draws nothing, so the SPA shows "On, unplugged" once the grace period elapses.

Flip either in HA (Developer Tools → States, or the entity's more-info dialog).
Both are plain entities on the heater's device with no `heater` attribute, so
unlike the helpers they replace they can't be mistaken for heaters themselves.

To watch **auto-off** fire without waiting two hours, set the heater's
`number.<name>_auto_off_after` to 1 minute. Real heaters have that control too —
it's ordinary configuration, not a simulation — and lowering it below a running
heater's elapsed time switches it off immediately, since the deadline is measured
from when the heater turned on.

## Fly demo (scale-to-zero, small persistent volume)

A hosted demo that costs ~nothing idle. It scales to zero, but keeps a small
volume at `/config` so onboarding + the local calendar survive cold wakes (no
"create your smart home" flash). `HC_AUTO_SETUP` still runs but is a one-time
no-op once the volume is populated.

```bash
fly launch --no-deploy -c ha-dev/fly.toml        # first time, or `fly apps create`
fly volume create ha_config -c ha-dev/fly.toml -r ord -n 1   # or let deploy auto-create it
fly secrets set -c ha-dev/fly.toml \
  OIDC_CLIENT_SECRET=... HA_ONBOARD_PASSWORD=...  # strong, non-dev
fly deploy -c ha-dev/fly.toml                     # run from the repo root
```

Notes:

- The `[mounts]` volume persists across stop/suspend/redeploy, so the machine
  still scales to zero (`min_machines_running=0`) — the volume just isn't billed
  for compute while stopped. `fly deploy` auto-creates it at `initial_size` for
  the first machine if you skip `fly volume create`.
- First boot onboards once (slow, ~1–2 min); `grace_period` is set to 4m so the
  health check doesn't fail during it. Subsequent wakes are fast and go straight
  to the login page.
- The health check probes `/auth/oidc/welcome`, not `/manifest.json`. `auth_oidc`
  registers its provider a few seconds after HA's login page starts serving, so
  gating "healthy" on an auth_oidc route makes fly-proxy hold the cold-wake
  request until the SSO provider is ready — otherwise the "Log in with …" button
  is missing until you reload.
- `configuration.yaml` omits `default_config` and enables only what this app
  needs, dropping the network-discovery/cloud/mobile integrations that just slow
  HA's boot on Fly.
- `HA_TRUSTED_PROXIES=0.0.0.0/0,::/0` + `HA_USE_X_FORWARDED_FOR=true` are required.
  HA rejects (`400`) any proxied request whose peer isn't trusted — which bounces
  you back to the login page on every refresh behind Fly. Trust-all is safe here
  because the internal port is only reachable via fly-proxy; pinning the exact
  fly-proxy IPv6/mapped peer is unreliable. (If you check `fly logs` and still see
  "untrusted proxy", the value didn't take — redeploy.)
- Set `HA_CORS_ORIGINS` to the SPA's origin, and `OIDC_DISCOVERY_URL` to the
  proxy's public URL.
- **Nabu Casa remote UI** needs the `cloud` integration, which the trimmed
  `configuration.yaml` omits — add `cloud:` if you use it. Cloud manages its own
  proxy trust via loopback, which trust-all already covers.
- Cross-config on the **proxy** app (`sm-oidc-proxy`): `HA_REDIRECT_URIS` must
  include `https://<fly-ha-host>/auth/oidc/callback`, and `OIDC_ISSUER` must be
  the proxy's public URL.
