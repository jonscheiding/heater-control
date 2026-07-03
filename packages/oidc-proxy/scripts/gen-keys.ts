import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

// Generate one RS256 signing key and print it as a JWKS suitable for OIDC_JWKS.
// Keys must be stable across restarts, so store the output as a secret rather
// than regenerating on boot (see the plan's state-loss note).
//
//   node --experimental-strip-types scripts/gen-keys.ts
//   pnpm --filter @heater-control/oidc-proxy gen-keys

const { privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = await exportJWK(privateKey);
jwk.alg = "RS256";
jwk.use = "sig";
jwk.kid = await calculateJwkThumbprint(jwk);

process.stdout.write(`${JSON.stringify({ keys: [jwk] })}\n`);
