#!/usr/bin/env node
import { App } from "aws-cdk-lib";

import { AppStack } from "../lib/app-stack";

const app = new App();

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const googleClientId: string =
  app.node.tryGetContext("googleClientId") ?? process.env.GOOGLE_CLIENT_ID;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const smartthingsLocationId: string =
  app.node.tryGetContext("smartthingsLocationId") ??
  process.env.SMARTTHINGS_LOCATION_ID;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const allowedEmails: string =
  app.node.tryGetContext("allowedEmails") ?? process.env.ALLOWED_EMAILS;

if (!googleClientId) {
  throw new Error("GOOGLE_CLIENT_ID must be set (env or cdk context)");
}
if (!smartthingsLocationId) {
  throw new Error("SMARTTHINGS_LOCATION_ID must be set (env or cdk context)");
}
if (!allowedEmails) {
  throw new Error(
    "ALLOWED_EMAILS must be set (comma-separated, env or cdk context)",
  );
}

new AppStack(app, "HeaterControlApp", {
  googleClientId,
  smartthingsLocationId,
  allowedEmails,
});
