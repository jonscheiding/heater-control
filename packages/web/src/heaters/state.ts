export const STATUS_LABELS: Record<HeaterState, string> = {
  off: "Off",
  on: "On",
  "no-power": "On, unplugged",
  waiting: "Turning on",
  unreachable: "Unreachable",
};

export type HeaterState = "off" | "on" | "waiting" | "no-power" | "unreachable";

export interface HeaterStateInput {
  switchState: string;
  switchLastChangedIso: string;
  powerWatts: number | null;
  now: number;
  graceMs?: number;
  powerThresholdW?: number;
}

export function computeHeaterState({
  switchState,
  switchLastChangedIso,
  powerWatts,
  now,
  graceMs = 5000,
  powerThresholdW = 5,
}: HeaterStateInput): HeaterState {
  // HA reports "unavailable" when it can't reach the device and "unknown"
  // before it has ever heard from it; neither means "off".
  if (switchState === "unavailable" || switchState === "unknown") {
    return "unreachable";
  }
  if (switchState !== "on") return "off";
  if (powerWatts === null) return "on";
  if (powerWatts >= powerThresholdW) return "on";
  const sinceOnMs = now - new Date(switchLastChangedIso).getTime();
  if (sinceOnMs < graceMs) return "waiting";
  return "no-power";
}
