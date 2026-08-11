import { callService, type Connection } from "home-assistant-js-websocket";

import { haFetch } from "../ha/connection.js";

export const SCHEDULES_CALENDAR = "calendar.heater_schedules";
export const SCHEDULEMASTER_CALENDAR = "calendar.schedulemaster";

export type ScheduleSource = "local" | "schedulemaster";

export interface HeaterSchedule {
  uid: string;
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
}

interface RawEvent {
  uid?: string;
  summary?: string;
  description?: string;
  start?: string | { dateTime?: string; date?: string };
  end?: string | { dateTime?: string; date?: string };
}

function extractIso(
  value: RawEvent["start"] | RawEvent["end"],
): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.dateTime ?? value.date;
  return undefined;
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
  const response = await haFetch(path);
  if (!response.ok) {
    throw new Error(
      `Failed to list schedules for ${calendarEntity}: ${response.status} ${response.statusText}`,
    );
  }
  const data: unknown = await response.json();
  const raw: RawEvent[] = Array.isArray(data)
    ? (data as RawEvent[])
    : ((data as { events?: RawEvent[] }).events ?? []);

  return raw
    .map((e): HeaterSchedule | null => {
      const startVal = extractIso(e.start);
      const endVal = extractIso(e.end);
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
        title: e.summary?.trim() || null,
      };
    })
    .filter((s): s is HeaterSchedule => s !== null);
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
