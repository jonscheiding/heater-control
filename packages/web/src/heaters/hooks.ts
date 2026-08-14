import { useMutation } from "@tanstack/react-query";
import { callService, type Connection } from "home-assistant-js-websocket";

interface ToggleInput {
  entityId: string;
  isOn: boolean;
}

export function useToggleHeater(connection: Connection | null) {
  return useMutation({
    mutationFn: async ({ entityId, isOn }: ToggleInput) => {
      if (!connection) throw new Error("Not connected to Home Assistant");

      if (window.location.hostname === "localhost") {
        // artificial delay, to make the "loading" UI visible in testing
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Ack-based: resolves once HA has processed the service call. The
      // pushed entity state (subscribeEntities) then reflects the change,
      // and computeHeaterState covers physical convergence afterwards.
      await callService(
        connection,
        "homeassistant",
        isOn ? "turn_off" : "turn_on",
        { entity_id: entityId },
      );
    },
  });
}
