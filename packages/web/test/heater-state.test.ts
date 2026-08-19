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

  // Z-Wave JS keeps the switch entity available and reporting its last known
  // state after the node dies, so these cases hinge entirely on nodeStatus.
  it("flags a dead Z-Wave node even though the switch still reports a state", () => {
    expect(state({ switchState: "on", nodeStatus: "dead" })).toBe(
      "unreachable",
    );
    expect(state({ switchState: "off", nodeStatus: "dead" })).toBe(
      "unreachable",
    );
  });

  it("treats a node status HA cannot read as unreachable", () => {
    expect(state({ switchState: "on", nodeStatus: "unavailable" })).toBe(
      "unreachable",
    );
    expect(state({ switchState: "on", nodeStatus: "unknown" })).toBe(
      "unreachable",
    );
  });

  it("accepts nodes the mesh can still deliver to", () => {
    for (const nodeStatus of ["alive", "awake", "asleep"]) {
      expect(state({ switchState: "on", nodeStatus })).toBe("on");
    }
  });

  it("ignores reachability when there is no node-status sensor", () => {
    expect(state({ switchState: "on", nodeStatus: null })).toBe("on");
    expect(state({ switchState: "on" })).toBe("on");
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
