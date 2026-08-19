import type { HassEntity } from "home-assistant-js-websocket";
import { describe, expect, it } from "vitest";

import { getHeaters, isHeater, toHeater } from "../src/heaters/heater.js";

const LAST_CHANGED = "2026-08-12T16:16:00.000Z";

function entity(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntity {
  return {
    entity_id: entityId,
    state,
    last_changed: LAST_CHANGED,
    last_updated: LAST_CHANGED,
    attributes,
    context: { id: "01", user_id: null, parent_id: null },
  };
}

const HEATER = { heater: true, friendly_name: "N628FN" };

describe("isHeater", () => {
  it("selects on the marker attribute, whatever the entity is called", () => {
    expect(isHeater(entity("switch.n628fn", "on", HEATER))).toBe(true);
    expect(isHeater(entity("switch.anything_at_all", "on", HEATER))).toBe(true);
  });

  // The regression guard for the naming convention this replaced: an entity
  // named like the old heaters is not a heater unless it says so.
  it("ignores an entity that merely looks like the old naming convention", () => {
    expect(isHeater(entity("switch.heater_1", "on"))).toBe(false);
    expect(isHeater(entity("input_boolean.heater_2", "on"))).toBe(false);
  });

  it("requires the marker to be exactly true", () => {
    expect(isHeater(entity("switch.a", "on", { heater: false }))).toBe(false);
    expect(isHeater(entity("switch.b", "on", { heater: "true" }))).toBe(false);
    expect(isHeater(entity("switch.c", "on", {}))).toBe(false);
  });
});

describe("toHeater", () => {
  it("reads the published contract", () => {
    const heater = toHeater(
      entity("switch.n628fn", "on", {
        ...HEATER,
        n_number: "628FN",
        aircraft_type: "C182",
        power_w: 1183.5,
        reachable: true,
        auto_off_at: "2026-08-12T18:16:00+00:00",
      }),
    );
    expect(heater).toEqual({
      entityId: "switch.n628fn",
      name: "N628FN",
      rawState: "on",
      isOn: true,
      lastChangedIso: LAST_CHANGED,
      nNumber: "628FN",
      aircraftType: "C182",
      powerWatts: 1183.5,
      reachable: true,
      autoOffAtIso: "2026-08-12T18:16:00+00:00",
    });
  });

  it("falls back to the entity id when there is no friendly name", () => {
    expect(toHeater(entity("switch.n628fn", "on", { heater: true })).name).toBe(
      "switch.n628fn",
    );
  });

  it("normalizes blank metadata to null", () => {
    const heater = toHeater(
      entity("switch.a", "on", {
        ...HEATER,
        n_number: "  ",
        aircraft_type: "  C182  ",
      }),
    );
    expect(heater.nNumber).toBeNull();
    expect(heater.aircraftType).toBe("C182");
  });

  it("accepts a numeric or string wattage and rejects anything else", () => {
    const power = (value: unknown) =>
      toHeater(entity("switch.a", "on", { ...HEATER, power_w: value }))
        .powerWatts;
    expect(power(1200)).toBe(1200);
    expect(power("1200.5")).toBe(1200.5);
    expect(power(null)).toBeNull();
    expect(power("n/a")).toBeNull();
    expect(power(undefined)).toBeNull();
  });

  // Defaulting a missing marker to unreachable would black out every heater at
  // once if the component ever stopped publishing it.
  it("treats reachability as true unless explicitly false", () => {
    const reachable = (attributes: Record<string, unknown>) =>
      toHeater(entity("switch.a", "on", { ...HEATER, ...attributes }))
        .reachable;
    expect(reachable({ reachable: false })).toBe(false);
    expect(reachable({ reachable: true })).toBe(true);
    expect(reachable({})).toBe(true);
  });

  it("drops an unparseable auto-off timestamp", () => {
    const autoOff = (value: unknown) =>
      toHeater(entity("switch.a", "on", { ...HEATER, auto_off_at: value }))
        .autoOffAtIso;
    expect(autoOff("2026-08-12T18:16:00+00:00")).toBe(
      "2026-08-12T18:16:00+00:00",
    );
    expect(autoOff(null)).toBeNull();
    expect(autoOff("soon")).toBeNull();
  });

  it("is only on for the literal on state", () => {
    expect(toHeater(entity("switch.a", "on", HEATER)).isOn).toBe(true);
    expect(toHeater(entity("switch.a", "unavailable", HEATER)).isOn).toBe(
      false,
    );
    expect(toHeater(entity("switch.a", "unavailable", HEATER)).rawState).toBe(
      "unavailable",
    );
  });
});

describe("getHeaters", () => {
  it("returns only heaters, in a deterministic order", () => {
    const heaters = getHeaters({
      "switch.n737ge": entity("switch.n737ge", "off", HEATER),
      "switch.n628fn": entity("switch.n628fn", "on", HEATER),
      "sensor.n628fn_power": entity("sensor.n628fn_power", "1183"),
      "switch.heater_1": entity("switch.heater_1", "on"),
    });
    expect(heaters.map((h) => h.entityId)).toEqual([
      "switch.n628fn",
      "switch.n737ge",
    ]);
  });
});
