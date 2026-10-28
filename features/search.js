/**
 * BEST WEATHER — Search & Spotlight Feature Module (Task 1a)
 * Handles live geocoding autocomplete, Apple Spotlight (⌘K) quick search,
 * GPS reverse-geocoding, and recent searches persistence.
 */

import { state } from '../core/state.js';
import { OFFICIAL_KNOWN_ELEVATIONS } from '../core/constants.js';
import { AlpineStorage } from '../storage.js';
import { resilientFetch, escapeHtml } from '../httpClient.js';
import { MicroEngine } from '../microEngine.js';
import { toggleFavoriteLocation } from './favorites.js';

let onLoadLocationCallback = null;
let onRenderOverviewCallback = null;
let onRenderAdaptiveTab2Callback = null;

export function initSearchHandlers({ onLoadLocation, onRenderOverview, onRenderAdaptiveTab2 }) {
  if (onLoadLocation) onLoadLocationCallback = onLoadLocation;
  if (onRenderOverview) onRenderOverviewCallback = onRenderOverview;
  if (onRenderAdaptiveTab2) onRenderAdaptiveTab2Callback = onRenderAdaptiveTab2;
}

export function selectExactLocation(loc) {
  addSpotlightRecent(loc);
  if (onLoadLocationCallback) {
    onLoadLocationCallback(loc);
  } else if (window.loadLocation) {
    window.loadLocation(loc);
  }
}

export function getSpotlightRecents() {
  return AlpineStorage.safeGetItem('alpine_recent_searches', []);
}

export function addSpotlightRecent(loc) {
  if (!loc || !loc.name) return;
  try {
    let list = getSpotlightRecents();
    if (!Array.isArray(list)) list = [];
    list = list.filter(item => item.name.toLowerCase() !== loc.name.toLowerCase());
    list.unshift({
      name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      elevation: loc.elevation,
      isMountain: !!loc.isMountain,
      country: loc.country || ''
    });
    AlpineStorage.safeSetItem('alpine_recent_searches', list.slice(0, 5));
  } catch (e) {}
}

export function renderSpotlightRecentsUI() {
  const box = document.getElementById('spotlight-recent-chips');
  const listElem = document.getElementById('spotlight-recent-list');
  if (!box || !listElem) return;
  const recents = getSpotlightRecents();
  if (recents.length === 0) {
    box.style.display = 'none';
    return;
  }
  listElem.innerHTML = recents.map(r => `
    <button type="button" class="recent-chip" data-recent="${escapeHtml(r.name)}">
      <span>${r.isMountain ? '🏔️' : '🏙️'}</span>
      <span>${escapeHtml(r.name)}</span>
      <span style="opacity:0.65; font-size:10px;">${r.elevation.toLocaleString('de-DE')}m</span>
    </button>
  `).join('');
  box.style.display = 'flex';

  listElem.querySelectorAll('.recent-chip').forEach((btn, idx) => {
    btn.onclick = () => {
      const targetLoc = recents[idx];
      if (targetLoc) {
        selectExactLocation(targetLoc);
        const modal = document.getElementById('spotlight-modal-overlay');
        if (modal) modal.style.display = 'none';
      }
    };
  });
}

export function renderSearchRecentsAndPresetsDropdown() {
  const dropdown = document.getElementById('search-results-dropdown');
  const input = document.getElementById('location-search-input');
  if (!dropdown) return;

  const recents = getSpotlightRecents();
  const presets = [
    { name: 'Zugspitze', lat: 47.421, lon: 10.985, elevation: 2962, isMountain: true, country: 'Deutschland' },
    { name: 'Matterhorn', lat: 45.976, lon: 7.658, elevation: 4478, isMountain: true, country: 'Schweiz' },
    { name: 'Großglockner', lat: 47.074, lon: 12.695, elevation: 3798, isMountain: true, country: 'Österreich' },
    { name: 'Nebelhorn', lat: 47.422, lon: 10.342, elevation: 2224, isMountain: true, country: 'Deutschland' },
    { name: 'München', lat: 48.137, lon: 11.575, elevation: 519, isMountain: false, country: 'Deutschland' }
  ];

  let html = `<div class="recent-searches-box">`;

  if (recents && recents.length > 0) {
    html += `
      <div class="recent-header-row">
        <span>⏱️ Zuletzt gesucht</span>
        <button type="button" class="recent-clear-btn" id="search-clear-recents-btn">Verlauf löschen</button>
      </div>
      <div class="recent-list-container">
    `;
    recents.forEach((item, idx) => {
      const icon = item.isMountain ? '🏔️' : '🏙️';
      html += `
        <div class="dropdown-item recent-search-item" data-idx="${idx}">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">${icon}</span>
            <div>
              <div class="dropdown-city">${escapeHtml(item.name)}</div>
              <div class="dropdown-region">${escapeHtml(item.country || (item.isMountain ? 'Berg / Gipfel' : 'Ort'))}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="dropdown-elevation">${item.elevation ? item.elevation.toLocaleString('de-DE') + ' m' : ''}</span>
            <button type="button" class="recent-item-del" data-del-name="${escapeHtml(item.name)}" title="Aus Verlauf entfernen">✕</button>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  html += `
    <div class="recent-header-row" style="margin-top:4px;">
      <span>🏔️ Beliebte Gipfel & Orte</span>
    </div>
    <div class="recent-presets-row">
  `;

  presets.forEach((p, idx) => {
    html += `
      <button type="button" class="recent-preset-chip" data-preset-idx="${idx}">
        ${p.isMountain ? '🏔️' : '🏙️'} ${escapeHtml(p.name)} <span style="opacity:0.65; font-size:10px;">${p.elevation}m</span>
      </button>
    `;
  });

  html += `</div></div>`;

  dropdown.innerHTML = html;
  dropdown.style.display = 'block';

  // Event handlers for recents
  if (recents && recents.length > 0) {
    const clearRecentsBtn = dropdown.querySelector('#search-clear-recents-btn');
    if (clearRecentsBtn) {
      clearRecentsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        AlpineStorage.safeSetItem('alpine_recent_searches', []);
        renderSearchRecentsAndPresetsDropdown();
        renderSpotlightRecentsUI();
      });
    }

    dropdown.querySelectorAll('.recent-search-item').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.recent-item-del')) return;
        const idx = parseInt(row.dataset.idx, 10);
        const item = recents[idx];
        if (item) {
          selectExactLocation(item);
          dropdown.style.display = 'none';
          if (input) input.value = '';
        }
      });
    });

    dropdown.querySelectorAll('.recent-item-del').forEach(delBtn => {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nameToDel = delBtn.dataset.delName;
        let list = getSpotlightRecents();
        list = list.filter(r => r.name !== nameToDel);
        AlpineStorage.safeSetItem('alpine_recent_searches', list);
        renderSearchRecentsAndPresetsDropdown();
        renderSpotlightRecentsUI();
      });
    });
  }

  // Event handlers for presets
  dropdown.querySelectorAll('.recent-preset-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(chip.dataset.presetIdx, 10);
      const p = presets[idx];
      if (p) {
        selectExactLocation(p);
        dropdown.style.display = 'none';
        if (input) input.value = '';
      }
    });
  });
}

export function determineIfMountain(name, featureCode, elevation) {
  const n = name.toLowerCase();
  if (OFFICIAL_KNOWN_ELEVATIONS[n] && OFFICIAL_KNOWN_ELEVATIONS[n].isMountain !== undefined) {
    return OFFICIAL_KNOWN_ELEVATIONS[n].isMountain;
  }
  if (featureCode && featureCode.startsWith('PPL')) {
    return false;
  }
  if (featureCode === 'MT' || featureCode === 'PK' || featureCode === 'PASS' || featureCode === 'MTS' || featureCode === 'HLL' || featureCode === 'RDGE') {
    return true;
  }
  if (n.includes('spitze') || n.includes('horn') || n.includes('kogel') || n.includes('gipfel') || n.includes('wand') || n.includes('grat') || n.includes('massiv') || n.includes('berg')) {
    return true;
  }
  if (elevation >= 1300 && (!featureCode || !featureCode.startsWith('PPL'))) {
    return true;
  }
  return false;
}

export function triggerExactGps(options = {}) {
  const isStartup = !!(options && options.isStartup);
  const quickGpsBtn = document.getElementById('quick-gps-btn');
  const gpsBtn = document.getElementById('gps-btn');

  if (!('geolocation' in navigator)) {
    if (!isStartup) {
      alert('Geolocation wird von diesem Browser nicht unterstützt.');
    }
    return;
  }

  if (quickGpsBtn) {
    quickGpsBtn.style.opacity = '0.6';
    const txt = quickGpsBtn.querySelector('.hgp-text');
    if (txt) txt.innerText = 'Ermittle Standort... 🛰️';
  }
  if (gpsBtn) gpsBtn.style.opacity = '0.5';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      if (quickGpsBtn) {
        quickGpsBtn.style.opacity = '1';
        const txt = quickGpsBtn.querySelector('.hgp-text');
        if (txt) txt.innerText = 'Mein Standort';
      }
      if (gpsBtn) gpsBtn.style.opacity = '1';

      let gpsElev = 500;
      try {
        const elRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`);
        const elData = await elRes.json();
        if (elData.elevation && elData.elevation[0] !== undefined) {
          gpsElev = Math.round(elData.elevation[0]);
        }
      } catch(e) {}

      let locationName = 'Mein Standort';
      try {
        const revRes = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}&localityLanguage=de`);
        if (revRes.ok) {
          const revData = await revRes.json();
          const place = revData.locality || revData.city || revData.principalSubdivision;
          if (place) {
            locationName = `Mein Standort (${place})`;
          }
        }
      } catch (e) {}

      const locObj = {
        name: locationName,
        lat: lat,
        lon: lon,
        elevation: gpsElev,
        isMountain: gpsElev >= 1000,
        isGps: true
      };

      // In persistent storage sichern für sofortigen Start beim nächsten Öffnen
      AlpineStorage.safeSetItem('best_weather_last_gps', locObj);

      // Falls beim Start bereits fast identische Koordinaten geladen sind, nur Objekt aktualisieren
      const isAlreadyLoaded = isStartup && state.weatherData &&
        state.currentLocation &&
        Math.abs(state.currentLocation.lat - lat) < 0.005 &&
        Math.abs(state.currentLocation.lon - lon) < 0.005;

      if (!isAlreadyLoaded) {
        selectExactLocation(locObj);
      } else {
        state.currentLocation = locObj;
        if (window.renderFavoritesTab) window.renderFavoritesTab();
      }
    },
    (err) => {
      if (quickGpsBtn) {
        quickGpsBtn.style.opacity = '1';
        const txt = quickGpsBtn.querySelector('.hgp-text');
        if (txt) txt.innerText = 'Mein Standort';
      }
      if (gpsBtn) gpsBtn.style.opacity = '1';
      console.warn('GPS location notice:', err);
      if (!isStartup) {
        alert('GPS-Standort konnte nicht ermittelt werden. Bitte Standortfreigabe in den Geräteeinstellungen prüfen.');
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}
window.triggerExactGps = triggerExactGps;

export function setupSearch(options = {}) {
  if (options.onLoadLocation) onLoadLocationCallback = options.onLoadLocation;
  if (options.onRenderOverview) onRenderOverviewCallback = options.onRenderOverview;
  if (options.onRenderAdaptiveTab2) onRenderAdaptiveTab2Callback = options.onRenderAdaptiveTab2;

  const input = document.getElementById('location-search-input');
  const dropdown = document.getElementById('search-results-dropdown');
  const clearBtn = document.getElementById('clear-search-btn');
  const gpsBtn = document.getElementById('gps-btn');
  const unitBtn = document.getElementById('unit-toggle-btn');

  if (!input || !dropdown) return;

  let debounceTimer = null;

  input.addEventListener('focus', () => {
    if (window.scrollX !== 0) {
      window.scrollTo(0, window.scrollY);
    }
    if (input.value.trim().length < 2) {
      renderSearchRecentsAndPresetsDropdown();
    }
  });

  input.addEventListener('blur', () => {
    if (window.scrollX !== 0) {
      window.scrollTo(0, window.scrollY);
    }
  });

  input.addEventListener('click', () => {
    if (input.value.trim().length < 2) {
      renderSearchRecentsAndPresetsDropdown();
    }
  });

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (clearBtn) clearBtn.style.display = q.length > 0 ? 'flex' : 'none';

    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.length < 2) {
      renderSearchRecentsAndPresetsDropdown();
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=de&format=json`;
        const data = await resilientFetch(url, { cancelCategory: 'main_search', ttlMs: 60000 });

        dropdown.innerHTML = '';
        if (data.results && data.results.length > 0) {
          const scored = data.results.map(item => {
            let score = 0;
            const country = (item.country || '').toLowerCase();
            if (['schweiz', 'österreich', 'deutschland', 'italien', 'liechtenstein', 'frankreich'].includes(country)) {
              score += 100;
            }
            const fc = item.feature_code || '';
            if (['MT', 'PK'].includes(fc)) score += 30;
            if (['PPLA', 'PPLC'].includes(fc)) score += 20;
            if (item.name.toLowerCase() === q.toLowerCase()) score += 50;
            const pop = item.population || 0;
            score += Math.min(50, pop / 10000);
            return { item, score };
          });
          scored.sort((a, b) => b.score - a.score);

          scored.forEach(({ item }) => {
            const row = document.createElement('div');
            row.className = 'dropdown-item';

            const nLower = item.name.toLowerCase();
            let officialElev = Math.round(item.elevation || 500);
            let isMtn = determineIfMountain(item.name, item.feature_code, officialElev);

            if (OFFICIAL_KNOWN_ELEVATIONS[nLower]) {
              officialElev = OFFICIAL_KNOWN_ELEVATIONS[nLower].elevation;
              isMtn = OFFICIAL_KNOWN_ELEVATIONS[nLower].isMountain;
            }

            const icon = isMtn ? '🏔️' : '🏙️';
            const admin = [item.admin1, item.country].filter(Boolean).join(', ');
            const isFav = state.favorites.some(f => f.name.toLowerCase() === item.name.toLowerCase());

            row.innerHTML = `
              <div class="dd-info">
                <div class="dropdown-city">${icon} ${escapeHtml(item.name)}</div>
                <div class="dropdown-region">${escapeHtml(admin)}</div>
              </div>
              <div class="dd-right">
                <span class="dropdown-elevation">${officialElev.toLocaleString('de-DE')} m</span>
                <button type="button" class="search-item-star-btn ${isFav ? 'favorited' : ''}" title="${isFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}" aria-label="Favorit umschalten">
                  ${isFav ? '★' : '☆'}
                </button>
              </div>
            `;

            const starBtn = row.querySelector('.search-item-star-btn');
            if (starBtn) {
              starBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const nowFav = toggleFavoriteLocation({
                  name: item.name,
                  lat: item.latitude,
                  lon: item.longitude,
                  elevation: officialElev,
                  country: item.country || '',
                  isMountain: isMtn
                });
                starBtn.innerText = nowFav ? '★' : '☆';
                starBtn.classList.toggle('favorited', nowFav);
                starBtn.title = nowFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
              });
            }

            row.addEventListener('click', () => {
              selectExactLocation({
                name: item.name,
                lat: item.latitude,
                lon: item.longitude,
                elevation: officialElev,
                country: item.country || '',
                isMountain: isMtn
              });
              dropdown.style.display = 'none';
              input.value = '';
              if (clearBtn) clearBtn.style.display = 'none';
            });

            dropdown.appendChild(row);
          });
          dropdown.style.display = 'block';
        } else {
          dropdown.innerHTML = '<div style="padding:14px; text-align:center; color:rgba(255,255,255,0.6); font-size:13px;">Kein Ort gefunden</div>';
          dropdown.style.display = 'block';
        }
      } catch (err) {
        console.error('Suche fehlgeschlagen:', err);
      }
    }, 250);
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;

      const firstItem = dropdown.querySelector('.dropdown-item');
      if (firstItem) {
        firstItem.click();
        return;
      }

      const coordMatch = q.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);
        if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          let elev = 500;
          try {
            const elRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`);
            const elData = await elRes.json();
            if (elData.elevation && elData.elevation[0] !== undefined) elev = Math.round(elData.elevation[0]);
          } catch(err) {}
          selectExactLocation({
            name: `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
            lat,
            lon,
            elevation: elev,
            isMountain: elev >= 1000
          });
          dropdown.style.display = 'none';
          input.value = '';
          if (clearBtn) clearBtn.style.display = 'none';
          return;
        }
      }

      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=de&format=json`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const item = data.results[0];
          const nLower = item.name.toLowerCase();
          let officialElev = Math.round(item.elevation || 500);
          let isMtn = determineIfMountain(item.name, item.feature_code, officialElev);
          if (OFFICIAL_KNOWN_ELEVATIONS[nLower]) {
            officialElev = OFFICIAL_KNOWN_ELEVATIONS[nLower].elevation;
            isMtn = OFFICIAL_KNOWN_ELEVATIONS[nLower].isMountain;
          }
          selectExactLocation({
            name: item.name,
            lat: item.latitude,
            lon: item.longitude,
            elevation: officialElev,
            country: item.country || '',
            isMountain: isMtn
          });
          dropdown.style.display = 'none';
          input.value = '';
          if (clearBtn) clearBtn.style.display = 'none';
        }
      } catch(err) {}
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      renderSearchRecentsAndPresetsDropdown();
      input.focus();
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container') && !e.target.closest('.search-dropdown')) {
      dropdown.style.display = 'none';
    }
  });

  if (gpsBtn) {
    gpsBtn.addEventListener('click', triggerExactGps);
  }

  if (unitBtn) {
    unitBtn.addEventListener('click', () => {
      state.unit = state.unit === 'celsius' ? 'fahrenheit' : 'celsius';
      unitBtn.innerText = state.unit === 'celsius' ? '°C' : '°F';
      if (onRenderOverviewCallback) onRenderOverviewCallback();
      else if (window.renderOverviewTab) window.renderOverviewTab();
      if (onRenderAdaptiveTab2Callback) onRenderAdaptiveTab2Callback();
      else if (window.renderAdaptiveTab2) window.renderAdaptiveTab2();
    });
  }
}

export function setupSpotlightAndQuickGps() {
  const triggerBtn = document.getElementById('spotlight-trigger-btn');
  const quickGpsBtn = document.getElementById('quick-gps-btn');
  const modal = document.getElementById('spotlight-modal-overlay');
  const closeBtn = document.getElementById('spotlight-modal-close');
  const input = document.getElementById('spotlight-search-input');
  const resultsContainer = document.getElementById('spotlight-results-list');
  const quickChips = document.querySelectorAll('.spotlight-quick-chips .sq-chip');

  if (!modal || !input) return;

  let selectedIndex = -1;
  let debounceTimer = null;

  function trapModalFocus(e) {
    if (e.key !== 'Tab') return;
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function openSpotlight() {
    modal.style.display = 'flex';
    input.value = '';
    selectedIndex = -1;
    renderSpotlightRecentsUI();
    renderSpotlightInitial();
    modal.addEventListener('keydown', trapModalFocus);
    setTimeout(() => input.focus(), 60);
  }

  function closeSpotlight() {
    modal.style.display = 'none';
    modal.removeEventListener('keydown', trapModalFocus);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (triggerBtn) triggerBtn.focus();
  }

  function renderSpotlightInitial() {
    resultsContainer.innerHTML = `
      <div style="padding: 22px 14px; text-align: center; color: var(--text-secondary); font-size: 13px;">
        💡 Tippe Stadt, Berggipfel oder Koordinaten ein oder klicke oben eine Schnellwahl.
      </div>
    `;
  }

  if (triggerBtn) {
    triggerBtn.addEventListener('click', openSpotlight);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSpotlight);
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeSpotlight();
    }
  });

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal.style.display === 'flex') {
        closeSpotlight();
      } else {
        openSpotlight();
      }
    } else if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeSpotlight();
    }
  });

  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.quick;
      closeSpotlight();
      if (q === 'gps') {
        triggerExactGps();
      } else if (q === 'matterhorn') {
        selectExactLocation({ name: 'Matterhorn', lat: 45.9765, lon: 7.6586, elevation: 4478, country: 'Schweiz', isMountain: true });
      } else if (q === 'zugspitze') {
        selectExactLocation({ name: 'Zugspitze', lat: 47.4211, lon: 10.9853, elevation: 2962, country: 'Deutschland', isMountain: true });
      } else if (q === 'grossglockner') {
        selectExactLocation({ name: 'Großglockner', lat: 47.0742, lon: 12.6947, elevation: 3798, country: 'Österreich', isMountain: true });
      } else if (q === 'watzmann') {
        selectExactLocation({ name: 'Watzmann-Mittelspitze', lat: 47.5539, lon: 12.9217, elevation: 2713, country: 'Deutschland', isMountain: true });
      } else if (q === 'muenchen') {
        selectExactLocation({ name: 'München', lat: 48.1371, lon: 11.5754, elevation: 519, country: 'Deutschland', isMountain: false });
      } else if (q === 'innsbruck') {
        selectExactLocation({ name: 'Innsbruck', lat: 47.2692, lon: 11.4041, elevation: 574, country: 'Österreich', isMountain: false });
      } else if (q === 'zuerich') {
        selectExactLocation({ name: 'Zürich', lat: 47.3769, lon: 8.5417, elevation: 408, country: 'Schweiz', isMountain: false });
      }
    });
  });

  if (quickGpsBtn) {
    quickGpsBtn.addEventListener('click', triggerExactGps);
  }

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    selectedIndex = -1;

    if (q.length < 2) {
      renderSpotlightInitial();
      return;
    }

    debounceTimer = setTimeout(async () => {
      const coordMatch = q.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);
        if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          let elev = 500;
          try {
            const elRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`);
            const elData = await elRes.json();
            if (elData.elevation && elData.elevation[0] !== undefined) elev = Math.round(elData.elevation[0]);
          } catch(err) {}

          resultsContainer.innerHTML = '';
          const row = document.createElement('div');
          row.className = 'spotlight-item selected';
          row.innerHTML = `
            <div class="si-left">
              <span class="si-icon">📍</span>
              <div>
                <span class="si-name">${lat.toFixed(4)}°, ${lon.toFixed(4)}°</span>
                <span class="si-sub">Koordinaten-Punkt</span>
              </div>
            </div>
            <div class="si-right">${elev.toLocaleString('de-DE')} m</div>
          `;
          row.addEventListener('click', () => {
            selectExactLocation({
              name: `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
              lat,
              lon,
              elevation: elev,
              isMountain: elev >= 1000
            });
            closeSpotlight();
          });
          resultsContainer.appendChild(row);
          selectedIndex = 0;
          return;
        }
      }

      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=de&format=json`;
        const data = await resilientFetch(url, { cancelCategory: 'spotlight_search', ttlMs: 60000 });

        if (data.results && data.results.length > 0) {
          const scored = data.results.map(item => {
            let score = 0;
            const country = (item.country || '').toLowerCase();
            if (['schweiz', 'österreich', 'deutschland', 'italien', 'liechtenstein', 'frankreich'].includes(country)) {
              score += 100;
            }
            const fc = item.feature_code || '';
            if (['MT', 'PK'].includes(fc)) score += 35;
            if (['PPLA', 'PPLC'].includes(fc)) score += 20;
            if (item.name.toLowerCase() === q.toLowerCase()) score += 50;
            const pop = item.population || 0;
            score += Math.min(50, pop / 10000);
            return { item, score };
          });
          scored.sort((a, b) => b.score - a.score);

          resultsContainer.innerHTML = '';
          scored.forEach(({ item }, idx) => {
            const nLower = item.name.toLowerCase();
            let officialElev = Math.round(item.elevation || 500);
            let isMtn = determineIfMountain(item.name, item.feature_code, officialElev);
            if (OFFICIAL_KNOWN_ELEVATIONS[nLower]) {
              officialElev = OFFICIAL_KNOWN_ELEVATIONS[nLower].elevation;
              isMtn = OFFICIAL_KNOWN_ELEVATIONS[nLower].isMountain;
            }
            const icon = isMtn ? '🏔️' : '🏙️';
            const admin = [item.admin1, item.country].filter(Boolean).join(', ');

            const isFav = state.favorites.some(f => f.name.toLowerCase() === item.name.toLowerCase());

            const row = document.createElement('div');
            row.className = `spotlight-item ${idx === 0 ? 'selected' : ''}`;
            row.innerHTML = `
              <div class="si-left">
                <span class="si-icon">${icon}</span>
                <div>
                  <span class="si-name">${escapeHtml(item.name)}</span>
                  <span class="si-sub">${escapeHtml(admin)}</span>
                </div>
              </div>
              <div class="si-right">
                <span>${officialElev.toLocaleString('de-DE')} m</span>
                <button type="button" class="spotlight-fav-star-btn ${isFav ? 'favorited' : ''}" title="${isFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}" aria-label="Favorit umschalten">
                  ${isFav ? '★' : '☆'}
                </button>
              </div>
            `;

            const starBtn = row.querySelector('.spotlight-fav-star-btn');
            if (starBtn) {
              starBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const nowFav = toggleFavoriteLocation({
                  name: item.name,
                  lat: item.latitude,
                  lon: item.longitude,
                  elevation: officialElev,
                  country: item.country || '',
                  isMountain: isMtn
                });
                starBtn.innerText = nowFav ? '★' : '☆';
                starBtn.classList.toggle('favorited', nowFav);
                starBtn.title = nowFav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
              });
            }

            row.addEventListener('click', () => {
              selectExactLocation({
                name: item.name,
                lat: item.latitude,
                lon: item.longitude,
                elevation: officialElev,
                country: item.country || '',
                isMountain: isMtn
              });
              closeSpotlight();
            });

            resultsContainer.appendChild(row);
          });
          selectedIndex = 0;
        } else {
          resultsContainer.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">
              Kein Ort oder Berggipfel gefunden für "${escapeHtml(q)}"
            </div>
          `;
          selectedIndex = -1;
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Spotlight Suche fehlgeschlagen:', err);
        }
      }
    }, 200);
  });

  input.addEventListener('keydown', (e) => {
    const items = resultsContainer.querySelectorAll('.spotlight-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedIndex));
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedIndex));
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetItem = selectedIndex >= 0 ? items[selectedIndex] : items[0];
      if (targetItem) {
        targetItem.click();
      }
    }
  });
}

export function updateNavigationWarningBadges() {
  const mtnDotMobile = document.getElementById('mbn-dot-mountain');
  const mtnDotDesktop = document.getElementById('tab-dot-mountain');
  const sportsDotMobile = document.getElementById('mbn-dot-sports');
  const sportsDotDesktop = document.getElementById('tab-dot-sports');

  const loc = state.currentLocation;
  const av = (loc && state.weatherData)
    ? MicroEngine.computeAvalancheReport(loc.lat, loc.lon, loc.elevation, state.weatherData, state.microData ? state.microData.terrain10m : null)
    : null;

  const hasMountainWarning = av && av.dangerLevel >= 3;
  [mtnDotMobile, mtnDotDesktop].forEach(dot => {
    if (dot) {
      dot.style.display = hasMountainWarning ? 'block' : 'none';
      dot.classList.toggle('dot-orange', !!(av && av.dangerLevel === 3));
    }
  });

  const hasSportsWarning = state.sports.hazards && (state.sports.hazards.level === 'yellow' || state.sports.hazards.level === 'red');
  [sportsDotMobile, sportsDotDesktop].forEach(dot => {
    if (dot) dot.style.display = hasSportsWarning ? 'block' : 'none';
  });
}
