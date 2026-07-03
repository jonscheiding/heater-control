import { load } from "cheerio";

import { smUrl } from "./config.js";
import { ScheduleMasterFlowError } from "./login.js";
import { withSession, type Session } from "./session.js";

export interface SmUser {
  /** ScheduleMaster's stable numeric user id (from the session). */
  userid: string;
  firstName: string;
  lastName: string;
  middleInitial: string | null;
  email: string;
}

/**
 * Field names on the ASP.NET UserInfo form. Isolated here because these are the
 * selectors most likely to break if ScheduleMaster reworks the page — the
 * fixture and smoke tests assert against them.
 */
const FIELDS = {
  firstName: "tx_firstname",
  lastName: "tx_lastname",
  middleInitial: "tx_mi",
  email: "tx_email",
} as const;

function inputValue($: ReturnType<typeof load>, field: string): string | null {
  // ASP.NET names inputs with a naming-container prefix, e.g.
  // `ctl00$CPL1$tx_firstname`. Match either the bare field or the `$`-suffixed
  // form so the scraper survives the container path changing again. The `$=`
  // (ends-with) form also keeps `tx_email` from matching `tx_email2`.
  const value = $(`input[name="${field}"], input[name$="$${field}"]`)
    .first()
    .attr("value");
  return value === undefined ? null : value;
}

/**
 * Fetch and parse the logged-in user's profile from `/UserInfo.aspx`, returning
 * the claims we care about (name + email). `cookies` is forwarded from login as
 * a safeguard; the 2018 flow authenticated purely via the URL session params.
 */
export async function getUserInfo(
  session: Session,
  cookies?: string | null,
): Promise<SmUser> {
  const url = withSession(smUrl("/UserInfo.aspx"), session);
  url.searchParams.set("GETUSER", "M");

  const response = await fetch(url, {
    headers: cookies ? { cookie: cookies } : {},
  });
  if (!response.ok) {
    throw new ScheduleMasterFlowError(
      `UserInfo.aspx returned status ${response.status}.`,
    );
  }

  const $ = load(await response.text());

  const firstName = inputValue($, FIELDS.firstName);
  const lastName = inputValue($, FIELDS.lastName);
  const email = inputValue($, FIELDS.email);

  // If the core fields are absent, the page shape has changed (or the session
  // was rejected and we got a login page back).
  if (firstName === null && lastName === null && email === null) {
    throw new ScheduleMasterFlowError(
      "UserInfo.aspx did not contain the expected profile fields (tx_firstname/tx_lastname/tx_email).",
    );
  }

  return {
    userid: session.userid,
    firstName: firstName ?? "",
    lastName: lastName ?? "",
    middleInitial: inputValue($, FIELDS.middleInitial),
    email: email ?? "",
  };
}

export { FIELDS as USER_INFO_FIELDS };
