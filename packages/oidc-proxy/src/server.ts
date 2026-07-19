import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

import { AccountStore } from "./account-store.js";
import { loadConfig } from "./config.js";
import { interactionsRouter } from "./interactions.js";
import { createProvider } from "./provider.js";
import { errorPage } from "./views.js";

const config = loadConfig();
const accounts = new AccountStore(config.ACCOUNT_TTL_SECONDS);
const provider = createProvider(config, accounts);
// Trust the reverse proxy / platform TLS terminator so the issuer stays https.
provider.proxy = true;

const app = express();
app.set("trust proxy", true);

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Login + consent UI. Mounted before the provider's catch-all callback.
app.use("/interaction", interactionsRouter(provider, accounts));

// All standard OIDC endpoints (discovery, authorize, token, jwks, userinfo).
app.use(provider.callback());

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).send(errorPage("Something went wrong. Please try again."));
});

app.listen(config.PORT, "0.0.0.0", () => {
  console.log(
    `oidc-proxy listening on :${config.PORT} (issuer ${config.OIDC_ISSUER})`,
  );
});
