import type { HassEntities } from "home-assistant-js-websocket";

import { findWeatherEntity, getTemperature } from "../weather/weather.js";
import { IconThermometer } from "./ui/IconThermometer.js";
import styles from "./WeatherBadge.module.css";

interface Props {
  entities: HassEntities;
}

export function WeatherBadge({ entities }: Props) {
  const entity = findWeatherEntity(entities);
  const temp = getTemperature(entity);
  if (!temp) return null;

  // met.no names its home entity "Forecast Home"; drop the "Forecast " prefix so
  // the label reads as a plain place name ("Home", "Forecast Denver" → "Denver").
  const name = entity?.attributes.friendly_name;
  const location =
    typeof name === "string" ? name.replace(/^Forecast\s+/i, "") : "Local";

  return (
    <div className={styles.badge}>
      <span className={styles.icon} aria-hidden="true">
        <IconThermometer />
      </span>
      <span className={styles.temp}>
        {Math.round(temp.value)}
        {temp.unit}
      </span>
      <span className={styles.location}>{location}</span>
    </div>
  );
}
