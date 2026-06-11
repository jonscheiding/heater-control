import { useAuth } from "react-oidc-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Device } from "../api.js";
import { SwitchControl } from "../components/SwitchControl.js";
import { TemperatureDisplay } from "../components/TemperatureDisplay.js";

export function Devices() {
  const auth = useAuth();
  const token = auth.user?.id_token ?? "";

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["devices"],
    queryFn: () => api.listDevices(token),
    enabled: Boolean(token),
    refetchInterval: 10_000,
  });

  if (isLoading) return <p>Loading devices…</p>;
  if (error) return <p>Failed to load devices: {error.message}</p>;
  if (!data?.length) return <p>No devices found.</p>;

  return (
    <ul className="devices">
      {data.map((device) => (
        <li key={device.id}>
          <DeviceCard
            device={device}
            token={token}
            onChange={() => void refetch()}
          />
        </li>
      ))}
    </ul>
  );
}

function DeviceCard({
  device,
  token,
  onChange,
}: {
  device: Device;
  token: string;
  onChange: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      capability,
      command,
    }: {
      capability: string;
      command: string;
    }) => api.sendCommand(token, device.id, capability, command),
    onSuccess: () => {
      setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: ["devices"] }),
        1500,
      );
      onChange();
    },
  });

  return (
    <article className="device">
      <h2>{device.label}</h2>
      {device.capabilities.includes("switch") && (
        <SwitchControl
          state={device.status.switch?.value === "on" ? "on" : "off"}
          pending={mutation.isPending}
          onToggle={(next) =>
            mutation.mutate({ capability: "switch", command: next })
          }
        />
      )}
      {device.capabilities.includes("temperatureMeasurement") && (
        <TemperatureDisplay
          value={device.status.temperature?.value as number | undefined}
          unit={device.status.temperature?.unit}
        />
      )}
    </article>
  );
}
