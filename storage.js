/**
 * BEST WEATHER — IndexedDB Alpine Storage Engine
 * High-capacity offline storage replacing localStorage for large GPX files
 * and multi-day meteorological datasets with safe fallback.
 */

const DB_NAME = 'BestWeatherAlpineDB';
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'));
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tours')) {
        db.createObjectStore('tours', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('weather')) {
        db.createObjectStore('weather', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

export const AlpineStorage = {
  /**
   * Speichert eine GPX-Tour sicher in IndexedDB (oder Fallback)
   */
  async saveTour(tour) {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('tours', 'readwrite');
        const store = tx.objectStore('tours');
        store.put(tour);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      // Fallback auf LocalStorage mit Quota-Schutz
      try {
        const key = `tour_${tour.id || 'current'}`;
        const miniTour = { ...tour, gpxXml: (tour.gpxXml && tour.gpxXml.length > 500000) ? null : tour.gpxXml };
        localStorage.setItem(key, JSON.stringify(miniTour));
      } catch (lsErr) {
        console.warn('Storage Fallback Quota Error:', lsErr);
      }
      return false;
    }
  },

  /**
   * Lädt eine Tour aus IndexedDB
   */
  async getTour(id) {
    try {
      const db = await getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('tours', 'readonly');
        const store = tx.objectStore('tours');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
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
   * Holt die zuletzt gecachten Wetterdaten
   */
  async getCachedWeather(locKey = null) {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('weather', 'readonly');
        const store = tx.objectStore('weather');
        if (locKey) {
          const req = store.get(locKey);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } else {
          // Hole neuesten Eintrag
          const req = store.openCursor(null, 'prev');
          req.onsuccess = (e) => {
            const cursor = e.target.result;
            resolve(cursor ? cursor.value : null);
          };
          req.onerror = () => resolve(null);
        }
      });
    } catch (e) {
      try {
        const raw = localStorage.getItem('alpine_offline_weather');
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    }
  },

  /**
   * Sicheres Setzen in LocalStorage (mit Schutz gegen Safari Private Mode)
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
  }
};
