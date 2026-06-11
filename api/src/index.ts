import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

import { requireAuth } from "./auth.js";
import { devicesRoutes } from "./routes/devices.js";

const app = new Hono();

app.use("/api/*", requireAuth);
app.route("/api/devices", devicesRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export const handler = handle(app);
