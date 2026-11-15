// LEGO Stock Market service worker.
// Caches static assets only. Pages and market data always come from the network so a cached
// price is never shown as live; when offline, the user gets a clear offline message.
const CACHE = "lsm-static-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(["/manifest.webmanifest", "/icons/icon-192.png"])),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          }),
      ),
    );
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(
        () =>
          new Response(
            "<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:system-ui;padding:2rem'><h1>You're offline</h1><p>LEGO Stock Market needs a connection to show current BrickLink prices.</p>",
            { headers: { "content-type": "text/html" } },
          ),
      ),
    );
  }
});
