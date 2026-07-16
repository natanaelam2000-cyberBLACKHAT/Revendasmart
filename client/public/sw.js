const CACHE_NAME = 'revenda-smart-static-v5';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/login-reference-official.png',
  '/logo-revenda-smart-official.png',
  '/logo-revenda-smart-symbol-official.png'
];

const STATIC_CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'font', 'image', 'manifest']);

const isSameOrigin = (url) => url.origin === self.location.origin;

function isStaticAssetRequest(request, url) {
  return isSameOrigin(url) && (
    STATIC_CACHEABLE_DESTINATIONS.has(request.destination)
    || url.pathname.startsWith('/assets/')
    || url.pathname === '/login-reference-official.png'
    || url.pathname === '/logo-revenda-smart-official.png'
    || url.pathname === '/logo-revenda-smart-symbol-official.png'
  );
}

async function cacheFirstStaticAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (!isSameOrigin(requestUrl)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (isStaticAssetRequest(request, requestUrl)) {
    event.respondWith(cacheFirstStaticAsset(request));
  }
});
