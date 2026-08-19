import { describe, expect, it } from "vitest";

import type { Heater } from "../src/heaters/heater.js";
import { computeHeaterState } from "../src/heaters/state.js";

const NOW = Date.parse("2026-08-12T16:17:00.000Z");
const LAST_CHANGED = new Date(NOW - 60_000).toISOString();

function state(overrides: Partial<Heater>) {
  const heater: Heater = {
    entityId: "switch.n628fn",
    name: "N628FN",
    rawState: "off",
    isOn: false,
    lastChangedIso: LAST_CHANGED,
    nNumber: "628FN",
    aircraftType: "C182",
    powerWatts: null,
    reachable: true,
    autoOffAtIso: null,
    ...overrides,
  };
  // `isOn` is derived, so keep it consistent unless a test overrides it.
  if (overrides.isOn === undefined) heater.isOn = heater.rawState === "on";
  return computeHeaterState({ heater, now: NOW });
}

describe("computeHeaterState", () => {
  it("reports on/off from the switch state", () => {
    expect(state({ rawState: "off" })).toBe("off");
    expect(state({ rawState: "on" })).toBe("on");
  });

  it("flags a heater Home Assistant cannot reach", () => {
    expect(state({ rawState: "unavailable" })).toBe("unreachable");
  });

  it("treats a never-seen heater as unreachable rather than off", () => {
    expect(state({ rawState: "unknown" })).toBe("unreachable");
  });

  it("prefers unreachable over any power reading", () => {
    expect(state({ rawState: "unavailable", powerWatts: 1200 })).toBe(
      "unreachable",
    );
  });

  // A Z-Wave switch keeps reporting its last known state after its node dies,
  // so this hinges entirely on what the integration decided about reachability.
  it("flags an unreachable heater even though it still reports a state", () => {
    expect(state({ rawState: "on", reachable: false })).toBe("unreachable");
    expect(state({ rawState: "off", reachable: false })).toBe("unreachable");
  });

  it("prefers unreachable over a live power reading", () => {
    expect(state({ rawState: "on", reachable: false, powerWatts: 1200 })).toBe(
      "unreachable",
    );
  });

  it("reports on when there is no power sensor configured", () => {
    expect(state({ rawState: "on", powerWatts: null })).toBe("on");
  });

  it("waits out the grace period before calling it unplugged", () => {
    const justOn = new Date(NOW - 1000).toISOString();
    expect(
      state({ rawState: "on", lastChangedIso: justOn, powerWatts: 0 }),
    ).toBe("waiting");
    expect(state({ rawState: "on", powerWatts: 0 })).toBe("no-power");
  });
});
