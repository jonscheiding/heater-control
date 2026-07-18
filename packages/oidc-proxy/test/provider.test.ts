import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";

import { AccountStore } from "../src/account-store.js";
import type { ProxyConfig } from "../src/config.js";
import { createProvider } from "../src/provider.js";

async function testConfig(): Promise<ProxyConfig> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.alg = "RS256";
  jwk.use = "sig";
  jwk.kid = await calculateJwkThumbprint(jwk);

  return {
    issuer: "https://sm-oidc.example.com",
    port: 3000,
    jwks: { keys: [jwk] },
    cookieKeys: ["k1", "k2"],
    ha: {
      clientId: "home-assistant",
      clientSecret: "secret",
      redirectUris: ["https://ha.example.com/auth/oidc/callback"],
      tokenAuthMethod: "client_secret_basic",
    },
    accountTtlSeconds: 600,
    insecureCookies: false,
  };
}

describe("createProvider", () => {
  it("builds a provider with the configured issuer and HA client", async () => {
    const config = await testConfig();
    const provider = createProvider(config, new AccountStore(600));

    expect(provider.issuer).toBe(config.issuer);

    const client = await provider.Client.find("home-assistant");
    expect(client).toBeDefined();
    expect(client?.redirectUris).toEqual(config.ha.redirectUris);
  });
});
