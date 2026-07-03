import { describe, expect, it } from "vitest";

import { authenticate } from "../src/index.js";
import { login } from "../src/login.js";
import { getUserInfo } from "../src/user-info.js";

/**
 * Live smoke tests — the tripwire for ScheduleMaster login-flow drift.
 *
 * These hit the real my.schedulemaster.com and only run when credentials are
 * present (use your personal account):
 *
 *   SM_TEST_USERNAME=... SM_TEST_PASSWORD=... [SM_TEST_EMAIL=...] \
 *     pnpm --filter @heater-control/sm-client test:smoke
 *
 * Each assertion is scoped so a failure points at *which* part of the flow
 * changed: the login redirect shape, the error signalling, or the profile page.
 */
const username = process.env["SM_TEST_USERNAME"];
const password = process.env["SM_TEST_PASSWORD"];
const expectedEmail = process.env["SM_TEST_EMAIL"];
const haveCreds = Boolean(username && password);

describe.skipIf(!haveCreds)("ScheduleMaster live login flow", () => {
  it("valid login still returns userid + session in the redirect", async () => {
    const result = await login(username!, password!);
    expect(result.ok, "expected a successful login").toBe(true);
    if (result.ok) {
      expect(result.session.userid).toBeTruthy();
      expect(result.session.session).toBeTruthy();
    }
  });

  it("a wrong password is still signalled as invalid_credentials", async () => {
    const result = await login(username!, `${password!}-definitely-wrong`);
    expect(result).toMatchObject({ ok: false, reason: "invalid_credentials" });
  });

  it("UserInfo still exposes the name + email claims", async () => {
    const result = await login(username!, password!);
    if (!result.ok) throw new Error("login failed; cannot check UserInfo");

    const user = await getUserInfo(result.session, result.cookies);
    expect(user.email, "profile email should be present").toContain("@");
    expect(
      user.firstName || user.lastName,
      "profile should have a name",
    ).toBeTruthy();
  });

  it("authenticate() yields OIDC claims", async () => {
    const result = await authenticate(username!, password!);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBeTruthy();
      expect(result.claims.email).toContain("@");
      if (expectedEmail) {
        expect(result.claims.email.toLowerCase()).toBe(
          expectedEmail.toLowerCase(),
        );
      }
    }
  });
});

if (!haveCreds) {
  // Surface *why* nothing ran, so a green smoke run can't be mistaken for a pass.
  console.warn(
    "[smoke] SM_TEST_USERNAME/SM_TEST_PASSWORD not set — live ScheduleMaster smoke tests skipped.",
  );
}
