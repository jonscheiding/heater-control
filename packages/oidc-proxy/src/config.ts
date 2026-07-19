import {
  cleanEnv,
  num,
  str,
  makeValidator,
  type ValidatorSpec,
  json,
  bool,
} from "envalid";
import type { JWK } from "jose";
import { z } from "zod";

const zod = <T>(schema: z.Schema<T>) =>
  makeValidator((value) => schema.parse(json()._parse(value)))();

const list = <T>(inner: ValidatorSpec<T>) =>
  makeValidator((values) =>
    values.split(",").map((value) => inner._parse(value)),
  )();

const jwkSchema = z
  .object({
    kty: z.string(),
    // JWKs have a bunch of optional parameters
    // don't feel like enumerating them here
  })
  .loose()
  .transform((data) => data as JWK);

const jwksSchema = z.union([
  jwkSchema.transform((data) => ({ keys: [data] })),
  z.object({ keys: z.array(jwkSchema) }),
]);

export interface ProxyEnvironmentConfig {
  PORT: number;

  OIDC_ISSUER: string;
  OIDC_JWKS: { keys: JWK[] };
  OIDC_COOKIE_KEYS: string[];
  OIDC_INSECURE_COOKIES: boolean;

  HA_CLIENT_ID: string;
  HA_CLIENT_SECRET: string;
  HA_REDIRECT_URIS: string[];
  HA_TOKEN_AUTH_METHOD: string;

  ACCOUNT_TTL_SECONDS: number;
}

/** Read and validate configuration from the environment. Throws on any gap. */
export function loadConfig(): ProxyEnvironmentConfig {
  return cleanEnv(process.env, {
    PORT: num({ default: 3000 }),

    OIDC_ISSUER: str(),
    OIDC_JWKS: zod(jwksSchema),
    OIDC_COOKIE_KEYS: list(str()),
    OIDC_INSECURE_COOKIES: bool({ default: false }),

    HA_CLIENT_ID: str(),
    HA_CLIENT_SECRET: str(),
    HA_REDIRECT_URIS: list(str()),
    HA_TOKEN_AUTH_METHOD: str({ default: "client_secret_basic" }),

    ACCOUNT_TTL_SECONDS: num({ default: 600 }),
  });
}
