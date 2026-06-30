import {
  callService,
  subscribeEntities,
  type Connection,
  type HassEntities,
} from "home-assistant-js-websocket";
import { useEffect, useState } from "react";

import { connect } from "./ha/connection.js";

export default function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [entities, setEntities] = useState<HassEntities>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    connect()
      .then((conn) => {
        if (cancelled) return;
        setConnection(conn);
        unsubscribe = subscribeEntities(conn, setEntities);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (error) {
    return (
      <main>
        <h1>Heater Control</h1>
        <p>Couldn&rsquo;t connect to Home Assistant: {error}</p>
      </main>
    );
  }

  if (!connection) {
    return (
      <main>
        <h1>Heater Control</h1>
        <p>Connecting&hellip;</p>
      </main>
    );
  }

  const TOGGLEABLE_PREFIXES = ["switch.", "input_boolean."];
  const switches = Object.values(entities)
    .filter((e) => TOGGLEABLE_PREFIXES.some((p) => e.entity_id.startsWith(p)))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));

  return (
    <main>
      <h1>Heater Control</h1>
      {switches.length === 0 ? (
        <p>No switch entities found.</p>
      ) : (
        <ul>
          {switches.map((s) => {
            const isOn = s.state === "on";
            return (
              <li key={s.entity_id}>
                <strong>{s.attributes.friendly_name ?? s.entity_id}</strong>{" "}
                <span>({s.state})</span>{" "}
                <button
                  onClick={() => {
                    void callService(
                      connection,
                      "homeassistant",
                      isOn ? "turn_off" : "turn_on",
                      { entity_id: s.entity_id },
                    );
                  }}
                >
                  {isOn ? "Turn off" : "Turn on"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
