import { callService, type Connection } from "home-assistant-js-websocket";

import { haFetch } from "../ha/connection.js";

export const SCHEDULES_CALENDAR = "calendar.heater_schedules";

export interface HeaterSchedule {
  uid: string;
  entityId: string;
  createdBy: string | null;
  startIso: string;
  endIso: string;
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

export async function listSchedules(
  startIso: string,
  endIso: string,
): Promise<HeaterSchedule[]> {
  const path =
    `/api/calendars/${SCHEDULES_CALENDAR}` +
    `?start=${encodeURIComponent(startIso)}` +
    `&end=${encodeURIComponent(endIso)}`;
  const response = await haFetch(path);
  if (!response.ok) {
    throw new Error(
      `Failed to list schedules: ${response.status} ${response.statusText}`,
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
        createdBy: parseCreatedBy(e.summary ?? ""),
        startIso: startVal,
        endIso: endVal,
      };
    })
    .filter((s): s is HeaterSchedule => s !== null);
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
): Promise<void> {
  await connection.sendMessagePromise({
    type: "calendar/event/delete",
    entity_id: SCHEDULES_CALENDAR,
    uid,
  });
}
