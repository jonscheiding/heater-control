import { toClaims, type OidcClaims } from "./claims.js";
import { login } from "./login.js";
import { getUserInfo } from "./user-info.js";

export { DEFAULT_BASE_URL, baseUrl, smUrl } from "./config.js";
export {
  login,
  ScheduleMasterFlowError,
  type LoginResult,
  type LoginSuccess,
  type LoginFailure,
  type LoginFailureReason,
} from "./login.js";
export { withSession, type Session } from "./session.js";
export { getUserInfo, USER_INFO_FIELDS, type SmUser } from "./user-info.js";
export { toClaims, type OidcClaims } from "./claims.js";

export type AuthenticateResult =
  | { ok: true; claims: OidcClaims }
  | { ok: false; reason: "invalid_credentials" | "suspended" };

/**
 * Full login → profile → claims flow. Returns OIDC claims on success, or a
 * typed failure reason. Throws {@link ScheduleMasterFlowError} if ScheduleMaster
 * responds in a shape the scraper no longer understands.
 */
export async function authenticate(
  username: string,
  password: string,
): Promise<AuthenticateResult> {
  const result = await login(username, password);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const user = await getUserInfo(result.session, result.cookies);
  return { ok: true, claims: toClaims(user, username) };
}
