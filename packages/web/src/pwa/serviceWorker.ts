/**
 * Registers public/sw.js, which is what makes the app installable in Chromium
 * and what keeps a cold home screen launch from failing outright when the phone
 * is offline.
 *
 * Production builds only: on the dev server there is nothing worth caching, and
 * a worker left registered on localhost would outlive the session and confuse
 * the next thing served from that port. To exercise it locally, run
 * `pnpm build && pnpm preview`.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      // Non-fatal: the app works fine uninstalled and online.
      console.warn("Service worker registration failed", err);
    });
  });
}
