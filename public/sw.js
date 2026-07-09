/* Service worker — Ṣalawāt. Ne met JAMAIS l'API en cache (données personnelles). */
const CACHE = 'salawat-v4';
const ASSETS = ['/', '/style.css', '/app.js', '/salawat.js', '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // scripts Google, polices...
  if (url.pathname.startsWith('/api/')) return;    // jamais de cache pour les données
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((rr) => {
      const cp = rr.clone();
      caches.open(CACHE).then((c) => c.put(e.request, cp));
      return rr;
    }))
  );
});
