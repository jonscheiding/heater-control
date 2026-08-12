import { describe, expect, it } from "vitest";

import { wallTimeToMs } from "../src/utils/time.js";

const HA_TZ = "America/New_York";

/** The instant, read back as wall time in `tz` — "2026-08-13 09:30:00". */
function wallTimeIn(ms: number, tz: string): string {
  return new Date(ms).toLocaleString("sv-SE", { timeZone: tz });
}

describe("test environment", () => {
  it("runs in a zone other than the HAOS box's, so shifts are visible", () => {
    // Guards the whole suite: if TZ pinning ever stops working, these tests go
    // quietly non-deterministic instead of failing.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "America/Los_Angeles",
    );
  });
});

describe("wallTimeToMs", () => {
  it("reads a zone-less datetime as HA's wall time, not the browser's", () => {
    const ms = wallTimeToMs("2026-08-13T09:30:00", HA_TZ);
    expect(new Date(ms).toISOString()).toBe("2026-08-13T13:30:00.000Z");
    // The browser is 3h behind ET; reading it locally would have given 16:30Z.
    expect(wallTimeIn(ms, HA_TZ)).toBe("2026-08-13 09:30:00");
  });

  it("applies standard time in winter", () => {
    const ms = wallTimeToMs("2026-01-13T09:30:00", HA_TZ);
    expect(new Date(ms).toISOString()).toBe("2026-01-13T14:30:00.000Z");
  });

  it("treats a bare date as midnight in HA's zone", () => {
    // The trap: `new Date("2026-08-13")` is UTC midnight, which in ET is the
    // evening of the 12th — an all-day event would land on the wrong day.
    const ms = wallTimeToMs("2026-08-13", HA_TZ);
    expect(new Date(ms).toISOString()).toBe("2026-08-13T04:00:00.000Z");
    expect(wallTimeIn(ms, HA_TZ)).toBe("2026-08-13 00:00:00");
  });

  it("keeps sub-second precision", () => {
    const ms = wallTimeToMs("2026-08-12T13:01:39.554", HA_TZ);
    expect(new Date(ms).toISOString()).toBe("2026-08-12T17:01:39.554Z");
  });

  describe("across DST transitions", () => {
    // The offset is looked up twice because the first lookup reads the wall time
    // as UTC, which near a transition can land on the wrong side of it.
    it.each([
      [
        "2026-03-08T01:30:00",
        "2026-03-08T06:30:00.000Z",
        "before spring-forward",
      ],
      [
        "2026-03-08T03:00:00",
        "2026-03-08T07:00:00.000Z",
        "after spring-forward",
      ],
      ["2026-11-01T00:30:00", "2026-11-01T04:30:00.000Z", "before fall-back"],
      ["2026-11-01T03:00:00", "2026-11-01T08:00:00.000Z", "after fall-back"],
    ])("%s -> %s (%s)", (wall, expected) => {
      expect(new Date(wallTimeToMs(wall, HA_TZ)).toISOString()).toBe(expected);
    });

    it("resolves the ambiguous repeated hour to its first occurrence", () => {
      // 01:30 happens twice on fall-back day; take the earlier (still EDT) one.
      const ms = wallTimeToMs("2026-11-01T01:30:00", HA_TZ);
      expect(new Date(ms).toISOString()).toBe("2026-11-01T05:30:00.000Z");
    });
  });

  describe("without a known HA timezone", () => {
    it("falls back to the browser's zone for a datetime", () => {
      const ms = wallTimeToMs("2026-08-13T09:30:00", null);
      expect(new Date(ms).toISOString()).toBe("2026-08-13T16:30:00.000Z");
    });

    it("still treats a bare date as local midnight, not UTC midnight", () => {
      const ms = wallTimeToMs("2026-08-13", null);
      expect(new Date(ms).toISOString()).toBe("2026-08-13T07:00:00.000Z");
    });
  });

  it("returns NaN for an unparseable value", () => {
    expect(wallTimeToMs("not a timestamp", HA_TZ)).toBeNaN();
    expect(wallTimeToMs("not a timestamp", null)).toBeNaN();
  });
});
