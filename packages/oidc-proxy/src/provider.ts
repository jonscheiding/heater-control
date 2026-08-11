import * as Sentry from "@sentry/node";
import { nanoid } from "nanoid";
import {
  Provider,
  type ClientMetadata,
  type Configuration,
} from "oidc-provider";

import type { AccountStore } from "./account-store.js";
import type { ProxyEnvironmentConfig } from "./config.js";
import { errorPage } from "./views.js";

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
      url(_ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
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
