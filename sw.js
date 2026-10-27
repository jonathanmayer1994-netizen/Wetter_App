/**
 * BEST WEATHER — Service Worker v2.0 (Task 5a)
 * Enterprise-Grade Alpine Offline PWA Cache Engine
 * Features: Leaflet precaching, Worker precaching, Stale-While-Revalidate,
 * and high-altitude offline fallbacks when off-grid in the Alps.
 */

const CACHE_NAME = 'best-weather-v2.3.2-alpine-hours';
const TILE_CACHE_NAME = 'best-weather-tiles-v2.0';
const MAX_TILES = 120;

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './microEngine.js',
  './storage.js',
  './httpClient.js',
  './gpx.worker.js',
  './background.worker.js',
  './physics.worker.js',
  './core/dispatcher.js',
  './core/state.js',
  './core/constants.js',
  './core/contracts.js',
  './core/backgroundCanvas.js',
  './core/weatherTourCache.js',
  './core/physicsBridge.js',
  './features/meteogram/meteogramCanvas.js',
  './features/overview.js',
  './features/mountain.js',
  './features/sports.js',
  './features/map.js',
  './features/search.js',
  './features/favorites.js',
  './features/networks.js',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

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
  } catch (_) {}
}

// 1. Install Event: Precache All Essential Alpine Assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Partial Precache Notice:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Clean Out Deprecated Caches
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
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Stale-While-Revalidate & Resilient Offline Fallbacks
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

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
          const cached = await caches.match(req);
          if (cached) return cached;
          // Liefert bei fehlender Kachel kein JSON (verhindert Bild-Dekodierungsfehler)
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
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // B. Core App Assets: Network First, with Instant Cache Fallback for Offline Alpine Use
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
        const cachedRes = await caches.match(req);
        if (cachedRes) return cachedRes;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
