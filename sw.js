/* Network-first: always fetch fresh app files. No stale precache. */
const VERSION = 'austria-trip-v20';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase.co')) return;

  const sameOrigin = url.origin === self.location.origin;
  const isShell = sameOrigin && (
    url.pathname.endsWith('.html')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/austria-family-guide')
    || url.pathname.endsWith('/austria-family-guide/')
  );

  if (!isShell) return;

  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
  );
});
