import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { config } from "./config.js";

const issuer = config.oidcIssuer.replace(/\/$/, "");
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing bearer token" }, 401);
  }

  let email: string | undefined;
  try {
    const { payload } = await jwtVerify(header.slice("Bearer ".length), jwks, {
      issuer,
      audience: config.oidcAudience,
    });
    email = typeof payload.email === "string" ? payload.email : undefined;
  } catch (err) {
    return c.json(
      { error: "Invalid token", detail: (err as Error).message },
      401,
    );
  }

  if (!email || !config.allowedEmails.has(email)) {
    return c.json({ error: "Not authorized" }, 403);
  }

  await next();
};
