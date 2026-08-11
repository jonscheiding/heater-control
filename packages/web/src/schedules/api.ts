import { callService, type Connection } from "home-assistant-js-websocket";

import { haFetch } from "../ha/connection.js";

export const SCHEDULES_CALENDAR = "calendar.heater_schedules";
export const SCHEDULEMASTER_CALENDAR = "calendar.schedulemaster";

export type ScheduleSource = "local" | "schedulemaster";

export interface HeaterSchedule {
  uid: string;
  entityId: string;
  createdBy: string | null;
  startIso: string;
  endIso: string;
  source: ScheduleSource;
  /** Calendar entity this event lives on — needed to delete it. */
  calendarEntity: string;
  /** Raw event summary; shown as detail for ScheduleMaster events. */
  summary: string | null;
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

function parseCreatedBy(summary: string): string | null {
  const idx = summary.indexOf("·");
  if (idx === -1) return null;
  const before = summary.slice(0, idx).trim();
  return before || null;
}

async function listFromCalendar(
  calendarEntity: string,
  source: ScheduleSource,
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
      if (!e.uid || !e.description || !startVal || !endVal) return null;
      return {
        uid: e.uid,
        entityId: e.description.trim(),
        // Local events carry "<user> · <name>"; ScheduleMaster events aren't
        // user-created, so leave createdBy null and surface the summary instead.
        createdBy: source === "local" ? parseCreatedBy(e.summary ?? "") : null,
        startIso: startVal,
        endIso: endVal,
        source,
        calendarEntity,
        summary: e.summary?.trim() || null,
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
  createdBy: string;
  startIso: string;
}

export async function createSchedule(
  connection: Connection,
  input: CreateScheduleInput,
): Promise<void> {
  const endIso = new Date(
    new Date(input.startIso).getTime() + 60_000,
  ).toISOString();
  await callService(
    connection,
    "calendar",
    "create_event",
    {
      summary: `${input.createdBy} · ${input.targetName}`,
      description: input.targetEntityId,
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
