import {
  type Connection,
  type HassEntities,
} from "home-assistant-js-websocket";
import { useState } from "react";

import { useNow } from "../ha/hooks.js";
import {
  findAutoOffTimer,
  findPowerSensor,
  getHeaters,
} from "../heaters/correlate.js";
import { useToggleHeater } from "../heaters/hooks.js";
import {
  useCreateSchedule,
  useDeleteSchedule,
  useSchedules,
} from "../schedules/hooks.js";
import { HeaterRow } from "./HeaterRow.js";
import { ScheduleDialog } from "./ScheduleDialog.js";

interface Props {
  connection: Connection;
  entities: HassEntities;
  username: string;
}

export function HeaterList({ connection, entities, username }: Props) {
  const now = useNow(1000);
  const heaters = getHeaters(entities);
  const { data: schedules = [] } = useSchedules(connection);
  const create = useCreateSchedule(connection);
  const del = useDeleteSchedule(connection);
  const toggle = useToggleHeater(connection);
  const [dialogHeater, setDialogHeater] = useState<{
    entityId: string;
    name: string;
  } | null>(null);

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

  const nowIso = new Date(now).toISOString();
  const maxIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const cancellingUid = del.isPending ? del.variables : undefined;

  return (
    <>
      <ul className="mx-auto max-w-2xl divide-y divide-slate-200 bg-white shadow-sm sm:rounded-lg">
        {heaters.map((h) => {
          const isOn = h.state === "on";
          const name = h.attributes.friendly_name ?? h.entity_id;
          const heaterSchedules = schedules.filter(
            (s) => s.entityId === h.entity_id,
          );
          return (
            <HeaterRow
              key={h.entity_id}
              switchEntity={h}
              powerSensor={findPowerSensor(h.entity_id, entities)}
              timer={findAutoOffTimer(h.entity_id, entities)}
              schedules={heaterSchedules}
              now={now}
              isLoading={
                (toggle.isPending &&
                  toggle.variables.entityId === h.entity_id) ||
                (create.isPending &&
                  create.variables.targetEntityId === h.entity_id)
              }
              onToggle={() => {
                toggle.mutate({ entityId: h.entity_id, isOn });
              }}
              onSchedule={() => {
                setDialogHeater({ entityId: h.entity_id, name });
              }}
              onSchedulePreset={(preset) => {
                if (
                  create.isPending &&
                  create.variables.targetEntityId === h.entity_id
                ) {
                  return;
                }

                let start: Date;
                switch (preset) {
                  case "1h":
                    start = new Date(now + 60 * 60 * 1000);
                    break;
                  case "8am":
                    {
                      const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
                      tomorrow.setHours(8, 0, 0, 0);
                      start = tomorrow;
                    }
                    break;
                  default:
                    preset satisfies never;
                    return;
                }
                create.mutate({
                  targetEntityId: h.entity_id,
                  targetName: name,
                  createdBy: username,
                  startIso: start.toISOString(),
                });
              }}
              onCancelSchedule={(uid) => {
                del.mutate(uid);
              }}
              cancellingUid={cancellingUid}
            />
          );
        })}
      </ul>
      <ScheduleDialog
        open={dialogHeater !== null}
        heaterName={dialogHeater?.name ?? ""}
        minIso={nowIso}
        maxIso={maxIso}
        submitting={create.isPending}
        onCancel={() => {
          setDialogHeater(null);
        }}
        onSubmit={(startIso) => {
          if (!dialogHeater) return;
          create.mutate(
            {
              targetEntityId: dialogHeater.entityId,
              targetName: dialogHeater.name,
              createdBy: username,
              startIso,
            },
            {
              onSuccess: () => {
                setDialogHeater(null);
              },
            },
          );
        }}
      />
    </>
  );
}
