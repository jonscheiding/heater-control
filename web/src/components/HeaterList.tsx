import {
  callService,
  type Connection,
  type HassEntities,
} from "home-assistant-js-websocket";

import { useNow } from "../ha/hooks.js";
import {
  findAutoOffTimer,
  findPowerSensor,
  getHeaters,
} from "../heaters/correlate.js";
import { HeaterRow } from "./HeaterRow.js";

interface Props {
  connection: Connection;
  entities: HassEntities;
}

export function HeaterList({ connection, entities }: Props) {
  const now = useNow(1000);
  const heaters = getHeaters(entities);

  if (heaters.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center text-slate-600">
        No heaters found. Expected entities matching{" "}
        <code className="rounded bg-slate-200 px-1 py-0.5 text-slate-800">
          switch.heater_*
        </code>{" "}
        or{" "}
        <code className="rounded bg-slate-200 px-1 py-0.5 text-slate-800">
          input_boolean.heater_*
        </code>
        .
      </div>
    );
  }

  return (
    <ul className="mx-auto max-w-2xl divide-y divide-slate-200 bg-white shadow-sm sm:rounded-lg">
      {heaters.map((h) => {
        const isOn = h.state === "on";
        return (
          <HeaterRow
            key={h.entity_id}
            switchEntity={h}
            powerSensor={findPowerSensor(h.entity_id, entities)}
            timer={findAutoOffTimer(h.entity_id, entities)}
            now={now}
            onToggle={() => {
              void callService(
                connection,
                "homeassistant",
                isOn ? "turn_off" : "turn_on",
                { entity_id: h.entity_id },
              );
            }}
          />
        );
      })}
    </ul>
  );
}
