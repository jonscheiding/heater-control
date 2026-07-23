import { callService, type Connection } from "home-assistant-js-websocket";

export interface ForecastEntry {
  time: number; // epoch ms
  temperature: number; // in the HA instance's unit system
}

export interface ForecastBlock {
  time: number;
  label: string;
  temperature: number;
}

const HOUR_MS = 60 * 60 * 1000;

// HA removed `forecast` from weather entity attributes; it's now fetched via the
// weather.get_forecasts service with return_response. The response is keyed by
// entity id, each holding a `forecast` array of { datetime, temperature, ... }.
interface RawForecastEntry {
  datetime?: unknown;
  temperature?: unknown;
}
interface GetForecastsResult {
  response?: Record<string, { forecast?: RawForecastEntry[] } | undefined>;
}

export async function fetchHourlyForecast(
  connection: Connection,
  entityId: string,
): Promise<ForecastEntry[]> {
  const result = (await callService(
    connection,
    "weather",
    "get_forecasts",
    { type: "hourly" },
    { entity_id: entityId },
    true,
  )) as GetForecastsResult;

  const raw = result.response?.[entityId]?.forecast ?? [];
  const entries: ForecastEntry[] = [];
  for (const e of raw) {
    if (typeof e.datetime === "string" && typeof e.temperature === "number") {
      const time = new Date(e.datetime).getTime();
      if (!Number.isNaN(time)) {
        entries.push({ time, temperature: e.temperature });
      }
    }
  }
  entries.sort((a, b) => a.time - b.time);
  return entries;
}

function formatHour(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const suffix = h < 12 ? "a" : "p";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}${suffix}`;
}

/** Nearest forecast temperature to `targetMs`, or null if none within maxGapMs. */
export function forecastAt(
  forecast: ForecastEntry[],
  targetMs: number,
  maxGapMs = 90 * 60 * 1000,
): number | null {
  let best: ForecastEntry | null = null;
  let bestGap = Infinity;
  for (const e of forecast) {
    const gap = Math.abs(e.time - targetMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = e;
    }
  }
  if (!best || bestGap > maxGapMs) return null;
  return best.temperature;
}

/** Sample the forecast into evenly spaced blocks starting at `nowMs`. */
export function sampleBlocks(
  forecast: ForecastEntry[],
  nowMs: number,
  count = 6,
  stepHours = 4,
): ForecastBlock[] {
  const blocks: ForecastBlock[] = [];
  for (let i = 0; i < count; i++) {
    const targetMs = nowMs + i * stepHours * HOUR_MS;
    const temp = forecastAt(forecast, targetMs, 2 * HOUR_MS);
    if (temp == null) continue;
    blocks.push({
      time: targetMs,
      label: i === 0 ? "now" : formatHour(targetMs),
      temperature: temp,
    });
  }
  return blocks;
}
