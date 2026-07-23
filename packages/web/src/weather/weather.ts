import type { HassEntities, HassEntity } from "home-assistant-js-websocket";

// The dev/demo HA sets up met.no tracking the configured home location, which
// surfaces as weather.forecast_home (older builds: weather.home). Prefer those,
// but fall back to any weather.* entity so a differently-named source still works.
const PREFERRED = ["weather.forecast_home", "weather.home"];

export function findWeatherEntity(
  entities: HassEntities,
): HassEntity | undefined {
  for (const id of PREFERRED) {
    if (entities[id]) return entities[id];
  }
  return Object.values(entities).find((e) =>
    e.entity_id.startsWith("weather."),
  );
}

export interface Temperature {
  value: number;
  unit: string;
}

export function getTemperature(
  entity: HassEntity | undefined,
): Temperature | null {
  if (!entity) return null;
  const value = entity.attributes.temperature as number | undefined;
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const unit = entity.attributes.temperature_unit as string | undefined;
  return { value, unit: unit ?? "°" };
}
