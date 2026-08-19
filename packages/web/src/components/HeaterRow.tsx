import type { Heater } from "../heaters/heater.js";

import { computeHeaterState, STATUS_LABELS } from "../heaters/state.js";
import type { HeaterSchedule } from "../schedules/api.js";
import {
  formatFlightTime,
  formatRemaining,
  formatUpcoming,
} from "../utils/format.js";
import { forecastAt, type ForecastEntry } from "../weather/forecast.js";
import { CalendarButton } from "./CalendarButton.js";
import styles from "./HeaterRow.module.css";
import { PowerButton } from "./PowerButton.js";
import { Button } from "./ui/Button.js";
import { InfoPopover } from "./ui/InfoPopover.js";
import { capitalize, sortBy } from "lodash-es";
import cx from "classnames";
import { IconCalendar } from "./ui/IconCalendar.js";
import { IconTestTube } from "./ui/IconTestTube.js";

interface Props {
  heater: Heater;
  schedules: HeaterSchedule[];
  forecast: ForecastEntry[];
  now: number;
  isLoading: boolean;
  onToggle: () => void;
  onSchedule: () => void;
  onSchedulePreset: (preset: "1h" | "8am") => void;
  onCancelSchedule: (schedule: HeaterSchedule) => void;
  cancellingUid: string | undefined;
}

export function HeaterRow({
  heater,
  schedules,
  forecast,
  now,
  isLoading,
  onToggle,
  onSchedule,
  onSchedulePreset,
  onCancelSchedule,
  cancellingUid,
}: Props) {
  const name = heater.name;
  const type = heater.aircraftType;

  const state = computeHeaterState({ heater, now });

  // `auto_off_at` is null whenever nothing is armed, and formatRemaining
  // returns null for a timestamp already past, so a stale value degrades to
  // "no countdown" rather than to a negative one.
  const remaining = heater.autoOffAtIso
    ? formatRemaining(heater.autoOffAtIso, now)
    : null;

  const sortedSchedules = sortBy(schedules, (a) => a.startIso);

  return (
    <li className={styles.row}>
      <div className={styles.main}>
        <PowerButton
          state={state}
          label={name}
          isLoading={isLoading}
          onToggle={onToggle}
        />
        <div className={styles.info}>
          <p className={styles.name}>
            {name}
            {type && <span className={styles.typeLabel}>{type}</span>}
          </p>
          <p
            className={cx(
              styles.status,
              state === "unreachable" && styles.statusUnreachable,
            )}
          >
            {STATUS_LABELS[state]}
          </p>
          {state === "unreachable" ? (
            <p className={styles.remaining}>
              Home Assistant can&rsquo;t reach this switch
            </p>
          ) : (
            remaining && (
              // formatRemaining already reads "in 1h 30m".
              <p className={styles.remaining}>Auto-off {remaining}</p>
            )
          )}
        </div>
        {heater.simulated && (
          <div className={styles.simulationIcon}>
            <InfoPopover
              lines={[
                "This heater is simulated. It does not control a physical device.",
              ]}
              label="Simulated Device"
              icon={IconTestTube}
            />
          </div>
        )}
        <Button round onClick={() => onSchedulePreset("1h")}>
          1H
        </Button>
        <Button round onClick={() => onSchedulePreset("8am")}>
          8AM
        </Button>
        <CalendarButton onClick={onSchedule} />
      </div>
      {sortedSchedules.length > 0 && (
        <ul className={styles.schedules}>
          {sortedSchedules.map((s) => {
            const forecastTemp = forecastAt(
              forecast,
              new Date(s.startIso).getTime(),
            );
            const fromScheduleMaster = s.source === "schedulemaster";
            const flightLine = s.flightStartIso
              ? `Flight ${formatFlightTime(s.flightStartIso, s.flightEndIso, now)}`
              : null;
            const smLines = [
              "From Schedule Master",
              flightLine,
              s.comment,
            ].filter((v): v is string => Boolean(v));
            return (
              <li key={s.uid} className={styles.scheduleItem}>
                <span className={styles.scheduleText}>
                  <IconCalendar />
                  {capitalize(formatUpcoming(s.startIso, now))}
                  {forecastTemp != null && (
                    <> · {Math.round(forecastTemp)}&deg;</>
                  )}
                  {s.username != null && ` · by ${s.username}`}
                </span>
                <div className={styles.scheduleActions}>
                  {fromScheduleMaster && (
                    <InfoPopover lines={smLines} label="Schedule details" />
                  )}
                  <Button
                    onClick={() => {
                      onCancelSchedule(s);
                    }}
                    disabled={cancellingUid === s.uid}
                    aria-label={`Cancel schedule ${formatUpcoming(s.startIso, now)}`}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
