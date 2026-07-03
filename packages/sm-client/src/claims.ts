import type { SmUser } from "./user-info.js";

/** Standard OIDC claims we can source from a ScheduleMaster profile. */
export interface OidcClaims {
  /** Stable subject — ScheduleMaster's userid. */
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  email: string;
  /** The login username the pilot typed. */
  preferred_username: string;
}

/** Map a scraped ScheduleMaster user + login name onto OIDC claims. */
export function toClaims(user: SmUser, username: string): OidcClaims {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return {
    sub: user.userid,
    name,
    given_name: user.firstName,
    family_name: user.lastName,
    email: user.email,
    preferred_username: username,
  };
}
