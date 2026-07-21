import {
  ERR_INVALID_AUTH,
  subscribeEntities,
  type Connection,
  type HassEntities,
  type HassUser,
} from "home-assistant-js-websocket";
import { useEffect, useState } from "react";

import { connect, reauthenticate } from "./connection.js";
import { getCurrentUser } from "./user.js";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface UseConnectionResult {
  connection: Connection | null;
  entities: HassEntities;
  user: HassUser | null;
  status: ConnectionStatus;
}

/**
 * Establishes and manages the Home Assistant connection.
 *
 * The underlying library auto-reconnects on socket loss with backoff, so a
 * "disconnected" event is treated as a transient "reconnecting" state (the UI
 * stays up with its last-known data) and cleared by the next "ready" event.
 * An invalid-auth failure — either on the initial connect or reported via
 * "reconnect-error" — clears the dead tokens and restarts the OAuth flow.
 */
export function useConnection(): UseConnectionResult {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [entities, setEntities] = useState<HassEntities>({});
  const [user, setUser] = useState<HassUser | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    connect()
      .then(async (conn) => {
        if (cancelled) return;
        setConnection(conn);
        setStatus("connected");

        if (import.meta.env.DEV) {
          // Dev-only handle for testing reconnect from the console, e.g.
          // `__haConn.socket.close()` (DevTools "Offline" won't drop an
          // already-open WebSocket, so it never triggers reconnect).
          (globalThis as unknown as { __haConn?: Connection }).__haConn = conn;
        }

        conn.addEventListener("ready", () => {
          if (!cancelled) setStatus("connected");
        });
        conn.addEventListener("disconnected", () => {
          if (!cancelled) setStatus("reconnecting");
        });
        conn.addEventListener("reconnect-error", () => {
          // Fired only for ERR_INVALID_AUTH; the refresh token is dead.
          reauthenticate();
        });

        // The library re-establishes this subscription automatically after a
        // reconnect, refreshing entities once "ready" fires again.
        unsubscribe = subscribeEntities(conn, setEntities);

        try {
          const currentUser = await getCurrentUser(conn);
          if (!cancelled) setUser(currentUser);
        } catch {
          // Non-fatal — banner just skips the welcome line.
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err === ERR_INVALID_AUTH) {
          reauthenticate();
          return;
        }
        setStatus("error");
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return { connection, entities, user, status };
}
