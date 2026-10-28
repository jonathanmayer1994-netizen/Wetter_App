/**
 * BEST WEATHER — Favorites Feature Module (Task 1a)
 * Manages saved locations, mountain presets, persistent localStorage synchronization,
 * and favorite toggle UI star states.
 */

import { state } from '../core/state.js';
import { AlpineStorage } from '../storage.js';
import { escapeHtml } from '../httpClient.js';
import { GoogleSheetsSync } from '../core/googleSheetsSync.js';

const STORAGE_KEY = 'best_weather_favorites_v4';

let onSelectLocationCallback = null;
let onSwitchTabCallback = null;

export function initFavoritesHandlers({ onSelectLocation, onSwitchTab }) {
  onSelectLocationCallback = onSelectLocation;
  onSwitchTabCallback = onSwitchTab;
}

export function setupFavorites(options = {}) {
  if (options.onSelectLocation) onSelectLocationCallback = options.onSelectLocation;
  if (options.onSwitchTab) onSwitchTabCallback = options.onSwitchTab;

  const addBtn = document.getElementById('add-current-favorite-btn');
  const favToggle = document.getElementById('fav-toggle-btn');
  const gpsCard = document.getElementById('favorites-gps-card');

  if (addBtn) addBtn.addEventListener('click', toggleFavoriteCurrent);
  if (favToggle) favToggle.addEventListener('click', toggleFavoriteCurrent);

  if (gpsCard) {
    gpsCard.addEventListener('click', () => {
      if (window.triggerExactGps) window.triggerExactGps();
      if (onSwitchTabCallback) onSwitchTabCallback('tab-overview');
      else if (window.switchTab) window.switchTab('tab-overview');
    });
  }

  // Google Sheets Cloud Sync Handlers
  const gsheetsInput = document.getElementById('gsheets-url-input');
  const gsheetsSaveBtn = document.getElementById('gsheets-save-btn');
  const gsheetsSyncBtn = document.getElementById('gsheets-sync-now-btn');

  if (gsheetsSaveBtn && gsheetsInput) {
    gsheetsSaveBtn.addEventListener('click', async () => {
      const url = gsheetsInput.value.trim();
      GoogleSheetsSync.setUrl(url);
      if (GoogleSheetsSync.isConnected()) {
        gsheetsSaveBtn.textContent = '⏳ Verbinde...';
        const res = await GoogleSheetsSync.pullAll();
        gsheetsSaveBtn.textContent = res.success ? '✅ Gespeichert' : '⚠️ Fehler';
        setTimeout(() => { gsheetsSaveBtn.textContent = '💾 Speichern'; }, 2000);
      } else {
        GoogleSheetsSync.updateStatusUI();
      }
    });
  }

  if (gsheetsSyncBtn) {
    gsheetsSyncBtn.addEventListener('click', async () => {
      if (!GoogleSheetsSync.isConnected()) {
        alert('Bitte gib zuerst eine gültige Google Apps Script Web-App URL ein.');
        return;
      }
      gsheetsSyncBtn.textContent = '⏳ Synchronisiere...';
      const res = await GoogleSheetsSync.pullAll();
      gsheetsSyncBtn.textContent = res.success ? '✅ Synchronisiert' : '⚠️ Fehler';
      setTimeout(() => { gsheetsSyncBtn.textContent = '🔄 Jetzt syncen'; }, 2000);
    });
  }

  GoogleSheetsSync.updateStatusUI();
  if (GoogleSheetsSync.isConnected()) {
    // Stiller Sync im Hintergrund
    GoogleSheetsSync.pullAll();
  }

  renderFavoritesTab();
}

export function toggleFavoriteLocation(loc) {
  if (!loc || !loc.name) return false;
  const idx = state.favorites.findIndex(f => f.name.toLowerCase() === loc.name.toLowerCase());
  let changedFav = null;
  let isRemoved = false;

  if (idx >= 0) {
    changedFav = state.favorites[idx];
    isRemoved = true;
    state.favorites.splice(idx, 1);
  } else {
    changedFav = {
      name: loc.name,
      lat: loc.lat || loc.latitude,
      lon: loc.lon || loc.longitude,
      elevation: loc.elevation || 500,
      country: loc.country || '',
      isMountain: !!loc.isMountain
    };
    state.favorites.push(changedFav);
  }

  AlpineStorage.safeSetItem(STORAGE_KEY, state.favorites);
  updateFavStarUI();
  renderFavoritesTab();

  // Cloud Sync in Google Sheets im Hintergrund
  if (changedFav && GoogleSheetsSync.isConnected()) {
    GoogleSheetsSync.syncFavoriteChange(changedFav, isRemoved);
  }

  return !isRemoved;
}

export function toggleFavoriteCurrent() {
  return toggleFavoriteLocation(state.currentLocation);
}

export function updateFavStarUI() {
  const btn = document.getElementById('fav-toggle-btn');
  if (!btn || !state.currentLocation) return;
  const isFav = state.favorites.some(f => f.name.toLowerCase() === state.currentLocation.name.toLowerCase());
  btn.innerText = isFav ? '★' : '☆';
  btn.classList.toggle('favorited', isFav);
}

export function renderFavoritesTab() {
  // 1. Status der GPS-Option oberhalb der Favoriten aktualisieren
  const gpsCard = document.getElementById('favorites-gps-card');
  const gpsSub = document.getElementById('fgc-status-desc');
  if (gpsCard && gpsSub) {
    const isCurrentGps = state.currentLocation && (state.currentLocation.isGps || state.currentLocation.name.startsWith('Mein Standort'));
    gpsCard.classList.toggle('active-gps', !!isCurrentGps);
    if (isCurrentGps) {
      gpsSub.innerText = `🟢 Aktiv ausgewählt (${state.currentLocation.name} • ${state.currentLocation.elevation} m) • Tippen zum Aktualisieren`;
    } else {
      gpsSub.innerText = 'Gerätestandort & Berghöhe live per GPS ermitteln';
    }
  }

  // 2. Gespeicherte Favoriten aus Google Sheet / LocalStorage rendern
  const grid = document.getElementById('favorites-grid');
  if (!grid) return;

  grid.innerHTML = '';
  if (!state.favorites || state.favorites.length === 0) {
    grid.innerHTML = `
      <div class="empty-favorites-box">
        <span class="empty-fav-icon">⭐</span>
        <div class="empty-fav-title">Keine Favoriten gespeichert</div>
        <p class="empty-fav-desc">Deine Liste zeigt ausschließlich die Orte an, die in deinem Google Sheet gespeichert sind. Suche oben nach einem Ort und tippe auf das Stern-Symbol (★), um ihn hinzuzufügen.</p>
      </div>
    `;
    return;
  }

  state.favorites.forEach((fav, i) => {
    const card = document.createElement('div');
    card.className = 'favorite-card';
    const typeIcon = fav.isMountain ? '🏔️' : '🏙️';
    card.innerHTML = `
      <div class="fav-info">
        <div class="fav-name">${typeIcon} ${escapeHtml(fav.name)}</div>
        <div class="fav-meta">Höhe: ${fav.elevation.toLocaleString('de-DE')} m • ${escapeHtml(fav.country || '')}</div>
      </div>
      <div class="fav-actions">
        <button class="fav-del-btn" title="Löschen" aria-label="Favorit löschen">✕</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('fav-del-btn')) {
        if (onSelectLocationCallback) onSelectLocationCallback(fav);
        else if (window.selectExactLocation) window.selectExactLocation(fav);
        if (onSwitchTabCallback) onSwitchTabCallback('tab-overview');
        else if (window.switchTab) window.switchTab('tab-overview');
      }
    });

    card.querySelector('.fav-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const removed = state.favorites.splice(i, 1)[0];
      AlpineStorage.safeSetItem(STORAGE_KEY, state.favorites);
      renderFavoritesTab();
      updateFavStarUI();
      if (removed && GoogleSheetsSync.isConnected()) {
        GoogleSheetsSync.syncFavoriteChange(removed, true);
      }
    });

    grid.appendChild(card);
  });
}
