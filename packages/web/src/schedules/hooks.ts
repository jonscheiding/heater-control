import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Connection } from "home-assistant-js-websocket";

import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  type CreateScheduleInput,
  type HeaterSchedule,
} from "./api.js";

const QUERY_KEY = ["schedules"] as const;

export function useSchedules(connection: Connection | null) {
  return useQuery<HeaterSchedule[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      if (!connection) return [];
      const start = new Date();
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
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
      await createSchedule(connection, input);
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
