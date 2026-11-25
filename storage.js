/**
 * BEST WEATHER — IndexedDB Alpine Storage Engine (Task 7a)
 * Features Debounced Write Queue, separation of static GPX text vs. dynamic timeline,
 * and high-capacity offline storage with graceful fallback.
 */

const DB_NAME = 'BestWeatherAlpineDB';
const DB_VERSION = 3;

let dbPromise = null;
let debouncedTourTimer = null;
let pendingTourSave = null;
let pendingResolvers = [];

function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      dbPromise = null;
      return reject(new Error('IndexedDB not supported'));
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tours')) {
        db.createObjectStore('tours', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('gpx_raw')) {
        db.createObjectStore('gpx_raw', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('weather')) {
        db.createObjectStore('weather', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('device_favorites')) {
        db.createObjectStore('device_favorites', { keyPath: 'deviceId' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null; // Rejection nicht permanent cachen
      reject(req.error);
    };
  });

  return dbPromise;
}

function getTodayLocalDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isWeatherCacheValidForToday(entry, maxAgeMs = 48 * 60 * 60 * 1000) {
  if (!entry || !entry.weatherData) return false;
  const ts = Number(entry.timestamp) || 0;
  if (ts > 0 && (Date.now() - ts) > maxAgeMs) return false;
  const times = entry.weatherData?.daily?.time;
  if (Array.isArray(times) && times.length > 0) {
    const todayKey = getTodayLocalDateKey();
    const lastKey = String(times[times.length - 1] || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(lastKey) && lastKey < todayKey) {
      return false;
    }
  }
  return true;
}

export const AlpineStorage = {
  /**
   * Debounced Queue zum Speichern einer Tour (verhindert I/O-Spikes und Promise-Leaks)
   */
  queueSaveTour(tour, delayMs = 600) {
    pendingTourSave = tour;
    if (debouncedTourTimer) clearTimeout(debouncedTourTimer);

    return new Promise((resolve) => {
      pendingResolvers.push(resolve);

      debouncedTourTimer = setTimeout(async () => {
        debouncedTourTimer = null;
        const resolvers = [...pendingResolvers];
        pendingResolvers = [];

        try {
          if (pendingTourSave) {
            const res = await this.saveTour(pendingTourSave);
            pendingTourSave = null;
            resolvers.forEach((r) => r(res));
          } else {
            resolvers.forEach((r) => r(true));
          }
        } catch (err) {
          resolvers.forEach((r) => r(false));
        }
      }, delayMs);
    });
  },

  /**
   * Speichert eine GPX-Tour sicher mit Trennung von Roh-XML und dynamischer Timeline
   */
  async saveTour(tour) {
    const tourId = tour.id || 'current_tour';

    // 1. Wenn Roh-XML vorhanden ist, separat in 'gpx_raw' ablegen (nur 1x nötig)
    if (tour.gpxXml) {
      try {
        const db = await getDB();
        await new Promise((res) => {
          const tx = db.transaction('gpx_raw', 'readwrite');
          tx.objectStore('gpx_raw').put({ id: tourId, xml: tour.gpxXml, timestamp: Date.now() });
          tx.oncomplete = () => res(true);
          tx.onerror = () => res(false);
        });
      } catch (_) {}
    }

    // 2. Schlankes Tour-Objekt (ohne redundanten Riesenstring) in 'tours' ablegen
    const lightweightTour = {
      ...tour,
      id: tourId,
      gpxXml: null, // abgetrennt für blitzschnelle Schreiboperationen
      hasRawGpx: Boolean(tour.gpxXml)
    };

    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('tours', 'readwrite');
        const store = tx.objectStore('tours');
        store.put(lightweightTour);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      // Fallback auf LocalStorage mit Quota-Schutz
      try {
        const key = `tour_${tourId}`;
        const miniTour = {
          ...lightweightTour,
          parsedGPX: tour.parsedGPX ? { ...tour.parsedGPX, points: (tour.parsedGPX.points || []).slice(0, 100) } : null
        };
        localStorage.setItem(key, JSON.stringify(miniTour));
      } catch (lsErr) {
        console.warn('Storage Fallback Quota Error:', lsErr);
      }
      return false;
    }
  },

  /**
   * Lädt eine Tour aus IndexedDB und führt Roh-XML und Timeline wieder zusammen
   */
  async getTour(id = 'current_tour') {
    try {
      const db = await getDB();
      const tour = await new Promise((resolve, reject) => {
        const tx = db.transaction('tours', 'readonly');
        const store = tx.objectStore('tours');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });

      if (!tour) return null;

      // Roh-XML bei Bedarf nachladen
      if (!tour.gpxXml) {
        try {
          const rawEntry = await new Promise((res) => {
            const tx = db.transaction('gpx_raw', 'readonly');
            const req = tx.objectStore('gpx_raw').get(id);
            req.onsuccess = () => res(req.result || null);
            req.onerror = () => res(null);
          });
          if (rawEntry && rawEntry.xml) {
            tour.gpxXml = rawEntry.xml;
          }
        } catch (_) {}
      }

      return tour;
    } catch (e) {
      try {
        const raw = localStorage.getItem(`tour_${id}`);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    }
  },

  /**
   * Speichert Wetterdaten für Offline-Nutzung
   */
  async saveWeatherCache(loc, weatherData, microData) {
    const payload = {
      id: `${loc.lat.toFixed(3)}_${loc.lon.toFixed(3)}`,
      locName: loc.name,
      loc,
      weatherData,
      microData,
      timestamp: Date.now()
    };

    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('weather', 'readwrite');
        tx.objectStore('weather').put(payload);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      try {
        localStorage.setItem('alpine_offline_weather', JSON.stringify({
          locName: loc.name,
          timestamp: payload.timestamp,
          weatherData,
          microData
        }));
      } catch (err) {}
      return false;
    }
  },

  /**
   * Holt die gecachten Wetterdaten (bevorzugt passend zum Standort, niemals komplett abgelaufene Vergangenheits-Snapshots).
   * Bei strictMatch=true und gesetztem locKey werden bei Cache-Miss KEINE fremden Standorte zurückgegeben.
   */
  async getCachedWeather(locKey = null, { strictMatch = false } = {}) {
    const fallbackLocal = () => {
      try {
        const raw = localStorage.getItem('alpine_offline_weather');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!isWeatherCacheValidForToday(parsed)) {
          try { localStorage.removeItem('alpine_offline_weather'); } catch (_) {}
          return null;
        }
        if (strictMatch && locKey && parsed?.id && parsed.id !== locKey) {
          return null;
        }
        return parsed;
      } catch (err) {
        return null;
      }
    };

    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('weather', 'readwrite');
        const store = tx.objectStore('weather');
        if (locKey) {
          const req = store.get(locKey);
          req.onsuccess = () => {
            if (req.result) {
              if (isWeatherCacheValidForToday(req.result)) {
                resolve(req.result);
                return;
              }
              try { store.delete(req.result.id); } catch (_) {}
            }
            if (strictMatch) {
              resolve(fallbackLocal());
              return;
            }
            // Fallback: zeitlich neuesten GÜLTIGEN Eintrag wählen (ohne abgelaufene Altlasten)
            let newest = null;
            const cReq = store.openCursor();
            cReq.onsuccess = (ev) => {
              const cursor = ev.target.result;
              if (cursor) {
                const val = cursor.value;
                if (!isWeatherCacheValidForToday(val)) {
                  try { cursor.delete(); } catch (_) {}
                } else if (!newest || (val?.timestamp || 0) > (newest?.timestamp || 0)) {
                  newest = val;
                }
                cursor.continue();
              } else {
                resolve(newest || fallbackLocal());
              }
            };
            cReq.onerror = () => resolve(fallbackLocal());
          };
          req.onerror = () => resolve(fallbackLocal());
        } else {
          let newest = null;
          const req = store.openCursor();
          req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
              const val = cursor.value;
              if (!isWeatherCacheValidForToday(val)) {
                try { cursor.delete(); } catch (_) {}
              } else if (!newest || (val?.timestamp || 0) > (newest?.timestamp || 0)) {
                newest = val;
              }
              cursor.continue();
            } else {
              resolve(newest || fallbackLocal());
            }
          };
          req.onerror = () => resolve(fallbackLocal());
        }
      });
    } catch (e) {
      return fallbackLocal();
    }
  },

  /**
   * Sicheres Setzen in LocalStorage
   */
  safeSetItem(key, value) {
    try {
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`LocalStorage write blocked (${key}):`, e);
      return false;
    }
  },

  /**
   * Sicheres Lesen aus LocalStorage
   */
  safeGetItem(key, defaultVal = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultVal;
      try {
        return JSON.parse(raw);
      } catch (err) {
        return raw;
      }
    } catch (e) {
      return defaultVal;
    }
  },

  /**
   * Sicheres Löschen aus LocalStorage
   */
  safeRemoveItem(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.warn(`LocalStorage remove blocked (${key}):`, e);
      return false;
    }
  },

  /**
   * Persistiert Metadaten zusätzlich in IndexedDB (überlebt Safari/PWA Session-Resets)
   */
  async setMeta(key, value) {
    this.safeSetItem(key, value);
    try {
      const db = await getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key, value, timestamp: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (_) {
      return false;
    }
  },

  async getMeta(key, defaultVal = null) {
    const lsVal = this.safeGetItem(key, null);
    if (lsVal !== null) return lsVal;
    try {
      const db = await getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').get(key);
        req.onsuccess = () => {
          const val = (req.result && req.result.value !== undefined) ? req.result.value : defaultVal;
          if (val !== null && val !== undefined) this.safeSetItem(key, val);
          resolve(val);
        };
        req.onerror = () => resolve(defaultVal);
      });
    } catch (_) {
      return defaultVal;
    }
  },

  /**
   * Liefert die stabile, anonyme Geräte-UUID (RFC 4122 v4).
   * Doppelwandig in LocalStorage & IndexedDB (meta) gesichert – übersteht PWA-Updates & Cache-Busting.
   */
  getDeviceUuid() {
    const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    let uuid = this.safeGetItem('bw_push_device_uuid', null);
    if (!uuid || !UUID_V4_REGEX.test(uuid)) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        uuid = crypto.randomUUID();
      } else {
        uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
      this.safeSetItem('bw_push_device_uuid', uuid);
      this.setMeta('bw_push_device_uuid', uuid).catch(() => {});
    }
    return uuid;
  },

  /**
   * Liefert den geräte-spezifischen LocalStorage-Key für Favoriten
   */
  getDeviceFavoritesKey(deviceId = null) {
    const id = deviceId || this.getDeviceUuid();
    return `bw_favs_${id}`;
  },

  /**
   * Speichert Favoriten atomar in LocalStorage UND IndexedDB für dieses spezifische Gerät.
   * Überlebt PWA-Neuladen, Service Worker Updates und Cache-Invalidierungen auf iOS.
   */
  async saveDeviceFavorites(deviceId, favorites) {
    const id = deviceId || this.getDeviceUuid();
    const list = Array.isArray(favorites) ? favorites : [];

    // 1. In gerätespezifischem LocalStorage sichern
    this.safeSetItem(this.getDeviceFavoritesKey(id), list);
    // 2. Rückwärtskompatibilität: globalen Key ebenfalls aktualisieren
    this.safeSetItem('best_weather_favorites_v4', list);

    // 3. Dauerhaft in IndexedDB (device_favorites) sichern
    try {
      const db = await getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction('device_favorites', 'readwrite');
        tx.objectStore('device_favorites').put({
          deviceId: id,
          favorites: list,
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (_) {
      return false;
    }
  },

  /**
   * Liest Favoriten aus IndexedDB für dieses spezifische Gerät (Notfall-Wiederherstellung)
   */
  async getDeviceFavorites(deviceId = null) {
    const id = deviceId || this.getDeviceUuid();
    try {
      const db = await getDB();
      return await new Promise((resolve) => {
        const tx = db.transaction('device_favorites', 'readonly');
        const req = tx.objectStore('device_favorites').get(id);
        req.onsuccess = () => {
          const res = req.result;
          if (res && Array.isArray(res.favorites)) {
            resolve(res.favorites);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }
};
