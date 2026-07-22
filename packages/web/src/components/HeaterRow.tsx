import type { HassEntity } from "home-assistant-js-websocket";

import { computeHeaterState, STATUS_LABELS } from "../heaters/state.js";
import type { HeaterSchedule } from "../schedules/api.js";
import { formatRemaining, formatUpcoming } from "../utils/format.js";
import { CalendarButton } from "./CalendarButton.js";
import styles from "./HeaterRow.module.css";
import { PowerButton } from "./PowerButton.js";
import { Button } from "./ui/Button.js";

interface Props {
  switchEntity: HassEntity;
  powerSensor: HassEntity | undefined;
  timer: HassEntity | undefined;
  schedules: HeaterSchedule[];
  now: number;
  isLoading: boolean;
  onToggle: () => void;
  onSchedule: () => void;
  onSchedulePreset: (preset: "1h" | "8am") => void;
  onCancelSchedule: (uid: string) => void;
  cancellingUid: string | undefined;
}

export function HeaterRow({
  switchEntity,
  powerSensor,
  timer,
  schedules,
  now,
  isLoading,
  onToggle,
  onSchedule,
  onSchedulePreset,
  onCancelSchedule,
  cancellingUid,
}: Props) {
  const name = switchEntity.attributes.friendly_name ?? switchEntity.entity_id;

  const rawPower = powerSensor ? Number.parseFloat(powerSensor.state) : NaN;
  const powerWatts = Number.isFinite(rawPower) ? rawPower : null;

  const state = computeHeaterState({
    switchState: switchEntity.state,
    switchLastChangedIso: switchEntity.last_changed,
    powerWatts,
    now,
  });

  const finishesAt =
    timer?.state === "active"
      ? (timer.attributes.finishes_at as string | undefined)
      : undefined;
  const remaining = finishesAt ? formatRemaining(finishesAt, now) : null;

  const sortedSchedules = [...schedules].sort((a, b) =>
    a.startIso.localeCompare(b.startIso),
  );

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
          <p className={styles.name}>{name}</p>
          <p className={styles.status}>{STATUS_LABELS[state]}</p>
          {remaining && (
            <p className={styles.remaining}>Auto-off in {remaining}</p>
          )}
        </div>
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
          {sortedSchedules.map((s) => (
            <li key={s.uid} className={styles.scheduleItem}>
              <span className={styles.scheduleText}>
                Scheduled {formatUpcoming(s.startIso, now)}
                {s.createdBy ? ` · by ${s.createdBy}` : ""}
              </span>
              <Button
                onClick={() => {
                  onCancelSchedule(s.uid);
                }}
                disabled={cancellingUid === s.uid}
                aria-label={`Cancel schedule ${formatUpcoming(s.startIso, now)}`}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
