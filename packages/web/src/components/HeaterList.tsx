import {
  type Connection,
  type HassEntities,
} from "home-assistant-js-websocket";
import { useState } from "react";

import { useNow } from "../ha/hooks.js";
import { getHeaters } from "../heaters/heater.js";
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
import { sortBy } from "lodash-es";

interface Props {
  connection: Connection;
  entities: HassEntities;
  username: string;
  userId: string | null;
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
          No heaters found. Add one in Home Assistant under Settings &rarr;
          Devices &amp; services &rarr; Add integration &rarr;{" "}
          <code className={styles.code}>Heater Control</code>.
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
        {sortBy(
          heaters,
          (h) => h.aircraftType ?? "",
          (h) => h.name,
        ).map((h) => {
          const isOn = h.isOn;
          const name = h.name;
          const nNumber = h.nNumber;
          const aircraftType = h.aircraftType;
          const heaterSchedules = schedules.filter(
            (s) => s.entityId === h.entityId,
          );
          return (
            <HeaterRow
              key={h.entityId}
              heater={h}
              schedules={heaterSchedules}
              forecast={forecast}
              now={now}
              isLoading={
                (toggle.isPending &&
                  toggle.variables.entityId === h.entityId) ||
                (create.isPending &&
                  create.variables.targetEntityId === h.entityId)
              }
              onToggle={() => {
                toggle.mutate({ entityId: h.entityId, isOn });
              }}
              onSchedule={() => {
                setDialogHeater({
                  entityId: h.entityId,
                  name,
                  nNumber,
                  aircraftType,
                });
              }}
              onSchedulePreset={(preset) => {
                if (
                  create.isPending &&
                  create.variables.targetEntityId === h.entityId
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
                  targetEntityId: h.entityId,
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
