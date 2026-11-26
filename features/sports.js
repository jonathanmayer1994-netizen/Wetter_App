/**
 * BEST WEATHER — Sports & GPX Tour Domain Feature Module (Task 1a)
 * GPX inspector, elevation profile chart, pace calculator, timeline simulation,
 * waypoint weather alerts, and route scrubber.
 */

import { state } from '../core/state.js';
import { WeatherTourCache } from '../core/weatherTourCache.js';
import { AlpineStorage } from '../storage.js';
import { escapeHtml, resilientFetch } from '../httpClient.js';
import { updateWeatherOverlay } from './map.js';
import { MicroEngine } from '../microEngine.js';
import { updateNavigationWarningBadges } from './search.js';

export function convertTemp(celsius) {
  if (state.unit === 'fahrenheit') {
    return (celsius * 9 / 5) + 32;
  }
  return celsius;
}

function switchTab(tabId) {
  if (window.switchTab) window.switchTab(tabId);
}


// =============================================================================
// GPX-ROUTEN-INSPEKTOR & HÖHENPROFIL-MIKROWETTER
// =============================================================================
let activeGPXData = null;
let gpxMapPolyline = null;
let gpxMapPolylineOutline = null;
let gpxStartMarker = null;
let gpxEndMarker = null;

export function clearGPXFromMap() {
  if (gpxMapPolyline && state.map.instance) state.map.instance.removeLayer(gpxMapPolyline);
  if (gpxMapPolylineOutline && state.map.instance) state.map.instance.removeLayer(gpxMapPolylineOutline);
  if (gpxStartMarker && state.map.instance) state.map.instance.removeLayer(gpxStartMarker);
  if (gpxEndMarker && state.map.instance) state.map.instance.removeLayer(gpxEndMarker);
  gpxMapPolyline = null;
  gpxMapPolylineOutline = null;
  gpxStartMarker = null;
  gpxEndMarker = null;

  const tourBanner = document.getElementById('gpx-active-tour-banner');
  if (tourBanner) tourBanner.style.display = 'none';

  // Standort-Marker wieder einblenden
  if (state.map.marker && state.map.instance) {
    state.map.marker.addTo(state.map.instance);
  }
  updateWeatherOverlay();
}

export function setupGPXInspector() {
  const openBtn = document.getElementById('gpx-open-btn');
  const modal = document.getElementById('gpx-modal-overlay');
  const closeBtn = document.getElementById('gpx-modal-close');
  const browseBtn = document.getElementById('gpx-browse-btn');
  const fileInput = document.getElementById('gpx-file-input');
  const dropZone = document.getElementById('gpx-drop-zone');
  const showOnMapBtn = document.getElementById('gpx-show-on-map-btn');

  // Floating Banner Close Button
  const gatbCloseBtn = document.getElementById('gatb-close-btn');
  if (gatbCloseBtn) {
    gatbCloseBtn.addEventListener('click', clearGPXFromMap);
  }

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
      // Standardmäßig sofort Tour laden, falls noch keine geladen ist
      if (!activeGPXData) {
        const sample = MicroEngine.getSampleGPXTrack('nebelhorn-oberstdorf');
        processGPXTrack(sample.xml, sample.name);
      }
    });
  }

  const closeActionBtn = document.getElementById('gpx-modal-close-action');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    if (closeActionBtn) {
      closeActionBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  // Presets
  const presetBtns = document.querySelectorAll('.gpx-preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tourId = btn.dataset.tour;
      const sample = MicroEngine.getSampleGPXTrack(tourId);
      processGPXTrack(sample.xml, sample.name);
      loadSportsPresetTour(tourId);
    });
  });

  // Browse Button & File Input
  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          processGPXTrack(ev.target.result, file.name.replace(/\.gpx$/i, ''));
        };
        reader.readAsText(file);
      }
    });
  }

  // Drag and Drop
  if (dropZone) {
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          processGPXTrack(ev.target.result, file.name.replace(/\.gpx$/i, ''));
        };
        reader.readAsText(file);
      }
    });
  }

  // Button: Auf Karte anzeigen
  if (showOnMapBtn) {
    showOnMapBtn.addEventListener('click', () => {
      if (!activeGPXData || !activeGPXData.points || !state.map.instance) return;
      if (modal) modal.style.display = 'none';

      // Wechsle auf Tab 3 (Karte)
      switchTab('tab-map');

      // Zeichne Polyline auf Karte
      const latLngs = activeGPXData.points.map(p => [p.lat, p.lon]);

      if (gpxMapPolyline) state.map.instance.removeLayer(gpxMapPolyline);
      if (gpxMapPolylineOutline) state.map.instance.removeLayer(gpxMapPolylineOutline);
      if (gpxStartMarker) state.map.instance.removeLayer(gpxStartMarker);
      if (gpxEndMarker) state.map.instance.removeLayer(gpxEndMarker);

      // Verberge Standort-Marker und sonstige Stationen: NUR Start, Ziel und GPX-Strecke anzeigen!
      if (state.map.marker) {
        state.map.marker.closePopup();
        state.map.instance.removeLayer(state.map.marker);
      }
      if (state.map.weatherLayerGroup) {
        state.map.weatherLayerGroup.clearLayers();
      }

      // 1. Kontrast-Randlinie
      gpxMapPolylineOutline = L.polyline(latLngs, {
        color: '#020617',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(state.map.instance);

      // 2. Haupt-GPX-Strecke (Leuchtendes Cyan)
      gpxMapPolyline = L.polyline(latLngs, {
        color: '#00e5ff',
        weight: 5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(state.map.instance);

      // 3. Startpunkt & Endpunkt (Ziel) Marker
      const pStart = activeGPXData.points[0];
      const pEnd = activeGPXData.points[activeGPXData.points.length - 1];

      const startIcon = L.divIcon({
        className: 'gpx-leaflet-icon',
        html: `<div class="gpx-endpoint-badge gpx-start-badge"><span class="gpx-pin-icon">🟢</span><span class="gpx-pin-text">Start:</span><span class="gpx-pin-ele">${pStart.ele} m</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });
      gpxStartMarker = L.marker([pStart.lat, pStart.lon], { icon: startIcon, zIndexOffset: 3000 }).addTo(state.map.instance);

      // Das Ziel ist das ZIEL und nicht der Gipfel!
      const endIcon = L.divIcon({
        className: 'gpx-leaflet-icon',
        html: `<div class="gpx-endpoint-badge gpx-end-badge"><span class="gpx-pin-icon">🏁</span><span class="gpx-pin-text">Ziel:</span><span class="gpx-pin-ele">${pEnd.ele} m</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });
      gpxEndMarker = L.marker([pEnd.lat, pEnd.lon], { icon: endIcon, zIndexOffset: 3000 }).addTo(state.map.instance);

      // 4. Interaktives Tooltip entlang der Strecke beim Bewegen über den Track
      gpxMapPolyline.on('mousemove', (e) => {
        let closest = activeGPXData.points[0];
        let minDist = Infinity;
        for (const pt of activeGPXData.points) {
          const d = Math.hypot(pt.lat - e.latlng.lat, pt.lon - e.latlng.lng);
          if (d < minDist) {
            minDist = d;
            closest = pt;
          }
        }
        gpxMapPolyline.bindTooltip(`📍 ${closest.ele} m • Distanz: ${closest.distFromStartKm ? closest.distFromStartKm.toFixed(1) + ' km' : ''}`, {
          sticky: true,
          className: 'gpx-track-tooltip'
        }).openTooltip();
      });

      // 5. Aktives Tour-Banner auf der Karte einblenden
      const tourBanner = document.getElementById('gpx-active-tour-banner');
      const gatbName = document.getElementById('gatb-name');
      const gatbStats = document.getElementById('gatb-stats');
      if (tourBanner) {
        tourBanner.style.display = 'flex';
        if (gatbName) gatbName.innerText = activeGPXData.name;
        if (gatbStats) gatbStats.innerText = `(${activeGPXData.totalDistanceKm} km, +${activeGPXData.totalAscentM} Hm) • 🟢 Start: ${pStart.ele} m ➔ 🏁 Ziel: ${pEnd.ele} m`;
      }

      // 6. Zoome auf die gesamte Tour mit sauberem Padding
      setTimeout(() => {
        state.map.instance.fitBounds(gpxMapPolyline.getBounds(), { padding: [60, 60] });
      }, 200);
    });
  }
}

export function processGPXTrack(xmlText, tourName) {
  const parsed = MicroEngine.parseGPXData(xmlText);
  if (!parsed.success) {
    alert('GPX-Datei konnte nicht verarbeitet werden: ' + (parsed.error || 'Ungültiges Format'));
    return;
  }

  activeGPXData = { ...parsed, name: tourName };

  // Stats Grid anzeigen
  const statsGrid = document.getElementById('gpx-stats-grid');
  const chartWrapper = document.getElementById('gpx-chart-wrapper');
  const actionsRow = document.getElementById('gpx-actions-row');

  if (statsGrid) statsGrid.style.display = 'grid';
  if (chartWrapper) chartWrapper.style.display = 'block';
  if (actionsRow) actionsRow.style.display = 'flex';

  document.getElementById('gpx-dist-val').innerText = `${parsed.totalDistanceKm} km`;
  document.getElementById('gpx-ascent-val').innerText = `+${parsed.totalAscentM} Hm (-${parsed.totalDescentM} Hm)`;
  document.getElementById('gpx-maxele-val').innerText = `${parsed.maxElevationM} m (Min ${parsed.minElevationM} m)`;
  document.getElementById('gpx-time-val').innerText = `${parsed.estimatedDuration}`;

  renderGPXElevationSVG(parsed);
}

export function renderGPXElevationSVG(parsed) {
  const svg = document.getElementById('gpx-elevation-svg');
  if (!svg || !parsed.points || parsed.points.length === 0) return;

  const pts = parsed.points;
  const count = pts.length;
  const W = 800;
  const H = 200;
  const padL = 50;
  const padR = 30;
  const padT = 30;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minZ = Math.max(0, parsed.minElevationM - 100);
  const maxZ = parsed.maxElevationM + 100;
  const rangeZ = Math.max(10, maxZ - minZ);
  const totalDist = Math.max(0.1, parsed.totalDistanceKm);

  // Basis-Temperatur aus aktuellem Wetter (oder 12°C auf 500m)
  const baseT = state.weatherData ? (state.weatherData.current ? state.weatherData.current.temperature_2m : 12) : 12;
  const baseElev = (state.currentLocation && state.currentLocation.elevation) ? state.currentLocation.elevation : 500;

  const getX = dKm => padL + (dKm / totalDist) * plotW;
  const getY = ele => padT + plotH - ((ele - minZ) / rangeZ) * plotH;

  const lineCoords = [];

  for (let i = 0; i < count; i++) {
    const x = getX(pts[i].distFromStartKm);
    const y = getY(pts[i].ele);
    lineCoords.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  const polyBottomLeft = `${padL},${padT + plotH}`;
  const polyBottomRight = `${(padL + plotW).toFixed(1)},${padT + plotH}`;
  const fillPoly = `${polyBottomLeft} ${lineCoords.join(' ')} ${polyBottomRight}`;

  // Start-, Gipfel- und Zieltemperaturen berechnen (0.65°C pro 100m)
  const pStart = pts[0];
  const pMax = pts.reduce((prev, cur) => cur.ele > prev.ele ? cur : prev, pts[0]);
  const pEnd = pts[pts.length - 1];

  const tStart = Math.round(baseT - ((pStart.ele - baseElev) * 0.0065));
  const tMax = Math.round(baseT - ((pMax.ele - baseElev) * 0.0065));
  const tEnd = Math.round(baseT - ((pEnd.ele - baseElev) * 0.0065));

  const xStart = getX(pStart.distFromStartKm);
  const yStart = getY(pStart.ele);
  const xMax = getX(pMax.distFromStartKm);
  const yMax = getY(pMax.ele);
  const xEnd = getX(pEnd.distFromStartKm);
  const yEnd = getY(pEnd.ele);

  svg.innerHTML = `
    <defs>
      <linearGradient id="gpx-poly-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.4" />
        <stop offset="100%" stop-color="#00e5ff" stop-opacity="0.05" />
      </linearGradient>
    </defs>

    <!-- Achsen & Horizontale Linien -->
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.2)" />
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.2)" />
    <text x="${padL - 8}" y="${padT + 8}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="end" font-family="monospace">${maxZ}m</text>
    <text x="${padL - 8}" y="${padT + plotH}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="end" font-family="monospace">${minZ}m</text>
    <text x="${padL}" y="${H - 12}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="start">0 km</text>
    <text x="${W - padR}" y="${H - 12}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="end">${totalDist.toFixed(1)} km</text>

    <!-- Flächen- und Linienverlauf -->
    <polygon points="${fillPoly}" fill="url(#gpx-poly-grad)" />
    <polyline points="${lineCoords.join(' ')}" fill="none" stroke="#00e5ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Startpunkt -->
    <circle cx="${xStart}" cy="${yStart}" r="4" fill="#30d158" stroke="#fff" stroke-width="1.5" />
    <text x="${xStart + 6}" y="${yStart - 6}" fill="#30d158" font-size="11" font-weight="700">Start: ${pStart.ele}m (${tStart}°C)</text>

    <!-- Höchster Punkt / Gipfel -->
    <circle cx="${xMax}" cy="${yMax}" r="5" fill="#ffd166" stroke="#fff" stroke-width="1.5" />
    <text x="${xMax}" y="${Math.max(14, yMax - 10)}" fill="#ffd166" font-size="11" font-weight="800" text-anchor="middle">🏔️ ${pMax.ele}m (${tMax}°C)</text>

    <!-- Zielpunkt -->
    <circle cx="${xEnd}" cy="${yEnd}" r="4" fill="#64d2ff" stroke="#fff" stroke-width="1.5" />
    <text x="${xEnd - 6}" y="${yEnd - 6}" fill="#64d2ff" font-size="11" font-weight="700" text-anchor="end">Ziel: ${pEnd.ele}m (${tEnd}°C)</text>
  `;
}

// =============================================================================
// SPORT & TOUREN-WETTER CONTROLLER (GPX ROUTEN-WETTER ÜBER DIE GESAMTE DAUER)
// =============================================================================

export function formatLocalDatetime(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function updateSportsStartTime(newDateStr, newTimeStr) {
  if (newDateStr) state.sports.startDateStr = newDateStr;
  if (newTimeStr) state.sports.startTimeStr = newTimeStr;

  const dStr = state.sports.startDateStr || new Date().toISOString().slice(0, 10);
  const tStr = state.sports.startTimeStr || '08:00';
  const fullIso = `${dStr}T${tStr}`;
  const parsedMs = new Date(fullIso).getTime();
  if (!isNaN(parsedMs)) {
    state.sports.startTimeMs = parsedMs;
    const legacyInput = document.getElementById('sports-start-time');
    if (legacyInput) legacyInput.value = fullIso;
  }
  recomputeSportsTimeline();
}

export function setAthleteCategory(cat) {
  state.sports.category = cat;
  state.sports.sportType = cat === 'bike' ? 'road_bike' : (cat === 'skitour' ? 'ski_touring' : 'hiking');

  const catCards = document.querySelectorAll('.athlete-cat-card');
  catCards.forEach(c => c.classList.toggle('active', c.dataset.category === cat));

  const bikePanel = document.getElementById('athlete-bike-controls');
  const mtnPanel = document.getElementById('athlete-mountain-controls');
  const skiPanel = document.getElementById('athlete-skitour-controls');
  const skiDash = document.getElementById('skitour-dashboard-card');

  if (bikePanel) bikePanel.style.display = cat === 'bike' ? 'block' : 'none';
  if (mtnPanel) mtnPanel.style.display = cat === 'mountain' ? 'block' : 'none';
  if (skiPanel) skiPanel.style.display = cat === 'skitour' ? 'block' : 'none';
  if (skiDash) skiDash.style.display = cat === 'skitour' ? 'block' : 'none';
  const slopeToggleBtn = document.getElementById('sports-slope-overlay-btn');
  if (slopeToggleBtn) slopeToggleBtn.style.display = cat === 'skitour' ? 'inline-flex' : 'none';
  if (cat !== 'skitour' && state.sports.slopeLayerGroup && state.sports.map) {
    state.sports.map.removeLayer(state.sports.slopeLayerGroup);
  }

  // Synchronisiere versteckte Legacy-Pills für Tests
  document.querySelectorAll('.sport-pill').forEach(sp => {
    sp.classList.toggle('active', sp.dataset.sport === state.sports.sportType);
  });

  updateSportPaceBadges();
  recomputeSportsTimeline();

  // Wenn Skitour aktiviert wird & noch keine frischen Multi-Wegpunkt-Daten (Tal+Gipfel+72h) geladen wurden: Live nachladen
  if (cat === 'skitour' && state.sports.parsedGPX) {
    const cacheAge = Date.now() - (state.sports.lastLiveFetchMs || 0);
    if (!state.sports.cachedPeakForecast || cacheAge > 5 * 60 * 1000) {
      refreshLiveSkitourForecast(false);
    }
  }
}

export async function refreshLiveSkitourForecast(forceRefresh = true) {
  if (!state.sports.parsedGPX) return;
  const reqSeq = ++state.sports.requestSeq;
  const btn = document.getElementById('skitour-live-refresh-btn');
  if (btn) {
    btn.classList.add('is-loading');
    btn.innerText = '⏳ Lädt...';
  }
  try {
    const parsed = state.sports.parsedGPX;
    const startPt = parsed.points[0];
    const pkg = await fetchHourlyForRoute(startPt.lat, startPt.lon, parsed, forceRefresh);
    if (reqSeq !== state.sports.requestSeq) return;
    if (pkg && pkg.valley) {
      state.sports.cachedForecast = pkg.valley;
      state.sports.cachedPeakForecast = pkg.peak || null;
      state.sports.officialBulletin = pkg.officialBulletin || null;
      state.sports.snowStationData = pkg.snowStationData || null;
      state.sports.demSamples = pkg.demSamples || state.sports.demSamples || null;
      if (state.sports.parsedGPX && state.sports.demSamples) {
        state.sports.parsedGPX._demSamples = state.sports.demSamples;
      }
      state.sports.lastLiveFetchMs = pkg.fetchedAtMs || Date.now();
    } else if (pkg) {
      state.sports.cachedForecast = pkg;
      state.sports.cachedPeakForecast = null;
      state.sports.officialBulletin = null;
      state.sports.snowStationData = null;
      state.sports.lastLiveFetchMs = Date.now();
    }
    recomputeSportsTimeline();
  } finally {
    if (btn) {
      btn.classList.remove('is-loading');
      btn.innerText = '🔄 Live';
    }
  }
}

export function setupSportsTab() {
  // 1. ATHLETEN-KATEGORIE WÄHLER (Rad & Berge)
  const catCards = document.querySelectorAll('.athlete-cat-card');

  catCards.forEach(card => {
    card.addEventListener('click', () => {
      const cat = card.dataset.category; // 'bike' oder 'mountain'
      setAthleteCategory(cat);
    });
  });

  // 2. RAD: STUFENLOSE GESCHWINDIGKEIT, STEPPER & PRESETS
  const bikeSlider = document.getElementById('bike-speed-slider');
  const bikeVal = document.getElementById('bike-speed-val');
  const bikeMinus = document.getElementById('bike-speed-minus');
  const bikePlus = document.getElementById('bike-speed-plus');
  const bikePresets = document.querySelectorAll('#bike-presets-row .atp-preset-btn');

  function setBikeSpeed(kmh) {
    const val = Math.max(10, Math.min(45, Math.round(kmh * 2) / 2));
    state.sports.bikeSpeedKmH = val;
    if (bikeSlider) bikeSlider.value = val;
    if (bikeVal) bikeVal.innerText = `${val.toFixed(1)} km/h`;
    const badge = document.getElementById('acc-bike-badge');
    if (badge) badge.innerText = `${val.toFixed(1)} km/h`;

    bikePresets.forEach(btn => {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.speed) - val) < 0.2);
    });
    recomputeSportsTimeline();
  }

  if (bikeSlider) {
    bikeSlider.addEventListener('input', () => {
      setBikeSpeed(parseFloat(bikeSlider.value) || 26.0);
    });
  }
  if (bikeMinus) {
    bikeMinus.addEventListener('click', () => {
      setBikeSpeed((state.sports.bikeSpeedKmH || 26.0) - 0.5);
    });
  }
  if (bikePlus) {
    bikePlus.addEventListener('click', () => {
      setBikeSpeed((state.sports.bikeSpeedKmH || 26.0) + 0.5);
    });
  }
  bikePresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const sp = parseFloat(btn.dataset.speed);
      if (!isNaN(sp)) setBikeSpeed(sp);
    });
  });

  // 3. BERGE: STUFENLOSE KM/H, AUFSTIEG HM/H, STEPPER & PRESETS
  const mtnSpeedSlider = document.getElementById('mtn-speed-slider');
  const mtnSpeedVal = document.getElementById('mtn-speed-val');
  const mtnSpeedMinus = document.getElementById('mtn-speed-minus');
  const mtnSpeedPlus = document.getElementById('mtn-speed-plus');
  const mtnSpeedPresets = document.querySelectorAll('#mtn-speed-presets .atp-preset-btn');

  function setMtnSpeed(kmh) {
    const val = Math.max(1.5, Math.min(8.0, Math.round(kmh * 10) / 10));
    state.sports.mountainSpeedKmH = val;
    if (mtnSpeedSlider) mtnSpeedSlider.value = val;
    if (mtnSpeedVal) mtnSpeedVal.innerText = `${val.toFixed(1)} km/h`;
    const badge = document.getElementById('acc-mountain-badge');
    if (badge) badge.innerText = `${val.toFixed(1)} km/h`;

    mtnSpeedPresets.forEach(btn => {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.mtnspeed) - val) < 0.1);
    });
    recomputeSportsTimeline();
  }

  if (mtnSpeedSlider) {
    mtnSpeedSlider.addEventListener('input', () => {
      setMtnSpeed(parseFloat(mtnSpeedSlider.value) || 4.0);
    });
  }
  if (mtnSpeedMinus) {
    mtnSpeedMinus.addEventListener('click', () => {
      setMtnSpeed((state.sports.mountainSpeedKmH || 4.0) - 0.1);
    });
  }
  if (mtnSpeedPlus) {
    mtnSpeedPlus.addEventListener('click', () => {
      setMtnSpeed((state.sports.mountainSpeedKmH || 4.0) + 0.1);
    });
  }
  mtnSpeedPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const sp = parseFloat(btn.dataset.mtnspeed);
      if (!isNaN(sp)) setMtnSpeed(sp);
    });
  });

  const mtnAscentSlider = document.getElementById('mtn-ascent-slider');
  const mtnAscentVal = document.getElementById('mtn-ascent-val');
  const mtnAscentMinus = document.getElementById('mtn-ascent-minus');
  const mtnAscentPlus = document.getElementById('mtn-ascent-plus');
  const mtnAscentPresets = document.querySelectorAll('#mtn-ascent-presets .atp-preset-btn');

  function setMtnAscent(hmh) {
    const val = Math.max(150, Math.min(1200, Math.round(hmh / 25) * 25));
    state.sports.mountainAscentHmH = val;
    if (mtnAscentSlider) mtnAscentSlider.value = val;
    if (mtnAscentVal) mtnAscentVal.innerText = `${val} Hm/h`;
    const badge = document.getElementById('acc-mountain-badge');
    if (badge) badge.innerText = `${state.sports.mountainSpeedKmH.toFixed(1)} km/h`;

    mtnAscentPresets.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.ascent, 10) === val);
    });
    recomputeSportsTimeline();
  }

  if (mtnAscentSlider) {
    mtnAscentSlider.addEventListener('input', () => {
      setMtnAscent(parseInt(mtnAscentSlider.value, 10) || 400);
    });
  }
  if (mtnAscentMinus) {
    mtnAscentMinus.addEventListener('click', () => {
      setMtnAscent((state.sports.mountainAscentHmH || 400) - 25);
    });
  }
  if (mtnAscentPlus) {
    mtnAscentPlus.addEventListener('click', () => {
      setMtnAscent((state.sports.mountainAscentHmH || 400) + 25);
    });
  }
  mtnAscentPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const asc = parseInt(btn.dataset.ascent, 10);
      if (!isNaN(asc)) setMtnAscent(asc);
    });
  });

  // 3b. SKITOUR: STUFENLOSE FELL-STEIGRATE (Hm/h) & SKIABFAHRT (km/h)
  const skiAscentSlider = document.getElementById('skitour-ascent-slider');
  const skiAscentVal = document.getElementById('skitour-ascent-val');
  const skiAscentMinus = document.getElementById('skitour-ascent-minus');
  const skiAscentPlus = document.getElementById('skitour-ascent-plus');
  const skiAscentPresets = document.querySelectorAll('#skitour-ascent-presets .atp-preset-btn');

  function setSkiAscent(hmh) {
    const val = Math.max(150, Math.min(1200, Math.round(hmh / 25) * 25));
    state.sports.skitourAscentHmH = val;
    if (skiAscentSlider) skiAscentSlider.value = val;
    if (skiAscentVal) skiAscentVal.innerText = `${val} Hm/h`;
    const badge = document.getElementById('acc-skitour-badge');
    if (badge) badge.innerText = `${val} Hm/h`;

    skiAscentPresets.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.skiascent, 10) === val);
    });
    recomputeSportsTimeline();
  }

  if (skiAscentSlider) {
    skiAscentSlider.addEventListener('input', () => {
      setSkiAscent(parseInt(skiAscentSlider.value, 10) || 400);
    });
  }
  if (skiAscentMinus) {
    skiAscentMinus.addEventListener('click', () => {
      setSkiAscent((state.sports.skitourAscentHmH || 400) - 25);
    });
  }
  if (skiAscentPlus) {
    skiAscentPlus.addEventListener('click', () => {
      setSkiAscent((state.sports.skitourAscentHmH || 400) + 25);
    });
  }
  skiAscentPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const asc = parseInt(btn.dataset.skiascent, 10);
      if (!isNaN(asc)) setSkiAscent(asc);
    });
  });

  const skiDescentSlider = document.getElementById('skitour-descent-slider');
  const skiDescentVal = document.getElementById('skitour-descent-val');
  const skiDescentMinus = document.getElementById('skitour-descent-minus');
  const skiDescentPlus = document.getElementById('skitour-descent-plus');
  const skiDescentPresets = document.querySelectorAll('#skitour-descent-presets .atp-preset-btn');

  function setSkiDescent(kmh) {
    const val = Math.max(15, Math.min(60, Math.round(kmh)));
    state.sports.skitourDescentKmH = val;
    if (skiDescentSlider) skiDescentSlider.value = val;
    if (skiDescentVal) skiDescentVal.innerText = `${val.toFixed(1)} km/h`;

    skiDescentPresets.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.skidescent, 10) === val);
    });
    recomputeSportsTimeline();
  }

  if (skiDescentSlider) {
    skiDescentSlider.addEventListener('input', () => {
      setSkiDescent(parseFloat(skiDescentSlider.value) || 25);
    });
  }
  if (skiDescentMinus) {
    skiDescentMinus.addEventListener('click', () => {
      setSkiDescent((state.sports.skitourDescentKmH || 25) - 2);
    });
  }
  if (skiDescentPlus) {
    skiDescentPlus.addEventListener('click', () => {
      setSkiDescent((state.sports.skitourDescentKmH || 25) + 2);
    });
  }
  skiDescentPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const desc = parseInt(btn.dataset.skidescent, 10);
      if (!isNaN(desc)) setSkiDescent(desc);
    });
  });

  // 4. SEPARATE DATUM- & UHRZEIT-AUSWAHL
  const dateInput = document.getElementById('sports-date-input');
  const datePresets = document.querySelectorAll('#sports-date-presets .stsp-preset-btn');
  const timeInput = document.getElementById('sports-time-input');
  const timePresets = document.querySelectorAll('#sports-time-presets .stsp-preset-btn');

  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const formatDateVal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (dateInput) {
    dateInput.value = state.sports.startDateStr || formatDateVal(today);
    dateInput.addEventListener('change', () => {
      if (dateInput.value) {
        datePresets.forEach(b => b.classList.remove('active'));
        updateSportsStartTime(dateInput.value, null);
      }
    });
  }

  datePresets.forEach(btn => {
    btn.addEventListener('click', () => {
      datePresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.dataset.datePreset;
      const target = new Date();
      if (preset === 'tomorrow') target.setDate(target.getDate() + 1);
      else if (preset === 'day-after') target.setDate(target.getDate() + 2);
      const str = formatDateVal(target);
      if (dateInput) dateInput.value = str;
      updateSportsStartTime(str, null);
    });
  });

  if (timeInput) {
    timeInput.value = state.sports.startTimeStr || '08:00';
    timeInput.addEventListener('change', () => {
      if (timeInput.value) {
        timePresets.forEach(b => b.classList.remove('active'));
        updateSportsStartTime(null, timeInput.value);
      }
    });
  }

  timePresets.forEach(btn => {
    btn.addEventListener('click', () => {
      timePresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.dataset.timePreset;
      let tStr = '08:00';
      if (preset === 'now') {
        const now = new Date();
        tStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      } else {
        tStr = preset;
      }
      if (timeInput) timeInput.value = tStr;
      updateSportsStartTime(null, tStr);
    });
  });

  // 5. LEGACY KOMPATIBILITÄT: datetime-local & Alte Sportarten-Pills für Tests
  const startTimeInput = document.getElementById('sports-start-time');
  if (startTimeInput) {
    startTimeInput.value = formatLocalDatetime(new Date());
    startTimeInput.addEventListener('change', () => {
      if (startTimeInput.value) {
        state.sports.startTimeMs = new Date(startTimeInput.value).getTime();
        recomputeSportsTimeline();
      }
    });
  }

  const legacySportButtons = document.querySelectorAll('.sport-pill, .sport-type-btn');
  legacySportButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      legacySportButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sports.sportType = btn.dataset.sport;
      if (btn.dataset.sport === 'road_bike' || btn.dataset.sport === 'gravel_mtb') {
        state.sports.category = 'bike';
      } else {
        state.sports.category = 'mountain';
      }
      updateSportPaceBadges();
      recomputeSportsTimeline();
    });
  });

  const legacyFitnessPills = document.querySelectorAll('.fitness-pill');
  legacyFitnessPills.forEach(btn => {
    btn.addEventListener('click', () => {
      legacyFitnessPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sports.fitnessLevel = btn.dataset.fitness;
      updateSportPaceBadges();
      recomputeSportsTimeline();
    });
  });

  // Meilenstein / Wegpunkt Filter (Alle, Warnungen, Pässe & Gipfel)
  const wptFilterPills = document.querySelectorAll('.swt-filter-pill');
  wptFilterPills.forEach(btn => {
    btn.addEventListener('click', () => {
      wptFilterPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sports.waypointFilter = btn.dataset.wptFilter;
      if (state.sports.timeline) {
        renderSportsWaypointsTable(state.sports.timeline);
      }
    });
  });

  // Initialisiere Pace-Badges auf den Cards & Pills
  updateSportPaceBadges();

  // Alpine Referenz-Routen (Presets / Demos: 1 Berg, 1 Rad, 1 Skitour)
  const routePresets = document.querySelectorAll('.sports-route-preset');
  routePresets.forEach(btn => {
    btn.addEventListener('click', () => {
      routePresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSportsPresetTour(btn.dataset.tour);
    });
  });

  // Live-Aktualisierungs-Button im Skitouren-Cockpit
  const liveRefreshBtn = document.getElementById('skitour-live-refresh-btn');
  if (liveRefreshBtn) {
    liveRefreshBtn.addEventListener('click', () => {
      refreshLiveSkitourForecast(true);
    });
  }

  // Munter-Kleingruppen-Toggle (Entlastungsabstand +3° vs. Ohne Abstand)
  const munterGroupBtn = document.getElementById('st-munter-group-toggle');
  if (munterGroupBtn) {
    munterGroupBtn.addEventListener('click', (e) => {
      e.preventDefault();
      state.sports.munterSmallGroup = state.sports.munterSmallGroup === false;
      recomputeSportsTimeline();
    });
  }

  // Optimalen Tourstart übernehmen
  const optStartBtn = document.getElementById('st-optimal-start-btn');
  if (optStartBtn) {
    optStartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetTime = optStartBtn.dataset.startTime;
      if (!targetTime) return;
      const topBefore = optStartBtn.getBoundingClientRect().top;
      const timeInput = document.getElementById('sports-time-input');
      if (timeInput) timeInput.value = targetTime;
      document.querySelectorAll('#sports-time-presets .stsp-preset-btn').forEach(b => b.classList.remove('active'));
      updateSportsStartTime(null, targetTime);
      const topAfter = optStartBtn.getBoundingClientRect().top;
      if (Math.abs(topAfter - topBefore) > 1) window.scrollBy(0, topAfter - topBefore);
    });
  }

  // Offline Alpine Notfallkarte Modal
  const emergencyBtn = document.getElementById('skitour-emergency-btn');
  const emergencyModal = document.getElementById('skitour-emergency-modal');
  const emergencyClose = document.getElementById('skitour-emergency-close');
  if (emergencyBtn && emergencyModal) {
    const toDms = (deg, posChar, negChar) => {
      const dir = deg >= 0 ? posChar : negChar;
      const abs = Math.abs(deg);
      const d = Math.floor(abs);
      const mFloat = (abs - d) * 60;
      const m = Math.floor(mFloat);
      const s = ((mFloat - m) * 60).toFixed(1);
      return `${d}°${String(m).padStart(2, '0')}'${s}"${dir}`;
    };
    emergencyBtn.addEventListener('click', () => {
      const tl = state.sports.timeline;
      const pt = (tl && tl.timedPoints && tl.timedPoints[state.sports.currentPointIndex || 0])
        || (tl && tl.timedPoints && tl.timedPoints[0])
        || state.currentLocation
        || { lat: 47.12, lon: 11.12, ele: 2000 };
      const lat = pt.lat ?? 47.12;
      const lon = pt.lon ?? 11.12;
      const ele = Math.round(pt.ele ?? pt.elevation ?? tl?.maxElevationM ?? 2000);
      const wgsEl = document.getElementById('em-coords-wgs84');
      const dmsEl = document.getElementById('em-coords-dms');
      const eleEl = document.getElementById('em-coords-ele');
      if (wgsEl) wgsEl.innerText = `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° O`;
      if (dmsEl) dmsEl.innerText = `DMS: ${toDms(lat, 'N', 'S')} • ${toDms(lon, 'O', 'W')}`;
      if (eleEl) {
        const valleyName = state.sports.gpxName || state.currentLocation?.name || 'Alpenraum';
        eleEl.innerText = `Höhe: ${ele.toLocaleString('de-DE')} m • Tour/Ort: ${valleyName}`;
      }
      emergencyModal.style.display = 'flex';
    });
    if (emergencyClose) {
      emergencyClose.addEventListener('click', () => { emergencyModal.style.display = 'none'; });
    }
    emergencyModal.addEventListener('click', (e) => {
      if (e.target === emergencyModal) emergencyModal.style.display = 'none';
    });
  }

  // Steilgelände >= 30° Overlay Toggle auf Routenkarte
  const slopeOverlayBtn = document.getElementById('sports-slope-overlay-btn');
  if (slopeOverlayBtn) {
    slopeOverlayBtn.addEventListener('click', () => {
      state.sports.slopeOverlayEnabled = !state.sports.slopeOverlayEnabled;
      slopeOverlayBtn.classList.toggle('active', state.sports.slopeOverlayEnabled);
      slopeOverlayBtn.setAttribute('aria-pressed', state.sports.slopeOverlayEnabled ? 'true' : 'false');
      renderSportsSlopeOverlay(state.sports.timeline);
    });
  }

  // GPX File Upload & Drag'n'Drop (Schlank & Prominent oben platziert)
  const browseBtn = document.getElementById('sports-browse-btn');
  const fileInput = document.getElementById('sports-file-input');
  const dropZone = document.getElementById('sports-drop-zone');
  const customGpxTrigger = document.getElementById('sports-custom-gpx-trigger');
  const clearGpxBtn = document.getElementById('sports-clear-gpx-btn');

  if (clearGpxBtn) {
    clearGpxBtn.addEventListener('click', () => {
      loadSportsPresetTour('nebelhorn-oberstdorf');
    });
  }

  if (customGpxTrigger && fileInput) {
    customGpxTrigger.addEventListener('click', () => {
      fileInput.click();
    });
  }

  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          routePresets.forEach(b => b.classList.remove('active'));
          loadSportsCustomGPX(ev.target.result, file.name);
        };
        reader.readAsText(file);
      }
    });
  }

  if (dropZone) {
    dropZone.addEventListener('click', (e) => {
      // Wenn nicht direkt auf Button geklickt wurde, trotzdem File-Dialog öffnen
      if (e.target !== browseBtn && !browseBtn.contains(e.target) && fileInput) {
        fileInput.click();
      }
    });
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          routePresets.forEach(b => b.classList.remove('active'));
          loadSportsCustomGPX(ev.target.result, file.name);
        };
        reader.readAsText(file);
      }
    });
  }

  // Interaktiver Strecken-Slider (Scrubber)
  const routeSlider = document.getElementById('sports-route-slider');
  if (routeSlider) {
    routeSlider.addEventListener('input', () => {
      state.sports.isDraggingSlider = true;
      const pct = parseFloat(routeSlider.value) || 0;
      const totalDist = state.sports.timeline ? state.sports.timeline.totalDistanceKm : 0;
      const km = (pct / 100) * totalDist;
      updateSportsScrubber(km);
    });
    routeSlider.addEventListener('change', () => {
      state.sports.isDraggingSlider = false;
    });
  }

  // Interaktiver Klick & Drag auf SVG-Höhenprofil
  const chartWrapper = document.getElementById('sports-chart-wrapper');
  if (chartWrapper) {
    let isDraggingChart = false;
    const handleChartScrub = (clientX) => {
      if (!state.sports.timeline) return;
      const rect = chartWrapper.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const km = pct * state.sports.timeline.totalDistanceKm;
      if (routeSlider) {
        routeSlider.value = Math.round(pct * 100);
      }
      updateSportsScrubber(km);
      if (state.sports.trackingActive) {
        updateInFlightProgress(km);
      }
    };

    chartWrapper.addEventListener('pointerdown', e => {
      isDraggingChart = true;
      try { chartWrapper.setPointerCapture(e.pointerId); } catch (_) { }
      handleChartScrub(e.clientX);
    });
    chartWrapper.addEventListener('pointermove', e => {
      if (isDraggingChart) {
        handleChartScrub(e.clientX);
      }
    });
    const stopChartDrag = (e) => {
      if (isDraggingChart) {
        isDraggingChart = false;
        try { chartWrapper.releasePointerCapture(e.pointerId); } catch (_) { }
      }
    };
    chartWrapper.addEventListener('pointerup', stopChartDrag);
    chartWrapper.addEventListener('pointercancel', stopChartDrag);
  }

  // 1-Touch Alpine Cockpit Station Chips
  const chipStart = document.getElementById('cockpit-chip-start');
  const chipPeak = document.getElementById('cockpit-chip-peak');
  const chipFinish = document.getElementById('cockpit-chip-finish');

  if (chipStart) {
    chipStart.addEventListener('click', () => {
      updateSportsScrubber(0);
    });
  }
  if (chipPeak) {
    chipPeak.addEventListener('click', () => {
      const tl = state.sports.timeline;
      if (!tl) return;
      const peakKm = tl.peakKm !== undefined ? tl.peakKm : (tl.maxElevationM ? (tl.milestones.find(m => m.ele === tl.maxElevationM)?.distFromStartKm || 0) : 0);
      updateSportsScrubber(peakKm);
    });
  }
  if (chipFinish) {
    chipFinish.addEventListener('click', () => {
      const tl = state.sports.timeline;
      if (!tl) return;
      updateSportsScrubber(tl.totalDistanceKm);
    });
  }

  // Vollbild-Modus für Sport & GPX Routenkarte
  const mapFsBtn = document.getElementById('sports-map-fullscreen-btn');
  const mapCloseBtn = document.getElementById('sports-map-close-btn');

  if (mapFsBtn) {
    mapFsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSportsMapFullscreen();
    });
  }
  if (mapCloseBtn) {
    mapCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSportsMapFullscreen();
    });
  }

  // Escape-Taste schließt Vollbild
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const wrapper = document.getElementById('sports-map-wrapper');
      if (wrapper && wrapper.classList.contains('sports-map-fullscreen')) {
        closeSportsMapFullscreen();
      }
    }
  });

  // Globaler Jump Helper für Map-Popups & Waypoint-Clicks
  window.jumpToSportsKm = (km) => {
    updateSportsScrubber(km);
    const cockpit = document.getElementById('sports-cockpit-card');
    if (cockpit && !document.getElementById('sports-map-wrapper')?.classList.contains('sports-map-fullscreen')) {
      cockpit.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  // Window Resize: Karte + Profil + Scrubber synchronisieren
  window.addEventListener('resize', () => {
    if (state.sports && state.sports.map) {
      state.sports.map.invalidateSize({ animate: false, pan: false });
    }
    if (state.sports && state.sports.timeline) {
      renderSportsMapElevationProfile(state.sports.timeline);
      if (state.sports.scrubberKm !== undefined) {
        updateSportsScrubber(state.sports.scrubberKm);
      }
    }
  });

  // Interaktives Karten-Höhenprofil (Touch-Ziehen, Maus-Hover ohne Klicken & Einklappen)
  const mapChartWrap = document.getElementById('smed-chart-wrap');
  const mapDock = document.getElementById('sports-map-elevation-dock');
  const mapCollapseBtn = document.getElementById('smed-collapse-btn');

  if (mapCollapseBtn && mapDock) {
    mapCollapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = mapDock.classList.toggle('is-collapsed');
      mapCollapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      mapCollapseBtn.innerText = collapsed ? '▴ Profil' : '▾ Profil';
      setTimeout(() => {
        if (state.sports.map) state.sports.map.invalidateSize();
        if (!collapsed && state.sports.timeline) {
          renderSportsMapElevationProfile(state.sports.timeline);
          updateSportsScrubber(state.sports.scrubberKm || 0);
        }
      }, 40);
    });
  }

  if (mapChartWrap) {
    let isDraggingProfile = false;
    const scrubAtClientX = (clientX) => {
      const tl = state.sports.timeline;
      if (!tl) return;
      const rect = mapChartWrap.getBoundingClientRect();
      if (!rect.width) return;
      const m = state.sports._mapProfileMetrics;
      const padL = m ? m.padL : 42;
      const plotW = m ? Math.max(10, m.plotW) : Math.max(10, rect.width - 52);
      const localX = (clientX - rect.left) - padL;
      const pct = Math.max(0, Math.min(1, localX / plotW));
      const km = pct * Math.max(0.1, tl.totalDistanceKm || 0);
      updateSportsScrubber(km, { fromProfile: true });
      if (state.sports.trackingActive) {
        updateInFlightProgress(km);
      }
    };

    mapChartWrap.addEventListener('pointerdown', (e) => {
      isDraggingProfile = true;
      try { mapChartWrap.setPointerCapture(e.pointerId); } catch (_) { }
      scrubAtClientX(e.clientX);
    });

    mapChartWrap.addEventListener('pointermove', (e) => {
      if (isDraggingProfile || e.pointerType === 'mouse') {
        scrubAtClientX(e.clientX);
      }
    });

    const endDrag = () => { isDraggingProfile = false; };
    mapChartWrap.addEventListener('pointerup', endDrag);
    mapChartWrap.addEventListener('pointercancel', endDrag);

    mapChartWrap.addEventListener('keydown', (e) => {
      const tl = state.sports.timeline;
      if (!tl) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = (tl.totalDistanceKm || 1) * 0.025 * (e.key === 'ArrowRight' ? 1 : -1);
        updateSportsScrubber((state.sports.scrubberKm || 0) + step, { fromProfile: true });
      }
    });
  }
}

export async function initSportsTour() {
  state.sports.initialized = true;
  // Feature 3B: Prüfe offline zwischengespeicherte Tour
  const cachedTour = await WeatherTourCache.getCachedTour();
  const isValidAllgaeuTour = cachedTour && cachedTour.tourName && (
    cachedTour.tourName.includes('Nebelhorn') || cachedTour.tourName.includes('Grünten')
  );

  if (cachedTour && cachedTour.gpxXml && cachedTour.tourName && isValidAllgaeuTour) {
    state.sports.gpxName = cachedTour.tourName;
    setAthleteCategory('mountain');
    await loadAndComputeSportsTour(cachedTour.gpxXml, cachedTour.tourName);
  } else {
    // Standard-Tour: Nebelhorn Rundtour (Allgäu • 2.224 m)
    const defaultTour = 'nebelhorn-oberstdorf';
    await loadSportsPresetTour(defaultTour);
  }
}

export async function loadSportsPresetTour(tourId) {
  const sample = MicroEngine.getSampleGPXTrack(tourId);
  if (!sample) return;
  state.sports.activeTour = tourId;
  state.sports.gpxName = sample.name;

  // Auto-Switch Athleten-Kategorie: Radtour -> Rad (bike), Skitour -> Skitour (skitour), Bergtour -> Berge (mountain)
  if (tourId === 'allgaeu-radtour') {
    setAthleteCategory('bike');
  } else if (tourId.startsWith('skitour')) {
    setAthleteCategory('skitour');
  } else {
    setAthleteCategory('mountain');
  }

  // Eigene GPX Datei-Banner ausblenden
  const customBanner = document.getElementById('sports-custom-file-banner');
  if (customBanner) customBanner.style.display = 'none';

  // Synchronisiere Buttons in beiden Ansichten (Sports-Tab & GPX-Modal)
  document.querySelectorAll('.sports-route-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tour === tourId);
  });
  document.querySelectorAll('.gpx-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tour === tourId);
  });

  await loadAndComputeSportsTour(sample.xml, sample.name);
}

export async function loadSportsCustomGPX(gpxXml, fileName) {
  state.sports.activeTour = null;
  const cleanName = fileName ? fileName.replace(/\.gpx$/i, '') : 'Eigene GPX-Route';
  state.sports.gpxName = cleanName;

  // Alle Demo-Presets deaktivieren
  document.querySelectorAll('.sports-route-preset').forEach(btn => {
    btn.classList.remove('active');
  });

  // Eigene GPX Banner anzeigen
  const customBanner = document.getElementById('sports-custom-file-banner');
  const filenameEl = document.getElementById('scfb-filename');
  const metaEl = document.getElementById('scfb-meta');
  if (customBanner) customBanner.style.display = 'flex';
  if (filenameEl) filenameEl.innerText = fileName || 'Eigene_Tour.gpx';
  if (metaEl) metaEl.innerText = 'Eigene Route aktiv • Höhen- & Streckenwetter für Wegpunkte berechnet';

  await loadAndComputeSportsTour(gpxXml, state.sports.gpxName);
}

export async function fetchHourlyForRoute(lat, lon, parsedGPX = null, forceRefresh = false) {
  const startPt = (parsedGPX && parsedGPX.points && parsedGPX.points.length > 0)
    ? parsedGPX.points[0]
    : { lat, lon, ele: 1000 };

  let peakPt = startPt;
  if (parsedGPX && parsedGPX.points && parsedGPX.points.length > 1) {
    for (const pt of parsedGPX.points) {
      if ((pt.ele || 0) > (peakPt.ele || 0)) peakPt = pt;
    }
  }

  const cacheKey = `${startPt.lat.toFixed(2)},${startPt.lon.toFixed(2)}|${peakPt.lat.toFixed(2)},${peakPt.lon.toFixed(2)}@${Math.round(peakPt.ele || 0)}`;
  const cachedEntry = state.sports.cachedForecasts[cacheKey];
  const LIVE_TTL_MS = 5 * 60 * 1000;
  if (!forceRefresh && cachedEntry && cachedEntry.valley && (Date.now() - (cachedEntry.fetchedAtMs || 0)) < LIVE_TTL_MS) {
    return cachedEntry;
  }

  const hourlyVars = 'temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,freezing_level_height,snowfall,snow_depth,cloud_cover,shortwave_radiation';
  const currentVars = 'temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,snowfall,snow_depth,cloud_cover';

  // Offiziellen Lawinenlagebericht (gesamter Alpenraum CAAMLv6) + 5-Netz-Live-Schneepegel + GeoSphere AROME 1 km + 2D DEM parallel anfragen
  const modelStrategy = MicroEngine.getRegionalModelPriority(peakPt.lat, peakPt.lon, peakPt.ele || 1800);
  const omModelsList = Array.isArray(modelStrategy?.modelsToQuery) ? modelStrategy.modelsToQuery.filter(Boolean) : [];
  const modelsQuery = omModelsList.length > 0 ? `&models=${omModelsList.join(',')}` : '';

  const officialPromise = MicroEngine.fetchOfficialAvalancheBulletin(peakPt.lat, peakPt.lon).catch(() => null);
  const snowStationPromise = MicroEngine.fetchNearbySnowStation(peakPt.lat, peakPt.lon, startPt.ele, peakPt.ele).catch(() => null);
  const arome1kmPromise = modelStrategy?.useGeosphere1km
    ? MicroEngine.fetchGeosphereArome1km(peakPt.lat, peakPt.lon, { forceRefresh }).catch(() => null)
    : Promise.resolve(null);
  const demPromise = (parsedGPX && parsedGPX.points && parsedGPX.points.length >= 2)
    ? MicroEngine.fetchRoute2DTerrainProfile(parsedGPX.points).catch(() => null)
    : Promise.resolve(null);

  const hasDistinctPeak = peakPt !== startPt && (
    Math.abs((peakPt.ele || 0) - (startPt.ele || 0)) >= 120 ||
    Math.abs(peakPt.lat - startPt.lat) >= 0.015 ||
    Math.abs(peakPt.lon - startPt.lon) >= 0.015
  );

  const buildBlendedCurrent = (rawCurrent, blendedHourly) => {
    if (rawCurrent && typeof rawCurrent.temperature_2m === 'number') return rawCurrent;
    if (!blendedHourly || !Array.isArray(blendedHourly.time) || blendedHourly.time.length === 0) return rawCurrent || null;
    const nowMs = Date.now();
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < blendedHourly.time.length; i++) {
      const d = Math.abs(new Date(blendedHourly.time[i]).getTime() - nowMs);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return {
      temperature_2m: blendedHourly.temperature_2m?.[bestI] ?? 0,
      wind_speed_10m: blendedHourly.wind_speed_10m?.[bestI] ?? 0,
      wind_gusts_10m: blendedHourly.wind_gusts_10m?.[bestI] ?? 0,
      wind_direction_10m: blendedHourly.wind_direction_10m?.[bestI] ?? 220,
      snowfall: blendedHourly.snowfall?.[bestI] ?? 0,
      snow_depth: blendedHourly.snow_depth?.[bestI] ?? null,
      cloud_cover: blendedHourly.cloud_cover?.[bestI] ?? 50
    };
  };

  try {
    if (hasDistinctPeak) {
      const lats = `${Number(startPt.lat).toFixed(3)},${Number(peakPt.lat).toFixed(3)}`;
      const lons = `${Number(startPt.lon).toFixed(3)},${Number(peakPt.lon).toFixed(3)}`;
      const eles = `${Math.round(startPt.ele || 800)},${Math.round(peakPt.ele || 2000)}`;
      const multiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&elevation=${eles}&current=${currentVars}&hourly=${hourlyVars}&past_days=3&forecast_days=10&timezone=auto${modelsQuery}`;
      let [res, officialBulletin, snowStationData, arome1kmPkg, demSamples] = await Promise.all([
        resilientFetch(multiUrl, { ttlMs: LIVE_TTL_MS, persist: true, forceRefresh }).catch(() => null),
        officialPromise,
        snowStationPromise,
        arome1kmPromise,
        demPromise
      ]);
      if (!res) {
        const plainUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&elevation=${eles}&current=${currentVars}&hourly=${hourlyVars}&past_days=3&forecast_days=10&timezone=auto`;
        res = await resilientFetch(plainUrl, { ttlMs: LIVE_TTL_MS, persist: true, forceRefresh });
      }
      const items = Array.isArray(res) ? res : (res && res.hourly ? [res] : []);
      if (items.length >= 2 && items[0].hourly && items[1].hourly) {
        const valleyBlended = MicroEngine.blendAlpineMultiModelHourly(items[0], modelStrategy, null, startPt.ele, snowStationData);
        const peakBlended = MicroEngine.blendAlpineMultiModelHourly(items[1], modelStrategy, arome1kmPkg, peakPt.ele, snowStationData);
        const pkg = {
          valley: valleyBlended,
          peak: {
            hourly: peakBlended,
            current: buildBlendedCurrent(items[1].current, peakBlended),
            elevation: items[1].elevation !== undefined ? items[1].elevation : peakPt.ele
          },
          officialBulletin,
          snowStationData,
          demSamples,
          alpineModelMeta: peakBlended._alpineModelMeta || null,
          fetchedAtMs: Date.now()
        };
        state.sports.cachedForecasts[cacheKey] = pkg;
        return pkg;
      }
    }

    // Fallback / Single-Point Live Query (mit past_days=3 & 10 Tagen Vorhersage + Alpine-Ensemble)
    const targetPt = peakPt || startPt;
    const eleParam = targetPt.ele !== undefined ? `&elevation=${Math.round(targetPt.ele)}` : '';
    const multiSingleUrl = `https://api.open-meteo.com/v1/forecast?latitude=${Number(targetPt.lat).toFixed(3)}&longitude=${Number(targetPt.lon).toFixed(3)}${eleParam}&current=${currentVars}&hourly=${hourlyVars}&past_days=3&forecast_days=10&timezone=auto${modelsQuery}`;
    let [data, officialBulletin, snowStationData, arome1kmPkg, demSamples] = await Promise.all([
      resilientFetch(multiSingleUrl, { ttlMs: LIVE_TTL_MS, persist: true, forceRefresh }).catch(() => null),
      officialPromise,
      snowStationPromise,
      arome1kmPromise,
      demPromise
    ]);
    if (!data) {
      const plainSingleUrl = `https://api.open-meteo.com/v1/forecast?latitude=${Number(targetPt.lat).toFixed(3)}&longitude=${Number(targetPt.lon).toFixed(3)}${eleParam}&current=${currentVars}&hourly=${hourlyVars}&past_days=3&forecast_days=10&timezone=auto`;
      data = await resilientFetch(plainSingleUrl, { ttlMs: LIVE_TTL_MS, persist: true, forceRefresh });
    }
    if (data && data.hourly && data.hourly.time && data.hourly.time.length > 0) {
      const blended = MicroEngine.blendAlpineMultiModelHourly(data, modelStrategy, arome1kmPkg, targetPt.ele, snowStationData);
      const pkg = {
        valley: blended,
        peak: {
          hourly: blended,
          current: buildBlendedCurrent(data.current, blended),
          elevation: data.elevation !== undefined ? data.elevation : targetPt.ele
        },
        officialBulletin,
        snowStationData,
        demSamples,
        alpineModelMeta: blended._alpineModelMeta || null,
        fetchedAtMs: Date.now()
      };
      state.sports.cachedForecasts[cacheKey] = pkg;
      return pkg;
    }
  } catch (err) {
    console.warn('Live route forecast fetch failed, using state fallback:', err);
  }

  const [officialBulletin, snowStationData, demSamples] = await Promise.all([officialPromise, snowStationPromise, demPromise]);

  if (state.weatherData && state.weatherData.hourly) {
    return {
      valley: state.weatherData.hourly,
      peak: { hourly: state.weatherData.hourly, current: state.weatherData.current || null, elevation: peakPt.ele },
      officialBulletin,
      snowStationData,
      demSamples,
      fetchedAtMs: Date.now()
    };
  }

  const synth = generateSyntheticSportsHourly();
  return {
    valley: synth,
    peak: { hourly: synth, current: null, elevation: peakPt.ele },
    officialBulletin,
    snowStationData,
    demSamples,
    fetchedAtMs: Date.now()
  };
}

export function generateSyntheticSportsHourly() {
  const times = [];
  const temps = [];
  const precips = [];
  const pops = [];
  const codes = [];
  const winds = [];
  const gusts = [];
  const freezing = [];
  const snowfall = [];
  const snowDepth = [];
  const clouds = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (let i = 0; i < 240; i++) {
    const t = new Date(now.getTime() + i * 3600000);
    times.push(t.toISOString());
    const hr = t.getHours();
    const dayIdx = Math.floor(i / 24);
    const temp = -3 + Math.sin((hr - 8) / 24 * Math.PI * 2) * 5;
    temps.push(Math.round(temp * 10) / 10);
    const isSnowBurst = (dayIdx === 2 || dayIdx === 5) && hr >= 3 && hr <= 11;
    precips.push(isSnowBurst ? 1.8 : 0);
    snowfall.push(isSnowBurst ? 1.8 : 0);
    snowDepth.push(0.85);
    clouds.push(isSnowBurst ? 90 : 30);
    pops.push(isSnowBurst ? 75 : 15);
    codes.push(isSnowBurst ? 73 : 1);
    winds.push(isSnowBurst ? 30 : 15);
    gusts.push(isSnowBurst ? 48 : 24);
    freezing.push(1600);
  }

  return {
    _isSynthetic: true,
    time: times,
    temperature_2m: temps,
    precipitation: precips,
    precipitation_probability: pops,
    weather_code: codes,
    wind_speed_10m: winds,
    wind_gusts_10m: gusts,
    freezing_level_height: freezing,
    snowfall,
    snow_depth: snowDepth,
    cloud_cover: clouds
  };
}

let _gpxWorkerSingleton = null;
let _gpxWorkerReqId = 0;
const _gpxWorkerPending = new Map();

function getGpxWorkerSingleton() {
  if (_gpxWorkerSingleton) return _gpxWorkerSingleton;
  if (typeof Worker === 'undefined') return null;
  try {
    _gpxWorkerSingleton = new Worker('./gpx.worker.js');
    _gpxWorkerSingleton.onmessage = (e) => {
      const { id, status, data } = e.data || {};
      const entry = _gpxWorkerPending.get(id);
      if (entry) {
        _gpxWorkerPending.delete(id);
        entry.resolve(status === 'success' ? data : null);
      }
    };
    _gpxWorkerSingleton.onerror = () => {
      for (const [, entry] of _gpxWorkerPending.entries()) {
        try { entry.resolve(null); } catch (_) {}
      }
      _gpxWorkerPending.clear();
      try { _gpxWorkerSingleton.terminate(); } catch (_) {}
      _gpxWorkerSingleton = null;
    };
    return _gpxWorkerSingleton;
  } catch (_) {
    _gpxWorkerSingleton = null;
    return null;
  }
}

export async function parseGPXAsync(gpxXml) {
  const worker = getGpxWorkerSingleton();
  if (worker) {
    try {
      const res = await new Promise((resolve) => {
        const id = ++_gpxWorkerReqId;
        const timeout = setTimeout(() => {
          _gpxWorkerPending.delete(id);
          resolve(null);
        }, 2500);
        _gpxWorkerPending.set(id, {
          resolve: (val) => {
            clearTimeout(timeout);
            resolve(val);
          }
        });
        worker.postMessage({ id, action: 'parseGPX', payload: { xmlString: gpxXml } });
      });
      if (res) return res;
    } catch (_) {}
  }
  return MicroEngine.parseGPXData(gpxXml);
}

export async function loadAndComputeSportsTour(gpxXml, tourName) {
  const reqSeq = ++state.sports.requestSeq;
  state.sports.gpxText = gpxXml;
  const parsed = await parseGPXAsync(gpxXml);
  if (reqSeq !== state.sports.requestSeq) return;
  if (!parsed || !parsed.points || parsed.points.length === 0) {
    const bannerTitle = document.getElementById('hsb-title');
    const bannerDesc = document.getElementById('hsb-desc');
    if (bannerTitle) bannerTitle.innerText = 'GPX-Fehler: Ungültiger Track';
    if (bannerDesc) bannerDesc.innerText = 'Die hochgeladene GPX-Datei enthält keine verwertbaren GPS-Trackpunkte.';
    return;
  }

  // Bei neuer Route: Live-Tracking und In-Flight Zustand sauber zurücksetzen
  if (state.sports.trackingActive) {
    stopLiveTracking();
  }
  state.sports.currentProgressKm = 0;
  state.sports.currentPointIndex = 0;
  state.sports.observedPaceFactor = 1.0;
  state.sports.timeDeltaMinutes = 0;
  state.sports.actualStartTimeMs = null;
  if (state.sports.completedRouteLine && state.sports.map) {
    state.sports.map.removeLayer(state.sports.completedRouteLine);
    state.sports.completedRouteLine = null;
  }
  const resetBtn = document.getElementById('sports-reset-progress-btn');
  if (resetBtn) resetBtn.style.display = 'none';
  const summaryBar = document.getElementById('sltp-in-flight-summary');
  if (summaryBar) summaryBar.style.display = 'none';

  const startPt = parsed.points[0];
  const forecastPkg = await fetchHourlyForRoute(startPt.lat, startPt.lon, parsed, false);
  if (reqSeq !== state.sports.requestSeq) return;
  state.sports.parsedGPX = parsed;
  if (forecastPkg && forecastPkg.valley) {
    state.sports.cachedForecast = forecastPkg.valley;
    state.sports.cachedPeakForecast = forecastPkg.peak || null;
    state.sports.officialBulletin = forecastPkg.officialBulletin || null;
    state.sports.snowStationData = forecastPkg.snowStationData || null;
    state.sports.demSamples = forecastPkg.demSamples || null;
    if (state.sports.demSamples) parsed._demSamples = state.sports.demSamples;
    state.sports.lastLiveFetchMs = forecastPkg.fetchedAtMs || Date.now();
  } else {
    state.sports.cachedForecast = forecastPkg;
    state.sports.cachedPeakForecast = null;
    state.sports.officialBulletin = null;
    state.sports.snowStationData = null;
    state.sports.demSamples = null;
    state.sports.lastLiveFetchMs = Date.now();
  }

  const heroTitleEl = document.getElementById('sports-active-tour-title');
  const heroSubEl = document.getElementById('sports-active-tour-sub');
  const heroIconEl = document.getElementById('sports-hero-icon');
  const sliderTotal = document.getElementById('cockpit-slider-total');

  if (heroIconEl) {
    heroIconEl.innerText = state.sports.category === 'bike' ? '🚴' : (state.sports.category === 'skitour' ? '⛷️' : '🏔️');
  }
  if (heroTitleEl) {
    heroTitleEl.innerText = tourName || state.sports.gpxName || 'Aktive Tour';
  }
  if (heroSubEl) {
    const isBike = state.sports.category === 'bike';
    const isSki = state.sports.category === 'skitour';
    const paceTxt = isBike
      ? `Rad • ${(state.sports.bikeSpeedKmH || 26).toFixed(1)} km/h Pace`
      : (isSki
        ? `Skitour • +${state.sports.skitourAscentHmH || 400} Hm/h • ↓${(state.sports.skitourDescentKmH || 25).toFixed(0)} km/h`
        : `Berge • ${(state.sports.mountainSpeedKmH || 4).toFixed(1)} km/h • ${state.sports.mountainAscentHmH || 400} Hm/h`);
    heroSubEl.innerText = `${paceTxt} • Stufenlose SAC-Dynamik & Relativ-Wind`;
  }
  if (sliderTotal && parsed.totalDistanceKm) {
    sliderTotal.innerText = `${parsed.totalDistanceKm.toFixed(1)} km`;
  }

  recomputeSportsTimeline();
}

export function updateSportPaceBadges() {
  const bikeBadge = document.getElementById('acc-bike-badge');
  const mtnBadge = document.getElementById('acc-mountain-badge');
  const skiBadge = document.getElementById('acc-skitour-badge');
  const bikeVal = document.getElementById('bike-speed-val');
  const mtnSpeedVal = document.getElementById('mtn-speed-val');
  const mtnAscentVal = document.getElementById('mtn-ascent-val');
  const skiAscentVal = document.getElementById('skitour-ascent-val');
  const skiDescentVal = document.getElementById('skitour-descent-val');

  const bSpeed = state.sports.bikeSpeedKmH || 26.0;
  const mSpeed = state.sports.mountainSpeedKmH || 4.0;
  const mAsc = state.sports.mountainAscentHmH || 400;
  const skiAsc = state.sports.skitourAscentHmH || 400;
  const skiDesc = state.sports.skitourDescentKmH || 25.0;

  if (bikeBadge) bikeBadge.innerText = `${bSpeed.toFixed(1)} km/h`;
  if (mtnBadge) mtnBadge.innerText = `${mSpeed.toFixed(1)} km/h`;
  if (skiBadge) skiBadge.innerText = `${skiAsc} Hm/h`;
  if (bikeVal) bikeVal.innerText = `${bSpeed.toFixed(1)} km/h`;
  if (mtnSpeedVal) mtnSpeedVal.innerText = `${mSpeed.toFixed(1)} km/h`;
  if (mtnAscentVal) mtnAscentVal.innerText = `${mAsc} Hm/h`;
  if (skiAscentVal) skiAscentVal.innerText = `${skiAsc} Hm/h`;
  if (skiDescentVal) skiDescentVal.innerText = `${skiDesc.toFixed(1)} km/h`;

  const sports = ['hiking', 'road_bike', 'gravel_mtb', 'trailrun', 'ski_touring', 'skimo'];
  sports.forEach(sp => {
    const badge = document.getElementById(`sp-pace-${sp}`);
    if (badge) {
      const info = MicroEngine.getSportSpeedInfo(sp, state.sports.fitnessLevel);
      badge.innerText = info.paceLabel;
    }
  });
}

export function renderSkitourDashboard(timeline) {
  const card = document.getElementById('skitour-dashboard-card');
  if (!card) return;
  if (state.sports.category !== 'skitour') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  const loc = (timeline && timeline.timedPoints && timeline.timedPoints.length > 0)
    ? { lat: timeline.timedPoints[0].lat, lon: timeline.timedPoints[0].lon, elevation: Math.round(timeline.maxElevationM || 1800) }
    : (state.currentLocation || { lat: 47.4, lon: 10.3, elevation: 1800 });
  const av = (timeline && timeline.avalancheReport)
    ? timeline.avalancheReport
    : MicroEngine.computeAvalancheReport(loc.lat, loc.lon, loc.elevation, state.weatherData, null);
  if (!av) return;

  // 0. Regionaler Lawinenwarndienst, exakte Routen-Höhenspanne & Live-Zeitstempel
  const agencyTag = document.getElementById('skitour-agency-tag');
  if (agencyTag) {
    const shortAgency = (av.stationAgency || 'EAWS / LWD').split('(')[0].trim();
    const minM = av.minElevationM ? av.minElevationM.toLocaleString('de-DE') : '—';
    const maxM = av.maxElevationM ? av.maxElevationM.toLocaleString('de-DE') : Math.round(loc.elevation).toLocaleString('de-DE');
    const liveStr = av.stationTime || 'Live';
    agencyTag.innerText = `${shortAgency} • ${minM}–${maxM} m • ${liveStr}`;
    agencyTag.title = `${av.stationAgency} (${av.stationName}) – Live-Abfrage für die geladenen GPX-Wegpunkte`;
  }

  // 1. EAWS Badge
  const badge = document.getElementById('skitour-eaws-badge');
  const num = document.getElementById('skitour-eaws-num');
  const label = document.getElementById('skitour-eaws-label');
  if (badge) {
    badge.style.background = av.dangerColor;
    badge.style.color = av.dangerLevel >= 4 ? '#ffffff' : '#000000';
  }
  if (num) num.innerText = av.dangerLevel;
  if (label) {
    const titles = ['', 'GERING', 'MÄSSIG', 'ERHEBLICH', 'GROSS', 'SEHR GROSS'];
    label.innerText = titles[av.dangerLevel] || 'MÄSSIG';
  }

  // Title & Sub & Pattern
  const titleEl = document.getElementById('skitour-eaws-title');
  const elevEl = document.getElementById('skitour-eaws-elev');
  const patternEl = document.getElementById('skitour-pattern-badge');

  if (titleEl) {
    titleEl.innerText = `Stufe ${av.dangerLevel} (${av.dangerTitle.replace(/^[0-9]\s*-\s*/, '')}) • Vormittags Stufe ${av.morningDangerLevel}, nachmittags Stufe ${av.afternoonDangerLevel}`;
  }
  if (elevEl) {
    const windNote = av.windFromSector ? ` • Kammwind aus ${av.windFromSector} (Lee: ${av.primarySector || 'NO'})` : '';
    elevEl.innerHTML = `Gefahr vor allem über <strong>${av.criticalElevation.toLocaleString('de-DE')} m</strong> • Kernproblem: <strong>${av.problems[0] ? av.problems[0].name : 'Triebschnee'}</strong>${windNote}`;
  }
  if (patternEl && av.dangerPattern) {
    patternEl.innerText = `⚠️ ${av.dangerPattern.name}`;
    patternEl.title = av.dangerPattern.desc;
  }

  // 1b. Modell-Konsens, EAWS-Tendenz & Föhn-Indikator
  const consensusEl = document.getElementById('skitour-model-consensus-pill');
  const tendencyEl = document.getElementById('skitour-tendency-pill');
  const foehnEl = document.getElementById('skitour-foehn-pill');
  if (consensusEl) {
    consensusEl.style.display = 'inline-flex';
    if (av.alpineModelMeta && av.alpineModelMeta.consensusLabel) {
      consensusEl.innerText = `📊 ${av.alpineModelMeta.consensusLabel}`;
      consensusEl.title = av.alpineModelMeta.weightsLabel || '';
    } else {
      consensusEl.innerText = '📊 🔵 Prognose-Einzelmodell (Fallback)';
      consensusEl.title = av.sourceLabel || '';
    }
  }
  if (tendencyEl) {
    if (av.tendency) {
      const tMap = { decreasing: 'abnehmend ↘', steady: 'gleichbleibend →', increasing: 'zunehmend ↗' };
      const tVal = tMap[String(av.tendency).toLowerCase()] || av.tendency;
      tendencyEl.style.display = 'inline-flex';
      tendencyEl.innerText = `📈 Trend: ${tVal}`;
    } else {
      tendencyEl.style.display = 'none';
    }
  }
  if (foehnEl) {
    if (av.foehnIndex && av.foehnIndex.active) {
      foehnEl.style.display = 'inline-flex';
      foehnEl.innerText = `🌬️ ${av.foehnIndex.label || 'Südföhn aktiv'}`;
    } else {
      foehnEl.style.display = 'none';
    }
  }

  // 2. Vector Danger Rose
  const aspectMapping = {
    'st-rose-n': 'N',
    'st-rose-no': 'NO',
    'st-rose-o': 'O',
    'st-rose-so': 'SO',
    'st-rose-s': 'S',
    'st-rose-sw': 'SW',
    'st-rose-w': 'W',
    'st-rose-nw': 'NW'
  };

  const aspectDetails = {
    'N': { name: 'Nordhang', icon: '❄️', steep: '> 30°', text: 'Schattig und kalt; Altschneeschwäche & Triebschneepakete beachten.' },
    'NO': { name: 'Nordosthang', icon: '❄️', steep: '> 30°', text: 'Kammnahe Rinnen und Mulden stark mit Einwehungen verfüllt.' },
    'O': { name: 'Osthang', icon: '💨', steep: '> 30°', text: 'Typischer Leehang bei West-/Nordwestwind. Geländekanten meiden.' },
    'SO': { name: 'Südosthang', icon: '☀️', steep: '> 34°', text: 'Frühe Sonneneinstrahlung; tageszeitliche Erwärmung beachten.' },
    'S': { name: 'Südhang', icon: '☀️', steep: '> 35°', text: 'Nassschnee- und Gleitschneerutsche bei tageszeitlicher Erwärmung.' },
    'SW': { name: 'Südwesthang', icon: '🌤️', steep: '> 34°', text: 'Nachmittags höchste Einstrahlung; Triebschnee auf abgeblasener Unterlage.' },
    'W': { name: 'Westhang', icon: '💨', steep: '> 30°', text: 'Windseitige Grate abgeblasen (Harsch/Eis), Rinnen je nach Anströmung heikel.' },
    'NW': { name: 'Nordwesthang', icon: '❄️', steep: '> 30°', text: 'Schattig und kalt. Ungünstiger Altschneeaufbau in Hochlagen.' }
  };

  const applyRoseSectorDiagnosis = (asp, path) => {
    document.querySelectorAll('.st-rose-sec').forEach(p => p.classList.remove('selected-sector'));
    if (path) path.classList.add('selected-sector');
    const isCritical = av.criticalAspects.includes(asp);
    const det = aspectDetails[asp];
    const secName = document.getElementById('skitour-sector-name');
    const secDesc = document.getElementById('skitour-sector-desc');
    const isLeeTarget = asp === av.primarySector;
    if (secName && det) {
      secName.innerText = `${det.icon} ${det.name} (${asp}): ${isCritical ? '⚠️ Kritisch' : '✅ Günstiger'}${isLeeTarget ? ' • Haupt-Leehang' : ''}`;
    }
    if (secDesc && det) {
      secDesc.innerHTML = `Kritische Steilheit: <strong>${det.steep}</strong> • Windrichtung: <strong>${av.windFromSector || 'W'}</strong><br>${det.text}`;
    }
  };

  const defaultSector = av.primarySector || av.criticalAspects[0] || 'NO';
  Object.entries(aspectMapping).forEach(([secId, asp]) => {
    const path = document.getElementById(secId);
    if (path) {
      const isCritical = av.criticalAspects.includes(asp);
      path.classList.remove('danger-high', 'danger-med', 'danger-low');
      if (isCritical) {
        path.classList.add(av.dangerLevel >= 3 ? 'danger-high' : 'danger-med');
      } else {
        path.classList.add('danger-low');
      }
      path.onclick = () => applyRoseSectorDiagnosis(asp, path);
      if (asp === defaultSector) {
        applyRoseSectorDiagnosis(asp, path);
      }
    }
  });

  // Problems Row (inkl. per-Problem Höhenstufe, Auslösung, Lawinengröße & optionaler Gefahrenrosen-Fokus)
  const probRow = document.getElementById('skitour-problems-row');
  if (probRow && av.problems) {
    probRow.innerHTML = av.problems.map((p, idx) => {
      const sizeStr = p.avalancheSize ? ` • Größe ${p.avalancheSize}/5` : '';
      const eleStr = p.elevationLower ? ` • ab ${Number(p.elevationLower).toLocaleString('de-DE')} m` : '';
      return `
      <div class="stp-badge" data-prob-idx="${idx}" title="${escapeHtml(p.desc || '')}">
        <span>${p.icon}</span>
        <strong>${escapeHtml(p.name)}</strong>: ${escapeHtml(p.trigger || p.desc || '')}${escapeHtml(sizeStr)}${escapeHtml(eleStr)}
      </div>`;
    }).join('');
  }

  // 3. Firn & Harsch Timeline
  const firn = av.firnAnalysis;
  const firnPill = document.getElementById('skitour-firn-window-pill');
  const firnDesc = document.getElementById('skitour-firn-desc');
  const firnTrack = document.getElementById('firn-timeline-track');

  if (firnPill && firn) {
    firnPill.innerText = firn.firnBadgeText || `⭐ Firn-Fenster: ${firn.firnWindowStart} – ${firn.firnWindowEnd} Uhr`;
  }
  if (firnDesc && firn) {
    firnDesc.innerHTML = `Nächtliche Ausstrahlung: <strong>${firn.nightCoolingRating}%</strong> • <em>${firn.crustStability}</em>`;
  }
  if (firnTrack && firn && firn.firnTimeline) {
    const defaultFirnHtml = `Nächtliche Ausstrahlung: <strong>${firn.nightCoolingRating}%</strong> • <em>${escapeHtml(firn.crustStability)}</em>`;
    firnTrack.innerHTML = firn.firnTimeline.map((item, idx) => `
      <button type="button" class="firn-track-hour" data-hour-idx="${idx}" style="background: ${item.color};" title="${escapeHtml(item.hour)}: ${escapeHtml(item.label)}">
        <span class="fth-time">${escapeHtml(item.hour.split(':')[0])}</span>
      </button>
    `).join('');
    firnTrack.querySelectorAll('.firn-track-hour').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(btn.dataset.hourIdx, 10);
        const item = firn.firnTimeline[idx];
        if (!item) return;
        const wasSelected = btn.classList.contains('is-selected');
        firnTrack.querySelectorAll('.firn-track-hour').forEach(b => b.classList.remove('is-selected'));
        if (wasSelected) {
          if (firnDesc) firnDesc.innerHTML = defaultFirnHtml;
        } else {
          btn.classList.add('is-selected');
          if (firnDesc) {
            firnDesc.innerHTML = `<strong>${escapeHtml(item.hour)} Uhr:</strong> ${escapeHtml(item.label)} • <em>Ausstrahlung ${firn.nightCoolingRating}%</em>`;
          }
        }
      });
    });
  }

  // 3b. Expositionsgetrennte Solar-Firn-Matrix (Ost/Südost, Süd, West, Nord)
  const aspectFirnGrid = document.getElementById('skitour-aspect-firn-grid');
  if (aspectFirnGrid && firn && firn.aspectFirnWindows) {
    const af = firn.aspectFirnWindows;
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val || '—'; };
    setTxt('afg-ese', af.eastSouthEast);
    setTxt('afg-s', af.south);
    setTxt('afg-w', af.west);
    setTxt('afg-n', af.north);
    aspectFirnGrid.style.display = 'grid';
  } else if (aspectFirnGrid) {
    aspectFirnGrid.style.display = 'none';
  }

  // 4b. Aufstieg / Abfahrt Split, Harscheisen, Whiteout, Startzeit-Optimierer & Packliste
  const phaseCard = document.getElementById('skitour-phase-card');
  if (phaseCard && timeline && timeline.phaseAnalysis) {
    const pa = timeline.phaseAnalysis;
    phaseCard.style.display = 'block';
    const ascEl = document.getElementById('st-phase-ascent');
    const crampEl = document.getElementById('st-phase-crampon');
    const descEl = document.getElementById('st-phase-descent');
    const qualEl = document.getElementById('st-phase-quality');
    const whiteEl = document.getElementById('st-whiteout-row');
    const optBtn = document.getElementById('st-optimal-start-btn');
    const gearEl = document.getElementById('skitour-gear-chips');

    if (ascEl) ascEl.innerText = `${pa.ascentDurationStr} • Höchster Punkt ${pa.summitArrivalStr}`;
    if (crampEl) crampEl.innerText = pa.cramponText || '';
    if (descEl) descEl.innerText = `${pa.descentDurationStr} Abfahrt`;
    if (qualEl) qualEl.innerText = pa.descentSnowQuality || '';
    if (whiteEl && timeline.whiteoutAnalysis) {
      whiteEl.innerText = timeline.whiteoutAnalysis.summary;
      whiteEl.classList.toggle('is-warn', !!timeline.whiteoutAnalysis.active);
    }
    if (optBtn) {
      const opt = timeline.optimalStartAdvisor;
      if (opt && opt.startTimeValue) {
        optBtn.style.display = 'inline-flex';
        optBtn.dataset.startTime = opt.startTimeValue;
        optBtn.innerText = `⭐ Empfohlen: Start ${opt.startTimeValue} Uhr`;
        optBtn.title = opt.reason || '';
      } else {
        optBtn.style.display = 'none';
      }
    }
    if (gearEl && Array.isArray(timeline.gearChecklist)) {
      gearEl.innerHTML = timeline.gearChecklist.map(g =>
        `<span class="st-gear-chip prio-${escapeHtml(g.priority || 'std')}">${escapeHtml(g.icon)} ${escapeHtml(g.label)}</span>`
      ).join('');
    }
  } else if (phaseCard) {
    phaseCard.style.display = 'none';
  }

  // 4. Schnee- & Neuschnee-Dossier Grid
  const freshSnowVal = document.getElementById('st-freshsnow-val');
  const freshProg = document.getElementById('st-freshsnow-prog');
  const totalSnow = document.getElementById('st-totalsnow-val');
  const snowline = document.getElementById('st-snowline-val');
  const densityVal = document.getElementById('st-density-val');
  const sweVal = document.getElementById('st-swe-val');
  const layerVal = document.getElementById('st-layer-val');
  const critFresh = document.getElementById('st-crit-freshsnow');

  if (freshSnowVal) freshSnowVal.innerText = `${av.freshSnow24hCm} cm (24h) / ${av.freshSnow72hCm || 0} cm (72h)`;
  if (freshProg) freshProg.innerText = `🔵 Prognose (+24h): +${av.prognosis24hCm || 0} cm`;
  if (totalSnow) {
    const valTxt = (av.snowDepthValleyCm !== null && av.snowDepthValleyCm !== undefined) ? `${av.snowDepthValleyCm} cm` : 'k.A.';
    const pkTxt = (av.snowDepthPeakCm !== null && av.snowDepthPeakCm !== undefined) ? `${av.snowDepthPeakCm} cm` : 'kein Pegel';
    totalSnow.innerText = (av.snowDepthProvenance && av.snowDepthProvenance.kind === 'estimate')
      ? `Keine Messdaten (≈ ~${valTxt}/${pkTxt})`
      : `Tal ${valTxt} / Berg ${pkTxt}`;
  }
  if (snowline) {
    const slM = av.skiableSnowlineM || Math.max(800, loc.elevation - Math.round(av.snowDepthValleyCm * 15));
    const prefix = (av.snowDepthProvenance && av.snowDepthProvenance.kind === 'real') ? '🟢' : (av.snowDepthProvenance && av.snowDepthProvenance.kind === 'forecast' ? '🔵' : '🟠');
    snowline.innerText = av.snowDepthStationLabel
      ? `${prefix} ${av.snowDepthStationLabel} • Ab ~${slM.toLocaleString('de-DE')} m`
      : `Fahrbare Schneegrenze: ab ~${slM.toLocaleString('de-DE')} m`;
  }
  if (densityVal) densityVal.innerText = `${av.densityKgM3} kg/m³ (${av.qualityClass})`;
  if (sweVal) sweVal.innerText = `Schneewasseräquivalent: ${av.sweMm} mm`;
  if (layerVal) {
    layerVal.innerText = av.thermalLayerSeverity === 'danger' ? '⚠️ Kritisch' : (av.thermalLayerSeverity === 'good' ? '✅ Günstig' : 'Normal');
    layerVal.className = `ssg-val ${av.thermalLayerSeverity === 'danger' ? 'text-red' : 'text-accent'}`;
    layerVal.title = av.thermalLayerPattern || '';
  }
  if (critFresh) critFresh.innerText = `Kritische Neuschneemenge: ${av.criticalFreshSnowThresholdCm} cm (${av.criticalExceeded ? '⚠️ Erreicht' : 'Unterschritten'})`;

  // Provenienz-Badges für jede Karte exakt setzen (ECHT vs PROGNOSE vs SCHÄTZWERT)
  const applyProv = (id, kind, text) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `st-prov-badge prov-${kind}`;
    el.innerText = text;
  };
  if (av.avalancheProvenance) {
    applyProv('st-eaws-prov-badge', av.avalancheProvenance.kind, av.avalancheProvenance.badge);
    applyProv('st-rose-prov-badge', av.isOfficialBulletin ? 'real' : 'forecast', av.isOfficialBulletin ? '🟢 ECHT (Offiz. Exposition)' : '🔵 PROGNOSE (Lee-Modell)');
  }
  if (av.freshSnowProvenance) applyProv('st-freshsnow-prov', av.freshSnowProvenance.kind, av.freshSnowProvenance.badge);
  if (av.snowDepthProvenance) applyProv('st-totalsnow-prov', av.snowDepthProvenance.kind, av.snowDepthProvenance.badge);

  // 5. GPX Hangneigungsanalyse & Munter 3x3 Check
  if (timeline && timeline.slopeStats) {
    const s = timeline.slopeStats;
    const maxBadge = document.getElementById('st-max-slope-badge');
    const slopeProvBadge = document.getElementById('st-slope-prov-badge');
    const catchBadge = document.getElementById('st-catchment-badge');
    const munterGroupBtn = document.getElementById('st-munter-group-toggle');
    const mvbIcon = document.getElementById('mvb-icon');
    const u30 = document.getElementById('ssb-under30');
    const b30 = document.getElementById('ssb-30to34');
    const b35 = document.getElementById('ssb-35to39');
    const o40 = document.getElementById('ssb-over40');
    const pUnder30 = document.getElementById('st-pct-under30');
    const p30to34 = document.getElementById('st-pct-30to34');
    const p35to39 = document.getElementById('st-pct-35to39');
    const pOver40 = document.getElementById('st-pct-over40');
    const munterText = document.getElementById('st-munter-text');

    if (maxBadge) maxBadge.innerText = `Max: ${s.maxSlopeDeg}°`;
    if (slopeProvBadge) {
      slopeProvBadge.innerText = s.has2DDem ? '🟢 ECHT (GPX + 2D-Gelände)' : '🟢 ECHT (GPX-Track)';
    }
    if (catchBadge) {
      if (s.catchmentAlertCount > 0) {
        catchBadge.style.display = 'inline-flex';
        catchBadge.innerText = `🪨 ${s.catchmentAlertCount}× Einzugsgebiet ≥ 35°`;
      } else {
        catchBadge.style.display = 'none';
      }
    }
    if (munterGroupBtn) {
      const isSmall = state.sports.munterSmallGroup !== false;
      munterGroupBtn.classList.toggle('active', isSmall);
      munterGroupBtn.setAttribute('aria-pressed', isSmall ? 'true' : 'false');
      munterGroupBtn.innerText = isSmall ? 'Kleingruppe (+3°)' : 'Ohne Abstand';
    }
    if (u30) u30.style.width = `${s.pctUnder30}%`;
    if (b30) b30.style.width = `${s.pct30to34}%`;
    if (b35) b35.style.width = `${s.pct35to39}%`;
    if (o40) o40.style.width = `${s.pctOver40}%`;

    if (pUnder30) pUnder30.innerText = `${s.pctUnder30}%`;
    if (p30to34) p30to34.innerText = `${s.pct30to34}%`;
    if (p35to39) p35to39.innerText = `${s.pct35to39}%`;
    if (pOver40) pOver40.innerText = `${s.pctOver40}%`;

    if (munterText) {
      const mInfo = timeline.munterAnalysis;
      if (mInfo && mInfo.verdictText) {
        if (mvbIcon) mvbIcon.innerText = mInfo.hasRisk ? '⚠️' : '✅';
        munterText.innerHTML = mInfo.exceedingCount > 0
          ? `<span class="text-red"><strong>${escapeHtml(mInfo.verdictText)}</strong></span>`
          : escapeHtml(mInfo.verdictText);
      } else if (av.dangerLevel >= 3 && s.pct35to39 + s.pctOver40 > 0) {
        munterText.innerHTML = `<span class="text-red"><strong>Achtung Munter Reduktionsmethode:</strong> Bei Stufe 3 (Erheblich) müssen Hänge ≥ 35° strikt gemieden werden! Route quert ${s.keySectionCount} Schlüsselstellen mit bis zu ${s.maxSlopeDeg}°.</span>`;
      } else if (av.dangerLevel >= 2 && s.maxSlopeDeg >= 30) {
        munterText.innerHTML = `<span><strong>Munter Check:</strong> Bei Stufe 2 sind Hänge bis 34° bei Einhaltung von Entlastungsabständen im Aufstieg machbar. Max. Steilheit: ${s.maxSlopeDeg}°.</span>`;
      } else {
        munterText.innerText = timeline.munterEvaluation || 'Geringe Hangneigung: Routenverlauf im unkritischen Bereich.';
      }
    }
  }

  // 6. Quellen-Transparenzbanner & 10-Tage Skitouren-Planer (Neuschnee, Qualität & VM/NM)
  const srcBanner = document.getElementById('skitour-source-banner');
  const srcIcon = document.getElementById('skitour-source-icon');
  const srcLabel = document.getElementById('skitour-source-label');
  const officialTextEl = document.getElementById('skitour-official-text');

  if (srcBanner && srcLabel) {
    srcBanner.classList.toggle('is-official', !!av.isOfficialBulletin);
    if (srcIcon) srcIcon.innerText = av.isOfficialBulletin ? '✅' : '📡';
    srcLabel.innerText = av.sourceLabel || 'Open-Meteo ECMWF/ICON + EAWS-Physik';
    if (officialTextEl) {
      if (av.officialText) {
        officialTextEl.style.display = 'block';
        officialTextEl.innerText = av.officialText;
      } else {
        officialTextEl.style.display = 'none';
      }
    }
  }

  const dayListEl = document.getElementById('skitour-10day-list');
  if (dayListEl && Array.isArray(av.forecast10Days)) {
    dayListEl.innerHTML = av.forecast10Days.map(d => `
      <button type="button" class="skitour-10day-row ${d.isSelected ? 'is-selected' : ''}" data-date="${d.dateKey}">
        <div class="s10d-day-col">
          <div class="s10d-day-name">
            <span>${escapeHtml(d.dayLabel)}</span>
            ${d.isWeekend ? '<span class="s10d-wknd-tag">Wochenende</span>' : ''}
          </div>
          <span class="s10d-src-mini ${d.isOfficialDay ? 'official' : ''}">${d.isOfficialDay ? '🟢 ECHT (Offiziell)' : '🔵 PROGNOSE'}</span>
        </div>

        <div class="s10d-snow-col">
          <span class="s10d-snow-main">${d.snowQualityIcon} +${d.freshSnowDayCm} cm (${escapeHtml(d.snowWindowStr)})</span>
          <span class="s10d-snow-sub">72h: ${d.cumFreshSnow72hCm} cm • ${d.densityKgM3} kg/m³ ${escapeHtml(d.snowQuality)}</span>
        </div>

        <div class="s10d-hazard-col">
          <span class="s10d-hazard-text">${escapeHtml(d.hazardSummary)}</span>
          <span class="s10d-wind-text">Wind: ${escapeHtml(d.windFromSector)} (Böen ${d.maxWindKmH} km/h) • Gipfel: Vormittag ${d.morning.tempC}° / Nachmittag ${d.afternoon.tempC}°</span>
        </div>

        <div class="s10d-periods-col">
          <span class="s10d-period-pill" style="background:${d.morning.color};color:${d.morning.textColor};" title="Vormittag (06–12 Uhr): Stufe ${d.morning.level}/5 (${escapeHtml(d.morning.label)})">Vormittag ${d.morning.level}/5</span>
          <span class="s10d-period-pill" style="background:${d.afternoon.color};color:${d.afternoon.textColor};" title="Nachmittag (12–18 Uhr): Stufe ${d.afternoon.level}/5 (${escapeHtml(d.afternoon.label)})">Nachmittag ${d.afternoon.level}/5</span>
        </div>
      </button>
    `).join('');

    dayListEl.querySelectorAll('.skitour-10day-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosenDate = btn.dataset.date;
        if (!chosenDate) return;
        const topBefore = btn.getBoundingClientRect().top;
        const dateInput = document.getElementById('sports-date-input');
        if (dateInput) dateInput.value = chosenDate;
        document.querySelectorAll('#sports-date-presets .stsp-preset-btn').forEach(b => b.classList.remove('active'));
        updateSportsStartTime(chosenDate, null);
        // Bewahre die exakte Viewport-Position der geklickten Zeile, falls oben Text ein-/ausgeblendet wurde
        const freshBtn = dayListEl.querySelector(`.skitour-10day-row[data-date="${chosenDate}"]`);
        if (freshBtn) {
          const topAfter = freshBtn.getBoundingClientRect().top;
          const delta = topAfter - topBefore;
          if (Math.abs(delta) > 1) window.scrollBy(0, delta);
        }
      });
    });
  }
}

export function recomputeSportsTimeline() {
  if (!state.sports.parsedGPX || !state.sports.cachedForecast) return;
  const parsed = state.sports.parsedGPX;
  const startPt = parsed.points[0];
  const hourly = state.sports.cachedForecast;

  const timeline = MicroEngine.computeRouteWeatherTimeline(
    parsed,
    state.sports.startTimeMs,
    state.sports.sportType,
    hourly,
    startPt.ele,
    state.sports.fitnessLevel,
    {
      category: state.sports.category,
      bikeSpeedKmH: state.sports.bikeSpeedKmH,
      mountainSpeedKmH: state.sports.mountainSpeedKmH,
      mountainAscentHmH: state.sports.mountainAscentHmH,
      skitourSpeedKmH: state.sports.skitourSpeedKmH,
      skitourAscentHmH: state.sports.skitourAscentHmH,
      skitourDescentKmH: state.sports.skitourDescentKmH,
      peakForecast: state.sports.cachedPeakForecast || null,
      officialBulletin: state.sports.officialBulletin || null,
      snowStationData: state.sports.snowStationData || null,
      demSamples: state.sports.demSamples || null,
      munterSmallGroup: state.sports.munterSmallGroup !== false
    }
  );

  state.sports.timeline = timeline;
  state.sports.hazards = timeline.hazards;

  // Wenn bereits Fortschritt auf der Route vorliegt, In-Flight Modell mit neuer Athleten-Pace anwenden
  if (state.sports.currentProgressKm > 0) {
    updateInFlightProgress(state.sports.currentProgressKm, false);
    return;
  }

  updateSportPaceBadges();
  renderInFlightTrackingPanel(timeline);
  renderSportsMetrics(timeline);
  renderSkitourDashboard(timeline);
  renderSportsHazards(timeline.hazards);
  updateNavigationWarningBadges();
  renderSportsElevationProfile(timeline);
  renderSportsWaypointsTable(timeline);
  renderSportsMap(timeline);

  const slider = document.getElementById('sports-route-slider');
  const pct = slider ? parseFloat(slider.value) || 0 : 0;
  const targetKm = (pct / 100) * timeline.totalDistanceKm;
  updateSportsScrubber(targetKm);

  // Feature 3B: Offline-Cache abspeichern
  WeatherTourCache.saveTour(
    state.sports.gpxName || 'Tour',
    state.sports.gpxText,
    parsed,
    timeline,
    { totalDist: timeline.totalDistanceKm, totalAsc: timeline.totalAscentM, duration: timeline.totalDurationStr }
  );
}

/**
 * =============================================================================
 * IN-FLIGHT ROUTE TRACKING & ECHTZEIT-WETTER ENGINE
 * =============================================================================
 */

/**
 * Snap-to-Route: Findet den nächstgelegenen Streckenpunkt für gegebene GPS-Koordinaten
 */
export function snapCoordinatesToRoute(lat, lon, points) {
  if (!points || points.length === 0) return { km: 0, index: 0, distanceMeters: 0 };
  let minDistanceM = Infinity;
  let bestIdx = 0;
  const R = 6371000;
  const toRad = Math.PI / 180;
  const lat1 = lat * toRad;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const lat2 = p.lat * toRad;
    const dLat = (p.lat - lat) * toRad;
    const dLon = (p.lon - lon) * toRad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;
    if (d < minDistanceM) {
      minDistanceM = d;
      bestIdx = i;
    }
  }

  return {
    km: points[bestIdx].distFromStartKm,
    index: bestIdx,
    distanceMeters: minDistanceM
  };
}

/**
 * Kompatibilitäts-Stubs: Live-Tour-Tracking wurde vollständig aus der App entfernt
 */
export function startLiveTracking() { }
export function stopLiveTracking() { }
export function toggleLiveTracking() { }
export function updateInFlightProgress(newKm) {
  updateSportsScrubber(newKm);
}
export function resetInFlightProgress() {
  updateSportsScrubber(0);
}
export function renderInFlightTrackingPanel() { }
export function updateInFlightMap() { }

export function renderSportsMetrics(timeline) {
  const dDist = document.getElementById('sm-val-dist');
  const dAsc = document.getElementById('sm-val-ascent');
  const dDur = document.getElementById('sm-val-dur');
  const dFin = document.getElementById('sm-val-finish');

  if (timeline.inFlight && timeline.currentProgressKm > 0) {
    if (dDist) dDist.innerHTML = `${timeline.remainingDistanceKm.toFixed(1)} km <span style="font-size: 11px; color: var(--text-tertiary); display: block;">(Rest von ${timeline.totalDistanceKm.toFixed(1)} km)</span>`;
    if (dAsc) dAsc.innerHTML = `+${Math.round(timeline.remainingAscentM || 0)} m <span style="font-size: 11px; color: var(--text-tertiary); display: block;">(Rest-Aufstieg)</span>`;
    if (dDur) dDur.innerHTML = `${timeline.remainingDurationStr} <span style="font-size: 11px; color: var(--text-tertiary); display: block;">(Verbleibende Tourzeit)</span>`;
    if (dFin) {
      const delta = timeline.timeDeltaMinutes || 0;
      const deltaTag = delta !== 0
        ? `<span class="swt-time-delta ${delta > 0 ? 'delta-late' : 'delta-early'}">(${delta > 0 ? '+' : ''}${delta} min)</span>`
        : '';
      dFin.innerHTML = `${timeline.updatedEndTimeStr || timeline.endTimeStr} Uhr ${deltaTag}`;
    }
  } else {
    if (dDist) dDist.innerText = `${timeline.totalDistanceKm.toFixed(1)} km`;
    if (dAsc) dAsc.innerText = `+${Math.round(timeline.totalAscentM)} m / -${Math.round(timeline.totalDescentM)} m`;
    if (dDur) dDur.innerText = timeline.totalDurationStr;
    if (dFin) {
      const finishDate = new Date(timeline.endTimeMs);
      const dayName = finishDate.toLocaleDateString('de-DE', { weekday: 'short' });
      dFin.innerText = `${timeline.endTimeStr} Uhr (${dayName})`;
    }
  }
}

export function renderSportsHazards(hazards) {
  const statusTag = document.getElementById('sports-hazard-status-tag');
  const banner = document.getElementById('hazard-summary-banner');
  const iconElem = document.getElementById('hsb-icon');
  const titleElem = document.getElementById('hsb-title');
  const descElem = document.getElementById('hsb-desc');
  const listElem = document.getElementById('hazard-alerts-list');

  if (!banner || !hazards) return;

  banner.classList.remove('hsb-green', 'hsb-yellow', 'hsb-red');
  banner.classList.add(`hsb-${hazards.level}`);

  if (statusTag) {
    statusTag.className = 'card-tag';
    if (hazards.level === 'red') {
      statusTag.innerText = '🔴 Hohe Alpine Gefahr';
      statusTag.style.color = 'var(--ios-red)';
      statusTag.style.borderColor = 'rgba(255, 69, 58, 0.4)';
    } else if (hazards.level === 'yellow') {
      statusTag.innerText = '🟡 Wetterwarnungen aktiv';
      statusTag.style.color = 'var(--ios-yellow)';
      statusTag.style.borderColor = 'rgba(255, 209, 102, 0.4)';
    } else {
      statusTag.innerText = '🟢 Optimale Bedingungen';
      statusTag.style.color = 'var(--ios-green)';
      statusTag.style.borderColor = 'rgba(48, 209, 88, 0.4)';
    }
  }

  if (iconElem) {
    iconElem.innerText = hazards.level === 'red' ? '⚡' : (hazards.level === 'yellow' ? '⚠️' : '✅');
  }

  if (titleElem) {
    if (hazards.level === 'red') {
      titleElem.innerText = 'Kritische Wettergefahren auf deiner Route erkannt!';
    } else if (hazards.level === 'yellow') {
      titleElem.innerText = 'Wetterwarnungen für exponierte Streckenabschnitte';
    } else {
      titleElem.innerText = 'Sichere Verhältnisse für deine gewählte Route';
    }
  }

  if (descElem) {
    descElem.innerText = hazards.advice || 'Wetterlage auf allen Wegpunkten im grünen Bereich.';
  }

  if (listElem) {
    listElem.innerHTML = '';
    if (!hazards.alerts || hazards.alerts.length === 0) {
      listElem.innerHTML = `
        <div class="hazard-alert-item alert-green">
          <div class="hai-icon">🌤️</div>
          <div class="hai-body">
            <div class="hai-top">
              <strong>Keine Wetterwarnungen entlang der Route</strong>
              <span class="hai-meta">Gesamte Streckenlänge</span>
            </div>
            <p>Für deine berechnete Durchgangszeit sind weder Gewitter, Sturmböen noch Kälteeinbrüche prognostiziert. Ideale Bedingungen für deine Tour!</p>
          </div>
        </div>
      `;
    } else {
      hazards.alerts.forEach(a => {
        const item = document.createElement('div');
        item.className = `hazard-alert-item alert-${a.severity}`;
        item.innerHTML = `
          <div class="hai-icon">${a.icon}</div>
          <div class="hai-body">
            <div class="hai-top">
              <strong>${a.title}</strong>
              <span class="hai-meta">${a.time} • km ${a.km.toFixed(1)} (${Math.round(a.ele)} m)</span>
            </div>
            <p>${a.desc}</p>
          </div>
        `;
        listElem.appendChild(item);
      });
    }
  }
}

export function renderSportsElevationProfile(timeline) {
  if (!timeline) return;

  // Cockpit Station-Labels dynamisch aktualisieren
  const peakLabel = document.getElementById('cockpit-peak-label');
  const finishLabel = document.getElementById('cockpit-finish-label');
  if (peakLabel) peakLabel.innerText = `Gipfel ${Math.round(timeline.maxElevationM)}m`;
  if (finishLabel) finishLabel.innerText = `Ziel ${timeline.totalDistanceKm.toFixed(1)} km`;

  const peakMs = timeline.milestones ? timeline.milestones.find(m => m.ele === timeline.maxElevationM) : null;
  timeline.peakKm = peakMs ? peakMs.distFromStartKm : (timeline.totalDistanceKm / 2);

  renderSportsMapElevationProfile(timeline);

  const svg = document.getElementById('sports-elevation-svg');
  if (!svg) return;

  const W = 900;

  const pts = timeline.timedPoints;
  const count = pts.length;
  const getX = dKm => padL + (dKm / totalDist) * plotW;
  const getY = ele => padT + plotH - ((ele - minZ) / rangeZ) * plotH;

  const lineCoords = [];
  const completedCoords = [];
  const curKm = timeline.currentProgressKm || 0;

  for (let i = 0; i < count; i++) {
    const x = getX(pts[i].distFromStartKm);
    const y = getY(pts[i].ele);
    const ptStr = `${x.toFixed(1)},${y.toFixed(1)}`;
    lineCoords.push(ptStr);
    if (timeline.inFlight && pts[i].distFromStartKm <= curKm) {
      completedCoords.push(ptStr);
    }
  }

  const polyBottomLeft = `${padL},${padT + plotH}`;
  const polyBottomRight = `${(padL + plotW).toFixed(1)},${padT + plotH}`;
  const fillPoly = `${polyBottomLeft} ${lineCoords.join(' ')} ${polyBottomRight}`;

  // Milestone Markers on SVG Profile
  const isSkitour = timeline.category === 'skitour';
  let milestoneSVGElements = '';
  timeline.milestones.forEach((m, idx) => {
    const mx = getX(m.distFromStartKm);
    const my = getY(m.ele);
    const isPeak = m.ele === timeline.maxElevationM;
    const isCompleted = !!m.isCompleted;
    const dotFill = isCompleted
      ? '#30d158'
      : (isSkitour && m.avalancheColor ? m.avalancheColor : (isPeak ? '#ffd166' : '#00e5ff'));
    const eawsText = (isSkitour && m.avalancheLevel) ? ` ⚠️${m.avalancheLevel}` : '';

    milestoneSVGElements += `
      <g class="svg-milestone-pin ${isCompleted ? 'pin-completed' : ''}" data-km="${m.distFromStartKm}" ${isCompleted ? 'style="opacity: 0.45;"' : ''}>
        <title>${escapeHtml(m.label || '')} • ${m.tempC}°C${isSkitour && m.avalancheLevel ? ` • Lawinenstufe ${m.avalancheLevel}/5 (${m.avalancheLabel})` : ''}</title>
        <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${isPeak ? 5.5 : 4.2}" fill="${dotFill}" stroke="#ffffff" stroke-width="1.8" />
        <text x="${mx.toFixed(1)}" y="${(my - 12).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.8))">
          ${isCompleted ? '✓ ' : ''}${m.weatherIcon} ${m.tempC}°${eawsText}
        </text>
      </g>
    `;
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="sports-profile-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.45" />
        <stop offset="65%" stop-color="#0a84ff" stop-opacity="0.20" />
        <stop offset="100%" stop-color="#051525" stop-opacity="0.05" />
      </linearGradient>
    </defs>

    <!-- Achsenlinien & Höhenraster -->
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
    <line x1="${padL}" y1="${padT + plotH / 2}" x2="${W - padR}" y2="${padT + plotH / 2}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4 4" />

    <!-- Höhen-Achsenbeschriftung -->
    <text x="${padL - 8}" y="${padT + 5}" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="end" font-family="monospace">${maxZ}m</text>
    <text x="${padL - 8}" y="${padT + plotH / 2 + 3}" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="end" font-family="monospace">${Math.round((maxZ + minZ) / 2)}m</text>
    <text x="${padL - 8}" y="${padT + plotH}" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="end" font-family="monospace">${minZ}m</text>

    <!-- Distanz-Achsenbeschriftung -->
    <text x="${padL}" y="${H - 12}" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="start">0 km (Start)</text>
    <text x="${W - padR}" y="${H - 12}" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="end">${totalDist.toFixed(1)} km (Ziel)</text>

    <!-- Gefülltes Höhenprofil -->
    <polygon points="${fillPoly}" fill="url(#sports-profile-grad)" />
    <polyline points="${lineCoords.join(' ')}" fill="none" stroke="#00e5ff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
    ${completedCoords.length > 1 ? `<polyline points="${completedCoords.join(' ')}" fill="none" stroke="#30d158" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />` : ''}

    <!-- Meilensteine & Wetter-Symbole -->
    ${milestoneSVGElements}

    <!-- Dynamischer Scrubber-Positionsstrich & Cursor-Punkt -->
    <line id="svg-scrubber-line" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#ffd166" stroke-width="2" stroke-dasharray="3 3" opacity="0.9" />
    <circle id="svg-scrubber-dot" cx="${padL}" cy="${getY(pts[0].ele)}" r="6" fill="#ffd166" stroke="#ffffff" stroke-width="2" />
  `;
}

function getProfileSegmentStyle(pt, gradPct, category) {
  if (category === 'skitour') {
    const deg = pt.slopeDeg || 0;
    if (deg >= 40) return '#ef4444';
    if (deg >= 35) return '#f97316';
    if (deg >= 30) return '#eab308';
    return '#22c55e';
  }
  if (category === 'bike') {
    if (gradPct < -4) return '#2dd4bf';
    if (gradPct < 3) return '#38bdf8';
    if (gradPct < 7) return '#eab308';
    if (gradPct < 11) return '#f97316';
    return '#ef4444';
  }
  // Berge / Wandern / Trailrun
  if (gradPct < -12) return '#30d158';
  if (gradPct <= 12) return '#38bdf8';
  if (gradPct <= 25) return '#eab308';
  return '#f97316';
}

export function renderSportsMapElevationProfile(timeline) {
  const dock = document.getElementById('sports-map-elevation-dock');
  const wrap = document.getElementById('smed-chart-wrap');
  const canvas = document.getElementById('sports-map-elevation-canvas');
  const legendEl = document.getElementById('smed-legend');
  if (!dock || !wrap || !canvas || !timeline || !Array.isArray(timeline.timedPoints) || timeline.timedPoints.length < 2) {
    if (dock) dock.style.display = 'none';
    return;
  }
  dock.style.display = 'flex';

  // ResizeObserver einmalig anbinden (für Normal <-> Vollbild & Window-Resize)
  if (!wrap.dataset.roBound && typeof ResizeObserver !== 'undefined') {
    wrap.dataset.roBound = '1';
    const ro = new ResizeObserver(() => {
      if (state.sports && state.sports.timeline) {
        drawSportsMapProfileCanvas(state.sports.timeline);
        updateSportsScrubber(state.sports.scrubberKm || 0);
      }
    });
    ro.observe(wrap);
  }

  // Sportart-spezifische Kompakte Legende aktualisieren
  if (legendEl) {
    const cat = timeline.category || 'mountain';
    if (cat === 'skitour') {
      legendEl.innerHTML = [
        ['#22c55e', '<30°'],
        ['#eab308', '30–34°'],
        ['#f97316', '35–39°'],
        ['#ef4444', '≥40°']
      ].map(([c, lbl]) => `<span class="smed-leg-item"><span class="smed-leg-dot" style="background:${c}"></span>${lbl}</span>`).join('');
    } else if (cat === 'bike') {
      legendEl.innerHTML = [
        ['#2dd4bf', 'Abfahrt'],
        ['#38bdf8', '<3%'],
        ['#eab308', '3–6%'],
        ['#f97316', '7–10%'],
        ['#ef4444', '≥11%']
      ].map(([c, lbl]) => `<span class="smed-leg-item"><span class="smed-leg-dot" style="background:${c}"></span>${lbl}</span>`).join('');
    } else {
      legendEl.innerHTML = [
        ['#30d158', 'Abstieg'],
        ['#38bdf8', 'Pfad'],
        ['#eab308', '>12%'],
        ['#f97316', '>25%']
      ].map(([c, lbl]) => `<span class="smed-leg-item"><span class="smed-leg-dot" style="background:${c}"></span>${lbl}</span>`).join('');
    }
  }

  drawSportsMapProfileCanvas(timeline);
}

function drawSportsMapProfileCanvas(timeline) {
  const wrap = document.getElementById('smed-chart-wrap');
  const canvas = document.getElementById('sports-map-elevation-canvas');
  if (!wrap || !canvas || !timeline || !Array.isArray(timeline.timedPoints) || timeline.timedPoints.length < 2) return;

  const rect = wrap.getBoundingClientRect();
  const W = Math.max(240, Math.round(rect.width));
  const H = Math.max(70, Math.round(rect.height));
  if (W <= 0 || H <= 0) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const pts = timeline.timedPoints;
  const totalDist = Math.max(0.1, timeline.totalDistanceKm || pts[pts.length - 1].distFromStartKm || 1);
  const rawMin = timeline.minElevationM !== undefined ? timeline.minElevationM : Math.min(...pts.map(p => p.ele));
  const rawMax = timeline.maxElevationM !== undefined ? timeline.maxElevationM : Math.max(...pts.map(p => p.ele));
  const padEle = Math.max(30, Math.round((rawMax - rawMin) * 0.12));
  const minZ = Math.max(0, Math.floor((rawMin - padEle) / 25) * 25);
  const maxZ = Math.ceil((rawMax + padEle) / 25) * 25;
  const rangeZ = Math.max(40, maxZ - minZ);

  const padL = 42;
  const padR = 12;
  const padT = 14;
  const padB = 16;
  const plotW = Math.max(40, W - padL - padR);
  const plotH = Math.max(30, H - padT - padB);

  const getX = (km) => padL + (Math.max(0, Math.min(totalDist, km)) / totalDist) * plotW;
  const getY = (ele) => padT + plotH - ((ele - minZ) / rangeZ) * plotH;

  // Segment-Steigung in % (mind. 15 m Horizontalbasis für stabile Steigungsfarbe & HUD)
  const segGrades = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    let win = i - 1;
    while (win > 0 && ((pts[i].distFromStartKm || 0) - (pts[win].distFromStartKm || 0)) < 0.015) {
      win--;
    }
    const dxM = Math.max(15, ((pts[i].distFromStartKm || 0) - (pts[win].distFromStartKm || 0)) * 1000);
    const dzM = pts[i].ele - pts[win].ele;
    segGrades[i] = Math.round((dzM / dxM) * 1000) / 10;
  }

  state.sports._mapProfileMetrics = {
    W, H, padL, padR, padT, padB, plotW, plotH, minZ, maxZ, rangeZ, totalDist, segGrades, timeline
  };

  // 1. Dezentes Höhen-Grid & Achsenbeschriftung
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  [0, 0.5, 1].forEach((f, idx) => {
    const y = Math.round(padT + plotH * (1 - f)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    const zVal = Math.round(minZ + rangeZ * f);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.font = '600 9px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = idx === 2 ? 'top' : (idx === 0 ? 'bottom' : 'middle');
    ctx.fillText(`${zVal}m`, padL - 5, idx === 2 ? y - 2 : (idx === 0 ? y + 2 : y));
  });

  // Distanz-Labels unten
  ctx.fillStyle = 'rgba(148, 163, 184, 0.78)';
  ctx.font = '600 9px JetBrains Mono, monospace';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText('0 km', padL, H - 2);
  ctx.textAlign = 'center';
  ctx.fillText(`${(totalDist / 2).toFixed(1)} km`, padL + plotW / 2, H - 2);
  ctx.textAlign = 'right';
  ctx.fillText(`${totalDist.toFixed(1)} km`, W - padR, H - 2);

  const cat = timeline.category || 'mountain';
  const av = timeline.avalancheReport;

  // 2. Whiteout-/Nebel-Höhenband (Berge & Skitour)
  if ((cat === 'skitour' || cat === 'mountain') && timeline.whiteoutAnalysis?.active && timeline.whiteoutAnalysis.minElevationM) {
    const woEle = timeline.whiteoutAnalysis.minElevationM;
    if (woEle < maxZ) {
      const yWo = Math.max(padT, Math.min(padT + plotH, getY(woEle)));
      ctx.fillStyle = 'rgba(203, 213, 225, 0.08)';
      ctx.fillRect(padL, padT, plotW, yWo - padT);
    }
  }

  // 3. Flächen-Verlauf unter der Höhenkurve
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(getX(pts[0].distFromStartKm), padT + plotH);
  for (let i = 0; i < pts.length; i++) {
    ctx.lineTo(getX(pts[i].distFromStartKm), getY(pts[i].ele));
  }
  ctx.lineTo(getX(pts[pts.length - 1].distFromStartKm), padT + plotH);
  ctx.closePath();
  const fillGrad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  fillGrad.addColorStop(0, cat === 'skitour' ? 'rgba(56, 189, 248, 0.28)' : 'rgba(0, 140, 255, 0.30)');
  fillGrad.addColorStop(1, 'rgba(15, 23, 42, 0.04)');
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // Niederschlags-Schattierung für Rad & Berge
  if (cat !== 'skitour' && Array.isArray(timeline.milestones) && timeline.milestones.length > 1) {
    ctx.clip();
    const ms = timeline.milestones;
    for (let i = 0; i < ms.length; i++) {
      if ((ms[i].precipMm || 0) >= 0.3 || ms[i].weatherCode >= 95) {
        const x0 = getX(i === 0 ? 0 : (ms[i - 1].distFromStartKm + ms[i].distFromStartKm) / 2);
        const x1 = getX(i === ms.length - 1 ? totalDist : (ms[i].distFromStartKm + ms[i + 1].distFromStartKm) / 2);
        ctx.fillStyle = ms[i].weatherCode >= 95 ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.22)';
        ctx.fillRect(x0, padT, Math.max(4, x1 - x0), plotH);
      }
    }
  }
  ctx.restore();

  // 4. Sportartspezifische alpine Referenzlinien
  const drawRefLine = (eleM, color, labelTxt, alignRight = true) => {
    if (typeof eleM !== 'number' || eleM <= minZ || eleM >= maxZ) return;
    const y = Math.round(getY(eleM)) + 0.5;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.font = '700 9px Plus Jakarta Sans, sans-serif';
    const tw = ctx.measureText(labelTxt).width;
    const tx = alignRight ? W - padR - 6 : padL + 6;
    const bx = alignRight ? tx - tw - 6 : tx - 3;
    const by = Math.max(padT, y - 13);
    ctx.fillStyle = 'rgba(9, 14, 24, 0.82)';
    ctx.fillRect(bx, by, tw + 9, 12);
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.textAlign = alignRight ? 'right' : 'left';
    ctx.fillText(labelTxt, tx, by + 1);
    ctx.restore();
  };

  if (cat === 'skitour' && av) {
    drawRefLine(av.criticalElevation, 'rgba(245, 158, 11, 0.9)', `⚠️ Lawinengefahr ab ${Math.round(av.criticalElevation)}m`, true);
    drawRefLine(av.skiableSnowlineM, 'rgba(56, 189, 248, 0.85)', `❄️ Schneegrenze ${Math.round(av.skiableSnowlineM)}m`, false);
  } else if (cat === 'mountain' && Array.isArray(timeline.milestones) && timeline.milestones.length > 0) {
    const fl = timeline.milestones[Math.floor(timeline.milestones.length / 2)].freezingLevelM;
    drawRefLine(fl, 'rgba(96, 165, 250, 0.85)', `❄️ 0°-Grenze ${Math.round(fl)}m`, true);
  }

  // (Kein starrer Einfach-Gipfel-Split bei Skitouren, da Touren mehrere Anstiege/Abfahrten haben können –
  // die Profilkurve und das Live-HUD zeigen jeden Aufstieg und jede Abfahrt direkt am Streckenpunkt.)

  // 5. Farbcodierte Höhenprofil-Linie je nach Sportart
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  for (let i = 1; i < pts.length; i++) {
    ctx.strokeStyle = getProfileSegmentStyle(pts[i], segGrades[i], cat);
    ctx.beginPath();
    ctx.moveTo(getX(pts[i - 1].distFromStartKm), getY(pts[i - 1].ele));
    ctx.lineTo(getX(pts[i].distFromStartKm), getY(pts[i].ele));
    ctx.stroke();
  }

  // 6. Wegpunkt-Dots (EAWS/Munter bei Skitour, Wind/Gewitter bei Rad/Berg) & Gipfel-Marker
  let peakPt = pts[0];
  for (const p of pts) {
    if (p.ele > peakPt.ele) peakPt = p;
  }

  if (Array.isArray(timeline.milestones)) {
    const wide = W >= 640;
    timeline.milestones.forEach((m, idx) => {
      if (idx === 0 || idx === timeline.milestones.length - 1) return;
      const mx = getX(m.distFromStartKm);
      const my = getY(m.ele);
      let dotFill = '#38bdf8';
      let warnRing = false;
      if (cat === 'skitour' && m.avalancheColor) {
        dotFill = m.avalancheColor;
        warnRing = !!(m.exceedsMunterLimit || m.inProblemCoreZone);
      } else if (m.weatherCode >= 95 || m.gustsKmH >= 50) {
        dotFill = '#ef4444';
        warnRing = true;
      } else if (cat === 'bike' && m.relWindType === 'headwind' && m.relWindKmH >= 20) {
        dotFill = '#f97316';
      }
      if (warnRing) {
        ctx.beginPath();
        ctx.arc(mx, my, 5.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(mx, my, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = dotFill;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (wide && m.weatherCode >= 95) {
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('⚡', mx, my - 6);
      }
    });
  }

  // Gipfel-Highlight-Pin
  const px = getX(peakPt.distFromStartKm);
  const py = getY(peakPt.ele);
  ctx.beginPath();
  ctx.arc(px, py, 4.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd166';
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#fef08a';
  ctx.font = '700 9.5px Plus Jakarta Sans, sans-serif';
  ctx.textAlign = px > W - 65 ? 'right' : (px < padL + 45 ? 'left' : 'center');
  ctx.textBaseline = 'bottom';
  ctx.fillText(`🏔️ ${Math.round(peakPt.ele)}m`, px, Math.max(11, py - 5));
}

export function renderSportsWaypointsTable(timeline) {
  const container = document.getElementById('sports-waypoints-list');
  if (!container || !timeline) return;

  container.innerHTML = '';

  const filter = state.sports.waypointFilter || 'all';
  let visibleMilestones = timeline.milestones;
  if (filter === 'hazards') {
    visibleMilestones = timeline.milestones.filter((m, idx) => {
      return (
        m.precipMm >= 0.5 ||
        m.gustsKmH >= 45 ||
        m.weatherCode >= 95 ||
        m.isSnow ||
        (m.weatherCondition && m.weatherCondition.includes('Gewitter'))
      );
    });
  } else if (filter === 'peaks') {
    visibleMilestones = timeline.milestones.filter((m, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === timeline.milestones.length - 1;
      const isPeak = m.ele === timeline.maxElevationM;
      return isStart || isEnd || isPeak;
    });
  }

  if (visibleMilestones.length === 0) {
    container.innerHTML = `
      <div class="swt-empty-notice">
        <span>✅</span>
        <div>
          <strong>Keine Streckenabschnitte mit Warnungen</strong>
          <p>Für deine geplante Tour sind bei aktuellem Wetter keine Gefahren auf den Wegpunkten aktiv.</p>
        </div>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  const nextUncompletedIdx = visibleMilestones.findIndex(m => !m.isCompleted);
  const isSkitour = timeline.category === 'skitour';

  visibleMilestones.forEach((m, idx) => {
    const row = document.createElement('div');
    const isCompleted = !!m.isCompleted;
    const isNext = !isCompleted && idx === nextUncompletedIdx;

    row.className = 'swt-row' + (isCompleted ? ' swt-row-completed' : '') + (isNext ? ' swt-row-active-live' : '');
    row.dataset.idx = m.index !== undefined ? m.index : idx;
    row.dataset.km = m.distFromStartKm;

    const isStart = idx === 0 || m.distFromStartKm === 0;
    const isEnd = m.distFromStartKm >= timeline.totalDistanceKm - 0.05 || idx === visibleMilestones.length - 1;
    const isPeak = m.ele === timeline.maxElevationM;

    let typeTag = '📍 Wegpunkt';
    let tagClass = 'tag-wpt';
    let labelText = `km ${m.distFromStartKm.toFixed(1)}`;
    let nodeIcon = '📍';
    let nodeClass = 'node-wpt';

    if (isCompleted) {
      typeTag = isStart ? '✓ Tourstart' : '✓ Passiert';
      tagClass = 'tag-completed';
      nodeIcon = '✓';
      nodeClass = 'node-completed';
      if (isStart) labelText = 'Startpunkt';
      else if (isPeak) labelText = `Passhöhe (${Math.round(m.ele)} m)`;
      else if (isEnd) labelText = `Zielankunft (${m.distFromStartKm.toFixed(1)} km)`;
      else labelText = `Streckenabschnitt ${m.distFromStartKm.toFixed(1)} km`;
    } else if (isNext) {
      typeTag = '➡️ Nächster Halt';
      tagClass = 'tag-next';
      nodeIcon = '⚡';
      nodeClass = 'node-next';
      if (isStart) labelText = 'Startpunkt';
      else if (isPeak) labelText = `Passhöhe (${Math.round(m.ele)} m)`;
      else if (isEnd) labelText = `Zielankunft (${m.distFromStartKm.toFixed(1)} km)`;
      else labelText = `Streckenabschnitt ${m.distFromStartKm.toFixed(1)} km`;
    } else if (isPeak) {
      typeTag = '🏔️ Scheitelpunkt';
      tagClass = 'tag-peak';
      nodeIcon = '🏔️';
      nodeClass = 'node-peak';
      labelText = `Passhöhe (${Math.round(m.ele)} m)`;
    } else if (isEnd) {
      typeTag = '🏁 Zielankunft';
      tagClass = 'tag-finish';
      nodeIcon = '🏁';
      nodeClass = 'node-end';
      labelText = `Streckenende (${m.distFromStartKm.toFixed(1)} km)`;
    } else if (isStart) {
      typeTag = '🏁 Tourstart';
      tagClass = 'tag-start';
      nodeIcon = '🟢';
      nodeClass = 'node-start';
      labelText = 'Startpunkt';
    } else {
      labelText = `Streckenabschnitt ${m.distFromStartKm.toFixed(1)} km`;
    }

    const hasWarning = (
      m.precipMm >= 0.5 ||
      m.gustsKmH >= 45 ||
      m.weatherCode >= 95 ||
      m.isSnow ||
      (m.weatherCondition && m.weatherCondition.includes('Gewitter'))
    );

    let deltaHtml = '';
    if (!isCompleted && m.timeDeltaMinutes !== undefined && m.timeDeltaMinutes !== 0) {
      const dMin = m.timeDeltaMinutes;
      deltaHtml = `<span class="swt-time-delta ${dMin > 0 ? 'delta-late' : 'delta-early'}">${dMin > 0 ? '+' : ''}${dMin} min</span>`;
    }

    const feltT = m.feltTempC !== undefined ? m.feltTempC : Math.round(m.tempC);
    const hasEaws = isSkitour && m.avalancheLevel;
    const isOfficialAv = !!(timeline.avalancheReport && timeline.avalancheReport.isOfficialBulletin);
    const eawsTagShort = isOfficialAv ? `✓ ${m.avalancheLevel}/5` : `~${m.avalancheLevel}/5`;
    const eawsTagFull = isOfficialAv
      ? `🟢 Offizieller Lawinenlagebericht Stufe ${m.avalancheLevel}/5 (${escapeHtml(m.avalancheLabel)})`
      : `🔵 Prognose Lawinenlagebericht ~${m.avalancheLevel}/5 (${escapeHtml(m.avalancheLabel)})`;
    const eawsMobileBadge = hasEaws
      ? `<span class="sms-eaws-badge" style="background:${m.avalancheColor};color:${m.avalancheTextColor};" title="${isOfficialAv ? 'Offizieller Lawinenlagebericht' : 'Prognose (kein offizieller Lawinenlagebericht)'}: Stufe ${m.avalancheLevel}/5">${eawsTagShort}</span>`
      : '';
    const eawsDesktopBadge = hasEaws
      ? `<span class="swt-eaws-badge" style="background:${m.avalancheColor};color:${m.avalancheTextColor};">${eawsTagFull}</span>`
      : '';
    const eawsAccordionChip = hasEaws
      ? `<div class="sap-chip">
           <span class="sap-label">${isOfficialAv ? '🟢 Offizieller Lawinenlagebericht (EAWS)' : '🔵 Lawinen-Prognosemodell (kein offizieller Lawinenlagebericht)'}</span>
           <strong class="sap-val"><span class="swt-eaws-badge" style="background:${m.avalancheColor};color:${m.avalancheTextColor};">${eawsTagFull}</span></strong>
           <span class="sap-sub">Höhe: <b>${Math.round(m.ele)} m</b> • Hangneigung: <b>${m.slopeDeg || 0}°</b></span>
         </div>`
      : '';

    // Standardmäßig erstes oder nächstes Element aufgeklappt
    if (isNext || (nextUncompletedIdx === -1 && idx === 0)) {
      row.classList.add('is-expanded');
    }

    row.innerHTML = `
      <!-- 1. MOBILER COMPACT SUMMARY BAR (Apple-Wetter Fahrplan-Perlenkette) -->
      <div class="swt-mobile-summary">
        <div class="sms-left">
          <span class="sms-node-badge ${nodeClass}">${nodeIcon}</span>
          <div class="sms-text-col">
            <div class="sms-title-row">
              <strong class="sms-name">${escapeHtml(labelText)}</strong>
              ${isPeak ? '<span class="sms-peak-badge">🏔️ Gipfel</span>' : ''}
              ${eawsMobileBadge}
              ${hasWarning ? '<span class="sms-warn-badge">⚠️ Achtung</span>' : ''}
            </div>
            <div class="sms-sub-row">
              <span class="sms-time text-yellow">⏱️ ${escapeHtml(m.arrivalTimeStr)}</span>
              <span class="sms-sep">•</span>
              <span class="sms-dist">${m.distFromStartKm.toFixed(1)} km</span>
              <span class="sms-sep">•</span>
              <span class="sms-ele text-cyan">${Math.round(m.ele)} m</span>
            </div>
          </div>
        </div>

        <div class="sms-right">
          <div class="sms-weather-chip">
            <span class="sms-icon">${m.weatherIcon}</span>
            <strong class="sms-temp">${m.tempC}°</strong>
          </div>
          <span class="sms-chevron">▾</span>
        </div>
      </div>

      <!-- 2. DESKTOP TABELLENZEILEN (Klassische Ansicht bei großen Monitoren) -->
      <div class="swt-desktop-cells">
        <div class="swt-cell swt-milestone">
          <span class="swt-type-tag ${tagClass} ${isCompleted ? 'swt-completed-tag' : (isNext ? 'swt-live-next-tag' : '')}">${escapeHtml(typeTag)}</span>
          <span class="swt-m-name">${escapeHtml(labelText)}</span>
          ${eawsDesktopBadge}
          <span class="swt-m-coords">${m.lat.toFixed(4)}°, ${m.lon.toFixed(4)}°</span>
        </div>
        <div class="swt-cell swt-dist-ele">
          <strong class="swt-dist">${m.distFromStartKm.toFixed(1)} km</strong>
          <span class="swt-ele text-cyan">${Math.round(m.ele)} m</span>
        </div>
        <div class="swt-cell swt-time">
          <div class="swt-time-top">
            <strong class="swt-arr-time">${escapeHtml(m.arrivalTimeStr)}</strong>
            ${deltaHtml}
          </div>
          <span class="swt-arr-date">${escapeHtml(m.arrivalDateStr)}</span>
        </div>
        <div class="swt-cell swt-weather">
          <div class="swt-w-top">
            <span class="swt-icon">${m.weatherIcon}</span>
            <span class="swt-cond">${escapeHtml(m.weatherCondition)}</span>
          </div>
        </div>
        <div class="swt-cell swt-temp">
          <strong class="swt-temp-val">${m.tempC}°C</strong>
          <span class="swt-temp-felt">Gefühlt ${feltT}°C</span>
        </div>
        <div class="swt-cell swt-wind">
          <div class="swt-wind-top">
            <strong>${m.windKmH} km/h</strong>
            <span class="swt-gusts text-orange">Böen ${m.gustsKmH}</span>
          </div>
          ${m.relWindBadge ? `<span class="swt-rel-wind-badge ${m.relWindType || ''}">${escapeHtml(m.relWindBadge)}</span>` : ''}
          ${m.descentWindchillC !== undefined && m.descentWindchillC <= 10 && (state.sports.category === 'bike' || m.distFromStartKm > 0) ? `<span class="swt-descent-badge">🥶 Abfahrt RealFeel ${m.descentWindchillC}°C</span>` : ''}
        </div>
        <div class="swt-cell swt-precip">
          <div class="swt-precip-top">
            <strong class="${m.popPercent >= 50 ? 'text-red' : (m.popPercent >= 25 ? 'text-yellow' : '')}">${m.popPercent}%</strong>
            <span class="swt-precip-mm">${m.precipMm > 0 ? `${m.precipMm.toFixed(1)} mm` : '0 mm'}</span>
          </div>
          ${m.isSnow ? '<span class="swt-snow-badge">❄️ Frost</span>' : ''}
        </div>
      </div>

      <!-- 3. MOBILES INLINE-ACCORDION DETAILPANEL (Klappt per Daumentipp auf) -->
      <div class="swt-accordion-pane">
        <div class="sap-inner">
          <div class="sap-grid">
            <div class="sap-chip">
              <span class="sap-label">🌡️ Wetterzustand & Gefühl</span>
              <strong class="sap-val">${m.weatherIcon} ${escapeHtml(m.weatherCondition)}</strong>
              <span class="sap-sub">Temperatur: <b>${m.tempC}°C</b> (Gefühlt <b>${feltT}°C</b>)</span>
            </div>

            <div class="sap-chip">
              <span class="sap-label">💨 Wind & Windvektor</span>
              <strong class="sap-val">${m.windKmH} km/h • Böen ${m.gustsKmH} km/h</strong>
              <span class="sap-sub text-cyan">${escapeHtml(m.relWindBadge || 'Normaler Wind')}</span>
            </div>

            <div class="sap-chip">
              <span class="sap-label">💧 Niederschlag & Frost</span>
              <strong class="sap-val ${m.popPercent >= 50 ? 'text-red' : ''}">${m.popPercent}% Regenrisiko</strong>
              <span class="sap-sub">${m.precipMm > 0 ? `${m.precipMm.toFixed(1)} mm erwartet` : 'Trockene Verhältnisse'} ${m.isSnow ? '• ❄️ Schneelage' : ''}</span>
            </div>

            <div class="sap-chip">
              <span class="sap-label">🧭 Position & Ankunft</span>
              <strong class="sap-val">${escapeHtml(m.arrivalTimeStr)} (${escapeHtml(m.arrivalDateStr)})</strong>
              <span class="sap-sub">${m.lat.toFixed(4)}°, ${m.lon.toFixed(4)}° ${deltaHtml ? `• ${deltaHtml}` : ''}</span>
            </div>
            ${eawsAccordionChip}
          </div>

          <div class="sap-footer">
            <button type="button" class="sap-focus-btn" data-km="${m.distFromStartKm}">
              <span>📍 Auf Karte zentrieren & Profil fokussieren</span>
            </button>
          </div>
        </div>
      </div>
    `;

    row.addEventListener('click', (e) => {
      const isExpanded = row.classList.contains('is-expanded');

      // Wenn auf den Fokus-Button geklickt wurde, direkt zentrieren
      if (e.target.closest('.sap-focus-btn')) {
        e.stopPropagation();
        const slider = document.getElementById('sports-route-slider');
        if (slider) {
          const pct = (m.distFromStartKm / timeline.totalDistanceKm) * 100;
          slider.value = Math.round(pct);
        }
        updateSportsScrubber(m.distFromStartKm);
        if (state.sports.map) {
          state.sports.map.panTo([m.lat, m.lon], { animate: true });
        }
        return;
      }

      // Accordion Verhalten: Andere Zeilen auf Mobile schließen
      const allRows = container.querySelectorAll('.swt-row');
      allRows.forEach(r => {
        if (r !== row) r.classList.remove('is-expanded');
      });

      if (isExpanded) {
        row.classList.remove('is-expanded');
      } else {
        row.classList.add('is-expanded');
      }

      // Scrubber und Karte synchronisieren
      const slider = document.getElementById('sports-route-slider');
      if (slider) {
        const pct = (m.distFromStartKm / timeline.totalDistanceKm) * 100;
        slider.value = Math.round(pct);
      }
      updateSportsScrubber(m.distFromStartKm);

      // Wenn Live-Tracking aktiv oder bereits im In-Flight Modus: manuell auf Punkt springen
      if (state.sports.trackingActive || state.sports.currentProgressKm > 0) {
        updateInFlightProgress(m.distFromStartKm, true);
      }
    });

    fragment.appendChild(row);
  });

  container.replaceChildren(fragment);
}

export function openSportsMapFullscreen() {
  const wrapper = document.getElementById('sports-map-wrapper');
  if (!wrapper) return;
  wrapper.classList.add('sports-map-fullscreen');
  document.body.classList.add('sports-map-fullscreen-active');
  document.body.style.overflow = 'hidden';

  const syncFsMap = (fit) => {
    if (state.sports.map) {
      state.sports.map.invalidateSize({ animate: false, pan: false });
      if (fit && state.sports.routeLine) {
        state.sports.map.fitBounds(state.sports.routeLine.getBounds(), {
          padding: [60, 60],
          maxZoom: 15
        });
      }
    }
    if (state.sports.timeline) {
      renderSportsMapElevationProfile(state.sports.timeline);
      updateSportsScrubber(state.sports.scrubberKm || 0);
    }
  };
  requestAnimationFrame(() => syncFsMap(true));
  setTimeout(() => syncFsMap(true), 80);
  setTimeout(() => syncFsMap(false), 260);
}

export function closeSportsMapFullscreen() {
  const wrapper = document.getElementById('sports-map-wrapper');
  if (!wrapper) return;
  wrapper.classList.remove('sports-map-fullscreen');
  document.body.classList.remove('sports-map-fullscreen-active');
  document.body.style.overflow = '';

  const syncCloseMap = (fit) => {
    if (state.sports.map) {
      state.sports.map.invalidateSize({ animate: false, pan: false });
      if (fit && state.sports.routeLine) {
        state.sports.map.fitBounds(state.sports.routeLine.getBounds(), {
          padding: [25, 25]
        });
      }
    }
    if (state.sports.timeline) {
      renderSportsMapElevationProfile(state.sports.timeline);
      updateSportsScrubber(state.sports.scrubberKm || 0);
    }
  };
  requestAnimationFrame(() => syncCloseMap(true));
  setTimeout(() => syncCloseMap(true), 80);
  setTimeout(() => syncCloseMap(false), 260);
}

export function renderSportsMap(timeline) {
  const container = document.getElementById('sports-map-container');
  if (!container || !timeline || !timeline.timedPoints || timeline.timedPoints.length === 0) return;

  if (!state.sports.map) {
    state.sports.map = L.map('sports-map-container', {
      zoomControl: false,
      attributionControl: false,
      maxZoom: 19
    }).setView([timeline.timedPoints[0].lat, timeline.timedPoints[0].lon], 11);

    // Garantiert nahtlose Leaflet-Größensync (verhindert graue Streifen am unteren Kartenrand bei Mac-Zoom/Fullscreen)
    if (!container.dataset.mapRoBound && typeof ResizeObserver !== 'undefined') {
      container.dataset.mapRoBound = '1';
      let rafId = 0;
      const ro = new ResizeObserver(() => {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          if (state.sports.map) state.sports.map.invalidateSize({ animate: false, pan: false });
        });
      });
      ro.observe(container);
    }

    // Hochauflösende Alpin-Topokarte mit Geländerelief & Höhenlinien (OpenTopoMap)
    const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 17,
      maxZoom: 19,
      subdomains: ['a', 'b', 'c'],
      attribution: '© OpenStreetMap, SRTM | OpenTopoMap'
    });
    topoLayer.on('tileerror', function (err) {
      if (err.tile && !err.tile._fallbackTried) {
        err.tile._fallbackTried = true;
        const coords = err.coords;
        err.tile.src = `https://tile.openstreetmap.fr/hot/${coords.z}/${coords.x}/${coords.y}.png`;
      }
    });
    topoLayer.addTo(state.sports.map);
  }

  // Bestehende Schichten entfernen
  if (state.sports.routeBgLine) state.sports.map.removeLayer(state.sports.routeBgLine);
  if (state.sports.routeLine) state.sports.map.removeLayer(state.sports.routeLine);
  if (state.sports.startMarker) state.sports.map.removeLayer(state.sports.startMarker);
  if (state.sports.endMarker) state.sports.map.removeLayer(state.sports.endMarker);
  if (state.sports.scrubberMarker) state.sports.map.removeLayer(state.sports.scrubberMarker);
  if (state.sports.milestoneMarkers) {
    state.sports.milestoneMarkers.forEach(m => state.sports.map.removeLayer(m));
  }
  state.sports.milestoneMarkers = [];

  const latLngs = timeline.timedPoints.map(p => [p.lat, p.lon]);

  // Route Hintergrund-Casing: strahlend weiße Umrandung wie auf Outdoor-Karten
  state.sports.routeBgLine = L.polyline(latLngs, {
    color: '#ffffff',
    weight: 7.5,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.sports.map);

  // Vordergrund-Route: kräftiges Alpin-Blau
  state.sports.routeLine = L.polyline(latLngs, {
    color: '#0066ff',
    weight: 4.5,
    opacity: 1.0,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.sports.map);

  // Start & Ziel Daten ermitteln
  const startPt = timeline.timedPoints[0];
  const endPt = timeline.timedPoints[timeline.timedPoints.length - 1];
  const startMs = timeline.milestones[0] || { weatherIcon: '☀️', tempC: 10, windKmH: 5, precipMm: 0, weatherCondition: 'Trocken' };
  const endMs = timeline.milestones[timeline.milestones.length - 1] || { weatherIcon: '☀️', tempC: 10, windKmH: 5, precipMm: 0, weatherCondition: 'Trocken' };
  const isSkitour = timeline.category === 'skitour';

  const isOfficialAv = !!(timeline.avalancheReport && timeline.avalancheReport.isOfficialBulletin);
  const getMapEawsPill = (ms) => (isSkitour && ms && ms.avalancheLevel)
    ? `<span class="ms-eaws-pill" style="background:${ms.avalancheColor};color:${ms.avalancheTextColor};" title="${isOfficialAv ? '🟢 Offizieller Lawinenlagebericht' : '🔵 Prognose (kein offizieller Lawinenlagebericht)'}: Stufe ${ms.avalancheLevel}/5 (${escapeHtml(ms.avalancheLabel)})">${isOfficialAv ? '✓' : '~'} ${ms.avalancheLevel}/5</span>`
    : '';
  const getPopupEawsRow = (ms) => (isSkitour && ms && ms.avalancheLevel)
    ? `<div class="smp-eaws-row"><span class="ms-eaws-pill" style="background:${ms.avalancheColor};color:${ms.avalancheTextColor};">${isOfficialAv ? '🟢 Offizieller Lawinenlagebericht' : '🔵 Prognose'}: Stufe ${ms.avalancheLevel}/5 (${escapeHtml(ms.avalancheLabel)})</span></div>`
    : '';

  // 1. START Marker (Roter Pin mit weißem Kreis 'START' + Callout-Badge wie im Referenzdesign)
  const startIcon = L.divIcon({
    className: 'sports-custom-pin start-pin',
    html: `
      <div class="sm-pin-teardrop sm-pin-start">
        <div class="ms-compact-pill sm-ref-badge sm-badge-start">
          <span class="ms-icon">${startMs.weatherIcon}</span>
          <span class="ms-temp">${startMs.tempC}°</span>
          <span class="ms-time">${timeline.startTimeStr}</span>
          ${getMapEawsPill(startMs)}
        </div>
        <div class="sm-pin-icon-wrap">
          <div class="sm-pin-circle">
            <span class="sm-pin-label">START</span>
          </div>
          <div class="sm-pin-stem"></div>
        </div>
      </div>
    `,
    iconSize: null,
    iconAnchor: null
  });

  state.sports.startMarker = L.marker([startPt.lat, startPt.lon], { icon: startIcon, zIndexOffset: 2500 }).addTo(state.sports.map);
  state.sports.startMarker.bindPopup(`
    <div class="sports-map-popup-card">
      <div class="smp-title">🚩 Tourstart</div>
      <div class="smp-meta">⏱️ Startzeit: <b>${timeline.startTimeStr} Uhr</b> • Höhe: <b>${Math.round(startPt.ele)} m</b></div>
      <div class="smp-grid">
        <div>${startMs.weatherIcon} <b>${startMs.weatherCondition}</b></div>
        <div>🌡️ Temperatur: <b>${startMs.tempC}°C</b></div>
        <div>💨 Wind: <b>${startMs.windKmH} km/h</b></div>
        ${getPopupEawsRow(startMs)}
      </div>
      <button type="button" class="smp-jump-btn" onclick="window.jumpToSportsKm && window.jumpToSportsKm(0)">
        📍 Im Streckenwetter anspringen
      </button>
    </div>
  `);

  // 2. ZIEL Marker (Roter Pin mit weißem Kreis und Zielflagge 🏁 + Callout-Badge)
  const endIcon = L.divIcon({
    className: 'sports-custom-pin end-pin',
    html: `
      <div class="sm-pin-teardrop sm-pin-end">
        <div class="ms-compact-pill sm-ref-badge sm-badge-end">
          <span class="ms-icon">${endMs.weatherIcon}</span>
          <span class="ms-temp">${endMs.tempC}°</span>
          <span class="ms-time">${timeline.endTimeStr}</span>
          ${getMapEawsPill(endMs)}
        </div>
        <div class="sm-pin-icon-wrap">
          <div class="sm-pin-circle">
            <span class="sm-pin-flag">🏁</span>
          </div>
          <div class="sm-pin-stem"></div>
        </div>
      </div>
    `,
    iconSize: null,
    iconAnchor: null
  });

  state.sports.endMarker = L.marker([endPt.lat, endPt.lon], { icon: endIcon, zIndexOffset: 2500 }).addTo(state.sports.map);
  state.sports.endMarker.bindPopup(`
    <div class="sports-map-popup-card">
      <div class="smp-title">🏁 Zielankunft</div>
      <div class="smp-meta">⏱️ Ankunft: <b>${timeline.endTimeStr} Uhr</b> • Distanz: <b>${timeline.totalDistanceKm.toFixed(1)} km</b></div>
      <div class="smp-grid">
        <div>${endMs.weatherIcon} <b>${endMs.weatherCondition}</b></div>
        <div>🌡️ Temperatur: <b>${endMs.tempC}°C</b></div>
        <div>💨 Wind: <b>${endMs.windKmH} km/h</b></div>
        ${getPopupEawsRow(endMs)}
      </div>
      <button type="button" class="smp-jump-btn" onclick="window.jumpToSportsKm && window.jumpToSportsKm(${timeline.totalDistanceKm})">
        📍 Im Streckenwetter anspringen
      </button>
    </div>
  `);

  // 3. Zwischen-Meilensteine alle ~200 Hm mit eleganten Wetter-Callouts (Referenzdesign)
  timeline.milestones.forEach((m, idx) => {
    if (idx === 0 || idx === timeline.milestones.length - 1) return;
    const isPeak = (m.ele === timeline.maxElevationM || m.label?.includes('Gipfel') || m.label?.includes('Pass'));

    const mIcon = L.divIcon({
      className: 'sports-milestone-marker',
      html: `
        <div class="ms-marker-bubble ${isPeak ? 'bubble-peak' : ''}" data-km="${m.distFromStartKm}">
          <!-- Kompakte Ansicht für kleine Standardkarte -->
          <div class="ms-compact-pill sm-ref-pill">
            <span class="ms-icon">${m.weatherIcon}</span>
            <span class="ms-temp">${m.tempC}°</span>
            <span class="ms-time">${m.arrivalTimeStr ? m.arrivalTimeStr.replace(' Uhr', '') : ''}</span>
            ${getMapEawsPill(m)}
          </div>
          <!-- Ausführliche Detailansicht für die vergrößerte Karte -->
          <div class="ms-detailed-card sm-ref-card ${isPeak ? 'bubble-peak' : ''}">
            <div class="sm-ref-main">
              <span class="ms-icon">${m.weatherIcon}</span>
              <span class="ms-temp">${m.tempC}°</span>
              <span class="ms-time">${m.arrivalTimeStr ? m.arrivalTimeStr.replace(' Uhr', '') : ''}</span>
            </div>
            <div class="sm-ref-sub">
              <span class="sm-cond">${isPeak ? '🏔️ ' : ''}${m.weatherCondition}</span>
              <span class="sm-dot">•</span>
              <span class="sm-wind">💨 ${m.windKmH} km/h</span>
              ${m.precipMm > 0 ? `<span class="sm-dot">•</span><span class="sm-rain">💧 ${m.precipMm.toFixed(1)}mm</span>` : ''}
            </div>
            ${isSkitour && m.avalancheLevel ? `<div class="ms-detailed-eaws"><span class="ms-eaws-pill" style="background:${m.avalancheColor};color:${m.avalancheTextColor};">⚠️ Lawinenlagebericht Stufe ${m.avalancheLevel}/5 (${escapeHtml(m.avalancheLabel)})</span></div>` : ''}
            <div class="sm-ref-arrow"></div>
          </div>
          <div class="sm-trail-dot ${isPeak ? 'dot-peak' : ''}"></div>
        </div>
      `,
      iconSize: null,
      iconAnchor: null
    });

    const marker = L.marker([m.lat, m.lon], { icon: mIcon, zIndexOffset: isPeak ? 2000 : 1000 }).addTo(state.sports.map);
    marker.bindPopup(`
      <div class="sports-map-popup-card">
        <div class="smp-title">${isPeak ? '🏔️ ' : '📍 '}${m.label} (${m.distFromStartKm.toFixed(1)} km)</div>
        <div class="smp-meta">⏱️ Durchgang: <b>${m.arrivalTimeStr}</b> • Höhe: <b>${Math.round(m.ele)} m</b></div>
        <hr class="smp-divider">
        <div class="smp-grid">
          <div>${m.weatherIcon} <b>${m.weatherCondition}</b></div>
          <div>🌡️ Temperatur: <b>${m.tempC}°C</b> (Gefühlt ${m.feltTempC}°C)</div>
          <div>💨 Wind: <b>${m.windKmH} km/h</b> (Böen ${m.gustsKmH} km/h)</div>
          ${m.relWindBadge ? `<div class="smp-wind-badge">${m.relWindBadge}</div>` : ''}
          <div>💧 Niederschlag: <b>${m.precipMm.toFixed(1)} mm</b> (${m.popPercent}%)</div>
          ${m.isSnow ? '<div class="smp-snow-badge">❄️ Frost / Schneelage möglich</div>' : ''}
          ${getPopupEawsRow(m)}
        </div>
        <button type="button" class="smp-jump-btn" onclick="window.jumpToSportsKm && window.jumpToSportsKm(${m.distFromStartKm})">
          📍 Im Streckenwetter anspringen
        </button>
      </div>
    `);
    state.sports.milestoneMarkers.push(marker);
  });

  // 4. Zentraler Tour-HUD-Badge auf der Karte (wie im Referenz-Screenshot: Dauer & Distanz)
  const hud = document.getElementById('sports-map-center-hud');
  if (hud) {
    hud.style.display = 'flex';
    const hudTime = document.getElementById('sm-hud-time');
    const hudDist = document.getElementById('sm-hud-dist');
    if (hudTime) hudTime.innerText = `${timeline.totalDurationStr || '--'}`;
    if (hudDist) hudDist.innerText = `${timeline.totalDistanceKm.toFixed(1)} km • +${Math.round(timeline.totalAscentM)} Hm`;
  }

  // 5. Interaktiver Scrubber-Marker (Athleten-Pin ohne störende Animationen)
  const athleteIcon = timeline.sportType === 'road_bike'
    ? '🚴'
    : (timeline.sportType === 'gravel_mtb'
      ? '🚵'
      : (timeline.sportType === 'trailrun'
        ? '🏃'
        : (timeline.category === 'skitour' || timeline.sportType === 'ski_touring' || timeline.sportType === 'skimo' ? '⛷️' : '🥾')));
  const scrubberIcon = L.divIcon({
    className: 'sports-scrubber-map-marker',
    html: `<div class="scrubber-pin-wrap"><div class="scrubber-live-pill" id="scrubber-map-live-pill" style="display:none;"></div><div class="scrubber-pin-static">${athleteIcon}</div></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  state.sports.scrubberMarker = L.marker([startPt.lat, startPt.lon], { icon: scrubberIcon, zIndexOffset: 3000 }).addTo(state.sports.map);

  const slopeToggleBtn = document.getElementById('sports-slope-overlay-btn');
  if (slopeToggleBtn) slopeToggleBtn.style.display = isSkitour ? 'inline-flex' : 'none';
  if (isSkitour && state.sports.slopeOverlayEnabled) {
    renderSportsSlopeOverlay(timeline);
  } else if (state.sports.slopeLayerGroup && state.sports.map) {
    state.sports.map.removeLayer(state.sports.slopeLayerGroup);
  }

  setTimeout(() => {
    state.sports.map.invalidateSize();
    state.sports.map.fitBounds(state.sports.routeLine.getBounds(), { padding: [35, 35] });
  }, 100);
}

/**
 * Steilgelände-Overlay (>= 30° / 35° / 40°) für die Skitouren-Routenkarte
 * Zeichnet sofort steile GPX-Trackabschnitte und lädt optional ein 10x10 Copernicus-DEM Raster im Korridor.
 */
export async function renderSportsSlopeOverlay(timeline) {
  if (!state.sports.map) return;
  if (state.sports.slopeLayerGroup) {
    state.sports.map.removeLayer(state.sports.slopeLayerGroup);
    state.sports.slopeLayerGroup = null;
  }
  if (!state.sports.slopeOverlayEnabled || !timeline || !Array.isArray(timeline.timedPoints) || timeline.timedPoints.length < 2) {
    return;
  }

  const group = L.layerGroup().addTo(state.sports.map);
  state.sports.slopeLayerGroup = group;

  // 1. Steile GPX- & 2D-DEM-Abschnitte direkt farbig hervorheben
  const pts = timeline.timedPoints;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const deg = cur.slopeDeg || 0;
    if (deg < 30) continue;
    const color = deg >= 40 ? '#ef4444' : (deg >= 35 ? '#f97316' : '#eab308');
    L.polyline([[prev.lat, prev.lon], [cur.lat, cur.lon]], {
      color,
      weight: 9,
      opacity: 0.78,
      lineCap: 'round',
      interactive: false
    }).addTo(group);
  }

  // 2. 10x10 DEM-Korridor-Flächenoverlay (30-34° Gelb, 35-39° Orange, >=40° Rot), 30 Tage gecacht
  try {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    pts.forEach(p => {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    });
    const padLat = Math.max(0.008, (maxLat - minLat) * 0.25);
    const padLon = Math.max(0.012, (maxLon - minLon) * 0.25);
    const s = minLat - padLat, n = maxLat + padLat, w = minLon - padLon, e = maxLon + padLon;
    const N = 10;
    const qLats = [], qLons = [];
    for (let r = 0; r < N; r++) {
      const lat = s + (r / (N - 1)) * (n - s);
      for (let c = 0; c < N; c++) {
        const lon = w + (c / (N - 1)) * (e - w);
        qLats.push(lat.toFixed(4));
        qLons.push(lon.toFixed(4));
      }
    }
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${qLats.join(',')}&longitude=${qLons.join(',')}`;
    const demRes = await resilientFetch(url, { ttlMs: 30 * 24 * 3600 * 1000, timeoutMs: 4500, persist: true, allowStaleOnError: true });
    if (!state.sports.slopeOverlayEnabled || state.sports.slopeLayerGroup !== group) return;
    if (demRes && Array.isArray(demRes.elevation) && demRes.elevation.length === N * N) {
      const elev = demRes.elevation;
      const dxM = ((e - w) / (N - 1)) * 111320 * Math.cos(((s + n) / 2) * Math.PI / 180);
      const dyM = ((n - s) / (N - 1)) * 111320;
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      const slopes = new Float32Array(N * N);
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const r0 = Math.max(0, r - 1), r1 = Math.min(N - 1, r + 1);
          const c0 = Math.max(0, c - 1), c1 = Math.min(N - 1, c + 1);
          const dzdx = (elev[r * N + c1] - elev[r * N + c0]) / Math.max(20, (c1 - c0) * dxM);
          const dzdy = (elev[r1 * N + c] - elev[r0 * N + c]) / Math.max(20, (r1 - r0) * dyM);
          slopes[r * N + c] = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
        }
      }
      const imgData = ctx.createImageData(160, 160);
      for (let py = 0; py < 160; py++) {
        const rf = ((159 - py) / 159) * (N - 1);
        const rLo = Math.min(N - 2, Math.floor(rf)), tR = rf - rLo;
        for (let px = 0; px < 160; px++) {
          const cf = (px / 159) * (N - 1);
          const cLo = Math.min(N - 2, Math.floor(cf)), tC = cf - cLo;
          const v00 = slopes[rLo * N + cLo], v01 = slopes[rLo * N + cLo + 1];
          const v10 = slopes[(rLo + 1) * N + cLo], v11 = slopes[(rLo + 1) * N + cLo + 1];
          const deg = (v00 * (1 - tC) + v01 * tC) * (1 - tR) + (v10 * (1 - tC) + v11 * tC) * tR;
          if (deg < 28) continue;
          const idx = (py * 160 + px) * 4;
          if (deg >= 40) {
            imgData.data[idx] = 239; imgData.data[idx + 1] = 68; imgData.data[idx + 2] = 68; imgData.data[idx + 3] = 140;
          } else if (deg >= 35) {
            imgData.data[idx] = 249; imgData.data[idx + 1] = 115; imgData.data[idx + 2] = 22; imgData.data[idx + 3] = 115;
          } else if (deg >= 30) {
            imgData.data[idx] = 234; imgData.data[idx + 1] = 179; imgData.data[idx + 2] = 8; imgData.data[idx + 3] = 92;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      L.imageOverlay(canvas.toDataURL('image/png'), [[s, w], [n, e]], { opacity: 0.75, interactive: false }).addTo(group);
    }
  } catch (_) {}
}

export function updateSportsScrubber(km, opts = {}) {
  const timeline = state.sports.timeline;
  if (!timeline || !timeline.timedPoints || timeline.timedPoints.length === 0) return;

  const totalDist = Math.max(0.1, timeline.totalDistanceKm);
  const clampedKm = Math.max(0, Math.min(totalDist, km));
  state.sports.scrubberKm = clampedKm;

  // Synchronisiere den sichtbaren Range Slider
  const routeSlider = document.getElementById('sports-route-slider');
  if (routeSlider && !state.sports.isDraggingSlider) {
    routeSlider.value = totalDist > 0 ? (clampedKm / totalDist) * 100 : 0;
  }

  const sliderTotal = document.getElementById('cockpit-slider-total');
  if (sliderTotal) {
    sliderTotal.innerText = `${totalDist.toFixed(1)} km`;
  }

  // Finde nächsten berechneten Punkt inkl. Index
  let closestPt = timeline.timedPoints[0];
  let closestPtIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < timeline.timedPoints.length; i++) {
    const diff = Math.abs(timeline.timedPoints[i].distFromStartKm - clampedKm);
    if (diff < minDiff) {
      minDiff = diff;
      closestPt = timeline.timedPoints[i];
      closestPtIdx = i;
    }
  }

  // Finde nächsten Meilenstein für Wetter-Werte
  let closestMs = timeline.milestones[0];
  let minMsDiff = Infinity;
  let closestMsIdx = 0;
  for (let i = 0; i < timeline.milestones.length; i++) {
    const diff = Math.abs(timeline.milestones[i].distFromStartKm - clampedKm);
    if (diff < minMsDiff) {
      minMsDiff = diff;
      closestMs = timeline.milestones[i];
      closestMsIdx = i;
    }
  }

  // --- 1. NEUER ALPINE COCKPIT WETTER-MONITOR (Unified & Mobile-Optimized) ---
  const cockpitBadge = document.getElementById('cockpit-pos-badge');
  if (cockpitBadge) {
    cockpitBadge.innerText = `📍 km ${closestPt.distFromStartKm.toFixed(1)} • ${Math.round(closestPt.ele)} Hm`;
  }

  const arrStr = closestPt.arrivalDate ? closestPt.arrivalDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  const sliderHint = document.getElementById('cockpit-slider-hint');
  if (sliderHint) {
    sliderHint.innerText = `km ${closestPt.distFromStartKm.toFixed(1)} • ${Math.round(closestPt.ele)} Hm • ⏱️ ${arrStr} Uhr`;
  }

  // Bestimme Streckenpunkt-Typ (Start, Gipfel, Ziel, Abschnitt)
  const isStart = clampedKm <= 0.25;
  const isEnd = clampedKm >= totalDist - 0.25;
  const isPeak = Math.abs(closestPt.ele - timeline.maxElevationM) <= 15;

  let stationTitle = `Streckenpunkt km ${closestPt.distFromStartKm.toFixed(1)}`;
  let stationIcon = closestMs.weatherIcon || '⛅';
  if (isStart) {
    stationTitle = 'Tourstart';
    stationIcon = '🟢';
  } else if (isPeak) {
    stationTitle = 'Gipfel / Scheitelpunkt';
    stationIcon = '🏔️';
  } else if (isEnd) {
    stationTitle = 'Zielankunft';
    stationIcon = '🏁';
  }

  const cwcIcon = document.getElementById('cwc-icon');
  const cwcTitle = document.getElementById('cwc-title');
  const cwcSub = document.getElementById('cwc-sub');
  const cwcTime = document.getElementById('cwc-time');
  const cwcTemp = document.getElementById('cwc-temp');
  const cwcFelt = document.getElementById('cwc-felt');
  const cwcCond = document.getElementById('cwc-cond');
  const cwcCondNote = document.getElementById('cwc-cond-note');
  const cwcWind = document.getElementById('cwc-wind');
  const cwcGusts = document.getElementById('cwc-gusts');
  const cwcPrecip = document.getElementById('cwc-precip');
  const cwcPop = document.getElementById('cwc-pop');
  const cwcAlert = document.getElementById('cwc-alert-bar');
  const cwcAlertText = document.getElementById('cwc-alert-text');

  if (cwcIcon) cwcIcon.innerText = stationIcon;
  if (cwcTitle) cwcTitle.innerText = stationTitle;
  if (cwcSub) cwcSub.innerText = `km ${closestPt.distFromStartKm.toFixed(1)} • ${Math.round(closestPt.ele)} Hm`;
  if (cwcTime) {
    const arrStr = closestPt.arrivalDate ? closestPt.arrivalDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    cwcTime.innerText = `⏱️ ${arrStr} Uhr`;
  }
  if (cwcTemp) cwcTemp.innerText = `${closestMs.tempC}°C`;
  if (cwcFelt) {
    const feltVal = closestMs.feltTempC !== undefined ? closestMs.feltTempC : closestMs.tempC;
    cwcFelt.innerText = `Gefühlt ${feltVal}°C`;
  }
  if (cwcCond) cwcCond.innerText = `${closestMs.weatherIcon} ${closestMs.weatherCondition || 'Normal'}`;
  if (cwcCondNote) {
    if (timeline.category === 'skitour' && closestMs.avalancheLevel) {
      cwcCondNote.innerHTML = `<span class="swt-eaws-badge" style="background:${closestMs.avalancheColor};color:${closestMs.avalancheTextColor};">⚠️ Lawinenlagebericht Stufe ${closestMs.avalancheLevel}/5 (${escapeHtml(closestMs.avalancheLabel)})</span>`;
    } else if (closestMs.weatherCode >= 95) cwcCondNote.innerText = '⚡ Gewitter';
    else if (closestMs.isSnow) cwcCondNote.innerText = '❄️ Schneelage';
    else if (closestMs.precipMm >= 1) cwcCondNote.innerText = '🌧️ Regenphase';
    else cwcCondNote.innerText = 'Stabil';
  }
  if (cwcWind) cwcWind.innerText = `${closestMs.windKmH} km/h`;
  if (cwcGusts) {
    let relStr = '';
    if (closestMs.relWindBadge) {
      if (closestMs.relWindBadge.includes('Gegenwind')) relStr = ' • 🌬️ Gegenwind';
      else if (closestMs.relWindBadge.includes('Rückenwind')) relStr = ' • 💨 Rückenwind';
      else if (closestMs.relWindBadge.includes('Seitenwind')) relStr = ' • ⚠️ Seitenwind';
      else relStr = ` • ${closestMs.relWindBadge}`;
    }
    cwcGusts.innerText = `Böen ${closestMs.gustsKmH} km/h${relStr}`;
  }
  if (cwcPrecip) cwcPrecip.innerText = closestMs.precipMm > 0 ? `${closestMs.precipMm.toFixed(1)} mm` : '0 mm';
  if (cwcPop) cwcPop.innerText = `${closestMs.popPercent}% Risiko`;

  // Warnungs-Banner bei alpinen Gefahren am Wegpunkt
  if (cwcAlert && cwcAlertText) {
    const hasHazard = closestMs.precipMm >= 1.0 || closestMs.gustsKmH >= 45 || closestMs.weatherCode >= 95 || closestMs.isSnow || (closestMs.tempC <= 0);
    if (hasHazard) {
      cwcAlert.style.display = 'flex';
      if (closestMs.weatherCode >= 95) cwcAlertText.innerText = 'Achtung: Gewittergefahr zur berechneten Durchgangszeit!';
      else if (closestMs.gustsKmH >= 45) cwcAlertText.innerText = `Sturmböen (${closestMs.gustsKmH} km/h) an exponierten Stellen erwartet!`;
      else if (closestMs.isSnow || closestMs.tempC <= 0) cwcAlertText.innerText = 'Frostgefahr / Minustemperaturen auf diesem Streckenabschnitt!';
      else if (closestMs.precipMm >= 1.0) cwcAlertText.innerText = `Regenrisiko: Erwartete Niederschlagsmenge ${closestMs.precipMm.toFixed(1)} mm.`;
      else cwcAlertText.innerText = 'Alpine Wetterwarnung für diesen Streckenabschnitt.';
    } else {
      cwcAlert.style.display = 'none';
    }
  }

  // 1-Touch Station-Chips aktiv schalten
  const chipStart = document.getElementById('cockpit-chip-start');
  const chipPeak = document.getElementById('cockpit-chip-peak');
  const chipFinish = document.getElementById('cockpit-chip-finish');
  if (chipStart) chipStart.classList.toggle('active', isStart);
  if (chipPeak) chipPeak.classList.toggle('active', isPeak && !isStart && !isEnd);
  if (chipFinish) chipFinish.classList.toggle('active', isEnd);

  // Altes Schwebendes HUD-Badge ausblenden (wird durch Capsule sauber ersetzt)
  const hud = document.getElementById('sports-hud-badge');
  if (hud) {
    hud.style.display = 'none';
  }

  // SVG Scrubber Strich & Punkt bewegen
  const svgLine = document.getElementById('svg-scrubber-line');
  const svgDot = document.getElementById('svg-scrubber-dot');
  if (svgLine && svgDot) {
    const padL = 50;
    const padT = 35;
    const padB = 40;
    const plotW = 900 - padL - 35;
    const plotH = 240 - padT - padB;
    const minZ = Math.max(0, timeline.minElevationM - 80);
    const maxZ = timeline.maxElevationM + 80;
    const rangeZ = Math.max(20, maxZ - minZ);

    const x = padL + (clampedKm / totalDist) * plotW;
    const y = padT + plotH - ((closestPt.ele - minZ) / rangeZ) * plotH;

    svgLine.setAttribute('x1', x.toFixed(1));
    svgLine.setAttribute('x2', x.toFixed(1));
    svgDot.setAttribute('cx', x.toFixed(1));
    svgDot.setAttribute('cy', y.toFixed(1));
  }

  // Map Marker + Live-Mini-Badge synchronisieren
  if (state.sports.scrubberMarker) {
    state.sports.scrubberMarker.setLatLng([closestPt.lat, closestPt.lon]);
    const livePinPill = document.getElementById('scrubber-map-live-pill');
    if (livePinPill) {
      const cat = timeline.category || 'mountain';
      const eawsTxt = (cat === 'skitour' && closestMs.avalancheLevel) ? ` • ~${closestMs.avalancheLevel}/5` : '';
      livePinPill.innerText = `${Math.round(closestPt.ele).toLocaleString('de-DE')} m • ${closestMs.tempC}°${eawsTxt}`;
      livePinPill.style.display = 'block';
    }
    if (opts && opts.fromProfile && state.sports.map && document.getElementById('sports-map-wrapper')?.classList.contains('sports-map-fullscreen')) {
      const b = state.sports.map.getBounds();
      if (b && !b.pad(-0.08).contains([closestPt.lat, closestPt.lon])) {
        state.sports.map.panTo([closestPt.lat, closestPt.lon], { animate: false });
      }
    }
  }

  // Karten-Höhenprofil-Dock: Fadenkreuz & sportartspezifische Live-HUD synchronisieren
  const pm = state.sports._mapProfileMetrics;
  const chLine = document.getElementById('smed-crosshair-line');
  const chDot = document.getElementById('smed-crosshair-dot');
  const chTip = document.getElementById('smed-crosshair-tooltip');
  const smedPos = document.getElementById('smed-pos');
  const smedMet = document.getElementById('smed-metric');
  const smedWea = document.getElementById('smed-weather');
  const smedExt = document.getElementById('smed-extra');

  const curGrad = (pm && pm.segGrades && pm.segGrades[closestPtIdx] !== undefined) ? pm.segGrades[closestPtIdx] : 0;
  const cat = timeline.category || 'mountain';

  if (smedPos) {
    smedPos.innerText = `📍 km ${closestPt.distFromStartKm.toFixed(1)} • ${Math.round(closestPt.ele).toLocaleString('de-DE')} m`;
  }
  if (smedMet) {
    if (cat === 'skitour') {
      const slopeVal = closestPt.slopeDeg ? `${closestPt.slopeDeg}°` : `${Math.round(Math.abs(curGrad))}%`;
      const phaseTxt = curGrad > 1.5 ? 'Aufstieg' : (curGrad < -1.5 ? 'Abfahrt' : 'Flach');
      smedMet.innerText = `📐 ${slopeVal} • ${phaseTxt}`;
      smedMet.style.background = (closestPt.slopeDeg || 0) >= 35 ? 'rgba(249, 115, 22, 0.24)' : ((closestPt.slopeDeg || 0) >= 30 ? 'rgba(234, 179, 8, 0.20)' : 'rgba(34, 197, 94, 0.18)');
      smedMet.style.color = (closestPt.slopeDeg || 0) >= 35 ? '#fdba74' : ((closestPt.slopeDeg || 0) >= 30 ? '#fef08a' : '#86efac');
    } else {
      const gSign = curGrad > 0 ? `+${curGrad.toFixed(0)}` : `${curGrad.toFixed(0)}`;
      smedMet.innerText = `${curGrad >= 0 ? '↗' : '↘'} ${gSign}%`;
      smedMet.style.background = Math.abs(curGrad) >= 10 ? 'rgba(249, 115, 22, 0.22)' : 'rgba(56, 189, 248, 0.16)';
      smedMet.style.color = Math.abs(curGrad) >= 10 ? '#fdba74' : '#7dd3fc';
    }
  }
  if (smedWea) {
    smedWea.innerText = `⏱️ ${arrStr} Uhr • ${closestMs.weatherIcon} ${closestMs.tempC}°C • 💨 ${closestMs.windKmH} km/h`;
  }
  if (smedExt) {
    if (cat === 'skitour' && closestMs.avalancheLevel) {
      smedExt.style.display = 'inline-flex';
      smedExt.style.background = closestMs.avalancheColor;
      smedExt.style.color = closestMs.avalancheTextColor;
      smedExt.innerText = closestMs.exceedsMunterLimit && closestMs.grmLimitDeg
        ? `⚠️ Stufe ${closestMs.avalancheLevel}/5 • Über ${closestMs.grmLimitDeg}°`
        : `Lawinenstufe ${closestMs.avalancheLevel}/5`;
    } else if (cat === 'bike' && closestMs.relWindBadge) {
      smedExt.style.display = 'inline-flex';
      smedExt.style.background = 'rgba(255, 255, 255, 0.09)';
      smedExt.style.color = '#f8fafc';
      smedExt.innerText = closestMs.descentWindchillC <= 5 && curGrad < -3
        ? `🥶 Abfahrt ${closestMs.descentWindchillC}°C`
        : closestMs.relWindBadge;
    } else if (cat === 'mountain' && closestMs.isSnow) {
      smedExt.style.display = 'inline-flex';
      smedExt.style.background = 'rgba(56, 189, 248, 0.18)';
      smedExt.style.color = '#bae6fd';
      smedExt.innerText = '❄️ Frostzone';
    } else {
      smedExt.style.display = 'none';
    }
  }

  if (pm && chLine && chDot && chTip) {
    const cx = pm.padL + (Math.max(0, Math.min(pm.totalDist, clampedKm)) / pm.totalDist) * pm.plotW;
    const cy = pm.padT + pm.plotH - ((closestPt.ele - pm.minZ) / pm.rangeZ) * pm.plotH;
    chLine.style.display = 'block';
    chLine.style.left = `${cx.toFixed(1)}px`;
    chDot.style.display = 'block';
    chDot.style.left = `${cx.toFixed(1)}px`;
    chDot.style.top = `${cy.toFixed(1)}px`;
    chTip.style.display = 'block';
    chTip.innerText = `${Math.round(closestPt.ele)} m • ${arrStr}`;
    const tipLeft = Math.max(pm.padL + 2, Math.min(pm.W - 96, cx - 42));
    chTip.style.left = `${tipLeft.toFixed(1)}px`;
  }

  // Wegpunkt-Zeile in Tabelle hervorheben (ohne Seiten-Scroll-Jump auf Mobile)
  const rows = document.querySelectorAll('.swt-row');
  rows.forEach((row) => {
    const rIdx = parseInt(row.dataset.idx, 10);
    const isActive = rIdx === closestMsIdx;
    row.classList.toggle('active-waypoint', isActive);
  });
}


