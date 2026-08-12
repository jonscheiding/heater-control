/** Minutes to add to UTC to get wall time in `timeZone` at instant `utcMs`. */
function offsetMinutes(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(utcMs));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // "GMT-04:00", or a bare "GMT" for UTC itself.
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * Resolve a zone-less wall time ("2026-08-13T09:30:00", or "2026-08-13" meaning
 * midnight) to epoch ms, reading it as happening in `timeZone`. Falls back to
 * the browser's zone when `timeZone` is null. NaN if unparseable.
 *
 * Two lookups: the first offset comes from the wall time read as if it were UTC,
 * which near a DST transition can be the wrong side's offset; re-reading it at
 * the corrected instant settles that.
 */
export function wallTimeToMs(wall: string, timeZone: string | null): number {
  const naive = wall.length === 10 ? `${wall}T00:00:00` : wall;
  // Without a zone, `new Date` reads a date-time as browser-local but a bare
  // date as UTC — appending the time above keeps the fallback consistently local.
  if (!timeZone) return new Date(naive).getTime();

  const asUtc = Date.parse(`${naive}Z`);
  if (Number.isNaN(asUtc)) return NaN;
  const firstPass = asUtc - offsetMinutes(timeZone, asUtc) * 60_000;
  return asUtc - offsetMinutes(timeZone, firstPass) * 60_000;
}
