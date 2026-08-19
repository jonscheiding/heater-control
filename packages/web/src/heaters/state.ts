export const STATUS_LABELS: Record<HeaterState, string> = {
  off: "Off",
  on: "On",
  "no-power": "On, unplugged",
  waiting: "Turning on",
  unreachable: "Unreachable",
};

export type HeaterState = "off" | "on" | "waiting" | "no-power" | "unreachable";

// Z-Wave node statuses that mean the mesh can still deliver a command. A
// sleeping node ("asleep") wakes for queued commands, so it counts as reachable;
// "dead" does not, and neither does an unknown/unavailable status sensor (the
// Z-Wave driver itself is down, so nothing gets through).
const LIVE_NODE_STATUSES = new Set(["alive", "awake", "asleep"]);

export interface HeaterStateInput {
  switchState: string;
  switchLastChangedIso: string;
  powerWatts: number | null;
  now: number;
  /** State of the correlated node-status sensor; null when there isn't one. */
  nodeStatus?: string | null;
  graceMs?: number;
  powerThresholdW?: number;
}

export function computeHeaterState({
  switchState,
  switchLastChangedIso,
  powerWatts,
  now,
  nodeStatus = null,
  graceMs = 5000,
  powerThresholdW = 5,
}: HeaterStateInput): HeaterState {
  // HA reports "unavailable" when it can't reach the device and "unknown"
  // before it has ever heard from it; neither means "off".
  if (switchState === "unavailable" || switchState === "unknown") {
    return "unreachable";
  }
  // Z-Wave JS leaves the switch entity available and reporting its last known
  // state when the node goes dead, so the node-status sensor is the only signal
  // that the device dropped off the mesh.
  if (nodeStatus !== null && !LIVE_NODE_STATUSES.has(nodeStatus)) {
    return "unreachable";
  }
  if (switchState !== "on") return "off";
  if (powerWatts === null) return "on";
  if (powerWatts >= powerThresholdW) return "on";
  const sinceOnMs = now - new Date(switchLastChangedIso).getTime();
  if (sinceOnMs < graceMs) return "waiting";
  return "no-power";
}
