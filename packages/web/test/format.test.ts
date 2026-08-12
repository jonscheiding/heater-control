import { describe, expect, it } from "vitest";

import {
  formatFlightTime,
  formatRemaining,
  formatUpcoming,
  toDatetimeLocalString,
  toTopOfReasonableHour,
} from "../src/utils/format.js";

// The suite runs in America/Los_Angeles (see vitest.config.ts), so these assert
// how a UTC instant renders for a *browser* three hours behind the HAOS box.
const NOW = Date.parse("2026-08-12T16:17:00.000Z"); // 09:17 PT

describe("formatRemaining", () => {
  it("counts minutes under the hour", () => {
    expect(formatRemaining("2026-08-12T16:52:00.000Z", NOW)).toBe("in 35m");
  });

  it("counts hours and minutes", () => {
    expect(formatRemaining("2026-08-12T19:30:00.000Z", NOW)).toBe("in 3h 13m");
  });

  it("returns null once the instant has passed", () => {
    expect(formatRemaining("2026-08-12T16:00:00.000Z", NOW)).toBeNull();
    expect(formatRemaining("2026-08-12T16:17:00.000Z", NOW)).toBeNull();
  });
});

describe("formatUpcoming", () => {
  it("counts down when the start is within four hours", () => {
    expect(formatUpcoming("2026-08-12T19:30:00.000Z", NOW)).toBe("in 3h 13m");
  });

  it("gives a wall time past the countdown window", () => {
    // 21:30 UTC is 14:30 PT — still today for this browser.
    expect(formatUpcoming("2026-08-12T21:30:00.000Z", NOW)).toMatch(
      /^today at /,
    );
  });

  it("can be forced to the absolute form inside the countdown window", () => {
    expect(formatUpcoming("2026-08-12T19:30:00.000Z", NOW, true)).toMatch(
      /^today at /,
    );
  });

  it("buckets the day in the browser's zone, not UTC", () => {
    // 04:30 UTC on the 13th is 21:30 PT on the 12th — today, not tomorrow.
    expect(formatUpcoming("2026-08-13T04:30:00.000Z", NOW)).toMatch(
      /^today at /,
    );
    // 08:30 UTC on the 13th is 01:30 PT on the 13th — tomorrow.
    expect(formatUpcoming("2026-08-13T08:30:00.000Z", NOW)).toMatch(
      /^tomorrow at /,
    );
  });

  it("names the weekday further out", () => {
    expect(formatUpcoming("2026-08-14T20:00:00.000Z", NOW)).toMatch(
      /^Fri, Aug 14 at /,
    );
  });
});

describe("formatFlightTime", () => {
  it("renders a start and a bare end clock time", () => {
    // 21:00–00:00 UTC is 14:00–17:00 PT, both on the 12th locally.
    expect(
      formatFlightTime(
        "2026-08-12T21:00:00.000Z",
        "2026-08-13T00:00:00.000Z",
        NOW,
      ),
    ).toMatch(/^today at .+ – .+$/);
  });

  it("omits the dash with no end time", () => {
    const formatted = formatFlightTime("2026-08-12T21:00:00.000Z", null, NOW);
    expect(formatted).toMatch(/^today at /);
    expect(formatted).not.toContain("–");
  });
});

describe("toDatetimeLocalString", () => {
  it("renders browser-local wall time for a datetime-local input", () => {
    // 16:17 UTC is 09:17 PT; the input has no zone, so it must be local.
    expect(toDatetimeLocalString(new Date(NOW))).toBe("2026-08-12T09:17");
  });

  it("zero-pads single-digit fields", () => {
    expect(toDatetimeLocalString(new Date("2026-01-02T08:05:00.000Z"))).toBe(
      "2026-01-02T00:05",
    );
  });
});

describe("toTopOfReasonableHour", () => {
  it("rounds forward to the next hour at least 30 minutes out", () => {
    // 09:17 PT -> 10:00 PT, 43 minutes out.
    expect(toTopOfReasonableHour(new Date(NOW)).toISOString()).toBe(
      "2026-08-12T17:00:00.000Z",
    );
  });

  it("skips an hour that is too soon to be useful", () => {
    // 09:45 -> 11:00, not 10:00, since 10:00 is only 15 minutes away.
    const ms = Date.parse("2026-08-12T16:45:00.000Z");
    expect(toTopOfReasonableHour(new Date(ms)).toISOString()).toBe(
      "2026-08-12T18:00:00.000Z",
    );
  });
});
