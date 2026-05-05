/* Verses service worker — minimal offline shell.
 * Strategy:
 *   - HTML pages: network-first with cache fallback (so users always get fresh
 *     deploys but can open the editor when offline).
 *   - Static assets (JS/CSS/images/fonts): stale-while-revalidate.
 *   - Datamuse, YouTube, Supabase, Google fonts: pass straight through.
 */
const VERSION = "verses-v1";
const HTML_CACHE = `${VERSION}-html`;
const ASSET_CACHE = `${VERSION}-assets`;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

const PASSTHROUGH = [
  "api.datamuse.com",
  "www.youtube.com",
  "www.youtube-nocookie.com",
  "i.ytimg.com",
  "fonts.gstatic.com",
  "fonts.googleapis.com",
  "supabase.co",
];

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (PASSTHROUGH.some((host) => url.hostname.endsWith(host))) return;
  if (url.pathname.startsWith("/auth/")) return;
  if (url.pathname === "/sw.js") return;

  const accept = req.headers.get("accept") || "";
  const isHTML =
    req.mode === "navigate" || accept.includes("text/html");

  if (isHTML) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(HTML_CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const fallback = await caches.match("/app");
          if (fallback) return fallback;
          return new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })()
  );
});
