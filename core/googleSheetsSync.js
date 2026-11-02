/**
 * BEST WEATHER — Google Sheets Cloud DB Sync Bridge (Universal v3.0)
 * Fully automatic, zero-config 2-way cloud synchronization for favorites.
 * Supports Google Apps Script Web Apps, JSONP fallback, and direct Google Sheet links.
 */

import { state } from './state.js';
import { AlpineStorage } from '../storage.js';
import { renderFavoritesTab, updateFavStarUI } from '../features/favorites.js';

const STORAGE_URL_KEY = 'best_weather_gsheets_url';
const STORAGE_LAST_SYNC_KEY = 'best_weather_gsheets_last_sync';
const STORAGE_PENDING_QUEUE_KEY = 'best_weather_gsheets_pending_queue';
const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbw4-2Oc-faGqdvOQJh88kpVbkFNldunZF0GBBSf9BJNaNuxknYNBoN_IvPEBMZcXtgfCw/exec';

// Mountain & City preset registry for instant coordinate recovery
const KNOWN_PRESETS = {
  'zugspitze': { lat: 47.4212, lon: 10.9864, elevation: 2962, country: 'Deutschland', isMountain: true },
  'matterhorn': { lat: 45.9764, lon: 7.6586, elevation: 4478, country: 'Schweiz', isMountain: true },
  'mont blanc': { lat: 45.8326, lon: 6.8652, elevation: 4808, country: 'Frankreich', isMountain: true },
  'großglockner': { lat: 47.0742, lon: 12.6947, elevation: 3798, country: 'Österreich', isMountain: true },
  'grossglockner': { lat: 47.0742, lon: 12.6947, elevation: 3798, country: 'Österreich', isMountain: true },
  'nebelhorn': { lat: 47.4219, lon: 10.3444, elevation: 2224, country: 'Deutschland', isMountain: true },
  'grünten': { lat: 47.5458, lon: 10.3168, elevation: 1738, country: 'Deutschland', isMountain: true },
  'gruenten': { lat: 47.5458, lon: 10.3168, elevation: 1738, country: 'Deutschland', isMountain: true },
  'münchen': { lat: 48.1351, lon: 11.5820, elevation: 519, country: 'Deutschland', isMountain: false },
  'muenchen': { lat: 48.1351, lon: 11.5820, elevation: 519, country: 'Deutschland', isMountain: false },
  'innsbruck': { lat: 47.2692, lon: 11.4041, elevation: 574, country: 'Österreich', isMountain: false },
  'salzburg': { lat: 47.8095, lon: 13.0550, elevation: 424, country: 'Österreich', isMountain: false },
  'zürich': { lat: 47.3769, lon: 8.5417, elevation: 408, country: 'Schweiz', isMountain: false },
  'kempten': { lat: 47.7286, lon: 10.3158, elevation: 674, country: 'Deutschland', isMountain: false },
  'oberstdorf': { lat: 47.4083, lon: 10.2794, elevation: 813, country: 'Deutschland', isMountain: true },
  'garmisch': { lat: 47.4921, lon: 11.0958, elevation: 708, country: 'Deutschland', isMountain: true }
};

/**
 * Normalisiert rohe Sheet-Datenstrukturen (Objekte, Arrays, 2D-Tabellen, GViz)
 */
export function normalizeSheetRows(rawData) {
  if (!rawData) return [];

  // 1. Bereits ein Array
  if (Array.isArray(rawData)) {
    if (rawData.length > 0 && Array.isArray(rawData[0])) {
      // 2D Array mit Kopfzeile
      const headers = rawData[0].map(h => String(h || '').trim().toLowerCase());
      return rawData.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, idx) => {
          obj[h] = row[idx];
        });
        return obj;
      });
    }
    return rawData;
  }

  // 2. Objekt mit Unter-Array (favoriten, favorites, data, items, rows, etc.)
  if (typeof rawData === 'object') {
    const candidates = ['favoriten', 'favorites', 'data', 'items', 'rows', 'orte', 'locations', 'values'];
    for (const key of candidates) {
      if (Array.isArray(rawData[key])) {
        return normalizeSheetRows(rawData[key]);
      }
    }

    // Google GViz API Format
    if (rawData.table && Array.isArray(rawData.table.rows)) {
      const cols = (rawData.table.cols || []).map((col, idx) => (col?.label || col?.id || `col_${idx}`).toLowerCase());
      return rawData.table.rows.map(r => {
        const obj = {};
        (r.c || []).forEach((cell, idx) => {
          const colKey = cols[idx] || `col_${idx}`;
          obj[colKey] = cell ? cell.v : null;
        });
        return obj;
      });
    }
  }

  return [];
}

/**
 * Mappt ein Zeilenobjekt flexibel in das interne Favoriten-Format
 */
export function mapRowToFavorite(row) {
  if (!row || typeof row !== 'object') return null;

  const getVal = (...keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
      const lower = k.toLowerCase();
      for (const prop in row) {
        if (prop.toLowerCase() === lower && row[prop] !== undefined && row[prop] !== null && row[prop] !== '') {
          return row[prop];
        }
      }
    }
    return undefined;
  };

  const rawName = getVal('name', 'ort', 'location', 'titel', 'title', 'label', 'berg', 'stadt', 'col_0');
  if (!rawName) return null;
  const name = String(rawName).trim();
  if (!name) return null;

  let lat = parseFloat(getVal('lat', 'latitude', 'breitengrad', 'breite', 'y', 'col_1'));
  let lon = parseFloat(getVal('lon', 'lng', 'longitude', 'laengengrad', 'längengrad', 'laenge', 'länge', 'x', 'col_2'));
  let ele = parseInt(getVal('elevation', 'altitude', 'hoehe', 'höhe', 'hoehe_m', 'höhe_m', 'ele', 'col_3'), 10);

  // Koordinaten-Fallback aus bekannter Datenbank
  if (isNaN(lat) || isNaN(lon)) {
    const key = name.toLowerCase().trim();
    if (KNOWN_PRESETS[key]) {
      lat = KNOWN_PRESETS[key].lat;
      lon = KNOWN_PRESETS[key].lon;
      if (isNaN(ele)) ele = KNOWN_PRESETS[key].elevation;
    }
  }

  if (isNaN(lat) || isNaN(lon)) return null;
  if (isNaN(ele)) ele = 500;

  const rawType = String(getVal('type', 'typ', 'kategorie', 'category', 'col_4') || '').toLowerCase();
  const isMountain = rawType.includes('berg') || rawType.includes('gipfel') || rawType.includes('mountain') || ele > 800;
  const country = String(getVal('country', 'land', 'staat', 'col_5') || 'Deutschland').trim();
  const notes = String(getVal('notes', 'notizen', 'beschreibung', 'col_6') || '').trim();

  return {
    name,
    lat,
    lon,
    elevation: ele,
    country,
    isMountain,
    notes
  };
}

/**
 * Führt JSONP Request aus (bypasst CORS vollständig)
 */
function fetchJsonp(url, action = 'get_all', timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const callbackName = 'gsheets_cb_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const script = document.createElement('script');
    const separator = url.includes('?') ? '&' : '?';
    script.src = `${url}${separator}callback=${callbackName}&action=${encodeURIComponent(action)}&_t=${Date.now()}`;
    script.async = true;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP Timeout'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callbackName];
    }

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP Script Load Error'));
    };

    document.head.appendChild(script);
  });
}

export const GoogleSheetsSync = {
  getUrl() {
    return AlpineStorage.safeGetItem(STORAGE_URL_KEY, DEFAULT_WEBHOOK_URL);
  },

  setUrl(url) {
    const clean = (url || '').trim();
    AlpineStorage.safeSetItem(STORAGE_URL_KEY, clean);
    this.updateStatusUI();
    return clean;
  },

  getLastSync() {
    return AlpineStorage.safeGetItem(STORAGE_LAST_SYNC_KEY, null);
  },

  setLastSync() {
    const ts = new Date().toISOString();
    AlpineStorage.safeSetItem(STORAGE_LAST_SYNC_KEY, ts);
    this.updateStatusUI();
    return ts;
  },

  isConnected() {
    const url = this.getUrl();
    if (!url) return false;
    return url.includes('script.google.com/macros/s/') || url.includes('docs.google.com/spreadsheets/d/');
  },

  /**
   * Lädt alle Favoriten aus Google Sheets (mit Multilevel-Fallbacks und Normalisierung)
   */
  async pullAll() {
    const url = this.getUrl();
    if (!this.isConnected()) {
      return { success: false, error: 'Keine Google Sheets URL konfiguriert' };
    }

    try {
      let rawData = null;

      // VARIATION A: Direkte Google Spreadsheet URL (z.B. docs.google.com/spreadsheets/d/ID/...)
      const sheetMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (sheetMatch && sheetMatch[1]) {
        const sheetId = sheetMatch[1];
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&_t=${Date.now()}`;
        try {
          const res = await fetch(gvizUrl);
          if (res.ok) {
            const text = await res.text();
            // Strip Google GViz wrapper /*O_o*/ google.visualization.Query.setResponse(...);
            const jsonStart = text.indexOf('{');
            const jsonEnd = text.lastIndexOf('}');
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
              rawData = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
            }
          }
        } catch (_) {}
      }

      // VARIATION B: Google Apps Script Web App Endpoint via GET
      if (!rawData) {
        try {
          const sep = url.includes('?') ? '&' : '?';
          const fetchUrl = `${url}${sep}action=get_all&_t=${Date.now()}`;
          const res = await fetch(fetchUrl, { method: 'GET', redirect: 'follow' });
          if (res.ok) {
            const text = await res.text();
            if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
              rawData = JSON.parse(text);
            } else if (text.includes('accounts.google.com') || text.includes('Sign in')) {
              console.warn('[GoogleSheetsSync] Web App erfordert Google-Login. Bitte Berechtigung in Google Apps Script auf "Jeder" (Anyone) stellen.');
            }
          }
        } catch (_) {}
      }

      // VARIATION C: Google Apps Script Web App via POST (text/plain bypasses CORS preflight)
      if (!rawData) {
        try {
          const postRes = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_all', timestamp: new Date().toISOString() }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            redirect: 'follow'
          });
          if (postRes.ok) {
            const text = await postRes.text();
            if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
              rawData = JSON.parse(text);
            }
          }
        } catch (_) {}
      }

      // VARIATION D: JSONP Callback Fallback (funktioniert auch bei strikten CORS Beschränkungen)
      if (!rawData && url.includes('script.google.com')) {
        try {
          rawData = await fetchJsonp(url, 'get_all', 4000);
        } catch (_) {}
      }

      // Daten verarbeiten
      const rows = normalizeSheetRows(rawData);
      if (rows && rows.length > 0) {
        this.mergeFavorites(rows);
        this.setLastSync();
        this.flushPendingQueue();
        return { success: true, count: rows.length };
      }

      // Falls keine Daten zurückkamen, aber Verbindung konfiguriert ist
      this.updateStatusUI();
      return { success: false, error: 'Keine Daten empfangen' };

    } catch (err) {
      console.warn('[GoogleSheetsSync] Fehler bei Synchronisation:', err);
      this.updateStatusUI();
      return { success: false, error: err.message };
    }
  },

  /**
   * Favoriten aus dem Sheet in die App einpflegen
   */
  mergeFavorites(sheetRows) {
    if (!Array.isArray(sheetRows) || sheetRows.length === 0) return;

    const mapped = [];
    sheetRows.forEach(row => {
      const fav = mapRowToFavorite(row);
      if (fav && !mapped.some(m => m.name.toLowerCase() === fav.name.toLowerCase())) {
        mapped.push(fav);
      }
    });

    if (mapped.length > 0) {
      // Synchronisiere exakt mit der Google Sheet Datenbank
      state.favorites = mapped;
      AlpineStorage.safeSetItem('best_weather_favorites_v4', state.favorites);
      updateFavStarUI();
      renderFavoritesTab();
    }
  },

  /**
   * Synchronisiert einen neu hinzugefügten oder gelöschten Favoriten
   */
  async syncFavoriteChange(favorite, isRemoved = false) {
    if (!favorite || !favorite.name) return;

    // Lokaler Zustand ist bereits aktualisiert; jetzt im Hintergrund hochladen
    const payload = isRemoved
      ? { action: 'delete_favorite', name: favorite.name }
      : {
          action: 'save_favorite',
          favorite: {
            name: favorite.name,
            lat: favorite.lat,
            lon: favorite.lon,
            elevation: favorite.elevation || 500,
            type: favorite.isMountain ? 'Berg' : 'Ort',
            country: favorite.country || 'Deutschland',
            notes: favorite.notes || ''
          }
        };

    const res = await this.push(payload.action, payload);
    if (!res.success) {
      // In Offline-Queue aufnehmen für späteren Sync
      this.enqueuePendingChange(payload);
    }
  },

  /**
   * Sendet ein Event / Daten an Google Sheets
   */
  async push(action, payload = {}) {
    const url = this.getUrl();
    if (!this.isConnected()) return { success: false, error: 'Nicht verbunden' };

    try {
      const body = JSON.stringify({
        action,
        timestamp: new Date().toISOString(),
        ...payload
      });

      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow'
      });

      if (res.ok) {
        this.setLastSync();
        return { success: true };
      }
      return { success: false, error: `HTTP ${res.status}` };
    } catch (err) {
      // Fallback: GET Request falls POST fehlschlägt
      try {
        const params = new URLSearchParams();
        params.set('action', action);
        if (payload.name) params.set('name', payload.name);
        if (payload.favorite) {
          params.set('name', payload.favorite.name);
          params.set('lat', payload.favorite.lat);
          params.set('lon', payload.favorite.lon);
          params.set('elevation', payload.favorite.elevation);
          params.set('type', payload.favorite.type);
        }
        const sep = url.includes('?') ? '&' : '?';
        const res = await fetch(`${url}${sep}${params.toString()}`, { method: 'GET', redirect: 'follow' });
        if (res.ok) {
          this.setLastSync();
          return { success: true };
        }
      } catch (_) {}

      return { success: false, error: err.message };
    }
  },

  enqueuePendingChange(payload) {
    const queue = AlpineStorage.safeGetItem(STORAGE_PENDING_QUEUE_KEY, []);
    queue.push({ payload, timestamp: Date.now() });
    AlpineStorage.safeSetItem(STORAGE_PENDING_QUEUE_KEY, queue);
  },

  async flushPendingQueue() {
    const queue = AlpineStorage.safeGetItem(STORAGE_PENDING_QUEUE_KEY, []);
    if (!queue || queue.length === 0) return;

    const remaining = [];
    for (const item of queue) {
      const res = await this.push(item.payload.action, item.payload);
      if (!res.success) remaining.push(item);
    }
    AlpineStorage.safeSetItem(STORAGE_PENDING_QUEUE_KEY, remaining);
  },

  /**
   * UI Status aktualisieren
   */
  updateStatusUI() {
    const statusText = document.getElementById('cloud-sync-status-text');
    const statusDot = document.getElementById('cloud-sync-dot');
    const modalLastSync = document.getElementById('gsheets-last-sync');
    const modalBadge = document.getElementById('gsheets-status-badge');
    const modalInput = document.getElementById('gsheets-url-input');

    const connected = this.isConnected();
    const lastSync = this.getLastSync();
    const count = (state.favorites || []).length;

    let timeStr = '';
    if (lastSync) {
      const d = new Date(lastSync);
      const isToday = d.toDateString() === new Date().toDateString();
      timeStr = `${isToday ? 'Heute' : d.toLocaleDateString('de-DE')}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
    }

    if (statusText) {
      if (connected && lastSync) {
        statusText.textContent = `Google Sheets synchronisiert (${timeStr} • ${count} Orte)`;
      } else if (connected) {
        statusText.textContent = 'Google Sheets verbunden (Auto-Sync aktiv)';
      } else {
        statusText.textContent = 'Cloud-Sync inaktiv';
      }
    }

    if (statusDot) {
      statusDot.className = `cssb-dot ${connected ? 'active' : ''}`;
    }

    if (modalBadge) {
      modalBadge.textContent = connected ? '✅ Verbunden' : 'Nicht verbunden';
      modalBadge.className = `card-tag ${connected ? 'text-green' : ''}`;
    }

    if (modalInput && !modalInput.value) {
      modalInput.value = this.getUrl();
    }

    if (modalLastSync) {
      modalLastSync.textContent = lastSync ? `Zuletzt synchronisiert: ${timeStr}` : 'Noch nicht synchronisiert';
    }
  }
};
