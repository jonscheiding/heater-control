import {
  createConnection,
  getAuth,
  type Auth,
  type Connection,
} from "home-assistant-js-websocket";

const TOKEN_KEY = "ha-tokens";

let connectionPromise: Promise<Connection> | null = null;

export function connect(): Promise<Connection> {
  connectionPromise ??= doConnect().catch((err: unknown) => {
    connectionPromise = null;
    throw err;
  });
  return connectionPromise;
}

async function doConnect(): Promise<Connection> {
  const auth: Auth = await getAuth({
    hassUrl: import.meta.env.VITE_HA_URL,
    saveTokens(data) {
      if (data == null) {
        localStorage.removeItem(TOKEN_KEY);
      } else {
        localStorage.setItem(TOKEN_KEY, JSON.stringify(data));
      }
    },
    loadTokens() {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return Promise.resolve(undefined);
      try {
        return Promise.resolve(JSON.parse(raw));
      } catch {
        return Promise.resolve(undefined);
      }
    },
  });
  return await createConnection({ auth });
}
