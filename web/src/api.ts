const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export interface Device {
  id: string;
  label: string;
  capabilities: string[];
  status: Record<string, { value: unknown; unit?: string }>;
}

async function request<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  if (response.status === 202 || response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const api = {
  listDevices: (token: string) => request<Device[]>(token, "/devices"),

  sendCommand: (
    token: string,
    deviceId: string,
    capability: string,
    command: string,
    args: unknown[] = [],
  ) =>
    request<void>(token, `/devices/${deviceId}/commands`, {
      method: "POST",
      body: JSON.stringify({ capability, command, arguments: args }),
    }),
};
