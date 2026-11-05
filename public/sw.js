/* SchematicHub service worker: keeps the app shell and the last-opened drawing pages available on a weak connection.
 * - /_next/static/*       cache-first (immutable, hashed files)
 * - navigations to /schematics/*  network-first, falling back to the last copy
 * Cached pages are private: they are deleted on sign-out (see clearOffline in src/lib/offline.ts). */
const STATIC = "sh-static-v1";
const PAGES = "sh-pages";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate" && url.pathname.startsWith("/schematics/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.open(PAGES).then((c) => c.match(req))) || Response.error()),
    );
  }
});
