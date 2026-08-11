import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import { sortBy } from "lodash-es";

const HEATER_PREFIXES = ["switch.heater_", "input_boolean.heater_"];

export function isHeater(entityId: string): boolean {
  return HEATER_PREFIXES.some((p) => entityId.startsWith(p));
}

export function getHeaters(entities: HassEntities): HassEntity[] {
  return sortBy(
    Object.values(entities).filter((e) => isHeater(e.entity_id)),
    (a) => a.entity_id,
  );
}

function baseName(entityId: string): string {
  const idx = entityId.indexOf(".");
  return idx === -1 ? entityId : entityId.slice(idx + 1);
}

export function findPowerSensor(
  switchId: string,
  entities: HassEntities,
): HassEntity | undefined {
  return entities[`sensor.${baseName(switchId)}_power`];
}

export function findAutoOffTimer(
  switchId: string,
  entities: HassEntities,
): HassEntity | undefined {
  return entities[`timer.${baseName(switchId)}_autooff`];
}
