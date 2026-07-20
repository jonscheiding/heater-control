import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Connection } from "home-assistant-js-websocket";
import { toast } from "react-toastify";

import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  type CreateScheduleInput,
  type HeaterSchedule,
} from "./api.js";

const QUERY_KEY = ["schedules"] as const;

const DUPLICATE_WINDOW_MS = 60 * 60 * 1000;

export function useSchedules(connection: Connection | null) {
  return useQuery<HeaterSchedule[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      if (!connection) return [];
      const start = new Date();
      const end = new Date(start.getTime() + 36 * 60 * 60 * 1000);
      return await listSchedules(start.toISOString(), end.toISOString());
    },
    enabled: !!connection,
    refetchInterval: 30_000,
  });
}

export function useCreateSchedule(connection: Connection | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateScheduleInput) => {
      if (!connection) throw new Error("Not connected to Home Assistant");
      const startMs = new Date(input.startIso).getTime();
      const nearby = await listSchedules(
        new Date(startMs - DUPLICATE_WINDOW_MS).toISOString(),
        new Date(startMs + DUPLICATE_WINDOW_MS).toISOString(),
      );
      const alreadyScheduled = nearby.some(
        (s) =>
          s.entityId === input.targetEntityId &&
          Math.abs(new Date(s.startIso).getTime() - startMs) <=
            DUPLICATE_WINDOW_MS,
      );
      if (alreadyScheduled) {
        toast.warn(
          `${input.targetName} is already scheduled within an hour of that time.`,
        );
      } else {
        await createSchedule(connection, input);
      }
      // Keep the mutation pending until the refetched list is on screen, so
      // the spinner spans the fetch gap and not just the create call.
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useDeleteSchedule(connection: Connection | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (uid: string) => {
      if (!connection) throw new Error("Not connected to Home Assistant");
      await deleteSchedule(connection, uid);
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
