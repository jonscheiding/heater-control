import { smUrl } from "./config.js";
import type { Session } from "./session.js";

export type LoginFailureReason = "invalid_credentials" | "suspended";

export interface LoginSuccess {
  ok: true;
  session: Session;
  /**
   * Any `Set-Cookie` values from the login response, pre-joined into a `Cookie`
   * request header. The 2018 flow needed no cookies (session lives in the URL),
   * but we forward them defensively in case the site now sets a required cookie.
   */
  cookies: string | null;
}

export interface LoginFailure {
  ok: false;
  reason: LoginFailureReason;
}

export type LoginResult = LoginSuccess | LoginFailure;

/**
 * Thrown when ScheduleMaster returns something the scraper doesn't recognise —
 * i.e. the login flow has probably changed. The live smoke test asserts against
 * this so drift is caught before a pilot hits a broken login.
 */
export class ScheduleMasterFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleMasterFlowError";
  }
}

function collectCookies(response: Response): string | null {
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length === 0) return null;
  // Reduce each Set-Cookie to its `name=value` pair for the Cookie header.
  return setCookies.map((c) => c.split(";", 1)[0]).join("; ");
}

/**
 * POST credentials to `/login.asp` and interpret the 302 redirect.
 *
 * ScheduleMaster signals the outcome entirely through the `Location` header:
 * `rd=loginerror` for bad credentials, a `suspended.asp` path for suspended
 * accounts, and `userid` + `session` query params on success.
 */
export async function login(
  username: string,
  password: string,
): Promise<LoginResult> {
  const body = new URLSearchParams({
    USERID: username,
    DATA: password,
    CMD: "LOGIN",
  });

  const response = await fetch(smUrl("/login.asp"), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const location = response.headers.get("location");
  if (!location) {
    throw new ScheduleMasterFlowError(
      `Expected a redirect from /login.asp but got status ${response.status} with no Location header.`,
    );
  }

  let redirect: URL;
  try {
    redirect = new URL(location, smUrl("/login.asp"));
  } catch {
    throw new ScheduleMasterFlowError(
      `Could not parse the login redirect Location: ${location}`,
    );
  }

  if (redirect.searchParams.get("rd") === "loginerror") {
    return { ok: false, reason: "invalid_credentials" };
  }

  if (redirect.pathname.toLowerCase().endsWith("suspended.asp")) {
    return { ok: false, reason: "suspended" };
  }

  const userid = redirect.searchParams.get("USERID");
  const session = redirect.searchParams.get("SESSION");
  if (!userid || !session) {
    throw new ScheduleMasterFlowError(
      `Login redirect lacked userid/session params: ${redirect.toString()}`,
    );
  }

  return {
    ok: true,
    session: { userid, session },
    cookies: collectCookies(response),
  };
}
