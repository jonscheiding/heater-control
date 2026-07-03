# @heater-control/oidc-proxy

An OIDC provider that fronts ScheduleMaster. Home Assistant's `auth_oidc`
integration treats this as a standard upstream issuer; behind the scenes it
authenticates pilots by screen-scraping ScheduleMaster (via
[`@heater-control/sm-client`](../sm-client)) and maps their profile to OIDC
claims (`sub`, `name`, `email`, …).

```
Browser ──▶ HA (auth_oidc) ──▶ oidc-proxy ──▶ ScheduleMaster login
                                    │
                                    └── issues id_token/claims to HA
```

Built on [`oidc-provider`](https://github.com/panva/node-oidc-provider) + a thin
Express layer that renders the login page and auto-approves consent for the
single first-party HA client.

## Configure & run

Copy `.env.example` → `.env` and fill it in. Generate the signing key once:

```bash
pnpm --filter @heater-control/oidc-proxy gen-keys   # → paste into OIDC_JWKS
pnpm --filter @heater-control/oidc-proxy dev        # local dev (tsx-style watch)
```

Discovery is served at `${OIDC_ISSUER}/.well-known/openid-configuration`.

## Deploy

`Dockerfile` builds a portable image (see the header comment for the root-context
build command). It runs on any container host; **Fly.io** is the recommended
default (scale-to-zero suits a login-only service). Signing keys come from
`OIDC_JWKS` so tokens stay valid across restarts.

## State

Grants/sessions use the in-memory adapter and scraped claims live in an in-memory
store for the auth window. The proxy is only touched at login (HA issues its own
tokens to the SPA), so a restart costs at most an occasional re-login. Swap in a
persistent adapter if that becomes undesirable.

## Tests

`pnpm --filter @heater-control/oidc-proxy test` — offline unit tests
(account-store TTL, provider construction). The ScheduleMaster scrape itself is
covered by `sm-client`'s suites.
