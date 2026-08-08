import * as Sentry from "@sentry/node";

/**
 * Sentry initialisation, kept in its own module so it can be loaded before the
 * rest of the app — either via `node --import ./dist/instrument.js` (prod) or as
 * the first import in `server.ts` (dev). Reads the environment directly rather
 * than via `loadConfig()` because it must run before config validation.
 *
 * A no-op when `SENTRY_DSN` is unset, so local dev and the test suite stay
 * silent without any extra wiring.
 */
const dsn = process.env["SENTRY_DSN"];

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env["SENTRY_ENVIRONMENT"] ?? "production",
    integrations: [
      Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
    ],
    enableLogs: true,
    // Error reporting only — we don't need performance tracing for a
    // login-only service.
    tracesSampleRate: 0,
  });
}
