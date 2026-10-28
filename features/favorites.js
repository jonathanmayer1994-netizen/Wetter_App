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

  if (addBtn) addBtn.addEventListener('click', toggleFavoriteCurrent);
  if (favToggle) favToggle.addEventListener('click', toggleFavoriteCurrent);

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

export function toggleFavoriteCurrent() {
  const loc = state.currentLocation;
  if (!loc) return;
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
      lat: loc.lat,
      lon: loc.lon,
      elevation: loc.elevation,
      country: loc.country,
      isMountain: loc.isMountain
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
}

export function updateFavStarUI() {
  const btn = document.getElementById('fav-toggle-btn');
  if (!btn || !state.currentLocation) return;
  const isFav = state.favorites.some(f => f.name.toLowerCase() === state.currentLocation.name.toLowerCase());
  btn.innerText = isFav ? '★' : '☆';
  btn.classList.toggle('favorited', isFav);
}

export function renderFavoritesTab() {
  const grid = document.getElementById('favorites-grid');
  if (!grid) return;

  grid.innerHTML = '';
  if (!state.favorites || state.favorites.length === 0) {
    grid.innerHTML = `
      <div class="empty-favorites-box">
        <span class="empty-fav-icon">⭐</span>
        <div class="empty-fav-title">Noch keine Favoriten gespeichert</div>
        <p class="empty-fav-desc">Speichere deine Lieblings-Alpengipfel oder Heimatorte per Klick auf den Stern oben rechts oder wähle einen alpinen Klassiker:</p>
        <div class="empty-fav-presets">
          <button class="preset-fav-chip" type="button" onclick="window.loadNamedMountain && window.loadNamedMountain('Zugspitze')">🏔️ Zugspitze (2.962 m)</button>
          <button class="preset-fav-chip" type="button" onclick="window.loadNamedMountain && window.loadNamedMountain('Matterhorn')">🏔️ Matterhorn (4.478 m)</button>
          <button class="preset-fav-chip" type="button" onclick="window.loadNamedMountain && window.loadNamedMountain('Großglockner')">🏔️ Großglockner (3.798 m)</button>
          <button class="preset-fav-chip" type="button" onclick="window.loadNamedMountain && window.loadNamedMountain('Nebelhorn')">🏔️ Nebelhorn (2.224 m)</button>
        </div>
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
      state.favorites.splice(i, 1);
      AlpineStorage.safeSetItem(STORAGE_KEY, state.favorites);
      renderFavoritesTab();
      updateFavStarUI();
    });

    grid.appendChild(card);
  });
}
