/* ============================================================
   Service Worker - Insopesca El Morro (v2.0.1)
   ============================================================ */

const CACHE_VERSION = 'v2.0.1';
const SHELL_CACHE   = 'insopesca-shell-'   + CACHE_VERSION;
const RUNTIME_CACHE = 'insopesca-runtime-' + CACHE_VERSION;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './users.json',
  './js/config.js',
  './js/db.js',
  './js/identity.js',
  './js/rooms.js',
  './js/admin.js',
  './js/balance.js',
  './js/backup.js',
  './js/sync.js',
  './js/app.js'
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'esm.sh'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] install failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
        .map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isCDN(url) {
  return CDN_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
}
function isUsersJson(req, url) {
  return url.pathname.endsWith('/users.json') || url.pathname === '/users.json';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && isUsersJson(req, url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res && res.ok) { cache.put(req, res.clone()); return res; }
        throw new Error('HTTP ' + res.status);
      } catch (err) {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response(JSON.stringify({
          version: 1, updated: new Date().toISOString(),
          adminWhatsApp: '+584262840546', adminId: '4M4N3C3R',
          rooms: ['El Morro', 'Guaca', 'La Esmeralda'],
          users: []
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  if (isCDN(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })());
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(req, copy));
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  if (sameOrigin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(req, copy));
        }
        return res;
      } catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }

  event.respondWith(
    fetch(req).catch(() => caches.match(req).then(r => r || new Response('', { status: 504 })))
  );
});