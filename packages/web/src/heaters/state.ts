import type { Heater } from "./heater.js";

export const STATUS_LABELS: Record<HeaterState, string> = {
  off: "Off",
  on: "On",
  "no-power": "On, unplugged",
  waiting: "Turning on",
  unreachable: "Unreachable",
};

export type HeaterState = "off" | "on" | "waiting" | "no-power" | "unreachable";

export interface HeaterStateInput {
  heater: Heater;
  now: number;
  graceMs?: number;
  powerThresholdW?: number;
}

export function computeHeaterState({
  heater,
  now,
  graceMs = 5000,
  powerThresholdW = 5,
}: HeaterStateInput): HeaterState {
  // HA reports "unavailable" when it can't reach the device and "unknown"
  // before it has ever heard from it; neither means "off".
  if (heater.rawState === "unavailable" || heater.rawState === "unknown") {
    return "unreachable";
  }
  // Whether the device can still be commanded is decided in Home Assistant —
  // a Z-Wave switch keeps reporting its last known state after its node dies,
  // so the integration reads the node's status and publishes the verdict.
  if (!heater.reachable) return "unreachable";
  if (!heater.isOn) return "off";
  if (heater.powerWatts === null) return "on";
  if (heater.powerWatts >= powerThresholdW) return "on";
  const sinceOnMs = now - new Date(heater.lastChangedIso).getTime();
  if (sinceOnMs < graceMs) return "waiting";
  return "no-power";
}
