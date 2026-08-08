# Heater Control — Deploy Notes

Three moving parts:

1. **Home Assistant** — runs the heaters, exposes the API the SPA talks to.
2. **SPA** (`packages/web/`) — static React app on Netlify.
3. **ScheduleMaster OIDC proxy** (`packages/oidc-proxy/`) — lets pilots sign in with their ScheduleMaster credentials; wraps the `sm-client` scraper in an OIDC provider.

Auth chain: ScheduleMaster proxy (OIDC issuer) → HA (`auth_oidc`) → SPA (HA's OAuth2 flow).

## Prerequisites

- Node 24+, pnpm 11+
- A Netlify account (or other static host) for the SPA
- A container host for the OIDC proxy (Fly.io recommended)

## 1. Home Assistant

- **Local dev + Fly demo:** the self-provisioning container in [`ha-dev/`](ha-dev/) — `cd ha-dev && docker compose up --build` (proxy on the host), or `fly deploy -c ha-dev/fly.toml`. See [`ha-dev/README.md`](ha-dev/README.md).
- **Prod HAOS box:** provisioned by hand, then [`deploy/`](deploy/) ships config over SSH. See [`deploy/README.md`](deploy/README.md).

Expose the prod box to pilots' browsers via **Nabu Casa** (easiest), a **reverse proxy + DDNS + TLS**, or **Tailscale**. The public URL becomes `VITE_HA_URL` for the SPA build.

## 2. SPA (Netlify)

Connect the Netlify site to this repo; `netlify.toml` sets the build (`pnpm --filter @heater-control/web build` → `packages/web/dist`, Node 24 / pnpm 11). Set `VITE_HA_URL` = the HA public URL (no trailing slash) in the Netlify dashboard. Deploys on push to the default branch.

## 3. ScheduleMaster OIDC proxy (`packages/oidc-proxy/`)

Portable container, configured entirely via env vars (see `packages/oidc-proxy/.env.example`).

1. **Signing key** (once): `pnpm --filter @heater-control/oidc-proxy gen-keys` → store as the `OIDC_JWKS` secret. Don't regenerate per deploy — it breaks HA's cached keys.
2. **Register HA as the client**: set `HA_CLIENT_ID`/`HA_CLIENT_SECRET`, `HA_REDIRECT_URIS` to `auth_oidc`'s callback URL, `OIDC_ISSUER` to the proxy's public URL.
3. **Deploy**: `docker build -f packages/oidc-proxy/Dockerfile -t sm-oidc-proxy .` (from repo root). Recommended host: Fly.io (`fly deploy`, scale-to-zero suits a login-only service).
4. **Point HA at it**: set `OIDC_*` in `deploy/.env` and run `deploy/push.sh --oidc` (renders `auth_oidc.yaml`, ships the patched component, writes `sm_oidc_client_secret` to `secrets.yaml`). Add `auth_oidc: !include auth_oidc.yaml` to `configuration.yaml` and set CORS (the SPA origin) in the HA UI. See [`deploy/README.md`](deploy/README.md).
5. **Guard against site drift**: run the live smoke tests periodically — `SM_TEST_USERNAME=… SM_TEST_PASSWORD=… pnpm --filter @heater-control/sm-client test:smoke` — wired into a scheduled CI job with repo secrets.

## 3b. Monitoring & alerts (Sentry)

Both the proxy and the SPA report errors to [Sentry](https://sentry.io). Reporting
is a no-op until a DSN is set, so it's opt-in per environment.

1. **Create two Sentry projects** (or one shared) — a Node project for the proxy
   and a Browser/React project for the SPA — and copy each DSN.
2. **Proxy**: set the DSN as a Fly secret (redeploys automatically):
   ```bash
   fly secrets set SENTRY_DSN='https://…@…ingest.sentry.io/…' -a sm-oidc-proxy
   ```
   Optionally `SENTRY_ENVIRONMENT` (defaults to `production`).
3. **SPA**: add `VITE_SENTRY_DSN` in the Netlify dashboard (build-time env var) and
   redeploy. It's baked into the client bundle — a browser DSN is safe to expose.
4. **Alert on ScheduleMaster scrape failures** (the important one). When the
   scraper stops understanding ScheduleMaster's login/profile pages, the proxy
   captures the error tagged `sm.scrape_failure=true`, grouped under a single
   `sm-scrape-failure` issue. In the proxy's Sentry project:
   - **Alerts → Create Alert → Issues**.
   - Condition: _The event's tags_ — `sm.scrape_failure` **equals** `true`.
   - Also fire _when an issue changes state to escalating/regressed_ so a
     recurrence after resolution re-notifies.
   - Action: **Send a notification to email** (your address / a team alias).
     Because all scrape failures share one fingerprint, this is one alert that fires
     on the first failure and again on any regression — not a per-request flood.

## 4. Smoke test

1. Open the Netlify URL on your phone.
2. The SPA redirects to HA's login → **Sign in with ScheduleMaster**.
3. Consent flow → redirected back to the SPA, signed in.
4. Switch entities from HA appear; toggling one changes the underlying device.

## Dev loop

- HA: `cd ha-dev && docker compose up` (see [`ha-dev/README.md`](ha-dev/README.md)); `localhost:5173` is already in the dev container's CORS origins.
- SPA: `pnpm dev` — Vite serves at `http://localhost:5173`.
- `packages/web/.env.local` overrides `VITE_HA_URL`.

## Known follow-ups

- **ScheduleMaster integration**: Python `custom_component` at `homeassistant/custom_components/schedulemaster/`, polls ScheduleMaster, exposes bookings as a calendar. `deploy/push.sh` already ships repo `custom_components/` (with a restart).
- **Mobile companion app login**: validate `auth_oidc` works in the HA Companion app if pilots use it.
