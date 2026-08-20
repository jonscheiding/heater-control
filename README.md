# Heater Control

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![Build and test](https://github.com/jonscheiding/heater-control/actions/workflows/build-test.yml/badge.svg)](https://github.com/jonscheiding/heater-control/actions/workflows/build-test.yml)
[![ScheduleMaster regression](https://github.com/jonscheiding/heater-control/actions/workflows/schedulemaster-regression.yml/badge.svg)](https://github.com/jonscheiding/heater-control/actions/workflows/schedulemaster-regression.yml)
[![Deploy to HAOS](https://github.com/jonscheiding/heater-control/actions/workflows/deploy-haos.yml/badge.svg)](https://github.com/jonscheiding/heater-control/actions/workflows/deploy-haos.yml)
[![Netlify Status](https://api.netlify.com/api/v1/badges/badbf539-ec87-487c-b894-99fbc3e286d1/deploy-status)](https://app.netlify.com/projects/heater-control/deploys)

Remote control for airplane engine block heaters, so pilots can preheat an
engine before a cold-weather flight from their phone.

[Home Assistant](https://www.home-assistant.io/) does the heavy lifting — it
owns the devices, scheduling, auto-off timers, and auth. This repo adds a
mobile-friendly single-page app on top, plus an OIDC proxy that lets pilots
sign in with their existing [ScheduleMaster](https://www.schedulemaster.com/)
credentials.

## How it works

```
pilot's browser ──▶ SPA (Netlify) ──▶ Home Assistant ──▶ heater switches
                                          │
                                          └─ auth_oidc ──▶ OIDC proxy ──▶ ScheduleMaster
```

- **SPA** (`packages/web/`) — static React app that talks to Home Assistant
  over its WebSocket API and signs users in via HA's OAuth2 flow. It installs
  as an app too: home screen on iOS and Android, Dock on macOS.
- **Home Assistant** — self-hosted; the reference configuration and the
  `heater_control` integration (heaters, auto-off) live in
  [`homeassistant/`](homeassistant/).
- **OIDC proxy** (`packages/oidc-proxy/`) — wraps the ScheduleMaster login
  scraper (`packages/sm-client/`) in a standards-compliant OIDC provider, which
  HA consumes via the [`auth_oidc`](https://github.com/christiaangoossens/hass-oidc-auth)
  HACS integration.

## Repository layout

| Path                   | What it is                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/web/`        | React SPA (Vite), deployed to Netlify                                                              |
| `packages/oidc-proxy/` | ScheduleMaster OIDC provider (Express + `oidc-provider`), runs on Fly.io                           |
| `packages/sm-client/`  | ScheduleMaster login/profile scraper used by the proxy                                             |
| `homeassistant/`       | Declarative HA reference config — see [its README](homeassistant/README.md)                        |
| `ha-dev/`              | Self-provisioning HA container for local dev and the Fly demo — see [its README](ha-dev/README.md) |
| `DEPLOY.md`            | End-to-end deployment guide (HA, Netlify, Fly, Sentry)                                             |
| `TODO.md`              | Roadmap / open items                                                                               |

## Development

Requires Node 24+, pnpm 11+, and Docker.

```bash
pnpm install
pnpm dev        # runs the OIDC proxy, the SPA (http://localhost:5173), and HA in Docker
```

The dev stack needs a little one-time setup (an `/etc/hosts` entry and a proxy
`.env.local` with a generated signing key) — see
[`ha-dev/README.md`](ha-dev/README.md#local-dev-oidc-proxy-on-the-host) for the
full walkthrough. Individual pieces can also run standalone: `pnpm dev:web`,
`pnpm dev:oidc`, `pnpm dev:ha`.

Other useful commands:

```bash
pnpm test       # run all package test suites
pnpm lint       # eslint across the workspace
pnpm format     # prettier check
pnpm build      # build all packages
```

### The installable app

The SPA offers to install itself: Chromium browsers get a one-click install,
and Safari on iOS/macOS — which has no install API — gets directions to the
menu item that does it. The offer hides itself once the app is installed, and a
dismissal is remembered for a month.

The service worker behind it is only registered in production builds, so test
installability with `pnpm --filter @heater-control/web preview` rather than
`pnpm dev:web`. App icons are generated from
[`packages/web/icons/app-icon.svg`](packages/web/icons/app-icon.svg) by
`packages/web/icons/generate.sh` (needs ImageMagick); rerun it after editing the
artwork.

## Deployment

See [`DEPLOY.md`](DEPLOY.md) for the full guide: Home Assistant setup
(container or HAOS), the Netlify SPA build, deploying the OIDC proxy to
Fly.io, and Sentry monitoring/alerts.
