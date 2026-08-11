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
import { useForecast } from "../weather/hooks.js";
import { findWeatherEntity } from "../weather/weather.js";
import styles from "./HeaterList.module.css";
import { HeaterRow } from "./HeaterRow.js";
import { ScheduleDialog } from "./ScheduleDialog.js";
import { WeatherBadge } from "./WeatherBadge.js";

interface Props {
  connection: Connection;
  entities: HassEntities;
  username: string;
  userId: string | null;
}

function attrString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function byName(
  a: { entity_id: string; attributes: { friendly_name?: string } },
  b: { entity_id: string; attributes: { friendly_name?: string } },
) {
  const nameA = a.attributes.friendly_name ?? a.entity_id;
  const nameB = b.attributes.friendly_name ?? b.entity_id;
  return nameA.localeCompare(nameB);
}

export function HeaterList({ connection, entities, username, userId }: Props) {
  const now = useNow(1000);
  const heaters = getHeaters(entities);
  const weatherEntity = findWeatherEntity(entities);
  const { data: forecast = [] } = useForecast(
    connection,
    weatherEntity?.entity_id,
  );
  const { data: schedules = [] } = useSchedules(connection);
  const create = useCreateSchedule(connection);
  const del = useDeleteSchedule(connection);
  const toggle = useToggleHeater(connection);
  const [dialogHeater, setDialogHeater] = useState<{
    entityId: string;
    name: string;
    nNumber: string | null;
    aircraftType: string | null;
  } | null>(null);

  if (heaters.length === 0) {
    return (
      <>
        <div className={styles.empty}>
          No heaters found. Expected entities matching{" "}
          <code className={styles.code}>switch.heater_*</code> or{" "}
          <code className={styles.code}>input_boolean.heater_*</code>.
        </div>
      </>
    );
  }

  const nowIso = new Date(now).toISOString();
  const maxIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const cancellingUid = del.isPending ? del.variables.uid : undefined;

  return (
    <>
      <WeatherBadge forecast={forecast} now={now} />
      <ul className={styles.list}>
        {heaters.sort(byName).map((h) => {
          const isOn = h.state === "on";
          const name = h.attributes.friendly_name ?? h.entity_id;
          const nNumber = attrString(h.attributes.n_number);
          const aircraftType = attrString(h.attributes.aircraft_type);
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
              forecast={forecast}
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
                setDialogHeater({
                  entityId: h.entity_id,
                  name,
                  nNumber,
                  aircraftType,
                });
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
                  startIso: start.toISOString(),
                  username,
                  userId,
                  nNumber,
                  aircraftType,
                });
              }}
              onCancelSchedule={(schedule) => {
                del.mutate({
                  uid: schedule.uid,
                  calendarEntity: schedule.calendarEntity,
                });
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
              startIso,
              username,
              userId,
              nNumber: dialogHeater.nNumber,
              aircraftType: dialogHeater.aircraftType,
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
