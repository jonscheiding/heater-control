import { callService, type Connection } from "home-assistant-js-websocket";

import { getHaTimeZone, haFetch } from "../ha/connection.js";
import { wallTimeToMs } from "../utils/time.js";

export const SCHEDULES_CALENDAR = "calendar.heater_schedules";
export const SCHEDULEMASTER_CALENDAR = "calendar.schedulemaster";

export type ScheduleSource = "local" | "schedulemaster";

export interface HeaterSchedule {
  uid: string;
  /**
   * Every `*Iso` field here is a UTC instant (`toISOString()` form) — normalized
   * on the way in by `toInstantIso`, since HA reports calendar times in *its*
   * timezone. Safe to `new Date(...)` or compare as epoch ms.
   */
  startIso: string;
  endIso: string;
  /** Calendar entity this event lives on — needed to delete it. */
  calendarEntity: string;
  /** Target heater entity_id (the turn-on target). */
  entityId: string;
  source: ScheduleSource;
  username: string | null;
  userId: string | null;
  userEmail: string | null;
  nNumber: string | null;
  aircraftType: string | null;
  /** Flight comment (ScheduleMaster). */
  comment: string | null;
  /** Actual scheduled flight start/end (ScheduleMaster). */
  flightStartIso: string | null;
  flightEndIso: string | null;
  /** Raw event summary ("Name - Tail"); handy for debugging/tooltip. */
  title: string | null;
}

/** JSON payload stored in a calendar event's `description` (shared with HA). */
interface EventPayload {
  entity_id?: string;
  source?: string;
  username?: string | null;
  user_id?: string | null;
  user_email?: string | null;
  n_number?: string | null;
  aircraft_type?: string | null;
  comment?: string | null;
  flight_start?: string | null;
  flight_end?: string | null;
}

interface RawEvent {
  uid?: string;
  summary?: string;
  description?: string;
  start?: string | { dateTime?: string; date?: string };
  end?: string | { dateTime?: string; date?: string };
}

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Resolve a calendar timestamp to an absolute instant, as UTC ISO.
 *
 * HA's calendar API reports a timed event as `{dateTime}` in *HA's* timezone
 * (offset included, e.g. "2026-08-13T09:30:00-04:00") and an all-day one as
 * `{date}` — a bare "2026-08-13" with no zone at all. A zone-less value read
 * as-is is interpreted in the *browser's* zone, which shifts it whenever the
 * browser and the HAOS box disagree. Everything downstream treats these fields
 * as instants (`new Date(...)`, epoch comparisons), so pin the zone-less shapes
 * to HA's timezone here and hand back one canonical format.
 */
function toInstantIso(
  value: RawEvent["start"] | RawEvent["end"] | null,
  haTimeZone: string | null,
): string | undefined {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? (value.dateTime ?? value.date)
        : undefined;
  if (!raw) return undefined;

  const ms = HAS_ZONE.test(raw)
    ? Date.parse(raw)
    : wallTimeToMs(raw, haTimeZone);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function parsePayload(description: string): EventPayload | null {
  const trimmed = description.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as EventPayload;
  } catch {
    return null;
  }
}

async function listFromCalendar(
  calendarEntity: string,
  defaultSource: ScheduleSource,
  startIso: string,
  endIso: string,
): Promise<HeaterSchedule[]> {
  const path =
    `/api/calendars/${calendarEntity}` +
    `?start=${encodeURIComponent(startIso)}` +
    `&end=${encodeURIComponent(endIso)}`;
  const [response, haTimeZone] = await Promise.all([
    haFetch(path),
    getHaTimeZone(),
  ]);
  if (!response.ok) {
    throw new Error(
      `Failed to list schedules for ${calendarEntity}: ${response.status} ${response.statusText}`,
    );
  }
  const data: unknown = await response.json();
  const raw: RawEvent[] = Array.isArray(data)
    ? (data as RawEvent[])
    : ((data as { events?: RawEvent[] }).events ?? []);

  // HA returns events that *overlap* the window, so an already-running preheat
  // comes back too; keep only ones that haven't started yet.
  const windowStartMs = Date.parse(startIso);

  return raw
    .map((e): HeaterSchedule | null => {
      const startVal = toInstantIso(e.start, haTimeZone);
      const endVal = toInstantIso(e.end, haTimeZone);
      const description = (e.description ?? "").trim();
      const payload = parsePayload(description);
      // Structured events carry entity_id in the JSON; tolerate a legacy
      // plain-entity_id description too.
      const entityId = (payload?.entity_id ?? description).trim();
      if (!e.uid || !entityId || !startVal || !endVal) return null;

      const source: ScheduleSource =
        payload?.source === "local" || payload?.source === "schedulemaster"
          ? payload.source
          : defaultSource;

      return {
        uid: e.uid,
        startIso: startVal,
        endIso: endVal,
        calendarEntity,
        entityId,
        source,
        username: payload?.username ?? null,
        userId: payload?.user_id ?? null,
        userEmail: payload?.user_email ?? null,
        nNumber: payload?.n_number ?? null,
        aircraftType: payload?.aircraft_type ?? null,
        comment: payload?.comment ?? null,
        // Written by our own integration as UTC, but normalize anyway so every
        // `*Iso` field on this object carries the same guarantee.
        flightStartIso: toInstantIso(payload?.flight_start, haTimeZone) ?? null,
        flightEndIso: toInstantIso(payload?.flight_end, haTimeZone) ?? null,
        title: e.summary?.trim() || null,
      };
    })
    .filter(
      (s): s is HeaterSchedule =>
        s !== null && Date.parse(s.startIso) > windowStartMs,
    );
}

export async function listSchedules(
  startIso: string,
  endIso: string,
): Promise<HeaterSchedule[]> {
  // Local schedules are required; ScheduleMaster is best-effort so the app keeps
  // working when the integration isn't deployed (the calendar 404s).
  const [local, sm] = await Promise.all([
    listFromCalendar(SCHEDULES_CALENDAR, "local", startIso, endIso),
    listFromCalendar(
      SCHEDULEMASTER_CALENDAR,
      "schedulemaster",
      startIso,
      endIso,
    ).catch(() => [] as HeaterSchedule[]),
  ]);
  return [...local, ...sm];
}

export interface CreateScheduleInput {
  targetEntityId: string;
  targetName: string;
  startIso: string;
  username: string;
  userId: string | null;
  nNumber: string | null;
  aircraftType: string | null;
}

export async function createSchedule(
  connection: Connection,
  input: CreateScheduleInput,
): Promise<void> {
  const endIso = new Date(
    new Date(input.startIso).getTime() + 60_000,
  ).toISOString();
  const payload: EventPayload = {
    entity_id: input.targetEntityId,
    source: "local",
    username: input.username,
    user_id: input.userId,
    user_email: null,
    n_number: input.nNumber,
    aircraft_type: input.aircraftType,
    comment: null,
  };
  const summary = input.nNumber
    ? `${input.username} - ${input.nNumber}`
    : `${input.username} - ${input.targetName}`;
  await callService(
    connection,
    "calendar",
    "create_event",
    {
      summary,
      description: JSON.stringify(payload),
      start_date_time: input.startIso,
      end_date_time: endIso,
    },
    { entity_id: SCHEDULES_CALENDAR },
  );
}

export async function deleteSchedule(
  connection: Connection,
  uid: string,
  calendarEntity: string,
): Promise<void> {
  await connection.sendMessagePromise({
    type: "calendar/event/delete",
    entity_id: calendarEntity,
    uid,
  });
}
