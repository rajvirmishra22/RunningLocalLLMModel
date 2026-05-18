// Minimal service worker so the site qualifies as an installable PWA.
// Network-first; cache shell on install for basic offline support.
const CACHE = "localmodel-shell-v2";
// Precache the shell of BOTH artifacts (landing + app) so the installed PWA
// can launch offline even if the user installs from / without first visiting /app/.
const SHELL = [
  "/",
  "/app/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/pwa-192.png",
  "/pwa-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle same-origin GETs for HTML/asset shell. Let everything else (model CDN, etc.) pass through untouched.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (req.destination === "document" || SHELL.includes(url.pathname))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Navigation fallback: if the user is offline and requests an app shell
        // page we haven't cached individually, serve the closest precached entry.
        if (req.mode === "navigate") {
          const fallback = url.pathname.startsWith("/app/")
            ? await caches.match("/app/")
            : await caches.match("/");
          if (fallback) return fallback;
        }
        return Response.error();
      })
  );
});
