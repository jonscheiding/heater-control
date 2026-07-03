/**
 * ScheduleMaster carries auth as URL query params (`userid` + `session`)
 * appended to every request after login — not cookies. This mirrors the
 * behaviour of the original schedulemaster-api scraper.
 */
export interface Session {
  userid: string;
  session: string;
}

/** Return a copy of `url` with the session's query params applied. */
export function withSession(url: URL, session: Session): URL {
  const next = new URL(url);
  next.searchParams.set("userid", session.userid);
  next.searchParams.set("session", session.session);
  return next;
}
