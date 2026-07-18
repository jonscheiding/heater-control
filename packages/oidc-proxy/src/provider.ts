import {
  Provider,
  type ClientMetadata,
  type Configuration,
} from "oidc-provider";

import type { AccountStore } from "./account-store.js";
import type { ProxyConfig } from "./config.js";

/**
 * Build the OIDC provider Home Assistant's `auth_oidc` integration talks to.
 * The only registered client is HA itself; accounts come from the in-memory
 * store populated during the ScheduleMaster login interaction.
 */
export function createProvider(
  config: ProxyConfig,
  accounts: AccountStore,
): Provider {
  const haClient: ClientMetadata = {
    client_id: config.ha.clientId,
    client_secret: config.ha.clientSecret,
    redirect_uris: config.ha.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: config.ha
      .tokenAuthMethod as ClientMetadata["token_endpoint_auth_method"],
  };

  const configuration: Configuration = {
    clients: [haClient],
    // Configuring these claim sets also enables the `profile`/`email` scopes.
    claims: {
      openid: ["sub"],
      profile: ["name", "given_name", "family_name", "preferred_username"],
      email: ["email"],
    },
    jwks: config.jwks,
    cookies: {
      keys: config.cookieKeys,
      // Over plain HTTP (local dev only) the browser drops Secure cookies, which
      // breaks the interaction session. Allow insecure cookies when explicitly
      // opted in; production runs over HTTPS and leaves this off.
      ...(config.insecureCookies
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

  return new Provider(config.issuer, configuration);
}
