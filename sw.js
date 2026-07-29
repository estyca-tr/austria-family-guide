const CACHE = 'austria-trip-v15';
const ASSETS = [
  './', './index.html', './styles.css?v=13', './app.js?v=13', './data.js?v=13',
  './places.js?v=13', './sync.js?v=13', './sync-config.js?v=13',
  './manifest.json', './icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isAppFile = /\.(js|css|html)(\?|$)/.test(url.pathname + url.search)
    || url.pathname.endsWith('/austria-family-guide/')
    || url.pathname.endsWith('/austria-family-guide');

  if (isAppFile) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
