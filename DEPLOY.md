# Heater Control — Deploy Notes

The system is three moving parts:

1. **Home Assistant** — self-hosted, runs the heaters and exposes the API the SPA talks to.
2. **SPA** (`web/`) — static React app, hosted on Netlify.
3. **ScheduleMaster OIDC proxy** (`oidc-proxy/`) — container that lets pilots sign in with their ScheduleMaster credentials; wraps the `sm-client` scraper in a standards OIDC provider.

Auth chain: upstream OIDC issuer (Google for testing, the ScheduleMaster proxy for production) → HA via the `auth_oidc` HACS integration → SPA via HA's OAuth2 flow.

## Prerequisites

- Node 24+, pnpm 11+
- A Home Assistant instance you control (Docker, HA OS, etc.)
- A Google Cloud project with an OAuth 2.0 Client ID (Web application) — temporary, for POC login
- A Netlify account (or other static host)

## 1. Home Assistant setup

> **Containerized dev + demo:** the fastest path is the self-provisioning image
> in [`ha-dev/`](ha-dev/) — `cd ha-dev && docker compose up --build` for local dev
> (with the OIDC proxy running on the host), or `fly deploy -c ha-dev/fly.toml`
> for a scale-to-zero, volume-less Fly demo. It bakes the `homeassistant/`
> reference config + `auth_oidc` (patched) and self-onboards. See
> [`ha-dev/README.md`](ha-dev/README.md).
>
> **Prod HAOS box:** provisioned **by hand** (the steps below). Once it's up,
> [`deploy/`](deploy/) automates only the recurring part — `deploy/push.sh` ships
> `packages/` + the `heater_control` blueprint over SSH and hot-reloads, and
> `deploy/heater.sh` scaffolds a new heater package. See
> [`deploy/README.md`](deploy/README.md).

### 1a. Start HA in Docker (skip if already running)

Standard `homeassistant/home-assistant` image. Volume-mount a config directory so settings persist across container restarts.

### 1b. Install HACS

HACS works in HA Container — the install is a one-liner inside the running container:

```bash
docker exec -it <ha-container> bash
wget -O - https://get.hacs.xyz | bash -
exit
docker restart <ha-container>
```

Then in the HA UI: Settings → Devices & Services → Add Integration → search "HACS" → authorize via GitHub (device-code flow).

### 1c. Install the `auth_oidc` integration via HACS

Custom repository: `https://github.com/christiaangoossens/hass-oidc-auth` (category: Integration). Then in HACS → Integrations, search "OIDC Auth" → download → restart HA.

Check the integration's README for current `configuration.yaml` schema — the keys have shifted between releases.

### 1d. Configure Google as the OIDC issuer (POC)

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client → Web application.
2. Authorized redirect URI: whatever the `auth_oidc` README specifies as its callback path on your HA host.
3. Add the resulting `client_id` and `client_secret` to HA's `auth_oidc` config block, with `discovery_url: https://accounts.google.com/.well-known/openid-configuration`.

### 1e. Allow the SPA's origin (CORS) and trust its reverse proxy if any

In HA's `configuration.yaml`:

```yaml
http:
  cors_allowed_origins:
    - http://localhost:5173 # vite dev
    - https://<your-netlify-domain> # prod SPA
  # If HA sits behind a reverse proxy (Nabu Casa, traefik, etc.):
  # use_x_forwarded_for: true
  # trusted_proxies:
  #   - <proxy IP>
```

Restart HA after changes.

### 1f. Expose HA to the public internet

Pilots' browsers need to reach HA directly. Options:

- **Nabu Casa** (easiest, ~$75/yr): one-click public HTTPS endpoint
- **Reverse proxy + DDNS + Let's Encrypt** (free, more setup)
- **Tailscale** (only viable for tech-comfortable users)

Whichever you pick, the public URL is what goes into `VITE_HA_URL` for the SPA's production build.

## 2. SPA deployment (Netlify)

Connect the Netlify site to this repo. `netlify.toml` at the repo root configures the build:

- Build command: `pnpm --filter @heater-control/web build`
- Publish directory: `web/dist`
- Node 24, pnpm 11

Set the environment variable in the Netlify dashboard:

- `VITE_HA_URL` = your HA's public URL (no trailing slash)

Deploys trigger on push to the default branch.

## 3. ScheduleMaster OIDC proxy (`oidc-proxy/`)

Production login uses the pilot's ScheduleMaster account instead of Google. The
proxy is a portable container — deploy it to any container host and configure it
entirely via env vars (see `oidc-proxy/.env.example`).

1. **Generate a signing key** (once): `pnpm --filter @heater-control/oidc-proxy gen-keys`
   → store the output as the `OIDC_JWKS` secret. Don't regenerate per deploy, or HA's
   cached keys break.
2. **Register HA as the client**: pick `HA_CLIENT_ID`/`HA_CLIENT_SECRET`, set
   `HA_REDIRECT_URIS` to `auth_oidc`'s callback URL, and set `OIDC_ISSUER` to the proxy's
   public URL.
3. **Deploy the container**: `docker build -f oidc-proxy/Dockerfile -t sm-oidc-proxy .`
   (from the repo root). Recommended host: **Fly.io** (`fly deploy`, scale-to-zero suits a
   login-only service); alternatives are Railway, or a container beside HA on the same
   Docker host reusing its Tailscale/reverse-proxy exposure.
4. **Point HA at it**: merge `homeassistant/auth_oidc.example.yaml` into `configuration.yaml`
   with the matching discovery URL / client credentials, and add
   `sm_oidc_client_secret` to `secrets.yaml`. Restart HA.
5. **Guard against site drift**: run the live smoke tests periodically —
   `SM_TEST_USERNAME=… SM_TEST_PASSWORD=… pnpm --filter @heater-control/sm-client test:smoke`
   — to catch ScheduleMaster login-flow changes before pilots do (wire into a scheduled CI
   job with repo secrets).

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
2. The SPA redirects to HA's login.
3. Click "Sign in with Google" (provided by `auth_oidc`).
4. Consent flow → redirected back to the SPA, signed in.
5. List of switch entities from HA appears; toggling one changes the underlying device.

## Dev loop

- HA: keep the Docker container running locally.
- SPA: `pnpm dev` (alias for `pnpm --filter @heater-control/web dev`). Vite serves at `http://localhost:5173`. Add that origin to HA's `cors_allowed_origins` and to your Google OAuth client's authorized origins/redirects.
- `web/.env.local` overrides `VITE_HA_URL` if you want to point dev at a non-default HA URL.

## Known follow-ups

- **Phase 2 scheduling**: define HA calendar entity for one-off turn-ons + `timer` entities for auto-off; SPA gains a scheduling UI against HA's calendar event REST endpoints.
- **Phase 3 ScheduleMaster integration**: Python `custom_component` at `custom_components/schedulemaster/`, polls ScheduleMaster, exposes bookings as a calendar entity. (The ScheduleMaster **auth** proxy that replaces Google now lives in `oidc-proxy/` — see section 3.)
- **Mobile companion app login flow**: validate `auth_oidc` works in the HA Companion app if pilots will use it.
