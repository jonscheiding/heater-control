# Heater Control — Deploy Notes

The system is two moving parts:

1. **Home Assistant** — self-hosted, runs the heaters and exposes the API the SPA talks to.
2. **SPA** (`web/`) — static React app, hosted on Netlify.

Auth chain: upstream OIDC issuer (Google for testing, ScheduleMaster proxy later) → HA via the `auth_oidc` HACS integration → SPA via HA's OAuth2 flow.

## Prerequisites

- Node 24+, pnpm 11+
- A Home Assistant instance you control (Docker, HA OS, etc.)
- A Google Cloud project with an OAuth 2.0 Client ID (Web application) — temporary, for POC login
- A Netlify account (or other static host)

## 1. Home Assistant setup

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

## 3. Smoke test

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
- **Phase 3 ScheduleMaster integration**: Python `custom_component` at `custom_components/schedulemaster/`, polls ScheduleMaster, exposes bookings as a calendar entity. Replace Google with the ScheduleMaster auth proxy at this point.
- **Mobile companion app login flow**: validate `auth_oidc` works in the HA Companion app if pilots will use it.
