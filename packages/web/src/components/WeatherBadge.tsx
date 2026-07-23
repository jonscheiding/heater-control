import { type ForecastEntry, sampleBlocks } from "../weather/forecast.js";
import styles from "./WeatherBadge.module.css";
import { IconThermometer } from "./ui/IconThermometer.js";

interface Props {
  forecast: ForecastEntry[];
  now: number;
}

export function WeatherBadge({ forecast, now }: Props) {
  const blocks = sampleBlocks(forecast, now);

  if (!blocks.length) return null;

  return (
    <div className={styles.badge}>
      <ul className={styles.blocks} aria-label="Next 24 hours">
        <li className={styles.icon}>
          <IconThermometer />
        </li>
        {blocks.map((b, i) => (
          <li key={i} className={styles.block}>
            <span className={styles.blockTime}>{b.label}</span>
            <span className={styles.blockTemp}>
              {Math.round(b.temperature)}&deg;
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
