import type { HassEntity } from "home-assistant-js-websocket";

import { formatRemaining } from "../heaters/format.js";
import { computeHeaterState, STATUS_LABELS } from "../heaters/state.js";
import { PowerButton } from "./PowerButton.js";

interface Props {
  switchEntity: HassEntity;
  powerSensor: HassEntity | undefined;
  timer: HassEntity | undefined;
  now: number;
  onToggle: () => void;
}

export function HeaterRow({
  switchEntity,
  powerSensor,
  timer,
  now,
  onToggle,
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

  return (
    <li className="flex items-center gap-4 px-4 py-4 sm:px-6">
      <PowerButton state={state} label={name} onToggle={onToggle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-medium text-slate-900">{name}</p>
        <p className="text-sm text-slate-600">
          {STATUS_LABELS[state]}
          {wattsDisplay ? ` · ${wattsDisplay}` : ""}
        </p>
        {remaining && <p className="text-sm text-slate-500">{remaining}</p>}
      </div>
    </li>
  );
}
