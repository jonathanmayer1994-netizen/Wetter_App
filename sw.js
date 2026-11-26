/**
 * BEST WEATHER — Service Worker v2.29.0
 * Enterprise-Grade Alpine Offline PWA Cache Engine
 * Features:
 * - Native Web Push Notifications (iOS 16.4+ APNs & macOS Notification Center)
 * - CDN Edge & iOS NSURLCache bypass on deploy token change (GitHub Pages max-age=600 fix)
 * - Network-First for code/markup with instant offline CacheStorage fallback
 * - Bounded 600-tile map cache
 */

const SW_URL = new URL(self.location.href);
const DEPLOY_TOKEN = SW_URL.searchParams.get('v') || 'v2.44.0';
const CACHE_NAME = `best-weather-v2.44.0-${DEPLOY_TOKEN}`;
const TILE_CACHE_NAME = 'best-weather-tiles-v2.2';
const MAX_TILES = 600;

let activeBustToken = DEPLOY_TOKEN;

const STATIC_ASSETS = [
  './',
  './index.html',
  './version.json',
  './style.css',
  './app.js',
  './microEngine.js',
  './storage.js',
  './httpClient.js',
  './gpx.worker.js',
  './background.worker.js',
  './physics.worker.js',
  './core/telemetryEngine.js',
  './core/domUtils.js',
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
  './core/solarEngine.js',
  './core/scrollOptimizer.js',
  './features/meteogram/meteogramCanvas.js',
  './features/overview.js',
  './features/mountain.js',
  './features/sports.js',
  './features/map.js',
  './features/mapSolar.js',
  './features/search.js',
  './features/favorites.js',
  './features/networks.js',
  './features/verificationUI.js',
  './features/bentoSheets.js',
  './features/pullToRefresh.js',
  './features/notifications.js',
  './features/notification-store.js',
  './manifest.json',
  './logo.png',
  './apple-touch-icon.png',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

const CORE_PRECACHE_ASSETS = [
  './',
  './index.html',
  './version.json',
  './style.css',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './app.js',
  './core/domUtils.js',
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
            return;
          }
        } catch (err) {
          console.warn('[ServiceWorker] Precache Notice:', asset, err);
        }
        // Rettung aus vorhandenem Cache falls Update bei schlechtem Empfang erfolgt
        try {
          const legacyCached = await caches.match(asset, { ignoreSearch: true });
          if (legacyCached && legacyCached.status === 200) {
            await cache.put(asset, legacyCached.clone());
          }
        } catch (_) { }
      })
    );
  }
}

function createOfflineFallbackPageResponse() {
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0b1329">
  <title>Best Weather – Aktuell keine Verbindung</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: max(24px, env(safe-area-inset-top, 24px)) 20px max(24px, env(safe-area-inset-bottom, 24px));
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif;
      color: #f8fafc;
      background: radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.18), transparent 55%),
                  linear-gradient(180deg, #0b1329 0%, #0f1c2e 55%, #09111e 100%);
    }
    .offline-card {
      width: 100%;
      max-width: 420px;
      padding: 30px 24px;
      border-radius: 26px;
      background: rgba(15, 23, 42, 0.82);
      border: 1px solid rgba(148, 163, 184, 0.24);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }
    .offline-icon {
      width: 64px;
      height: 64px;
      border-radius: 20px;
      display: grid;
      place-items: center;
      font-size: 32px;
      background: rgba(56, 189, 248, 0.14);
      border: 1px solid rgba(56, 189, 248, 0.35);
      box-shadow: 0 8px 24px rgba(56, 189, 248, 0.18);
    }
    .offline-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.2px;
      color: #fde68a;
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.35);
    }
    h1 {
      font-size: 20px;
      line-height: 1.28;
      font-weight: 750;
      color: #ffffff;
    }
    p {
      font-size: 14px;
      line-height: 1.5;
      color: #cbd5e1;
      max-width: 34ch;
    }
    .offline-btn {
      margin-top: 6px;
      width: 100%;
      padding: 13px 18px;
      border: none;
      border-radius: 14px;
      font-family: inherit;
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
      box-shadow: 0 8px 20px rgba(37, 99, 235, 0.35);
      cursor: pointer;
    }
    .offline-btn:active { transform: scale(0.98); }
    .offline-hint {
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <main class="offline-card" role="alert">
    <div class="offline-icon" aria-hidden="true">📡</div>
    <span class="offline-pill">Schlechter Empfang oder Offline</span>
    <h1>Aktuell können die Daten nicht geladen werden</h1>
    <p>Die Verbindung ist momentan zu schwach oder unterbrochen. Bitte prüfe dein Netz und versuche es erneut.</p>
    <button type="button" class="offline-btn" onclick="window.location.reload()">🔄 Erneut laden</button>
    <div class="offline-hint" id="offline-auto-hint">Lädt automatisch neu, sobald wieder Empfang besteht.</div>
  </main>
  <script>
    window.addEventListener('online', function () {
      var hint = document.getElementById('offline-auto-hint');
      if (hint) hint.textContent = 'Empfang wiederhergestellt – lade App neu...';
      window.location.reload();
    });
  </script>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
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
        precacheAssetList(remaining).catch(() => { });
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

  // A2. Meteorological APIs: Fast-Race Network (max 2.5s) mit Instant-Cache-Fallback & JSON-Error
  if (isMeteorologicalAPI) {
    const raceApi = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('SW_API_TIMEOUT_FAST_RACE'));
        }
      }, 2500);

      fetch(req)
        .then((networkRes) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            if (networkRes && networkRes.status === 200) {
              const clone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            resolve(networkRes);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
    });

    event.respondWith(
      raceApi.catch(async () => {
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

  // B. Same-Origin App Shell, HTML, JS & CSS: Fast-Race Network (max 1.2s) mit Instant-Cache-Fallback
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
    const networkFetchPromise = fetch(bustUrl, { cache: 'no-store' }).then((networkRes) => {
      if (networkRes && networkRes.status === 200) {
        const clone = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
      }
      return networkRes;
    });

    // Fast-Race Promise: Max. 1200ms Timeout bei instabilem Netz / Funkloch wenn Cache existiert
    const raceNetwork = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('SW_NETWORK_TIMEOUT_FAST_RACE'));
        }
      }, 1200);

      networkFetchPromise
        .then((networkRes) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(networkRes);
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        });
    });

    event.respondWith(
      raceNetwork.catch(async (raceErr) => {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const indexFallback = await caches.match('./index.html', { ignoreSearch: true });
          if (indexFallback) return indexFallback;
        }
        // Kein Cache vorhanden: Bei bloßem 1.2s-Timeout langsamen Empfang bis 6.5s abwarten statt voreilig abzubrechen
        if (raceErr && raceErr.message === 'SW_NETWORK_TIMEOUT_FAST_RACE') {
          try {
            const slowRes = await Promise.race([
              networkFetchPromise,
              new Promise((_, rej) => setTimeout(() => rej(new Error('SW_SLOW_NETWORK_TIMEOUT')), 6500))
            ]);
            if (slowRes) return slowRes;
          } catch (_) { }
        }
        const acceptsHtml = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/') || (req.headers.get('accept') || '').includes('text/html');
        if (acceptsHtml) {
          return createOfflineFallbackPageResponse();
        }
        return new Response('', { status: 503, statusText: 'Service Unavailable' });
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
          if (req.mode === 'navigate') {
            return createOfflineFallbackPageResponse();
          }
          return new Response('', { status: 503, statusText: 'Service Unavailable' });
        });

      return cachedRes || fetchPromise;
    })
  );
});

// =============================================================================
// NATIVE PUSH NOTIFICATION STORAGE (IndexedDB 24h Retention in Service Worker)
// =============================================================================
const NOTIF_IDB_NAME = 'best-weather-db';
const NOTIF_IDB_STORE = 'notifications';
const NOTIF_RETENTION_MS = 24 * 60 * 60 * 1000;
let _swNotifDbPromise = null;

function getSwNotifDB() {
  if (_swNotifDbPromise) return _swNotifDbPromise;
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  _swNotifDbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(NOTIF_IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(NOTIF_IDB_STORE)) {
          const store = db.createObjectStore(NOTIF_IDB_STORE, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('read', 'read', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        db.onversionchange = () => {
          try { db.close(); } catch (_) {}
          _swNotifDbPromise = null;
        };
        db.onclose = () => {
          _swNotifDbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        _swNotifDbPromise = null;
        resolve(null);
      };
    } catch (_) {
      _swNotifDbPromise = null;
      resolve(null);
    }
  });
  return _swNotifDbPromise;
}

async function getNotifFromIndexedDB(id) {
  if (!id) return null;
  const db = await getSwNotifDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(NOTIF_IDB_STORE)) return resolve(null);
      const tx = db.transaction([NOTIF_IDB_STORE], 'readonly');
      const store = tx.objectStore(NOTIF_IDB_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

async function saveNotifToIndexedDB(record) {
  const db = await getSwNotifDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([NOTIF_IDB_STORE], 'readwrite');
      const store = tx.objectStore(NOTIF_IDB_STORE);
      const getReq = store.get(record.id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (existing && existing.read) {
          record.read = true;
        }
        store.put(record);
      };
      getReq.onerror = () => {
        store.put(record);
      };
      const index = store.index('timestamp');
      const cutoff = Date.now() - NOTIF_RETENTION_MS;
      const range = IDBKeyRange.upperBound(cutoff);
      const curReq = index.openCursor(range);
      curReq.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (_) {
      resolve();
    }
  });
}

async function markNotifReadInIndexedDB(id) {
  if (!id) return;
  const db = await getSwNotifDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([NOTIF_IDB_STORE], 'readwrite');
      const store = tx.objectStore(NOTIF_IDB_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.read = true;
          store.put(item);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch (_) {
      resolve();
    }
  });
}

// =============================================================================
// NATIVE WEB PUSH NOTIFICATIONS (iOS 16.4+ APNs & macOS Notification Center)
// =============================================================================

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      try {
        payload = { title: 'Best Weather', body: event.data.text() };
      } catch (_) {
        payload = { title: 'Best Weather', body: 'Neue Wetteraktualisierung' };
      }
    }
  } else {
    payload = { title: 'Best Weather', body: 'Wetteraktualisierung verfügbar' };
  }

  const title = String(payload.title || 'Best Weather');
  const body = String(payload.body || 'Neue Wetterdaten verfügbar');
  const tag = String(payload.tag || 'best-weather-alert');
  const notifType = payload.type || payload.data?.type || (tag.includes('briefing') ? 'briefing' : tag.includes('storm') ? 'storm' : tag.includes('frost') ? 'frost' : tag.includes('extreme') ? 'extreme' : 'alert');
  const isBriefing = notifType === 'briefing' || tag.includes('briefing');
  const notifId = payload.id || (isBriefing && tag ? tag : `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  // Prüfe Plattform: iOS WebKit nutzt für Web-Clip-PWA-Benachrichtigungen automatisch das Homescreen-Icon.
  // Das Übergeben von externen/relativen Bild-URLs während des Reconnect-Fensters aus dem Flugmodus
  // kann dazu führen, dass WebKit die Anzeige abbricht, wenn der Netzwerk-Stack noch initialisiert.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const baseUrl = self.registration?.scope || self.location?.origin || '';
  const iconUrl = (!isIOS && payload.icon)
    ? (payload.icon.startsWith('http') ? payload.icon : (baseUrl ? new URL(payload.icon, baseUrl).href : payload.icon))
    : (!isIOS ? (baseUrl ? new URL('icon-192.png', baseUrl).href : './icon-192.png') : undefined);
  const badgeUrl = (!isIOS && payload.badge)
    ? (payload.badge.startsWith('http') ? payload.badge : (baseUrl ? new URL(payload.badge, baseUrl).href : payload.badge))
    : (!isIOS ? (baseUrl ? new URL('favicon.png', baseUrl).href : './favicon.png') : undefined);

  const notifRecord = {
    id: notifId,
    title,
    body,
    icon: iconUrl || './icon-192.png',
    badge: badgeUrl || './favicon.png',
    tag,
    type: notifType,
    data: {
      url: payload.data?.url || './',
      tab: payload.data?.tab || 'tab-overview',
      id: notifId,
      ...payload.data
    },
    timestamp: Date.now(),
    read: false
  };

  // 100% robuste iOS WebKit- & APNs-kompatible NotificationOptions:
  // - tag: notifId garantiert, dass iOS Notification Center JEDE Meldung mind. 24h vorhält und NIE überschreibt
  // - renotify: true weckt das Display und signalisiert aktiv
  // - Keine actions auf iOS (iOS WebKit unterstützt keine Web Clip Action-Buttons)
  const notificationOptions = {
    body,
    tag: notifId,
    renotify: true,
    data: notifRecord.data
  };

  if (iconUrl) notificationOptions.icon = iconUrl;
  if (badgeUrl) notificationOptions.badge = badgeUrl;

  // Actions NUR hinzufügen, wenn die Plattform dies nach W3C-Standard unterstützt (Notification.maxActions > 0)
  // Auf iOS WebKit ist Notification.maxActions === 0!
  if (typeof Notification !== 'undefined' && Notification.maxActions && Notification.maxActions > 0) {
    if (Array.isArray(payload.actions) && payload.actions.length > 0) {
      notificationOptions.actions = payload.actions.slice(0, Notification.maxActions);
    }
  }

  // Wichtig für Apple APNs / iOS: showNotification() MUSS zuverlässig und sofort auflösen,
  // unabhängig von IndexedDB-Locks beim Reconnect
  event.waitUntil(
    (async () => {
      // 1. Tagesbericht-Unterdrückung: Wurde der Tagesbericht für heute bereits empfangen und
      // vom Nutzer als GELESEN markiert, wird keine weitere Notification im Sperrbildschirm erzeugt!
      if (isBriefing) {
        try {
          const existing = await getNotifFromIndexedDB(notifId);
          if (existing && existing.read) {
            console.log(`[SW] Tagesbericht ${notifId} wurde vom Nutzer bereits gelesen — erneute Push-Anzeige unterdrückt.`);
            return;
          }
        } catch (_) { }
      }

      // 2. ZUERST sofortige Anzeige im Sperrbildschirm & Notification Center
      try {
        await self.registration.showNotification(title, notificationOptions);
      } catch (err) {
        console.warn('showNotification mit primären Optionen fehlgeschlagen, starte ultra-minimalen Fallback:', err);
        try {
          await self.registration.showNotification(title, {
            body,
            tag: notifId,
            renotify: true,
            data: notificationOptions.data
          });
        } catch (_) { }
      }

      // 2. Parallel in IndexedDB für In-App Feed speichern & iOS App Badge setzen
      try {
        await saveNotifToIndexedDB(notifRecord);
      } catch (err) {
        console.warn('saveNotifToIndexedDB failed:', err);
      }

      if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
        navigator.setAppBadge().catch(() => { });
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const notifData = event.notification.data || {};
  const notifId = notifData.id || '';
  const targetTab = notifData.tab || 'tab-overview';
  const targetUrl = notifData.url || './index.html';

  if (notifId) {
    markNotifReadInIndexedDB(notifId);
  }

  if (typeof navigator !== 'undefined' && 'clearAppBadge' in navigator) {
    navigator.clearAppBadge().catch(() => { });
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Prüfen, ob bereits ein Best Weather Tab/PWA-Fenster offen ist
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_OPENED',
            tab: targetTab,
            notifId: notifId,
            data: notifData
          });
          return client.focus();
        }
      }
      // Wenn noch kein Fenster offen ist, Standalone-PWA mit Deep-Link Query Param öffnen
      if (clients.openWindow) {
        const fullUrl = `${targetUrl}?openNotif=1${notifId ? `&notifId=${encodeURIComponent(notifId)}` : ''}`;
        return clients.openWindow(fullUrl);
      }
    })
  );
});

self.addEventListener('notificationclose', (event) => {
  // Verworfen
});

