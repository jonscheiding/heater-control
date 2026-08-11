import * as Sentry from "@sentry/node";
import { nanoid } from "nanoid";
import {
  interactionPolicy,
  Provider,
  type ClientMetadata,
  type Configuration,
} from "oidc-provider";

import type { AccountStore } from "./account-store.js";
import type { ProxyEnvironmentConfig } from "./config.js";
import { errorPage } from "./views.js";

/**
 * The stock interaction policy assumes a session's account can always be
 * resolved: `loadAccount` tolerates `findAccount` returning nothing, but then
 * `loadGrant` skips attaching a Grant, and the consent prompt's checks
 * dereference `ctx.oidc.grant` unconditionally. Our accounts live in a
 * short-TTL in-memory cache, so an OP session that outlived its cached claims
 * crashed `/auth` with `Cannot read properties of undefined (reading
 * 'getOIDCScopeEncountered')` until the proxy was restarted (which wiped the
 * sessions along with the accounts). Ask the pilot to log in again instead.
 */
export function createInteractionPolicy(): interactionPolicy.DefaultPolicy {
  const policy = interactionPolicy.base();

  const login = policy.get("login");
  if (!login) {
    throw new Error("base interaction policy is missing the login prompt");
  }

  login.checks.add(
    new interactionPolicy.Check(
      "account_not_found",
      "End-User authentication is required",
      "login_required",
      (ctx) =>
        ctx.oidc.session?.accountId && !ctx.oidc.account
          ? interactionPolicy.Check.REQUEST_PROMPT
          : interactionPolicy.Check.NO_NEED_TO_PROMPT,
    ),
  );

  return policy;
}

/**
 * Build the OIDC provider Home Assistant's `auth_oidc` integration talks to.
 * The only registered client is HA itself; accounts come from the in-memory
 * store populated during the ScheduleMaster login interaction.
 */
export function createProvider(
  config: ProxyEnvironmentConfig,
  accounts: AccountStore,
): Provider {
  const haClient: ClientMetadata = {
    client_id: config.HA_CLIENT_ID,
    client_secret: config.HA_CLIENT_SECRET,
    redirect_uris: config.HA_REDIRECT_URIS,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method:
      config.HA_TOKEN_AUTH_METHOD as ClientMetadata["token_endpoint_auth_method"],
  };

  const configuration: Configuration = {
    clients: [haClient],
    // Configuring these claim sets also enables the `profile`/`email` scopes.
    claims: {
      openid: ["sub"],
      profile: ["name", "given_name", "family_name", "preferred_username"],
      email: ["email"],
    },
    jwks: config.OIDC_JWKS,
    cookies: {
      keys: config.OIDC_COOKIE_KEYS,
      // Over plain HTTP (local dev only) the browser drops Secure cookies, which
      // breaks the interaction session. Allow insecure cookies when explicitly
      // opted in; production runs over HTTPS and leaves this off.
      ...(config.OIDC_INSECURE_COOKIES
        ? { long: { secure: false }, short: { secure: false } }
        : {}),
    },
    // HA is a confidential client (has a secret); PKCE is optional.
    pkce: { required: () => false },
    features: {
      devInteractions: { enabled: false },
    },
    interactions: {
      policy: createInteractionPolicy(),
      url(_ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
    },
    ttl: {
      // Keep the OP's SSO window from outliving the claims it is built from:
      // the session is worthless once the cached account is gone, and letting it
      // linger (14 days by default) only strands pilots on a stale session.
      Session: config.ACCOUNT_TTL_SECONDS,
    },
    renderError: (ctx, out, error) => {
      const id = nanoid();

      Sentry.captureException(error, {
        attributes: { out, id },
      });

      console.error(error, out, id);

      ctx.type = "html";
      ctx.body = errorPage(
        `Something went wrong: ${out.error ?? "Unknown error"}. Please share this identifier with Operations: ${id}`,
      );
    },
    findAccount(_ctx, sub) {
      const claims = accounts.get(sub);
      if (!claims) return undefined;
      return {
        accountId: sub,
        claims() {
          return { ...claims };
        },
      };
    },
  };

  return new Provider(config.OIDC_ISSUER, configuration);
}
