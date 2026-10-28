/**
 * BEST WEATHER — Google Sheets Cloud DB Sync Bridge (Option A)
 * Uses Google Apps Script Web App Endpoint for zero-auth, zero-login 2-way sync.
 */

import { state } from './state.js';
import { AlpineStorage } from '../storage.js';
import { renderFavoritesTab, updateFavStarUI } from '../features/favorites.js';

const STORAGE_URL_KEY = 'best_weather_gsheets_url';
const STORAGE_LAST_SYNC_KEY = 'best_weather_gsheets_last_sync';
const DEFAULT_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbw4-2Oc-faGqdvOQJh88kpVbkFNldunZF0GBBSf9BJNaNuxknYNBoN_IvPEBMZcXtgfCw/exec';

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
    return !!(url && url.startsWith('https://script.google.com/macros/s/'));
  },

  /**
   * Lädt alle Daten (Favoriten, Touren, Settings) aus Google Sheets
   */
  async pullAll() {
    const url = this.getUrl();
    if (!this.isConnected()) return { success: false, error: 'Keine gültige Google Apps Script URL konfiguriert.' };

    try {
      let data = null;
      try {
        const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}action=get_all&_t=${Date.now()}`;
        const res = await fetch(fetchUrl, {
          method: 'GET',
          redirect: 'follow'
        });
        if (res.ok) data = await res.json();
      } catch (_) {}

      // Fallback via POST falls GET durch Cross-Origin / Redirects geblockt wird
      if (!data) {
        try {
          const postRes = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_all', timestamp: new Date().toISOString() }),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            redirect: 'follow'
          });
          if (postRes.ok) data = await postRes.json();
        } catch (_) {}
      }

      if (data && data.favoriten && Array.isArray(data.favoriten)) {
        // Favoriten synchronisieren
        this.mergeFavorites(data.favoriten);
      }

      this.setLastSync();
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Sendet ein Event / Daten an Google Sheets (POST ohne Preflight via text/plain)
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
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        redirect: 'follow'
      });

      const result = await res.json();
      this.setLastSync();
      return { success: true, result };
    } catch (err) {
      console.warn('Google Sheets Push Fehler:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * Favoriten aus dem Sheet in die App einpflegen
   */
  mergeFavorites(sheetFavs) {
    if (!Array.isArray(sheetFavs)) return;

    sheetFavs.forEach(sf => {
      if (!sf.Name || !sf.Breitengrad || !sf.Laengengrad) return;
      const lat = parseFloat(sf.Breitengrad);
      const lon = parseFloat(sf.Laengengrad);
      const ele = sf.Hoehe_m ? parseInt(sf.Hoehe_m, 10) : 500;
      const isMtn = sf.Typ ? (sf.Typ.toLowerCase().includes('berg') || sf.Typ.toLowerCase().includes('gipfel')) : (ele > 800);

      const existingIdx = state.favorites.findIndex(f => f.name.toLowerCase() === sf.Name.toLowerCase());
      const favObj = {
        name: sf.Name,
        lat,
        lon,
        elevation: ele,
        country: sf.Land || 'Deutschland',
        isMountain: isMtn,
        notes: sf.Notizen || ''
      };

      if (existingIdx >= 0) {
        state.favorites[existingIdx] = { ...state.favorites[existingIdx], ...favObj };
      } else {
        state.favorites.push(favObj);
      }
    });

    AlpineStorage.safeSetItem('best_weather_favorites_v4', state.favorites);
    updateFavStarUI();
    renderFavoritesTab();
  },

  /**
   * Synchronisiert einen neu hinzugefügten oder gelöschten Favoriten
   */
  async syncFavoriteChange(favorite, isRemoved = false) {
    if (!this.isConnected()) return;
    if (isRemoved) {
      await this.push('delete_favorite', { name: favorite.name });
    } else {
      await this.push('save_favorite', {
        favorite: {
          id: `fav_${Date.now()}`,
          name: favorite.name,
          lat: favorite.lat,
          lon: favorite.lon,
          elevation: favorite.elevation,
          type: favorite.isMountain ? 'Berg' : 'Ort',
          country: favorite.country || 'Deutschland',
          notes: favorite.notes || ''
        }
      });
    }
  },

  /**
   * UI Badge & Status aktualisieren
   */
  updateStatusUI() {
    const badge = document.getElementById('gsheets-status-badge');
    const input = document.getElementById('gsheets-url-input');
    const lastSyncEl = document.getElementById('gsheets-last-sync');

    const connected = this.isConnected();
    const lastSync = this.getLastSync();

    if (badge) {
      badge.textContent = connected ? '✅ Verbunden' : 'Nicht verbunden';
      badge.className = `card-tag ${connected ? 'text-green' : ''}`;
    }
    if (input && !input.value) {
      input.value = this.getUrl();
    }
    if (lastSyncEl) {
      if (lastSync) {
        const d = new Date(lastSync);
        lastSyncEl.textContent = `Zuletzt synchronisiert: ${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
      } else {
        lastSyncEl.textContent = connected ? 'Noch nicht synchronisiert' : 'Trage deine Web-App URL ein';
      }
    }
  }
};

