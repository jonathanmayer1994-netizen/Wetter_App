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
    return (celsius * 9/5) + 32;
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
  state.sports.sportType = cat === 'bike' ? 'road_bike' : 'hiking';

  const catCards = document.querySelectorAll('.athlete-cat-card');
  catCards.forEach(c => c.classList.toggle('active', c.dataset.category === cat));

  const bikePanel = document.getElementById('athlete-bike-controls');
  const mtnPanel = document.getElementById('athlete-mountain-controls');
  if (bikePanel) bikePanel.style.display = cat === 'bike' ? 'block' : 'none';
  if (mtnPanel) mtnPanel.style.display = cat === 'mountain' ? 'block' : 'none';

  // Synchronisiere versteckte Legacy-Pills für Tests
  document.querySelectorAll('.sport-pill').forEach(sp => {
    sp.classList.toggle('active', sp.dataset.sport === state.sports.sportType);
  });

  updateSportPaceBadges();
  recomputeSportsTimeline();
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
    if (badge) badge.innerText = `${val.toFixed(1)} km/h • ${state.sports.mountainAscentHmH} Hm/h`;

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
    if (badge) badge.innerText = `${state.sports.mountainSpeedKmH.toFixed(1)} km/h • ${val} Hm/h`;

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

  // Alpine Referenz-Routen (Presets)
  const routePresets = document.querySelectorAll('.sports-route-preset');
  routePresets.forEach(btn => {
    btn.addEventListener('click', () => {
      routePresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSportsPresetTour(btn.dataset.tour);
    });
  });

  // GPX File Upload & Drag'n'Drop
  const browseBtn = document.getElementById('sports-browse-btn');
  const fileInput = document.getElementById('sports-file-input');
  const dropZone = document.getElementById('sports-drop-zone');

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

  // Mobile Stage Stepper Navigation
  const smsPrevBtn = document.getElementById('sms-prev-btn');
  const smsNextBtn = document.getElementById('sms-next-btn');
  const swtList = document.getElementById('sports-waypoints-list');
  const smsBadge = document.getElementById('sms-step-badge');

  if (swtList) {
    let scrollTimeout;
    swtList.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const rows = swtList.querySelectorAll('.swt-row');
        if (rows.length === 0) return;
        const center = swtList.scrollLeft + swtList.clientWidth / 2;
        let bestIdx = 0;
        let minDiff = Infinity;
        rows.forEach((r, i) => {
          const diff = Math.abs((r.offsetLeft + r.offsetWidth / 2) - center);
          if (diff < minDiff) { minDiff = diff; bestIdx = i; }
        });
        if (smsBadge) smsBadge.innerText = `Etappe ${bestIdx + 1} von ${rows.length}`;
      }, 50);
    }, { passive: true });
  }

  if (smsPrevBtn && swtList) {
    smsPrevBtn.addEventListener('click', () => {
      const rows = swtList.querySelectorAll('.swt-row');
      if (rows.length === 0) return;
      const center = swtList.scrollLeft + swtList.clientWidth / 2;
      let curr = 0;
      let minDiff = Infinity;
      rows.forEach((r, i) => {
        const diff = Math.abs((r.offsetLeft + r.offsetWidth / 2) - center);
        if (diff < minDiff) { minDiff = diff; curr = i; }
      });
      if (curr > 0) {
        rows[curr - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        rows[curr - 1].click();
      }
    });
  }

  if (smsNextBtn && swtList) {
    smsNextBtn.addEventListener('click', () => {
      const rows = swtList.querySelectorAll('.swt-row');
      if (rows.length === 0) return;
      const center = swtList.scrollLeft + swtList.clientWidth / 2;
      let curr = 0;
      let minDiff = Infinity;
      rows.forEach((r, i) => {
        const diff = Math.abs((r.offsetLeft + r.offsetWidth / 2) - center);
        if (diff < minDiff) { minDiff = diff; curr = i; }
      });
      if (curr < rows.length - 1) {
        rows[curr + 1].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        rows[curr + 1].click();
      }
    });
  }

  // Live-Tour Tracking Controls
  const trackToggleBtn = document.getElementById('sports-live-track-toggle');
  if (trackToggleBtn) {
    trackToggleBtn.addEventListener('click', toggleLiveTracking);
  }

  const simStepBtn = document.getElementById('sports-sim-step-btn');
  if (simStepBtn) {
    simStepBtn.addEventListener('click', () => {
      if (!state.sports.timeline) return;
      const totalKm = state.sports.timeline.totalDistanceKm || 1;
      const nextKm = Math.min(totalKm, (state.sports.currentProgressKm || 0) + 5.0);
      updateInFlightProgress(nextKm, true);
    });
  }

  const resetBtn = document.getElementById('sports-reset-progress-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetInFlightProgress();
    });
  }

  // Interaktiver Strecken-Slider (Scrubber)
  const routeSlider = document.getElementById('sports-route-slider');
  if (routeSlider) {
    routeSlider.addEventListener('input', () => {
      const pct = parseFloat(routeSlider.value) || 0;
      const totalDist = state.sports.timeline ? state.sports.timeline.totalDistanceKm : 0;
      const km = (pct / 100) * totalDist;
      updateSportsScrubber(km);
      if (state.sports.trackingActive) {
        updateInFlightProgress(km);
      }
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
      try { chartWrapper.setPointerCapture(e.pointerId); } catch (_) {}
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
        try { chartWrapper.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    chartWrapper.addEventListener('pointerup', stopChartDrag);
    chartWrapper.addEventListener('pointercancel', stopChartDrag);
  }

  // Window Resize: Scrubber & HUD Position neu synchronisieren
  window.addEventListener('resize', () => {
    if (state.sports && state.sports.timeline && state.sports.scrubberKm !== undefined) {
      updateSportsScrubber(state.sports.scrubberKm);
    }
  });
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

  // Nebelhorn und Grünten sind alpine Bergtouren: automatisch Kategorie 'Berge' aktivieren
  setAthleteCategory('mountain');

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
  state.sports.gpxName = fileName ? fileName.replace(/\.gpx$/i, '') : 'Eigene GPX-Route';
  await loadAndComputeSportsTour(gpxXml, state.sports.gpxName);
}

export async function fetchHourlyForRoute(lat, lon) {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (state.sports.cachedForecasts[cacheKey]) {
    return state.sports.cachedForecasts[cacheKey];
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,freezing_level_height&forecast_days=7&timezone=auto`;
    const data = await resilientFetch(url, { ttlMs: 5 * 60 * 1000 });
    if (data && data.hourly && data.hourly.time && data.hourly.time.length > 0) {
      state.sports.cachedForecasts[cacheKey] = data.hourly;
      return data.hourly;
    }
  } catch (err) {
    console.warn('Live route forecast fetch failed, using state fallback:', err);
  }

  if (state.weatherData && state.weatherData.hourly) {
    return state.weatherData.hourly;
  }

  return generateSyntheticSportsHourly();
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
  const now = new Date();
  now.setMinutes(0, 0, 0);

  for (let i = 0; i < 168; i++) {
    const t = new Date(now.getTime() + i * 3600000);
    times.push(t.toISOString());
    const hr = t.getHours();
    const temp = 14 + Math.sin((hr - 8) / 24 * Math.PI * 2) * 6;
    temps.push(Math.round(temp * 10) / 10);
    precips.push(hr >= 14 && hr <= 17 ? 0.8 : 0);
    pops.push(hr >= 14 && hr <= 17 ? 40 : 10);
    codes.push(hr >= 14 && hr <= 17 ? 80 : 1);
    winds.push(12 + Math.random() * 8);
    gusts.push(22 + Math.random() * 15);
    freezing.push(2800);
  }

  return {
    time: times,
    temperature_2m: temps,
    precipitation: precips,
    precipitation_probability: pops,
    weather_code: codes,
    wind_speed_10m: winds,
    wind_gusts_10m: gusts,
    freezing_level_height: freezing
  };
}

export async function parseGPXAsync(gpxXml) {
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise((resolve) => {
        const worker = new Worker('./gpx.worker.js');
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve(MicroEngine.parseGPXData(gpxXml));
        }, 2500);

        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          if (e.data && e.data.status === 'success') {
            resolve(e.data.data);
          } else {
            resolve(MicroEngine.parseGPXData(gpxXml));
          }
        };

        worker.onerror = () => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(MicroEngine.parseGPXData(gpxXml));
        };

        worker.postMessage({ action: 'parseGPX', payload: { xmlString: gpxXml } });
      });
    } catch (e) {}
  }
  return MicroEngine.parseGPXData(gpxXml);
}

export async function loadAndComputeSportsTour(gpxXml, tourName) {
  state.sports.gpxText = gpxXml;
  const parsed = await parseGPXAsync(gpxXml);
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

  state.sports.parsedGPX = parsed;
  const startPt = parsed.points[0];
  const hourly = await fetchHourlyForRoute(startPt.lat, startPt.lon);
  state.sports.cachedForecast = hourly;

  recomputeSportsTimeline();
}

export function updateSportPaceBadges() {
  const bikeBadge = document.getElementById('acc-bike-badge');
  const mtnBadge = document.getElementById('acc-mountain-badge');
  const bikeVal = document.getElementById('bike-speed-val');
  const mtnSpeedVal = document.getElementById('mtn-speed-val');
  const mtnAscentVal = document.getElementById('mtn-ascent-val');

  const bSpeed = state.sports.bikeSpeedKmH || 26.0;
  const mSpeed = state.sports.mountainSpeedKmH || 4.0;
  const mAsc = state.sports.mountainAscentHmH || 400;

  if (bikeBadge) bikeBadge.innerText = `${bSpeed.toFixed(1)} km/h`;
  if (mtnBadge) mtnBadge.innerText = `${mSpeed.toFixed(1)} km/h • ${mAsc} Hm/h`;
  if (bikeVal) bikeVal.innerText = `${bSpeed.toFixed(1)} km/h`;
  if (mtnSpeedVal) mtnSpeedVal.innerText = `${mSpeed.toFixed(1)} km/h`;
  if (mtnAscentVal) mtnAscentVal.innerText = `${mAsc} Hm/h`;

  const sports = ['hiking', 'road_bike', 'gravel_mtb', 'trailrun'];
  sports.forEach(sp => {
    const badge = document.getElementById(`sp-pace-${sp}`);
    if (badge) {
      const info = MicroEngine.getSportSpeedInfo(sp, state.sports.fitnessLevel);
      badge.innerText = info.paceLabel;
    }
  });
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
      mountainAscentHmH: state.sports.mountainAscentHmH
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
 * Startet die automatische Live-Verfolgung per Smartphone-/Browser-GPS
 */
export function startLiveTracking() {
  if (!state.sports.timeline) {
    console.warn('Keine Route geladen für Live-Tracking');
    return;
  }
  state.sports.trackingActive = true;
  if (!state.sports.actualStartTimeMs) {
    state.sports.actualStartTimeMs = Date.now();
  }

  const toggleBtn = document.getElementById('sports-live-track-toggle');
  const toggleText = document.getElementById('sltp-toggle-text');
  const beaconDot = document.getElementById('sltp-beacon-dot');
  const statusTitle = document.getElementById('sltp-status-title');
  const resetBtn = document.getElementById('sports-reset-progress-btn');

  if (toggleBtn) toggleBtn.classList.add('tracking-active');
  if (toggleText) toggleText.innerText = '🔴 Live-Tour stoppen';
  if (beaconDot) beaconDot.classList.add('active');
  if (statusTitle) statusTitle.innerText = 'Live-Tour aktiv: GPS-Ortung läuft';
  if (resetBtn) resetBtn.style.display = 'inline-flex';

  if (navigator.geolocation) {
    state.sports.watchId = navigator.geolocation.watchPosition(
      pos => {
        if (!state.sports.trackingActive || !state.sports.timeline) return;
        const snapped = snapCoordinatesToRoute(
          pos.coords.latitude,
          pos.coords.longitude,
          state.sports.timeline.timedPoints
        );
        // Nur vorwärts updaten, um GPS-Jitter zu verhindern
        if (snapped.km >= (state.sports.currentProgressKm || 0)) {
          updateInFlightProgress(snapped.km, false);
        }
      },
      err => {
        console.warn('Geolocation watchPosition Warnung:', err.message);
        if (statusTitle) statusTitle.innerText = 'Live-Tour aktiv (Simulation & Klick aktiv)';
      },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 12000 }
    );
  }
}

/**
 * Stoppt die Live-Verfolgung
 */
export function stopLiveTracking() {
  state.sports.trackingActive = false;
  if (state.sports.watchId !== null) {
    navigator.geolocation.clearWatch(state.sports.watchId);
    state.sports.watchId = null;
  }
  const toggleBtn = document.getElementById('sports-live-track-toggle');
  const toggleText = document.getElementById('sltp-toggle-text');
  const beaconDot = document.getElementById('sltp-beacon-dot');
  const statusTitle = document.getElementById('sltp-status-title');

  if (toggleBtn) toggleBtn.classList.remove('tracking-active');
  if (toggleText) toggleText.innerText = '🟢 Live-Tour starten';
  if (beaconDot) beaconDot.classList.remove('active');
  if (statusTitle) {
    statusTitle.innerText = state.sports.currentProgressKm > 0
      ? `Live-Tour pausiert (bei km ${state.sports.currentProgressKm.toFixed(1)})`
      : 'Live-Tour Tracking: Bereit';
  }
}

export function toggleLiveTracking() {
  if (state.sports.trackingActive) {
    stopLiveTracking();
  } else {
    startLiveTracking();
  }
}

/**
 * Aktualisiert den In-Flight-Status entlang der Route, berechnet adaptive Pace und
 * re-interpoliert das Wetter für alle zukünftigen Wegpunkte zur NEUEN Ankunftszeit!
 */
export function updateInFlightProgress(newKm, manualTrigger = false) {
  if (!state.sports.timeline) return;
  const timeline = state.sports.timeline;
  const totalDist = timeline.totalDistanceKm || 1;
  const clampedKm = Math.max(0, Math.min(totalDist, newKm));

  if (!state.sports.actualStartTimeMs) {
    state.sports.actualStartTimeMs = Date.now();
  }

  // Bei manuellen Schritten (z.B. +5 km Button) simulieren wir einen plausiblen Ist-Zeitstempel
  let nowMs = Date.now();
  if (manualTrigger) {
    const plannedHours = (clampedKm / totalDist) * (timeline.totalHours || 2.0);
    // Realistischer Verzug von +12 Minuten zur Veranschaulichung des adaptiven Tempos
    nowMs = state.sports.actualStartTimeMs + Math.round((plannedHours * 3600000) + (12 * 60000));
  }

  const athleteSettings = {
    category: state.sports.category,
    bikeSpeedKmH: state.sports.bikeSpeedKmH,
    mountainSpeedKmH: state.sports.mountainSpeedKmH,
    mountainAscentHmH: state.sports.mountainAscentHmH
  };

  const updatedTimeline = MicroEngine.updateInFlightRouteWeather(
    timeline,
    clampedKm,
    nowMs,
    state.sports.cachedForecast || {},
    athleteSettings
  );

  state.sports.timeline = updatedTimeline;
  state.sports.currentProgressKm = clampedKm;
  state.sports.currentPointIndex = updatedTimeline.currentPointIndex;
  state.sports.observedPaceFactor = updatedTimeline.paceFactor;
  state.sports.timeDeltaMinutes = updatedTimeline.timeDeltaMinutes;

  const resetBtn = document.getElementById('sports-reset-progress-btn');
  if (resetBtn && clampedKm > 0) resetBtn.style.display = 'inline-flex';

  const routeSlider = document.getElementById('sports-route-slider');
  if (routeSlider) {
    routeSlider.value = Math.round((clampedKm / totalDist) * 100);
  }

  renderInFlightTrackingPanel(updatedTimeline);
  renderSportsMetrics(updatedTimeline);
  renderSportsHazards(updatedTimeline.hazards);
  renderSportsElevationProfile(updatedTimeline);
  renderSportsWaypointsTable(updatedTimeline);
  updateSportsScrubber(clampedKm);
  updateInFlightMap(updatedTimeline, clampedKm);
}

/**
 * Setzt den Tourfortschritt komplett auf Start (0 km) zurück
 */
export function resetInFlightProgress() {
  stopLiveTracking();
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

  const statusTitle = document.getElementById('sltp-status-title');
  if (statusTitle) statusTitle.innerText = 'Live-Tour Tracking: Bereit';
  const statusDesc = document.getElementById('sltp-status-desc');
  if (statusDesc) statusDesc.innerText = 'Aktiviere GPS oder klicke auf die Route, um Zeiten & Wetter für die Reststrecke live zu aktualisieren.';

  const routeSlider = document.getElementById('sports-route-slider');
  if (routeSlider) routeSlider.value = 0;

  recomputeSportsTimeline();
}

/**
 * Rendert das In-Flight Tracking Cockpit mit Distanz- & Zeitchips
 */
export function renderInFlightTrackingPanel(timeline) {
  const panel = document.getElementById('sports-live-tracking-panel');
  const summaryBar = document.getElementById('sltp-in-flight-summary');
  const statusTitle = document.getElementById('sltp-status-title');
  const statusDesc = document.getElementById('sltp-status-desc');

  if (!panel || !timeline) return;

  if (timeline.inFlight && timeline.currentProgressKm > 0) {
    if (summaryBar) summaryBar.style.display = 'grid';
    if (statusTitle) {
      statusTitle.innerText = state.sports.trackingActive
        ? '🔴 Live-Tour aktiv (Echtzeit-Standort)'
        : '⚡ In-Flight Modus aktiv';
    }
    if (statusDesc) {
      const delta = timeline.timeDeltaMinutes || 0;
      const deltaText = delta > 0
        ? `${delta} min hinter Zeitplan`
        : (delta < 0 ? `${Math.abs(delta)} min vor Zeitplan` : 'exakt im Zeitplan');
      statusDesc.innerText = `Aktuelle Position: km ${timeline.currentProgressKm.toFixed(1)} von ${timeline.totalDistanceKm.toFixed(1)} km (${deltaText}). Verbleibende Wegpunkte & Wetterbedingungen zur neuen Ankunftszeit aktualisiert.`;
    }

    const dVal = document.getElementById('sltp-val-done');
    const rVal = document.getElementById('sltp-val-remaining');
    const pVal = document.getElementById('sltp-val-pace');
    const nVal = document.getElementById('sltp-val-next');

    const pct = Math.round((timeline.currentProgressKm / timeline.totalDistanceKm) * 100);
    if (dVal) dVal.innerText = `${timeline.currentProgressKm.toFixed(1)} km (${pct}%)`;
    if (rVal) rVal.innerText = `${timeline.remainingDistanceKm.toFixed(1)} km (ca. ${timeline.remainingDurationStr})`;
    if (pVal) {
      const factor = timeline.paceFactor || 1.0;
      const dMin = timeline.timeDeltaMinutes || 0;
      const dSign = dMin > 0 ? `+${dMin}m Verzögerung` : (dMin < 0 ? `${dMin}m schneller` : 'Im Plan');
      pVal.innerText = `${factor.toFixed(2)}× Tempo (${dSign})`;
    }
    if (nVal) {
      const nextMs = timeline.milestones.find(m => !m.isCompleted);
      if (nextMs) {
        nVal.innerText = `${nextMs.label} • ${nextMs.arrivalTimeStr} (${nextMs.weatherIcon} ${nextMs.tempC}°C)`;
      } else {
        nVal.innerText = '🏁 Zielankunft erreicht!';
      }
    }
  } else {
    if (summaryBar) summaryBar.style.display = 'none';
  }
}

/**
 * Aktualisiert die Leaflet-Karte bei In-Flight Fortbewegung (absolvierte Teilstrecke grün hervorheben)
 */
export function updateInFlightMap(timeline, currentKm) {
  if (!state.sports.map || !timeline || !timeline.timedPoints) return;
  const pts = timeline.timedPoints;
  const completedPts = pts.filter(p => p.distFromStartKm <= currentKm + 0.05);

  if (state.sports.completedRouteLine) {
    state.sports.map.removeLayer(state.sports.completedRouteLine);
    state.sports.completedRouteLine = null;
  }

  if (completedPts.length > 1) {
    const completedLatLngs = completedPts.map(p => [p.lat, p.lon]);
    state.sports.completedRouteLine = L.polyline(completedLatLngs, {
      color: '#30d158',
      weight: 6,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(state.sports.map);
  }

  // Meilenstein-Marker auf der Karte dimmen/hervorheben
  if (state.sports.milestoneMarkers && state.sports.milestoneMarkers.length > 0) {
    for (let i = 1; i < timeline.milestones.length - 1; i++) {
      const m = timeline.milestones[i];
      const marker = state.sports.milestoneMarkers[i - 1];
      if (marker) {
        const el = marker.getElement();
        if (el) {
          if (m.isCompleted) {
            el.style.opacity = '0.45';
            el.style.filter = 'grayscale(0.6)';
          } else {
            el.style.opacity = '1';
            el.style.filter = 'none';
          }
        }
      }
    }
  }
}

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
  const svg = document.getElementById('sports-elevation-svg');
  if (!svg || !timeline) return;

  const W = 900;
  const H = 240;
  const padL = 50;
  const padR = 35;
  const padT = 35;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minZ = Math.max(0, timeline.minElevationM - 80);
  const maxZ = timeline.maxElevationM + 80;
  const rangeZ = Math.max(20, maxZ - minZ);
  const totalDist = Math.max(0.1, timeline.totalDistanceKm);

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
  let milestoneSVGElements = '';
  timeline.milestones.forEach((m, idx) => {
    const mx = getX(m.distFromStartKm);
    const my = getY(m.ele);
    const isPeak = m.ele === timeline.maxElevationM;
    const isCompleted = !!m.isCompleted;

    milestoneSVGElements += `
      <g class="svg-milestone-pin ${isCompleted ? 'pin-completed' : ''}" data-km="${m.distFromStartKm}" ${isCompleted ? 'style="opacity: 0.45;"' : ''}>
        <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${isPeak ? 5.5 : 4}" fill="${isCompleted ? '#30d158' : (isPeak ? '#ffd166' : '#00e5ff')}" stroke="#ffffff" stroke-width="1.8" />
        <text x="${mx.toFixed(1)}" y="${(my - 12).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.8))">
          ${isCompleted ? '✓ ' : ''}${m.weatherIcon} ${m.tempC}°
        </text>
      </g>
    `;
  });

  // Dynamischer Pulsierender Athleten-Marker bei In-Flight Fortschritt
  let liveAthleteElement = '';
  if (timeline.inFlight && curKm > 0 && pts.length > 0) {
    const activePt = pts[timeline.currentPointIndex || 0] || pts[0];
    const ax = getX(curKm);
    const ay = getY(activePt.ele);
    liveAthleteElement = `
      <g id="svg-live-athlete-dot" transform="translate(${ax.toFixed(1)}, ${ay.toFixed(1)})">
        <circle r="11" fill="none" stroke="#30d158" stroke-width="2" opacity="0.8">
          <animate attributeName="r" values="7;16;7" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0.15;0.9" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle r="5.5" fill="#30d158" stroke="#ffffff" stroke-width="2" />
      </g>
    `;
  }

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

    <!-- Live Athleten-Positionsdot -->
    ${liveAthleteElement}

    <!-- Dynamischer Scrubber-Positionsstrich & Cursor-Punkt -->
    <line id="svg-scrubber-line" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#ffd166" stroke-width="2" stroke-dasharray="3 3" opacity="0.9" />
    <circle id="svg-scrubber-dot" cx="${padL}" cy="${getY(pts[0].ele)}" r="6" fill="#ffd166" stroke="#ffffff" stroke-width="2" />
  `;
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

    if (isCompleted) {
      typeTag = isStart ? '✓ Tourstart' : '✓ Passiert';
      tagClass = 'tag-completed';
      if (isStart) labelText = 'Startpunkt';
      else if (isPeak) labelText = `Passhöhe (${Math.round(m.ele)} m)`;
      else if (isEnd) labelText = `Zielankunft (${m.distFromStartKm.toFixed(1)} km)`;
      else labelText = `Streckenabschnitt ${m.distFromStartKm.toFixed(1)} km`;
    } else if (isNext) {
      typeTag = '➡️ Nächster Halt';
      tagClass = 'tag-next';
      if (isStart) labelText = 'Startpunkt';
      else if (isPeak) labelText = `Passhöhe (${Math.round(m.ele)} m)`;
      else if (isEnd) labelText = `Zielankunft (${m.distFromStartKm.toFixed(1)} km)`;
      else labelText = `Streckenabschnitt ${m.distFromStartKm.toFixed(1)} km`;
    } else if (isPeak) {
      typeTag = '🏔️ Scheitelpunkt';
      tagClass = 'tag-peak';
      labelText = `Passhöhe (${Math.round(m.ele)} m)`;
    } else if (isEnd) {
      typeTag = '🏁 Zielankunft';
      tagClass = 'tag-finish';
      labelText = `Streckenende (${m.distFromStartKm.toFixed(1)} km)`;
    } else if (isStart) {
      typeTag = '🏁 Tourstart';
      tagClass = 'tag-start';
      labelText = 'Startpunkt';
    } else {
      labelText = `Streckenabschnitt ${m.distFromStartKm.toFixed(1)} km`;
    }

    let deltaHtml = '';
    if (!isCompleted && m.timeDeltaMinutes !== undefined && m.timeDeltaMinutes !== 0) {
      const dMin = m.timeDeltaMinutes;
      deltaHtml = `<span class="swt-time-delta ${dMin > 0 ? 'delta-late' : 'delta-early'}">${dMin > 0 ? '+' : ''}${dMin} min</span>`;
    }

    const feltT = m.feltTempC !== undefined ? m.feltTempC : Math.round(m.tempC);

    row.innerHTML = `
      <!-- 1. Streckenabschnitt -->
      <div class="swt-cell swt-milestone">
        <span class="swt-type-tag ${tagClass} ${isCompleted ? 'swt-completed-tag' : (isNext ? 'swt-live-next-tag' : '')}">${escapeHtml(typeTag)}</span>
        <span class="swt-m-name">${escapeHtml(labelText)}</span>
        <span class="swt-m-coords">${m.lat.toFixed(4)}°, ${m.lon.toFixed(4)}°</span>
      </div>

      <!-- 2. Distanz & Höhe -->
      <div class="swt-cell swt-dist-ele">
        <strong class="swt-dist">${m.distFromStartKm.toFixed(1)} km</strong>
        <span class="swt-ele text-cyan">${Math.round(m.ele)} m</span>
      </div>

      <!-- 3. Durchgangszeit -->
      <div class="swt-cell swt-time">
        <div class="swt-time-top">
          <strong class="swt-arr-time">${escapeHtml(m.arrivalTimeStr)}</strong>
          ${deltaHtml}
        </div>
        <span class="swt-arr-date">${escapeHtml(m.arrivalDateStr)}</span>
      </div>

      <!-- 4. Wetterlage -->
      <div class="swt-cell swt-weather">
        <div class="swt-w-top">
          <span class="swt-icon">${m.weatherIcon}</span>
          <span class="swt-cond">${escapeHtml(m.weatherCondition)}</span>
        </div>
      </div>

      <!-- 5. Temperatur (Gefühlt) -->
      <div class="swt-cell swt-temp">
        <strong class="swt-temp-val">${m.tempC}°C</strong>
        <span class="swt-temp-felt">Gefühlt ${feltT}°C</span>
      </div>

      <!-- 6. Wind & Vektor -->
      <div class="swt-cell swt-wind">
        <div class="swt-wind-top">
          <strong>${m.windKmH} km/h</strong>
          <span class="swt-gusts text-orange">Böen ${m.gustsKmH}</span>
        </div>
        ${m.relWindBadge ? `<span class="swt-rel-wind-badge ${m.relWindType || ''}">${escapeHtml(m.relWindBadge)}</span>` : ''}
        ${m.descentWindchillC !== undefined && m.descentWindchillC <= 10 && (state.sports.category === 'bike' || m.distFromStartKm > 0) ? `<span class="swt-descent-badge">🥶 Abfahrt RealFeel ${m.descentWindchillC}°C</span>` : ''}
      </div>

      <!-- 7. Niederschlag -->
      <div class="swt-cell swt-precip">
        <div class="swt-precip-top">
          <strong class="${m.popPercent >= 50 ? 'text-red' : (m.popPercent >= 25 ? 'text-yellow' : '')}">${m.popPercent}%</strong>
          <span class="swt-precip-mm">${m.precipMm > 0 ? `${m.precipMm.toFixed(1)} mm` : '0 mm'}</span>
        </div>
        ${m.isSnow ? '<span class="swt-snow-badge">❄️ Frost</span>' : ''}
      </div>
    `;

    row.addEventListener('click', () => {
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
  const smsBadge = document.getElementById('sms-step-badge');
  if (smsBadge && visibleMilestones.length > 0) {
    smsBadge.innerText = `Etappe 1 von ${visibleMilestones.length}`;
  }
}

export function renderSportsMap(timeline) {
  const container = document.getElementById('sports-map-container');
  if (!container || !timeline || !timeline.timedPoints || timeline.timedPoints.length === 0) return;

  if (!state.sports.map) {
    state.sports.map = L.map('sports-map-container', {
      zoomControl: true,
      attributionControl: false,
      maxZoom: 19
    }).setView([timeline.timedPoints[0].lat, timeline.timedPoints[0].lon], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors, HOT'
    }).addTo(state.sports.map);
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

  // Route Hintergrund-Casing (Glow-Effekt)
  state.sports.routeBgLine = L.polyline(latLngs, {
    color: '#005577',
    weight: 8,
    opacity: 0.7,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.sports.map);

  // Vordergrund-Route (Leuchtendes Cyan)
  state.sports.routeLine = L.polyline(latLngs, {
    color: '#00e5ff',
    weight: 4.5,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.sports.map);

  // Start & Ziel Marker
  const startPt = timeline.timedPoints[0];
  const endPt = timeline.timedPoints[timeline.timedPoints.length - 1];

  const startIcon = L.divIcon({
    className: 'sports-custom-pin start-pin',
    html: '<div class="pin-inner pin-start">🚩 <span>START</span></div>',
    iconSize: [72, 28],
    iconAnchor: [36, 14]
  });

  const endIcon = L.divIcon({
    className: 'sports-custom-pin end-pin',
    html: '<div class="pin-inner pin-end">🏁 <span>ZIEL</span></div>',
    iconSize: [68, 28],
    iconAnchor: [34, 14]
  });

  state.sports.startMarker = L.marker([startPt.lat, startPt.lon], { icon: startIcon }).addTo(state.sports.map);
  state.sports.startMarker.bindPopup(`<b>🚩 Tourstart</b><br>Höhe: ${Math.round(startPt.ele)} m<br>Startzeit: ${timeline.startTimeStr} Uhr`);

  state.sports.endMarker = L.marker([endPt.lat, endPt.lon], { icon: endIcon }).addTo(state.sports.map);
  state.sports.endMarker.bindPopup(`<b>🏁 Zielankunft</b><br>Strecke: ${timeline.totalDistanceKm.toFixed(1)} km<br>Ankunft: ${timeline.endTimeStr} Uhr`);

  // Zwischen-Meilensteine mit Wetter-Bubbles
  timeline.milestones.forEach((m, idx) => {
    if (idx === 0 || idx === timeline.milestones.length - 1) return;
    const mIcon = L.divIcon({
      className: 'sports-milestone-marker',
      html: `<div class="ms-marker-bubble"><span class="ms-icon">${m.weatherIcon}</span> <span class="ms-temp">${m.tempC}°</span></div>`,
      iconSize: [54, 24],
      iconAnchor: [27, 12]
    });

    const marker = L.marker([m.lat, m.lon], { icon: mIcon }).addTo(state.sports.map);
    marker.bindPopup(`
      <div style="font-family: -apple-system, sans-serif; min-width: 170px;">
        <strong style="color: #00e5ff; font-size: 13px;">${m.label} (${m.distFromStartKm.toFixed(1)} km)</strong><br>
        <span style="font-size: 11px; color: #8e8e93;">⏱️ Durchgang: ${m.arrivalTimeStr} (${m.arrivalDateStr})</span>
        <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0;">
        <div>${m.weatherIcon} <b>${m.weatherCondition}</b></div>
        <div>🌡️ Temperatur: <b>${m.tempC}°C</b> (Gefühlt ${m.feltTempC}°C)</div>
        <div>💨 Wind: <b>${m.windKmH} km/h</b> (Böen ${m.gustsKmH} km/h)</div>
        <div>💧 Niederschlag: <b>${m.precipMm.toFixed(1)} mm</b> (${m.popPercent}%)</div>
        ${m.isSnow ? '<div style="color: #64d2ff; font-weight: bold;">❄️ Frost / Schneelage möglich</div>' : ''}
      </div>
    `);
    state.sports.milestoneMarkers.push(marker);
  });

  // Interaktiver Scrubber-Marker (Athleten-Pin)
  const athleteIcon = timeline.sportType === 'road_bike' ? '🚴' : (timeline.sportType === 'gravel_mtb' ? '🚵' : (timeline.sportType === 'trailrun' ? '🏃' : '🥾'));
  const scrubberIcon = L.divIcon({
    className: 'sports-scrubber-map-marker',
    html: `<div class="scrubber-pin-pulse">${athleteIcon}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  state.sports.scrubberMarker = L.marker([startPt.lat, startPt.lon], { icon: scrubberIcon, zIndexOffset: 3000 }).addTo(state.sports.map);

  setTimeout(() => {
    state.sports.map.invalidateSize();
    state.sports.map.fitBounds(state.sports.routeLine.getBounds(), { padding: [30, 30] });
  }, 100);
}

export function updateSportsScrubber(km) {
  const timeline = state.sports.timeline;
  if (!timeline || !timeline.timedPoints || timeline.timedPoints.length === 0) return;

  const totalDist = Math.max(0.1, timeline.totalDistanceKm);
  const clampedKm = Math.max(0, Math.min(totalDist, km));
  state.sports.scrubberKm = clampedKm;

  // Finde nächsten berechneten Punkt
  let closestPt = timeline.timedPoints[0];
  let minDiff = Infinity;
  for (let i = 0; i < timeline.timedPoints.length; i++) {
    const diff = Math.abs(timeline.timedPoints[i].distFromStartKm - clampedKm);
    if (diff < minDiff) {
      minDiff = diff;
      closestPt = timeline.timedPoints[i];
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

  // Scrubber Label & Badge
  const pointLabel = document.getElementById('ss-current-point-label');
  const timeBadge = document.getElementById('ss-current-time-badge');
  if (pointLabel) {
    pointLabel.innerText = `📍 km ${closestPt.distFromStartKm.toFixed(1)} • ${Math.round(closestPt.ele)} m`;
  }
  if (timeBadge) {
    const arrStr = closestPt.arrivalDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    timeBadge.innerText = `⏱️ ${arrStr} Uhr`;
  }

  // HUD-Badge über SVG
  const hud = document.getElementById('sports-hud-badge');
  if (hud) {
    hud.style.display = 'block';
    const hIcon = document.getElementById('shb-icon');
    const hTitle = document.getElementById('shb-title');
    const hTime = document.getElementById('shb-time');
    const hTemp = document.getElementById('shb-temp');
    const hWind = document.getElementById('shb-wind');
    const hCond = document.getElementById('shb-cond');
    const hEle = document.getElementById('shb-ele');

    if (hIcon) hIcon.innerText = closestMs.weatherIcon;
    if (hTitle) hTitle.innerText = `km ${closestPt.distFromStartKm.toFixed(1)}`;
    if (hTime) hTime.innerText = closestPt.arrivalDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (hTemp) hTemp.innerText = `${closestMs.tempC}°C (Gefühlt ${closestMs.feltTempC}°C)${closestMs.descentWindchillC !== undefined && closestMs.descentWindchillC <= 10 ? ' • Abfahrt ' + closestMs.descentWindchillC + '°C' : ''}`;
    if (hWind) hWind.innerText = `${closestMs.windKmH} km/h (Böen ${closestMs.gustsKmH})${closestMs.relWindBadge ? ' • ' + closestMs.relWindBadge : ''}`;
    if (hCond) hCond.innerText = closestMs.weatherCondition;
    if (hEle) hEle.innerText = `Höhe: ${Math.round(closestPt.ele)} m • Niederschlag: ${closestMs.precipMm} mm (${closestMs.popPercent}%)`;

    // Dynamische Positionierung & Flip-Logik entlang des Höhenprofils:
    // Sobald der Wegpunkt hinter der Information verschwinden würde oder der Scrubber
    // die Wegpunkt-Mitte überschreitet, dockt das Info-Badge dynamisch LINKS vom Wegpunkt
    // und beim Zurückbewegen wieder RECHTS, sodass Inhalte und Wegpunkte NIE überlappt werden.
    const pct = clampedKm / totalDist;
    const padL = 50;
    const plotW = 900 - 50 - 35;
    const targetSvgX = padL + pct * plotW;

    const chartWrapper = document.getElementById('sports-chart-wrapper');
    const wrapperWidth = (chartWrapper && chartWrapper.clientWidth > 0) ? chartWrapper.clientWidth : 900;
    const badgeWidth = hud.offsetWidth || 270;
    const currentXpx = (targetSvgX / 900) * wrapperWidth;
    const gap = 14;
    const edgeMargin = 10;

    // Freiraum-Berechnung rechts und links vom aktuellen Wegpunkt
    const fitsOnRight = (currentXpx + gap + badgeWidth) <= (wrapperWidth - edgeMargin);
    const fitsOnLeft = (currentXpx - gap - badgeWidth) >= edgeMargin;

    let dockSide = hud.dataset.dockSide || 'right';

    if (dockSide === 'right') {
      // Wenn rechts der Platz ausgeht (Wegpunkt würde dahinter verschwinden) ODER
      // der Wegpunkt über 50% der Route liegt und links genügend Platz ist:
      if (!fitsOnRight || (currentXpx > wrapperWidth * 0.50 && fitsOnLeft)) {
        dockSide = 'left';
      }
    } else {
      // Wenn der Nutzer nach links zurückfährt (< 48%) und rechts ausreichend Platz ist,
      // oder falls links kein Platz mehr wäre:
      const fitsComfortablyOnRight = (currentXpx + gap + badgeWidth) <= (wrapperWidth - edgeMargin - 12);
      if ((currentXpx < wrapperWidth * 0.48 && fitsComfortablyOnRight) || !fitsOnLeft) {
        dockSide = 'right';
      }
    }
    hud.dataset.dockSide = dockSide;

    let badgeLeftPx;
    if (dockSide === 'left') {
      // Links vom Wegpunkt anzeigen: Der aktuelle Wegpunkt und Strich liegen RECHTS vom Badge (nie verdeckt)
      badgeLeftPx = currentXpx - gap - badgeWidth;
      badgeLeftPx = Math.max(edgeMargin, Math.min(wrapperWidth - edgeMargin - badgeWidth, badgeLeftPx));
      hud.classList.remove('hud-dock-right');
      hud.classList.add('hud-dock-left');
    } else {
      // Rechts vom Wegpunkt anzeigen: Der aktuelle Wegpunkt und Strich liegen LINKS vom Badge (nie verdeckt)
      badgeLeftPx = currentXpx + gap;
      badgeLeftPx = Math.min(wrapperWidth - edgeMargin - badgeWidth, Math.max(edgeMargin, badgeLeftPx));
      hud.classList.remove('hud-dock-left');
      hud.classList.add('hud-dock-right');
    }

    hud.style.left = `${badgeLeftPx.toFixed(1)}px`;
    hud.style.right = 'auto';
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

  // Map Marker synchronisieren
  if (state.sports.scrubberMarker) {
    state.sports.scrubberMarker.setLatLng([closestPt.lat, closestPt.lon]);
  }

  // Wegpunkt-Zeile in Tabelle hervorheben & Mobile Stage Carousel synchronisieren
  const rows = document.querySelectorAll('.swt-row');
  const smsBadge = document.getElementById('sms-step-badge');
  rows.forEach((row, i) => {
    const rIdx = parseInt(row.dataset.idx, 10);
    const isActive = rIdx === closestMsIdx;
    row.classList.toggle('active-waypoint', isActive);
    if (isActive) {
      if (smsBadge) {
        smsBadge.innerText = `Etappe ${i + 1} von ${rows.length}`;
      }
      if (window.innerWidth <= 768) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  });
}


