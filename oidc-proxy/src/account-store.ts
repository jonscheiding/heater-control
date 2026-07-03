import type { OidcClaims } from "@heater-control/sm-client";

interface Entry {
  claims: OidcClaims;
  expiresAt: number;
}

/**
 * In-memory map of `sub` → scraped claims, populated at login and read by the
 * provider's `findAccount`. There is no ScheduleMaster user database to query,
 * so claims are cached here for the short window of the auth flow.
 *
 * Losing this on restart is acceptable (see the plan): the proxy is only touched
 * at login, and at worst a pilot re-authenticates.
 */
export class AccountStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly ttlSeconds: number) {}

  private now(): number {
    return Date.now();
  }

  set(claims: OidcClaims): void {
    this.entries.set(claims.sub, {
      claims,
      expiresAt: this.now() + this.ttlSeconds * 1000,
    });
  }

  get(sub: string): OidcClaims | undefined {
    const entry = this.entries.get(sub);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(sub);
      return undefined;
    }
    return entry.claims;
  }
}
