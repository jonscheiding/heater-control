import { Hono } from "hono";

import { getDeviceStatus, listDevices, sendCommand } from "../smartthings.js";

export const devicesRoutes = new Hono();

devicesRoutes.get("/", async (c) => {
  const devices = await listDevices();
  return c.json(devices);
});

devicesRoutes.get("/:deviceId/status", async (c) => {
  const status = await getDeviceStatus(c.req.param("deviceId"));
  return c.json(status);
});

devicesRoutes.post("/:deviceId/commands", async (c) => {
  const body = await c.req.json<{
    capability: string;
    command: string;
    arguments?: unknown[];
  }>();
  if (!body.capability || !body.command) {
    return c.json({ error: "capability and command are required" }, 400);
  }
  await sendCommand(
    c.req.param("deviceId"),
    body.capability,
    body.command,
    body.arguments,
  );
  return c.body(null, 202);
});
