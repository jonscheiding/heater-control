import type { JWK } from "jose";

/** Parsed, validated runtime configuration for the proxy. */
export interface ProxyConfig {
  issuer: string;
  port: number;
  jwks: { keys: JWK[] };
  cookieKeys: string[];
  ha: {
    clientId: string;
    clientSecret: string;
    redirectUris: string[];
    tokenAuthMethod: string;
  };
  /** How long scraped claims live in the account store (seconds). */
  accountTtlSeconds: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function list(name: string): string[] {
  return required(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseJwks(raw: string): { keys: JWK[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OIDC_JWKS must be valid JSON (a JWKS object or a JWK).");
  }
  // Accept either a full { keys: [...] } JWKS or a single JWK.
  const keys =
    parsed && typeof parsed === "object" && "keys" in parsed
      ? (parsed as { keys: JWK[] }).keys
      : [parsed as JWK];
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error("OIDC_JWKS did not contain any keys.");
  }
  return { keys };
}

/** Read and validate configuration from the environment. Throws on any gap. */
export function loadConfig(): ProxyConfig {
  return {
    issuer: required("OIDC_ISSUER"),
    port: Number(process.env["PORT"] ?? "3000"),
    jwks: parseJwks(required("OIDC_JWKS")),
    cookieKeys: list("OIDC_COOKIE_KEYS"),
    ha: {
      clientId: required("HA_CLIENT_ID"),
      clientSecret: required("HA_CLIENT_SECRET"),
      redirectUris: list("HA_REDIRECT_URIS"),
      tokenAuthMethod:
        process.env["HA_TOKEN_AUTH_METHOD"] ?? "client_secret_basic",
    },
    accountTtlSeconds: Number(process.env["ACCOUNT_TTL_SECONDS"] ?? "600"),
  };
}
