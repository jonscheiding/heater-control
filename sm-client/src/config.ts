/**
 * ScheduleMaster has no public API — this client screen-scrapes the classic
 * ASP.NET site at my.schedulemaster.com. The base URL is configurable so tests
 * can point at a local fixture server, but defaults to production.
 */
export const DEFAULT_BASE_URL = "https://my.schedulemaster.com";

export function baseUrl(): string {
  return process.env["SM_BASE_URL"] ?? DEFAULT_BASE_URL;
}

/** Build an absolute ScheduleMaster URL from a path (e.g. `/login.asp`). */
export function smUrl(path: string): URL {
  return new URL(path, baseUrl());
}
