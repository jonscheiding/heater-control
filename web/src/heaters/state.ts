export const STATUS_LABELS: Record<HeaterState, string> = {
  off: "Off",
  on: "On",
  "no-power": "On, unplugged",
  waiting: "Turning on",
};

export type HeaterState = "off" | "on" | "waiting" | "no-power";

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
  if (switchState !== "on") return "off";
  if (powerWatts === null) return "on";
  if (powerWatts >= powerThresholdW) return "on";
  const sinceOnMs = now - new Date(switchLastChangedIso).getTime();
  if (sinceOnMs < graceMs) return "waiting";
  return "no-power";
}
