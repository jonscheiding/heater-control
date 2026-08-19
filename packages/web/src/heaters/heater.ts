import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import { sortBy } from "lodash-es";

/**
 * A heater, read off a single Home Assistant entity.
 *
 * The `heater_control` integration publishes everything about a heater as state
 * attributes on one entity it owns, so there is nothing to correlate: no entity
 * id prefixes, no companion sensors to find by name, and entities stay free to
 * be renamed. Heaters are discovered purely by the `heater` marker attribute.
 */
export interface Heater {
  entityId: string;
  name: string;
  /** Raw HA state — "on" / "off" / "unavailable" / "unknown". */
  rawState: string;
  isOn: boolean;
  /** Drives the grace period between switching on and drawing power. */
  lastChangedIso: string;
  nNumber: string | null;
  aircraftType: string | null;
  /** Null when the heater has no power sensor configured. */
  powerWatts: number | null;
  reachable: boolean;
  autoOffAtIso: string | null;
  simulated: boolean;
}

function attrString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function attrNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function attrTimestamp(value: unknown): string | null {
  const text = attrString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

export function isHeater(entity: HassEntity): boolean {
  return entity.attributes.heater === true;
}

export function isSimulated(entity: HassEntity): boolean {
  return entity.attributes.source_entity == null;
}

export function toHeater(entity: HassEntity): Heater {
  const attrs = entity.attributes as Record<string, unknown>;
  return {
    entityId: entity.entity_id,
    name: attrString(attrs.friendly_name) ?? entity.entity_id,
    rawState: entity.state,
    isOn: entity.state === "on",
    lastChangedIso: entity.last_changed,
    nNumber: attrString(attrs.n_number),
    aircraftType: attrString(attrs.aircraft_type),
    powerWatts: attrNumber(attrs.power_w),
    // Absent means "we can't tell", which should not black out the whole
    // fleet — only an explicit false marks a heater unreachable.
    reachable: attrs.reachable !== false,
    autoOffAtIso: attrTimestamp(attrs.auto_off_at),
    simulated: isSimulated(entity),
  };
}

export function getHeaters(entities: HassEntities): Heater[] {
  return sortBy(
    Object.values(entities).filter(isHeater).map(toHeater),
    (h) => h.entityId,
  );
}
