import {
  subscribeEntities,
  type Connection,
  type HassEntities,
  type HassUser,
} from "home-assistant-js-websocket";
import { useEffect, useState } from "react";

import { Banner } from "./components/Banner.js";
import { HeaterList } from "./components/HeaterList.js";
import { connect } from "./ha/connection.js";
import { getCurrentUser } from "./ha/user.js";

export default function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [entities, setEntities] = useState<HassEntities>({});
  const [user, setUser] = useState<HassUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    connect()
      .then(async (conn) => {
        if (cancelled) return;
        setConnection(conn);
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
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const isLoaded = Object.values(entities).length > 0;

  return (
    <div className="min-h-screen bg-slate-100">
      <Banner username={user?.name ?? null} />
      <main className="py-4 sm:py-6">
        {error && (
          <div className="mx-auto max-w-2xl rounded bg-red-50 p-4 text-red-800 sm:rounded-lg">
            Couldn&rsquo;t connect to Home Assistant: {error}
          </div>
        )}
        {!error && !connection && (
          <div className="mx-auto max-w-2xl p-4 text-center text-slate-600">
            Connecting&hellip;
          </div>
        )}
        {!isLoaded && connection && (
          <div className="mx-auto max-w-2xl p-4 text-center text-slate-600">
            Connecting&hellip;
          </div>
        )}
        {isLoaded && connection && (
          <HeaterList
            connection={connection}
            entities={entities}
            username={user?.name || "Pilot"}
          />
        )}
      </main>
    </div>
  );
}
