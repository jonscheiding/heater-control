import { config } from "./config.js";
import { getSecret } from "./secrets.js";

const BASE_URL = "https://api.smartthings.com/v1";

interface SmartThingsDevice {
  deviceId: string;
  label: string;
  name: string;
  locationId: string;
  components: Array<{
    id: string;
    capabilities: Array<{ id: string; version: number }>;
  }>;
}

interface SmartThingsStatus {
  components: Record<
    string,
    Record<
      string,
      Record<string, { value: unknown; unit?: string; timestamp?: string }>
    >
  >;
}

export interface Device {
  id: string;
  label: string;
  capabilities: string[];
  status: Record<string, { value: unknown; unit?: string }>;
}

async function smartthingsFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getSecret(config.smartthingsSecretArn);
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SmartThings ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

function flattenStatus(status: SmartThingsStatus): Device["status"] {
  const flat: Device["status"] = {};
  const main = status.components.main;
  if (!main) return flat;

  for (const capability of Object.values(main)) {
    for (const [attr, attrValue] of Object.entries(capability)) {
      flat[attr] = {
        value: attrValue.value,
        ...(attrValue.unit ? { unit: attrValue.unit } : {}),
      };
    }
  }
  return flat;
}

export async function listDevices(): Promise<Device[]> {
  const response = await smartthingsFetch<{ items: SmartThingsDevice[] }>(
    `/devices?locationId=${config.smartthingsLocationId}`,
  );

  const devices = await Promise.all(
    response.items.map(async (item) => {
      const status = await smartthingsFetch<SmartThingsStatus>(
        `/devices/${item.deviceId}/status`,
      );
      const mainComponent = item.components.find((c) => c.id === "main");
      const capabilities = mainComponent?.capabilities.map((c) => c.id) ?? [];

      return {
        id: item.deviceId,
        label: item.label,
        capabilities,
        status: flattenStatus(status),
      };
    }),
  );

  return devices;
}

export async function getDeviceStatus(
  deviceId: string,
): Promise<Device["status"]> {
  const status = await smartthingsFetch<SmartThingsStatus>(
    `/devices/${deviceId}/status`,
  );
  return flattenStatus(status);
}

export async function sendCommand(
  deviceId: string,
  capability: string,
  command: string,
  args: unknown[] = [],
): Promise<void> {
  await smartthingsFetch(`/devices/${deviceId}/commands`, {
    method: "POST",
    body: JSON.stringify({
      commands: [{ component: "main", capability, command, arguments: args }],
    }),
  });
}
