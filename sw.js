/**
 * BEST WEATHER — Service Worker v2.25.2
 * Enterprise-Grade Alpine Offline PWA Cache Engine
 * Features:
 * - CDN Edge & iOS NSURLCache bypass on deploy token change (GitHub Pages max-age=600 fix)
 * - Network-First for code/markup with instant offline CacheStorage fallback
 * - Bounded 600-tile map cache
 */

const SW_URL = new URL(self.location.href);
const DEPLOY_TOKEN = SW_URL.searchParams.get('v') || 'v2.25.2';
const CACHE_NAME = `best-weather-v2.25.2-${DEPLOY_TOKEN}`;
const TILE_CACHE_NAME = 'best-weather-tiles-v2.1';
const MAX_TILES = 600;

let activeBustToken = DEPLOY_TOKEN;

const STATIC_ASSETS = [
  './',
  './index.html',
  './version.json',
  './style.css',
  './css/01_variables.css',
  './css/02_base.css',
  './css/03_overview.css',
  './css/04_mountain.css',
  './css/05_verification.css',
  './css/06_map.css',
  './css/07_sports.css',
  './css/08_responsive.css',
  './app.js',
  './microEngine.js',
  './storage.js',
  './httpClient.js',
  './gpx.worker.js',
  './background.worker.js',
  './physics.worker.js',
  './core/appUpdater.js',
  './core/dispatcher.js',
  './core/state.js',
  './core/constants.js',
  './core/contracts.js',
  './core/googleSheetsSync.js',
  './core/backgroundCanvas.js',
  './core/weatherTourCache.js',
  './core/physicsBridge.js',
  './core/verificationStore.js',
  './core/actualEngine.js',
  './features/meteogram/meteogramCanvas.js',
  './features/overview.js',
  './features/mountain.js',
  './features/sports.js',
  './features/map.js',
  './features/search.js',
  './features/favorites.js',
  './features/networks.js',
  './features/verificationUI.js',
  './features/bentoSheets.js',
  './features/pullToRefresh.js',
  './manifest.json',
  './logo.png',
  './apple-touch-icon.png',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

const CORE_PRECACHE_ASSETS = [
  './',
  './index.html',
  './version.json',
  './style.css',
  './app.js',
  './core/appUpdater.js',
  './manifest.json',
  './logo.png'
];

function appendBustParam(rawUrl, key, value) {
  try {
    const u = new URL(rawUrl, self.location.href);
    if (u.origin !== self.location.origin) return rawUrl;
    u.searchParams.set(key, value);
    return u.toString();
  } catch (_) {
    return rawUrl;
  }
}

async function putTileCacheWithQuota(req, res) {
  try {
    const cache = await caches.open(TILE_CACHE_NAME);
    await cache.put(req, res);
    const keys = await cache.keys();
    if (keys.length > MAX_TILES) {
      const deleteCount = keys.length - MAX_TILES;
      for (let i = 0; i < deleteCount; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (_) { }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 4500) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(url, ctrl ? { ...opts, signal: ctrl.signal } : opts);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function precacheAssetList(urls) {
  const cache = await caches.open(CACHE_NAME);
  for (let i = 0; i < urls.length; i += 2) {
    const chunk = urls.slice(i, i + 2);
    await Promise.allSettled(
      chunk.map(async (asset) => {
        try {
          const isLocal = !asset.startsWith('http');
          const fetchUrl = isLocal ? appendBustParam(asset, '_sw', activeBustToken) : asset;
          const reqInit = isLocal ? { cache: 'no-store' } : {};
          const res = await fetchWithTimeout(fetchUrl, reqInit, 4500);
          if (res && res.status === 200) {
            await cache.put(asset, res);
          }
        } catch (err) {
          console.warn('[ServiceWorker] Precache Notice:', asset, err);
        }
      })
    );
  }
}

async function precacheFreshAssets() {
  await precacheAssetList(CORE_PRECACHE_ASSETS);
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.token) {
    activeBustToken = String(data.token);
  }
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (data.type === 'FORCE_REVALIDATE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(
        keys
          .filter((k) => k !== TILE_CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
    );
  }
});

// 1. Install Event: Precache All Essential Assets bypassing CDN max-age=600
self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheFreshAssets().then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean Out Deprecated Caches, Claim Clients & Warm Remaining Cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== TILE_CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()).then(() => {
      // Warm remaining offline assets in background without delaying SW activation or saturating sockets
      const remaining = STATIC_ASSETS.filter((a) => !CORE_PRECACHE_ASSETS.includes(a));
      setTimeout(() => {
        precacheAssetList(remaining).catch(() => {});
      }, 600);
    })
  );
});

// 3. Fetch Event: Direct Origin Bypass on Cache-Busted Probes + Network-First Code/Markup
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' && req.method !== 'HEAD') return;

  const isSameOrigin = url.origin === self.location.origin;

  // Explicit update-checker probes (_bw_cb=...) always bypass CacheStorage cleanly
  if (isSameOrigin && url.searchParams.has('_bw_cb')) {
    event.respondWith(fetch(new Request(req, { cache: 'no-store' })));
    return;
  }

  if (req.method !== 'GET') return;

  const isMapTile =
    url.hostname.includes('cartocdn.com') ||
    url.hostname.includes('opentopomap.org') ||
    url.hostname.includes('arcgisonline.com') ||
    (url.hostname.includes('rainviewer.com') && !url.pathname.endsWith('.json'));

  const isMeteorologicalAPI =
    url.hostname.includes('open-meteo.com') ||
    (url.hostname.includes('rainviewer.com') && url.pathname.endsWith('.json'));

  // A1. Map Tiles: Bounded Tile Cache with Quota Management
  if (isMapTile) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            putTileCacheWithQuota(req, clone);
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          return new Response(null, { status: 504, statusText: 'Offline Tile Not Cached' });
        })
    );
    return;
  }

  // A2. Meteorological APIs: Network First with Instant Cache Fallback & JSON Error
  if (isMeteorologicalAPI) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          return new Response(JSON.stringify({ offline: true, error: 'Offline im Alpingebiet (Kein Netzempfang)' }), {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // B. Same-Origin App Shell, HTML, JS & CSS: Network-First mit CDN-Token-Bypass & Offline-Fallback
  const isCodeOrMarkup = isSameOrigin && (
    req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json')
  );

  if (isCodeOrMarkup) {
    const bustUrl = appendBustParam(req.url, '_sw', activeBustToken);
    event.respondWith(
      fetch(bustUrl, { cache: 'no-store' })
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(async () => {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          if (req.mode === 'navigate') {
            const indexFallback = await caches.match('./index.html', { ignoreSearch: true });
            if (indexFallback) return indexFallback;
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // C. Statische Medien, Icons, Fonts & CDN-Assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cachedRes) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(async () => {
          if (cachedRes) return cachedRes;
          if (req.destination === 'image' || url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg') || url.pathname.endsWith('.ico')) {
            const imgFallback = await caches.match('./apple-touch-icon.png', { ignoreSearch: true });
            if (imgFallback) return imgFallback;
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });

      return cachedRes || fetchPromise;
    })
  );
});
