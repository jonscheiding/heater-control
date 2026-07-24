import * as Sentry from "@sentry/react";
import {
  createConnection,
  getAuth,
  type Auth,
  type Connection,
} from "home-assistant-js-websocket";

const TOKEN_KEY = "ha-tokens";

let connectionPromise: Promise<Connection> | null = null;
let currentAuth: Auth | null = null;

export function connect(): Promise<Connection> {
  connectionPromise ??= doConnect().catch((err: unknown) => {
    connectionPromise = null;
    currentAuth = null;
    Sentry.captureException(err, { tags: { area: "ha-connection" } });
    throw err;
  });
  return connectionPromise;
}

async function doConnect(): Promise<Connection> {
  currentAuth = await getAuth({
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
  clearAuthParamsFromUrl();
  return await createConnection({ auth: currentAuth });
}

function clearAuthParamsFromUrl(): void {
  const url = new URL(window.location.href);
  let dirty = false;
  for (const key of ["auth_callback", "code", "state"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      dirty = true;
    }
  }
  if (dirty) {
    window.history.replaceState({}, "", url.toString());
  }
}

export async function logout(): Promise<void> {
  try {
    await currentAuth?.revoke();
  } catch {
    // Best effort — clear local tokens regardless.
  }
  localStorage.removeItem(TOKEN_KEY);
  connectionPromise = null;
  currentAuth = null;
  window.location.reload();
}

/**
 * The stored tokens are invalid (e.g. HA was restarted in dev, or the refresh
 * token was revoked). Drop them and reload so `connect()` starts a fresh OAuth
 * flow. Unlike `logout`, we skip revoke — the tokens are already dead.
 */
export function reauthenticate(): void {
  localStorage.removeItem(TOKEN_KEY);
  connectionPromise = null;
  currentAuth = null;
  window.location.reload();
}

export async function haFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const auth = currentAuth;
  if (!auth) throw new Error("Not connected to Home Assistant");
  if (auth.expired) {
    try {
      await auth.refreshAccessToken();
    } catch {
      // fall through; fetch will 401 if the token is truly bad
    }
  }
  const response = await fetch(`${import.meta.env.VITE_HA_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      ...init?.headers,
    },
  });
  if (response.status === 401) {
    // Token was rejected despite our refresh attempt — force a re-login.
    reauthenticate();
  } else if (response.status >= 500) {
    // HA (or its reverse proxy) is erroring — worth surfacing, not just failing
    // silently at the call site.
    Sentry.captureMessage(`HA request to ${path} failed: ${response.status}`, {
      level: "error",
      tags: { area: "ha-fetch" },
    });
  }
  return response;
}
