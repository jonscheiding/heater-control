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

/**
 * Z-Wave JS keeps a switch entity *available* (reporting its last known state)
 * even after the node stops answering — its availability tracks the driver and
 * the node's interview, not whether the device is currently reachable. The
 * reachability signal lives in the node's diagnostic status sensor instead, so
 * we correlate one by convention: rename it to `sensor.<heater>_node_status` in
 * HA and the SPA picks it up. Absent for non-Z-Wave heaters — those go
 * `unavailable` on their own.
 */
export function findNodeStatusSensor(
  switchId: string,
  entities: HassEntities,
): HassEntity | undefined {
  return entities[`sensor.${baseName(switchId)}_node_status`];
}

export function findAutoOffTimer(
  switchId: string,
  entities: HassEntities,
): HassEntity | undefined {
  return entities[`timer.${baseName(switchId)}_autooff`];
}
