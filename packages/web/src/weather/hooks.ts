import { useQuery } from "@tanstack/react-query";
import type { Connection } from "home-assistant-js-websocket";

import { fetchHourlyForecast, type ForecastEntry } from "./forecast.js";

export function useForecast(
  connection: Connection,
  entityId: string | undefined,
) {
  return useQuery<ForecastEntry[]>({
    queryKey: ["forecast", entityId],
    queryFn: () => {
      if (!entityId) return [];
      return fetchHourlyForecast(connection, entityId);
    },
    enabled: entityId != null,
    // met.no updates roughly hourly; a 30-min refetch keeps it fresh cheaply.
    staleTime: 15 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
  });
}
