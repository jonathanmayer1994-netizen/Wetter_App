/**
 * BEST WEATHER — Service Worker
 * High-performance Alpine Offline PWA Cache Engine
 */

const CACHE_NAME = 'best-weather-v1.0.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './microEngine.js',
  './storage.js',
  './httpClient.js',
  './gpx.worker.js',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

// 1. Install Event: Core Assets cachen
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW Precache partielle Warnung:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate Event: Veraltete Caches aufräumen
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Intelligente Strategien
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Nur GET Requests behandeln
  if (req.method !== 'GET') return;

  // A. Wetter- & Geocoding-APIs (Open-Meteo, RainViewer): Network First mit Fallback auf Cache
  if (url.hostname.includes('open-meteo.com') || url.hostname.includes('rainviewer.com') || url.hostname.includes('openstreetmap.org')) {
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
          return new Response(JSON.stringify({ offline: true, error: 'Keine Internetverbindung im Alpingebiet' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // B. Statische App-Ressourcen: Cache First, fallback auf Network & Cache-Update
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      if (cachedRes) {
        // Im Hintergrund nach Aktualisierungen suchen (Stale-while-revalidate)
        fetch(req).then((netRes) => {
          if (netRes && netRes.status === 200) {
            caches.open(CACHE_NAME).then((c) => c.put(req, netRes));
          }
        }).catch(() => {});
        return cachedRes;
      }

      return fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      }).catch(async () => {
        // Offline-Fallback für Navigationsanfragen
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
