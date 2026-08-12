import { beforeEach, describe, expect, it, vi } from "vitest";

import { getHaTimeZone, haFetch } from "../src/ha/connection.js";
import {
  listSchedules,
  SCHEDULEMASTER_CALENDAR,
  SCHEDULES_CALENDAR,
} from "../src/schedules/api.js";

vi.mock("../src/ha/connection.js", () => ({
  haFetch: vi.fn(),
  getHaTimeZone: vi.fn(),
}));

// 12:17 ET / 09:17 PT — the browser, the box, and UTC all disagree, which is
// the point: these timestamps only line up if the zones are handled.
const NOW = "2026-08-12T16:17:00.000Z";
const WINDOW_END = "2026-08-14T16:17:00.000Z";

/**
 * Mirrors the shape HA serves. The explicit `| undefined` (rather than just `?`)
 * is so tests can drop a field to assert the unusable-event path, which
 * `exactOptionalPropertyTypes` otherwise forbids.
 */
interface RawEvent {
  uid?: string | undefined;
  summary?: string | undefined;
  description?: string | undefined;
  start?: string | { dateTime?: string; date?: string } | undefined;
  end?: string | { dateTime?: string; date?: string } | undefined;
}

/** A ScheduleMaster preheat as HA's calendar API actually serves it. */
function smEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    uid: "sm-17318530",
    summary: "David Rutishauser - 628FN",
    // Starts 15:30 ET today — 3h13m out, so it belongs in the list.
    start: { dateTime: "2026-08-12T15:30:00-04:00" },
    end: { dateTime: "2026-08-12T17:00:00-04:00" },
    description: JSON.stringify({
      entity_id: "input_boolean.heater_1",
      source: "schedulemaster",
      username: "David Rutishauser",
      user_id: "133096",
      user_email: "dkrutishauser@verizon.net",
      n_number: "628FN",
      aircraft_type: "C182",
      comment: "Local",
      flight_start: "2026-08-12T21:00:00+00:00",
      flight_end: "2026-08-13T00:00:00+00:00",
    }),
    ...overrides,
  };
}

/** Serve `events` per calendar entity; anything else 404s like a missing one. */
function serve(events: Partial<Record<string, RawEvent[]>>): void {
  vi.mocked(haFetch).mockImplementation((path: string) => {
    const entity = /\/api\/calendars\/([^?]+)/.exec(path)?.[1];
    const body = entity ? events[entity] : undefined;
    if (!body) {
      return Promise.resolve(
        new Response("", { status: 404, statusText: "Not Found" }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

function list(): Promise<Awaited<ReturnType<typeof listSchedules>>> {
  return listSchedules(NOW, WINDOW_END);
}

beforeEach(() => {
  vi.mocked(getHaTimeZone).mockResolvedValue("America/New_York");
});

describe("listSchedules", () => {
  it("keeps a preheat whose HA wall time reads as earlier than the UTC window start", async () => {
    // Regression: comparing the raw strings put "15:30:00-04:00" below
    // "16:17:00.000Z", silently hiding every preheat in the next few hours.
    serve({
      [SCHEDULES_CALENDAR]: [],
      [SCHEDULEMASTER_CALENDAR]: [smEvent()],
    });

    const schedules = await list();

    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.startIso).toBe("2026-08-12T19:30:00.000Z");
  });

  it("drops a preheat that has already started", async () => {
    // HA returns events *overlapping* the window, so an in-progress one arrives
    // too; it started at 12:00 ET, before the 12:17 ET window start.
    serve({
      [SCHEDULES_CALENDAR]: [],
      [SCHEDULEMASTER_CALENDAR]: [
        smEvent({
          uid: "sm-inprogress",
          start: { dateTime: "2026-08-12T12:00:00-04:00" },
          end: { dateTime: "2026-08-12T13:30:00-04:00" },
        }),
      ],
    });

    expect(await list()).toHaveLength(0);
  });

  it("normalizes every timestamp to a UTC instant", async () => {
    serve({
      [SCHEDULES_CALENDAR]: [],
      [SCHEDULEMASTER_CALENDAR]: [smEvent()],
    });

    const schedule = (await list())[0];

    expect(schedule).toMatchObject({
      startIso: "2026-08-12T19:30:00.000Z",
      endIso: "2026-08-12T21:00:00.000Z",
      flightStartIso: "2026-08-12T21:00:00.000Z",
      flightEndIso: "2026-08-13T00:00:00.000Z",
    });
  });

  it("pins a zone-less all-day date to HA's zone, not the browser's", async () => {
    // Read as UTC (or in PT) this would land on the 12th; in ET it is the 13th.
    serve({
      [SCHEDULES_CALENDAR]: [],
      [SCHEDULEMASTER_CALENDAR]: [
        smEvent({ start: { date: "2026-08-13" }, end: { date: "2026-08-14" } }),
      ],
    });

    const schedule = (await list())[0];

    expect(schedule?.startIso).toBe("2026-08-13T04:00:00.000Z");
    expect(
      new Date(schedule?.startIso ?? "").toLocaleString("sv-SE", {
        timeZone: "America/New_York",
      }),
    ).toBe("2026-08-13 00:00:00");
  });

  it("falls back to the browser's zone when HA's timezone is unknown", async () => {
    vi.mocked(getHaTimeZone).mockResolvedValue(null);
    serve({
      [SCHEDULES_CALENDAR]: [],
      [SCHEDULEMASTER_CALENDAR]: [
        smEvent({ start: "2026-08-13T09:30:00", end: "2026-08-13T11:00:00" }),
      ],
    });

    // 09:30 PT rather than 09:30 ET — wrong zone, but still a real instant.
    expect((await list())[0]?.startIso).toBe("2026-08-13T16:30:00.000Z");
  });

  it("maps the payload onto the schedule", async () => {
    serve({
      [SCHEDULES_CALENDAR]: [],
      [SCHEDULEMASTER_CALENDAR]: [smEvent()],
    });

    expect((await list())[0]).toMatchObject({
      uid: "sm-17318530",
      calendarEntity: SCHEDULEMASTER_CALENDAR,
      entityId: "input_boolean.heater_1",
      source: "schedulemaster",
      username: "David Rutishauser",
      userId: "133096",
      userEmail: "dkrutishauser@verizon.net",
      nNumber: "628FN",
      aircraftType: "C182",
      comment: "Local",
      title: "David Rutishauser - 628FN",
    });
  });

  it("defaults the source to the calendar it came from", async () => {
    serve({
      [SCHEDULES_CALENDAR]: [
        smEvent({
          uid: "local-1",
          description: JSON.stringify({ entity_id: "switch.heater_2" }),
        }),
      ],
      [SCHEDULEMASTER_CALENDAR]: [],
    });

    expect((await list())[0]?.source).toBe("local");
  });

  it("tolerates a legacy bare entity_id description", async () => {
    serve({
      [SCHEDULES_CALENDAR]: [
        smEvent({ uid: "legacy-1", description: " switch.heater_3 " }),
      ],
      [SCHEDULEMASTER_CALENDAR]: [],
    });

    expect((await list())[0]).toMatchObject({
      entityId: "switch.heater_3",
      source: "local",
      username: null,
      flightStartIso: null,
    });
  });

  it("skips events with no uid, no target, or an unusable timestamp", async () => {
    serve({
      [SCHEDULES_CALENDAR]: [
        smEvent({ uid: undefined }),
        smEvent({ uid: "no-target", description: "" }),
        smEvent({ uid: "no-start", start: undefined }),
        smEvent({ uid: "bad-start", start: { dateTime: "not a timestamp" } }),
      ],
      [SCHEDULEMASTER_CALENDAR]: [],
    });

    expect(await list()).toHaveLength(0);
  });

  it("returns local schedules alone when the ScheduleMaster calendar is absent", async () => {
    // The integration is optional — its calendar 404s when undeployed.
    serve({ [SCHEDULES_CALENDAR]: [smEvent({ uid: "local-only" })] });

    const schedules = await list();

    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.uid).toBe("local-only");
  });

  it("fails when the local calendar cannot be read", async () => {
    serve({ [SCHEDULEMASTER_CALENDAR]: [] });

    await expect(list()).rejects.toThrow(/Failed to list schedules/);
  });
});
