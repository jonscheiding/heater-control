import { Router, urlencoded, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { type InteractionResults, type Provider } from "oidc-provider";

import { authenticate } from "@heater-control/sm-client";

import type { AccountStore } from "./account-store.js";
import { errorPage, loginPage } from "./views.js";

/** Read a string field from a parsed urlencoded body, defaulting to "". */
function field(
  body: Record<string, unknown> | undefined,
  name: string,
): string {
  const value = body?.[name];
  return typeof value === "string" ? value : "";
}

/**
 * Auto-approve consent for our single first-party client (HA). There is no
 * per-user authorization model, so we grant exactly the scopes/claims requested.
 */
async function grantConsent(
  provider: Provider,
  req: Request,
  res: Response,
  details: Awaited<ReturnType<Provider["interactionDetails"]>>,
): Promise<void> {
  const { prompt, params, session, grantId } = details;

  let grant = grantId ? await provider.Grant.find(grantId) : undefined;
  grant ??= new provider.Grant({
    accountId: session?.accountId,
    clientId: String(params["client_id"]),
  });

  const promptDetails = prompt.details as {
    missingOIDCScope?: string[];
    missingOIDCClaims?: string[];
  };
  if (promptDetails.missingOIDCScope) {
    grant.addOIDCScope(promptDetails.missingOIDCScope.join(" "));
  }
  if (promptDetails.missingOIDCClaims) {
    grant.addOIDCClaims(promptDetails.missingOIDCClaims);
  }

  const consentGrantId = await grant.save();
  const result: InteractionResults = { consent: { grantId: consentGrantId } };
  await provider.interactionFinished(req, res, result, {
    mergeWithLastSubmission: true,
  });
}

/** Express router serving the login + consent interaction pages. */
export function interactionsRouter(
  provider: Provider,
  accounts: AccountStore,
): Router {
  const router = Router();

  router.get("/:uid", async (req, res) => {
    const details = await provider.interactionDetails(req, res);
    switch (details.prompt.name) {
      case "login":
        res.send(loginPage(details.uid));
        return;
      case "consent":
        await grantConsent(provider, req, res, details);
        return;
      default:
        res
          .status(400)
          .send(errorPage(`Unsupported interaction: ${details.prompt.name}`));
    }
  });

  router.post(
    "/:uid/login",
    urlencoded({ extended: false }),
    async (req, res) => {
      const details = await provider.interactionDetails(req, res);
      const body = req.body as Record<string, unknown> | undefined;
      const username = field(body, "username");
      const password = field(body, "password");

      if (!username || !password) {
        res.send(loginPage(details.uid, "Enter your username and password."));
        return;
      }

      let result;
      try {
        result = await authenticate(username, password);
      } catch (e) {
        const id = nanoid();
        console.error("Authentication error", id, e);
        res
          .status(502)
          .send(
            errorPage(
              `Communication error with ScheduleMaster. Please share this identifier with Operations: ${id}`,
            ),
          );
        return;
      }

      if (!result.ok) {
        const message =
          result.reason === "suspended"
            ? "This ScheduleMaster account is suspended."
            : "Incorrect username or password.";
        res.status(401).send(loginPage(details.uid, message));
        return;
      }

      accounts.set(result.claims);
      await provider.interactionFinished(
        req,
        res,
        { login: { accountId: result.claims.sub } },
        { mergeWithLastSubmission: false },
      );
    },
  );

  return router;
}
