import { describe, expect, it } from "vitest";

import { computeHeaterState } from "../src/heaters/state.js";

const NOW = Date.parse("2026-08-12T16:17:00.000Z");
const LAST_CHANGED = new Date(NOW - 60_000).toISOString();

function state(overrides: Partial<Parameters<typeof computeHeaterState>[0]>) {
  return computeHeaterState({
    switchState: "off",
    switchLastChangedIso: LAST_CHANGED,
    powerWatts: null,
    now: NOW,
    ...overrides,
  });
}

describe("computeHeaterState", () => {
  it("reports on/off from the switch state", () => {
    expect(state({ switchState: "off" })).toBe("off");
    expect(state({ switchState: "on" })).toBe("on");
  });

  it("flags a switch Home Assistant cannot reach", () => {
    expect(state({ switchState: "unavailable" })).toBe("unreachable");
  });

  it("treats a never-seen switch as unreachable rather than off", () => {
    expect(state({ switchState: "unknown" })).toBe("unreachable");
  });

  it("prefers unreachable over any power-sensor reading", () => {
    expect(state({ switchState: "unavailable", powerWatts: 1200 })).toBe(
      "unreachable",
    );
  });

  it("waits out the grace period before calling it unplugged", () => {
    const justOn = new Date(NOW - 1000).toISOString();
    expect(
      state({
        switchState: "on",
        switchLastChangedIso: justOn,
        powerWatts: 0,
      }),
    ).toBe("waiting");
    expect(state({ switchState: "on", powerWatts: 0 })).toBe("no-power");
  });
});
