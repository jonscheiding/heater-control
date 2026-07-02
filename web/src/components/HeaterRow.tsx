import type { HassEntity } from "home-assistant-js-websocket";

import { formatRemaining } from "../heaters/format.js";
import { computeHeaterState, STATUS_LABELS } from "../heaters/state.js";
import type { HeaterSchedule } from "../schedules/api.js";
import { formatUpcoming } from "../schedules/format.js";
import { PowerButton } from "./PowerButton.js";
import { CalendarButton } from "./CalendarButton.js";
import { BasicButton } from "./BasicButton.js";

interface Props {
  switchEntity: HassEntity;
  powerSensor: HassEntity | undefined;
  timer: HassEntity | undefined;
  schedules: HeaterSchedule[];
  now: number;
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

  const wattsDisplay =
    powerWatts !== null && switchEntity.state === "on"
      ? `${Math.round(powerWatts)} W`
      : null;

  const sortedSchedules = [...schedules].sort((a, b) =>
    a.startIso.localeCompare(b.startIso),
  );

  return (
    <li className="px-4 py-4 sm:px-6">
      <div className="flex items-center gap-4">
        <PowerButton state={state} label={name} onToggle={onToggle} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-slate-900">
            {name}
          </p>
          <p className="text-sm text-slate-600">
            {STATUS_LABELS[state]}
            {wattsDisplay ? ` · ${wattsDisplay}` : ""}
          </p>
          {remaining && <p className="text-sm text-slate-500">{remaining}</p>}
        </div>
        <BasicButton onClick={() => onSchedulePreset("1h")}>1H</BasicButton>
        <BasicButton onClick={() => onSchedulePreset("8am")}>8AM</BasicButton>
        <CalendarButton onClick={onSchedule} />
      </div>
      {sortedSchedules.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
          {sortedSchedules.map((s) => (
            <li
              key={s.uid}
              className="flex items-center justify-between gap-2 text-sm text-slate-600"
            >
              <span className="min-w-0 truncate">
                Scheduled {formatUpcoming(s.startIso, now)}
                {s.createdBy ? ` · by ${s.createdBy}` : ""}
              </span>
              <button
                type="button"
                onClick={() => {
                  onCancelSchedule(s.uid);
                }}
                disabled={cancellingUid === s.uid}
                className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
                aria-label={`Cancel schedule ${formatUpcoming(s.startIso, now)}`}
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
