/*
 * 零环 service worker — a small network-first runtime cache so the installed PWA
 * keeps working offline after the first visit. No build-time manifest needed:
 * responses are cached as they are fetched; on failure we fall back to the cache.
 */
const CACHE = 'zero-ring-v16';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res && res.status === 200 && res.type === 'basic') {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html');
      }
    })(),
  );
});
