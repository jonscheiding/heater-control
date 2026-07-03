# @heater-control/sm-client

Screen-scraping client for [ScheduleMaster](https://my.schedulemaster.com), the
airplane scheduling site. ScheduleMaster has no public API, so this logs in by
posting the classic ASP.NET login form and reads identity claims off the profile
page. It exists to feed the ScheduleMaster OIDC proxy (`../oidc-proxy`).

## Usage

```ts
import { authenticate } from "@heater-control/sm-client";

const result = await authenticate(username, password);
if (result.ok) {
  console.log(result.claims); // { sub, name, given_name, family_name, email, preferred_username }
} else {
  console.log(result.reason); // "invalid_credentials" | "suspended"
}
```

`authenticate()` throws `ScheduleMasterFlowError` when the site responds in a
shape the scraper no longer understands — that's the signal the flow has changed.

## The scraped flow

| Step    | Request                                                               | Signal                                                                                                         |
| ------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Login   | `POST /login.asp` (`USERID`, `DATA`, `CMD=LOGIN`), no redirect follow | 302 `Location`: `rd=loginerror` → bad creds, `suspended.asp` → suspended, else `userid`+`session` query params |
| Profile | `GET /UserInfo.aspx?GETUSER=M&userid=…&session=…`                     | form inputs `tx_firstname`, `tx_lastname`, `tx_mi`, `tx_email`                                                 |

Session is carried in the URL, not cookies; cookies from login are forwarded
defensively in case that changes.

## Tests

- `pnpm --filter @heater-control/sm-client test` — offline unit + fixture tests
  (mocked `fetch`, saved `UserInfo.aspx` fixture). Always safe to run in CI.
- `pnpm --filter @heater-control/sm-client test:smoke` — **live** tripwire tests
  against the real site. Requires `SM_TEST_USERNAME` / `SM_TEST_PASSWORD` (see
  `.env.example`); skipped with a warning when unset. Run manually or on a
  schedule to catch login-flow drift before pilots do.
