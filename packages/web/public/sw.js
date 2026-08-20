/*
 * Service worker for the installed app.
 *
 * Two jobs, in order of importance:
 *  1. Existing at all — Chrome/Edge only offer to install a site whose service
 *     worker has a fetch handler.
 *  2. Making a cold launch from the home screen feel instant, and degrade to
 *     "the app loads, but can't reach Home Assistant" instead of a browser
 *     error page when the phone is offline.
 *
 * It deliberately never touches Home Assistant traffic — heater state has to be
 * live, and the websocket isn't cacheable anyway.
 */

const CACHE = "heater-control-v1";
const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` so an install triggered by a stale page still fetches fresh.
      await cache.add(new Request(SHELL, { cache: "reload" }));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((key) => key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Home Assistant, Sentry, anything else cross-origin: not ours to cache.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(shellFirstFromNetwork(request));
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  } else {
    // Icons, the manifest, and anything else we ship unhashed.
    event.respondWith(staleWhileRevalidate(event));
  }
});

/**
 * Navigations go to the network so a deploy is picked up immediately, and fall
 * back to the cached shell when it can't be reached. The OAuth redirect back
 * from Home Assistant is a navigation too, but its query string is read by the
 * app after boot, so serving the cached shell for it is still correct.
 */
async function shellFirstFromNetwork(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(SHELL);
    if (cached) return cached;
    throw err;
  }
}

/** Build output is content-hashed, so a hit is never stale. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * For files whose names never change: serve the copy we have, then refresh it
 * in the background so an edited icon isn't cached forever.
 */
function staleWhileRevalidate(event) {
  const request = event.request;

  const refresh = fetch(request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  });

  return caches.match(request).then((cached) => {
    if (cached) {
      // Don't let the worker be killed mid-refresh, and don't fail the
      // response if the refresh does.
      event.waitUntil(refresh.catch(() => undefined));
      return cached;
    }
    return refresh;
  });
}
