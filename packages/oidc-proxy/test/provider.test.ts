import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import { AccountStore } from "../src/account-store.js";
import type { ProxyEnvironmentConfig } from "../src/config.js";
import { createProvider } from "../src/provider.js";

async function testConfig(): Promise<ProxyEnvironmentConfig> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.alg = "RS256";
  jwk.use = "sig";
  jwk.kid = await calculateJwkThumbprint(jwk);

  return {
    PORT: 3300,

    OIDC_ISSUER: "https://sm-oidc.example.com",
    OIDC_JWKS: { keys: [jwk] },
    OIDC_COOKIE_KEYS: ["k1", "k2"],
    OIDC_INSECURE_COOKIES: false,

    HA_CLIENT_ID: "home-assistant",
    HA_CLIENT_SECRET: "secret",
    HA_REDIRECT_URIS: ["https://ha.example.com/auth/oidc/callback"],
    HA_TOKEN_AUTH_METHOD: "client_secret_basic",

    ACCOUNT_TTL_SECONDS: 600,
  };
}

describe("createProvider", () => {
  it("builds a provider with the configured issuer and HA client", async () => {
    const config = await testConfig();
    const provider = createProvider(config, new AccountStore(600));

    expect(provider.issuer).toBe(config.OIDC_ISSUER);

    const client = await provider.Client.find("home-assistant");
    expect(client).toBeDefined();
    expect(client?.redirectUris).toEqual(config.HA_REDIRECT_URIS);
  });
});
