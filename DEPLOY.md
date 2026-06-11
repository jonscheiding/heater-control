# Heater Control — MVP Deploy Notes

## Prerequisites

- Node 20+, pnpm 9+
- AWS CLI configured with credentials (`aws sts get-caller-identity` works)
- A SmartThings account that owns the switches/sensors, with a Personal Access Token
- A Google Cloud project with an OAuth 2.0 Client ID (Web application)

## One-time setup

### 1. Install

```bash
cd /Users/jonscheiding/Code/Personal/heater-control
pnpm install
```

### 2. Find your SmartThings location id

```bash
curl -H "Authorization: Bearer <PAT>" https://api.smartthings.com/v1/locations
```

Note the `locationId` for the hangar location.

### 3. Get a Google OAuth client

Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application.

Authorized JavaScript origins:

- `http://localhost:5173` (dev)
- `https://<AppUrl>` (added after first deploy)

Authorized redirect URIs:

- `http://localhost:5173` (dev)
- `https://<AppUrl>` (added after first deploy)

Note the **Client ID** (no client secret needed — public SPA uses PKCE).

### 4. Bootstrap CDK (first time only per account/region)

```bash
cd infra
npx cdk bootstrap
```

## Deploy

### Deploy the app stack

```bash
export GOOGLE_CLIENT_ID=...
export SMARTTHINGS_LOCATION_ID=...
export ALLOWED_EMAILS=jon@example.com,pilot2@example.com

pnpm --filter @heater-control/infra deploy
```

Note the `AppUrl` (CloudFront), `WebBucketName`, and `SmartThingsSecretArn` outputs.

### Update the Google OAuth client

Add `https://<AppUrl>` to both Authorized JavaScript origins and Authorized redirect URIs in the Google Cloud Console.

### Populate the SmartThings secret

```bash
aws secretsmanager put-secret-value \
  --secret-id <SmartThingsSecretArn> \
  --secret-string '<your-PAT>'
```

### Build and upload the frontend

```bash
cd web
cat > .env.production <<EOF
VITE_OIDC_AUTHORITY=https://accounts.google.com
VITE_OIDC_CLIENT_ID=$GOOGLE_CLIENT_ID
EOF

pnpm build
aws s3 sync dist/ s3://<WebBucketName>/ --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"
```

(Find `DistributionId` in the CloudFront console or via `aws cloudfront list-distributions`.)

## Smoke test

1. Open `https://<AppUrl>` on your phone
2. Tap Sign In → consent screen → redirected back signed in
3. If your email isn't in `ALLOWED_EMAILS`, API calls return 403 — you'll see "Failed to load devices"
4. With an allowed email: list of devices from the configured SmartThings location appears
5. Tap the toggle on a switch — the SmartThings device should change state within a second

## Dev loop

- Frontend: `pnpm dev:web` with `web/.env.local` pointing `VITE_API_BASE` to the API Gateway URL (CloudFront's `/api/*` rewrite only applies in prod). Add `http://localhost:5173` to the Google OAuth client's authorized origins.
- API: there's no local Lambda emulator wired up; iterate by `pnpm --filter @heater-control/infra deploy` — the `NodejsFunction` only redeploys the Lambda bundle, which is fast.

## Known follow-ups (post-MVP)

- Phase 2: EventBridge Scheduler for user-driven schedules, DynamoDB table for schedule records
- Phase 3: Replace Google with the ScheduleMaster auth proxy — change `VITE_OIDC_*` and `OIDC_*` env vars, drop the `ALLOWED_EMAILS` gate (the proxy itself is the gate)
- Local Lambda dev (SAM, or wrap Hono in a plain Node server for `pnpm dev:api`)
