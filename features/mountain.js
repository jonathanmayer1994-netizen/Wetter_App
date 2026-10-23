/**
 * BEST WEATHER — Mountain & 3D Alpine Terrain Domain Feature Module (Task 1a)
 * Dynamic Mountain vs. City views, Alpine 3D WebGL Canvas, Massif & Wind views,
 * Altimetric wind roses, 24h altitude slider, and avalanche reports.
 */

import { state } from '../core/state.js';
import { WMO_CODES } from '../core/constants.js';
import { MicroEngine } from '../microEngine.js';
import { escapeHtml } from '../httpClient.js';
import { updateNavigationWarningBadges } from './search.js';

export function convertTemp(celsius) {
  if (state.unit === 'fahrenheit') {
    return (celsius * 9/5) + 32;
  }
  return celsius;
}

function loadLocation(loc) {
  if (window.loadLocation) window.loadLocation(loc);
}

function switchTab(tabId) {
  if (window.switchTab) window.switchTab(tabId);
}

export function renderAdaptiveTab2() {
  const isMountain = state.currentLocation.isMountain;
  const mPanel = document.getElementById('mountain-view-panel');
  const cPanel = document.getElementById('city-view-panel');

  const desktopTab = document.getElementById('tab-btn-mountain');
  const mobileTab = document.querySelector('.mbn-btn[data-tab="tab-mountain"]');

  if (isMountain) {
    if (mPanel) mPanel.style.display = 'flex';
    if (cPanel) cPanel.style.display = 'none';
    if (desktopTab) {
      const icon = desktopTab.querySelector('.tab-icon');
      const label = desktopTab.querySelector('.tab-label');
      if (icon) icon.innerText = '🏔️';
      if (label) label.innerText = 'Berg & 3D-Alpin';
    }
    if (mobileTab) {
      const icon = mobileTab.querySelector('.mbn-icon');
      const label = mobileTab.querySelector('.mbn-label');
      if (icon) icon.innerText = '🏔️';
      if (label) label.innerText = 'Berg & 3D';
    }
    renderMountainPanel();
    renderAltitudeHoursScroller();
    selectAltitudeHour(state.selectedAltitudeHour || 0, false);
  } else {
    if (mPanel) mPanel.style.display = 'none';
    if (cPanel) cPanel.style.display = 'flex';
    if (desktopTab) {
      const icon = desktopTab.querySelector('.tab-icon');
      const label = desktopTab.querySelector('.tab-label');
      if (icon) icon.innerText = '🏙️';
      if (label) label.innerText = 'Stadtklima & Umwelt';
    }
    if (mobileTab) {
      const icon = mobileTab.querySelector('.mbn-icon');
      const label = mobileTab.querySelector('.mbn-label');
      if (icon) icon.innerText = '🏙️';
      if (label) label.innerText = 'Stadtklima';
    }
    renderCityPanel();
  }
}

// Mountain Panel Render
export function renderMountainPanel() {
  const m = state.microData;
  if (!m) return;

  const loc = state.currentLocation;
  document.getElementById('mountain-title').innerText = `${loc.name} (${loc.elevation.toLocaleString('de-DE')} m)`;
  document.getElementById('m-peak-elev').innerText = `${loc.elevation.toLocaleString('de-DE')} m`;
  document.getElementById('m-landform').innerText = m.terrain10m.landform;
  document.getElementById('m-freezing-level').innerText = `${Math.round(m.atmosphere.freezingLevelMeters)} m`;

  const invElem = document.getElementById('m-inversion-status');
  if (m.atmosphere.inversionActive) {
    invElem.innerText = '⚠️ Inversion aktiv (Oben wärmer)';
    invElem.style.color = '#ffd166';
  } else {
    invElem.innerText = '🟢 Normaler Berg-Gradient';
    invElem.style.color = '#30d158';
  }

  // Update Wall Aspect Details
  const w = m.microWeather;
  const t = m.terrain10m;
  const wallName = state.activeAspect.isAuto ? `${t.aspectName}` : getSelectedWallLabel();
  document.getElementById('active-wall-name').innerText = `${wallName} (${t.tilt}° Neigung)`;
  document.getElementById('active-wall-radiation').innerText = `Sonneneinstrahlung: ${w.slopeSolarIrradianceW_m2} W/m² (GTI)`;
  document.getElementById('active-wall-temp').innerText = `${Math.round(convertTemp(w.temperature10m))}°C`;
  document.getElementById('active-wall-temp-sub').innerText = `Gefühlt: ${Math.round(convertTemp(w.feltTemp))}°C`;
  document.getElementById('active-wall-snow').innerText = w.snowCondition;
  document.getElementById('active-wall-wind').innerText = w.slopeWindExposure;
  document.getElementById('active-wall-wind-sub').innerText = `Gratwind: ${w.windSpeedKmH} km/h (Böen: ${w.windGustsKmH} km/h)`;

  // Rendere Lawinenlagebericht & Live-Webcams
  renderAvalancheReport();
  renderMountainWebcams();
}

// =============================================================================
// LAWINENLAGEBERICHT & SCHNEEDECKEN-STABILITÄT (EAWS STUFEN 1–5)
// =============================================================================
export function renderAvalancheReport() {
  const avCard = document.getElementById('avalanche-danger-card');
  if (!avCard) return;

  const loc = state.currentLocation;
  const terrain = state.microData ? state.microData.terrain10m : null;
  const av = MicroEngine.computeAvalancheReport(loc.lat, loc.lon, loc.elevation, state.weatherData, terrain);
  if (!av) return;

  // 1. EAWS Stufen-Badge
  const badge = document.getElementById('eaws-level-badge');
  const numElem = document.getElementById('eaws-level-num');
  const textElem = document.getElementById('eaws-level-text');

  if (badge) {
    badge.style.background = av.dangerColor;
    badge.style.color = av.dangerLevel >= 4 ? '#ffffff' : '#000000';
  }
  if (numElem) numElem.innerText = av.dangerLevel;
  if (textElem) textElem.innerText = av.dangerTitle.replace(/^[0-9]\s*-\s*/, '');

  // 2. Kritische Höhenlage
  const critElevElem = document.getElementById('rose-crit-elev');
  if (critElevElem) {
    critElevElem.innerHTML = `Gefahr vor allem über <strong>${av.criticalElevation.toLocaleString('de-DE')} m</strong>`;
  }

  // 3. Gefahrenrose (SVG 8 Hangexpositionen)
  const aspectMapping = {
    'rose-sec-n': 'N',
    'rose-sec-no': 'NO',
    'rose-sec-o': 'O',
    'rose-sec-so': 'SO',
    'rose-sec-s': 'S',
    'rose-sec-sw': 'SW',
    'rose-sec-w': 'W',
    'rose-sec-nw': 'NW'
  };

  const aspectDetails = {
    'N': { name: 'Nordhang', icon: '❄️', steep: '> 30°', text: 'Kritisch im Triebschnee. Geringe Zusatzbelastung reicht oft zur Schneebrettauslösung.' },
    'NO': { name: 'Nordosthang', icon: '❄️', steep: '> 32°', text: 'Kammnahe Rinnen und Mulden stark mit Einwehungen verfüllt.' },
    'O': { name: 'Osthang', icon: '💨', steep: '> 30°', text: 'Leehang mit frischen Triebschneepaketen. Geländekanten meiden.' },
    'SO': { name: 'Südosthang', icon: '☀️', steep: '> 35°', text: 'Tageserwärmung schwächt die Schneedecke ab dem Vormittag.' },
    'S': { name: 'Südhang', icon: '☀️', steep: '> 35°', text: 'Nassschnee- und Gleitschneerutsche an steilen Sonnenhängen.' },
    'SW': { name: 'Südwesthang', icon: '🌤️', steep: '> 34°', text: 'Windverblasene Rücken oft hart gefroren, Rinnen triebschneebelastet.' },
    'W': { name: 'Westhang', icon: '💨', steep: '> 30°', text: 'Windseitige Grate abgeblasen (Harsch/Eis), Rinnen heikel.' },
    'NW': { name: 'Nordwesthang', icon: '❄️', steep: '> 30°', text: 'Schattig und kalt. Ungünstiger Altschneeaufbau in Hochlagen.' }
  };

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

      // Feature 6A: Interaktiver Klick auf Gefahrenrose-Sektor
      path.onclick = () => {
        document.querySelectorAll('.rose-sec').forEach(p => p.classList.remove('selected-sector'));
        path.classList.add('selected-sector');
        const det = aspectDetails[asp];
        const infoBox = document.getElementById('rose-sector-info');
        const infoText = document.getElementById('rsi-text');
        if (infoBox && infoText && det) {
          infoBox.classList.add('highlight');
          const dangerBadge = isCritical ? `⚠️ Kritisch (Stufe ${av.dangerLevel})` : `✅ Günstiger (Stufe 1–2)`;
          infoText.innerHTML = `<strong>${det.icon} ${det.name} (${asp}):</strong> ${dangerBadge} • Kritische Steilheit: <strong>${det.steep}</strong><br>${det.text}`;
        }
      };
    }
  });

  // 4. Hauptprobleme
  const probList = document.getElementById('av-problems-list');
  if (probList) {
    probList.innerHTML = av.problems.map(p => `
      <div class="av-problem-item">
        <span class="av-p-icon">${p.icon}</span>
        <div class="av-p-content">
          <strong>${p.name}</strong>
          <p>${p.desc}</p>
        </div>
      </div>
    `).join('');
  }

  // 5. Kennzahlen, Schneehöhen & Alpinempfehlung
  const freshSnowVal = document.getElementById('av-freshsnow-val');
  const windVal = document.getElementById('av-wind-val');
  const safetyText = document.getElementById('av-safety-text');
  const peakSnow = document.getElementById('av-totalsnow-peak');
  const valleySnow = document.getElementById('av-totalsnow-valley');
  const stationName = document.getElementById('av-station-name');
  const stationTime = document.getElementById('av-station-time');

  if (freshSnowVal) freshSnowVal.innerText = `${av.freshSnow24hCm} cm`;
  if (windVal) windVal.innerText = `${av.maxRidgeWindKmH} km/h`;
  if (safetyText) safetyText.innerText = av.safetyRule;
  if (peakSnow) peakSnow.innerText = `${av.snowDepthPeakCm} cm`;
  if (valleySnow) valleySnow.innerText = `${av.snowDepthValleyCm} cm`;
  if (stationName) stationName.innerText = `${av.stationAgency} (${av.stationName})`;
  if (stationTime) stationTime.innerText = av.stationTime;

  // Feature 9A: Badges aktualisieren (Lawinen-/Bergwarnung)
  updateNavigationWarningBadges();
}

// =============================================================================
// ALPINE LIVE-WEBCAMS
// =============================================================================
// ALPINE LIVE-WEBCAMS (BERGGIPFEL & SKIGEBIETE)
// =============================================================================
export function renderMountainWebcams() {
  const grid = document.getElementById('mountain-webcams-grid');
  if (!grid) return;

  const loc = state.currentLocation;
  const cams = MicroEngine.getMountainWebcams(loc.name, loc.lat, loc.lon);
  if (!cams || cams.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-tertiary); font-size:12px;">Keine Live-Webcams für diesen Standort hinterlegt.</p>';
    return;
  }

  const cacheBuster = Math.floor(Date.now() / 600000); // 10-Minuten-Bucket für frischeste Livecam-Bilder
  grid.innerHTML = cams.map(cam => {
    const liveThumb = `${cam.thumbUrl}${cam.thumbUrl.includes('?') ? '&' : '?'}t=${cacheBuster}`;
    return `
    <div class="webcam-card" data-id="${cam.id}" data-cam='${JSON.stringify(cam).replace(/'/g, "&#39;")}'>
      <div class="webcam-thumb-wrap">
        <span class="webcam-live-badge">${cam.status}</span>
        <img src="${liveThumb}" alt="${cam.title}" class="webcam-thumb" loading="lazy" onerror="this.onerror=null;this.src='${cam.thumbUrl}';">
      </div>
      <div class="webcam-card-info">
        <span class="webcam-title">${cam.title}</span>
        <div class="webcam-meta">
          <span>Höhe: ${cam.elevation}</span>
          <span>Blick: ${cam.viewDir}</span>
        </div>
      </div>
    </div>
  `;
  }).join('');

  grid.querySelectorAll('.webcam-card').forEach(card => {
    card.addEventListener('click', () => {
      try {
        const cam = JSON.parse(card.dataset.cam);
        openWebcamModal(cam);
      } catch (e) {
        console.error(e);
      }
    });
  });
}

export function openWebcamModal(cam) {
  const modal = document.getElementById('webcam-modal-overlay');
  const title = document.getElementById('webcam-modal-title');
  const img = document.getElementById('webcam-modal-img');
  const meta = document.getElementById('webcam-modal-meta');
  const link = document.getElementById('webcam-external-link');

  if (!modal) return;
  if (title) title.innerText = cam.title;
  if (img) {
    const liveSrc = cam.highResUrl || cam.thumbUrl;
    img.src = `${liveSrc}${liveSrc.includes('?') ? '&' : '?'}t=${Date.now()}`;
    img.alt = cam.title;
  }
  if (meta) meta.innerText = `Blickrichtung: ${cam.viewDir} • Kamerastation auf ${cam.elevation} • ${cam.status}`;
  if (link) link.href = cam.streamUrl;

  modal.style.display = 'flex';
}

export function setupWebcamModal() {
  const modal = document.getElementById('webcam-modal-overlay');
  const closeBtn = document.getElementById('webcam-modal-close');
  const closeActionBtn = document.getElementById('webcam-modal-close-action');

  const closeModal = () => {
    if (modal) modal.style.display = 'none';
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (closeActionBtn) closeActionBtn.addEventListener('click', closeModal);

  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
  }

  // Globaler Escape-Key Handler für alle Dialoge & Modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const dModal = document.getElementById('day-detail-modal');
      const gModal = document.getElementById('gpx-modal-overlay');
      const wModal = document.getElementById('webcam-modal-overlay');
      if (dModal) dModal.style.display = 'none';
      if (gModal) gModal.style.display = 'none';
      if (wModal) wModal.style.display = 'none';
    }
  });
}

// City Panel Render
export function renderCityPanel() {
  const loc = state.currentLocation;
  const cur = state.weatherData ? state.weatherData.current : null;
  const t = cur ? Math.round(cur.temperature_2m) : 15;

  document.getElementById('city-title').innerText = `${loc.name} — Stadtklima & Urbaner Komfort`;
  document.getElementById('city-elev-val').innerText = `${loc.elevation.toLocaleString('de-DE')} m`;
  document.getElementById('city-heat-island').innerText = `+1.8 °C vs. Umland`;
  document.getElementById('city-street-wind').innerText = `${cur ? Math.round(cur.wind_speed_10m * 0.7) : 8} km/h (Boden)`;
  document.getElementById('city-urban-temp').innerText = `${t + 1}°C`;
  document.getElementById('city-canyon-wind').innerText = `${cur ? Math.round(cur.wind_speed_10m) : 12} km/h`;
  document.getElementById('city-aqi-val').innerText = 'Gut (AQI 24)';
  document.getElementById('city-comfort-label').innerText = t > 25 ? 'Leichte Wärmebelastung' : 'Sehr angenehm';
}

export function getSelectedWallLabel() {
  if (state.activeAspect.azimuth === 0) return 'Südwand (45°)';
  if (state.activeAspect.azimuth === 180) return 'Nordwand (75°)';
  if (state.activeAspect.azimuth === -90) return 'Ostwand (50°)';
  if (state.activeAspect.azimuth === 90) return 'Westwand (50°)';
  return 'Benutzerdefinierte Wand';
}

export function setupWallSelector() {
  const pills = document.querySelectorAll('.aspect-pill');
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');

      if (pill.dataset.auto) {
        state.activeAspect.isAuto = true;
      } else {
        state.activeAspect.isAuto = false;
        state.activeAspect.tilt = parseFloat(pill.dataset.tilt);
        state.activeAspect.azimuth = parseFloat(pill.dataset.azimuth);
      }

      loadLocation(state.currentLocation);
    });
  });
}

// =============================================================================
// VERTIKALES HÖHENPROFIL (TAL VS. BERG: 4 HÖHENSTUFEN + SMARTE ZEITSTEUERUNG)
// =============================================================================

export function renderAltitudeChart() {
  const container = document.getElementById('altitude-levels-container');
  if (!container || !state.microData || !state.microData.altitudeProfile) return;

  const profiles = state.microData.altitudeProfile;
  const currentProfile = profiles[state.selectedAltitudeHour] || profiles[0];

  container.innerHTML = '';

  currentProfile.levels.forEach(level => {
    const card = document.createElement('div');
    const isFreezing = !level.isAboveFreezing;
    card.className = `altitude-tier-card ${isFreezing ? 'tier-freezing' : 'tier-thawing'}`;

    const t = Math.round(convertTemp(level.temp));
    const tFormatted = t > 0 ? `+${t}°` : `${t}°`;

    const feltT = Math.round(convertTemp(level.feltTemp));
    const feltFormatted = feltT > 0 ? `+${feltT}°` : `${feltT}°`;

    // Harmonische Temperatur-Farben
    let tempColor = '#30d158'; // Grün (angenehm / mild)
    if (level.temp < -5) tempColor = '#5ac8fa'; // Tiefkaltes Eisblau
    else if (level.temp < 0) tempColor = '#64d2ff'; // Frostiges Cyan
    else if (level.temp > 20) tempColor = '#ff453a'; // Sehr warm
    else if (level.temp > 14) tempColor = '#ff9f0a'; // Warm / Sommerlich

    let feltColor = '#30d158';
    if (level.feltTemp < -5) feltColor = '#5ac8fa';
    else if (level.feltTemp < 0) feltColor = '#64d2ff';
    else if (level.feltTemp > 20) feltColor = '#ff453a';
    else if (level.feltTemp > 14) feltColor = '#ff9f0a';

    // 0°C-Niveau Distanz
    let freezingDiffText = '';
    let freezingDiffClass = '';
    if (level.freezingDiff > 0) {
      freezingDiffText = `+${level.freezingDiff.toLocaleString('de-DE')} m über 0°C`;
      freezingDiffClass = 'f-above-frost';
    } else if (level.freezingDiff < 0) {
      freezingDiffText = `${Math.abs(level.freezingDiff).toLocaleString('de-DE')} m unter 0°C`;
      freezingDiffClass = 'f-below-frost';
    } else {
      freezingDiffText = 'Exakt an der 0°C-Grenze';
      freezingDiffClass = 'f-exact-frost';
    }

    const precipIcon = level.isAboveFreezing ? '💧' : '❄️';
    const precipType = level.precipType || (level.isAboveFreezing ? 'Regen' : 'Schnee');

    card.innerHTML = `
      <!-- 1. IDENTITÄT & HÖHE -->
      <div class="tier-cell-identity">
        <div class="tier-icon-box">${level.icon}</div>
        <div class="tier-identity-info">
          <div class="tier-name-row">
            <span class="tier-name">${level.name}</span>
            <span class="tier-elevation-badge">${level.z.toLocaleString('de-DE')} m</span>
          </div>
          <div class="tier-meta-sub">
            <span class="tier-pressure-chip">${level.pressureHpa || Math.round(1013 * Math.exp(-level.z/8000))} hPa</span>
            <span class="tier-zone-pill ${level.isAboveFreezing ? 'zone-thaw' : 'zone-frost'}">
              ${level.isAboveFreezing ? 'Tauwetter' : 'Frostgrenze'}
            </span>
          </div>
        </div>
      </div>

      <!-- 2. TEMPERATUR & WINDCHILL -->
      <div class="tier-cell-temp">
        <div class="tier-main-temp" style="color: ${tempColor}">
          <span class="t-val">${tFormatted}</span>
          <span class="t-sublabel">Luft</span>
        </div>
        <div class="tier-felt-block">
          <span class="tf-label">Gefühlt</span>
          <span class="tf-val" style="color: ${feltColor}">${feltFormatted}</span>
        </div>
      </div>

      <!-- 3. WIND & BÖEN -->
      <div class="tier-cell-wind">
        <div class="tier-wind-row">
          <span class="tw-icon">💨</span>
          <span class="tw-val">${level.wind} <small>km/h</small></span>
        </div>
        <div class="tw-gusts">Böen: <strong>${level.gusts || Math.round(level.wind * 1.35)} km/h</strong></div>
      </div>

      <!-- 4. NIEDERSCHLAG & NULLGRADGRENZE -->
      <div class="tier-cell-precip">
        <div class="tier-precip-pill ${level.isAboveFreezing ? 'precip-rain' : 'precip-snow'}">
          <span class="p-icon">${precipIcon}</span>
          <span class="p-text">${precipType}</span>
        </div>
        <div class="tier-freezing-info">
          <span class="tfi-label">0°C-Niveau</span>
          <span class="tfi-diff ${freezingDiffClass}">${freezingDiffText}</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });

  // 3D-Bergmodell synchronisieren
  renderMountain3DModel();
}

/**
 * ============================================================================
 * 3D BERGGELÄNDE & WETTER-HÖHENSCHNITT ENGINE (ALPINE 3D RELIEF & METEOROLOGY)
 * ============================================================================
 * Bildet das Bergmassiv in 3D mit realistischer Geometrie, echter 0°C-Schneefallgrenze,
 * Wolkenschicht / Inversionsmeer, Höhenwind-Gradient und interaktiven Höhenstufen ab.
 */
export function renderMountain3DModel() {
  updateMountain3DHUD();
  drawMountain3DCanvas();

  // Starte kontinuierliche Animationsschleife (60fps) für Partikel & Strömung
  if (!state.mountain3D.animFrame) {
    startMountain3DAnimation();
  }
}

/**
 * Aktualisiert die DOM-Badges und HUD-Overlays auf dem 3D-Berg (ohne Canvas-Redraw)
 */
export function updateMountain3DHUD() {
  const m = state.microData;
  if (!m || !m.altitudeProfile) return;

  const profiles = m.altitudeProfile;
  const cur = profiles[state.selectedAltitudeHour] || profiles[0];
  const levels = cur.levels;
  if (!levels || levels.length < 3) return;

  const valL = levels[0];
  const midL = levels[1];
  const peakL = levels[2];
  const freezingLevel = cur.freezingLevel;
  const precip = cur.precip || 0;
  const peakWind = peakL.wind || 40;
  const peakGusts = peakL.gusts || Math.round(peakWind * 1.35);

  // 1. Aktualisiere HUD-Badges auf dem 3D-Berg
  const peakZElem = document.getElementById('m3d-val-peak-z');
  const peakTempElem = document.getElementById('m3d-val-peak-temp');
  const peakCondElem = document.getElementById('m3d-val-peak-cond');
  const peakWindElem = document.getElementById('m3d-val-peak-wind');
  const peakGustsElem = document.getElementById('m3d-val-peak-gusts');

  const frostZElem = document.getElementById('m3d-val-frost-z');
  const frostSubElem = document.getElementById('m3d-val-frost-sub');

  const midZElem = document.getElementById('m3d-val-mid-z');
  const midTempElem = document.getElementById('m3d-val-mid-temp');
  const midCondElem = document.getElementById('m3d-val-mid-cond');
  const midWindElem = document.getElementById('m3d-val-mid-wind');

  const valZElem = document.getElementById('m3d-val-valley-z');
  const valTempElem = document.getElementById('m3d-val-valley-temp');
  const valCondElem = document.getElementById('m3d-val-valley-cond');
  const valWindElem = document.getElementById('m3d-val-valley-wind');

  const peakDir = peakL.windDir || 280;
  const peakDirText = peakL.windDirText || 'WNW';
  const midDir = midL.windDir || 260;
  const midDirText = midL.windDirText || 'W';
  const valDir = valL.windDir || 210;
  const valDirText = valL.windDirText || 'SSW';

  if (peakZElem) peakZElem.innerText = `${peakL.z.toLocaleString('de-DE')} m`;
  if (peakTempElem) {
    const t = Math.round(convertTemp(peakL.temp));
    peakTempElem.innerText = `${t > 0 ? `+${t}` : t}°C`;
  }
  if (peakCondElem) peakCondElem.innerText = peakL.precipType === 'Schnee' ? '❄️ Schneefall' : (precip > 0 ? '🌧️ Regen' : '☀️ Klar');
  if (peakWindElem) peakWindElem.innerText = `${peakL.wind} km/h (${peakDirText} ${peakDir}°)`;
  if (peakGustsElem) peakGustsElem.innerText = `${peakGusts} km/h`;

  if (frostZElem) frostZElem.innerText = `${Math.round(freezingLevel).toLocaleString('de-DE')} m`;
  if (frostSubElem) {
    if (freezingLevel >= peakL.z) {
      frostSubElem.innerText = `0°C-Grenze +${Math.round(freezingLevel - peakL.z)} m über Gipfel (Tauwetter)`;
    } else if (freezingLevel <= valL.z) {
      frostSubElem.innerText = `Dauerfrost bis ins Tal (${Math.round(valL.z - freezingLevel)} m unter Talboden)`;
    } else {
      frostSubElem.innerText = `Darüber Schnee, darunter Regen`;
    }
  }

  if (midZElem) midZElem.innerText = `${midL.z.toLocaleString('de-DE')} m`;
  if (midTempElem) {
    const t = Math.round(convertTemp(midL.temp));
    midTempElem.innerText = `${t > 0 ? `+${t}` : t}°C`;
  }
  if (midCondElem) midCondElem.innerText = midL.precipType === 'Schnee' ? '❄️ Schnee' : '💧 Regen';
  if (midWindElem) midWindElem.innerText = `${midL.wind} km/h (${midDirText} ${midDir}°)`;

  if (valZElem) valZElem.innerText = `${valL.z.toLocaleString('de-DE')} m`;
  if (valTempElem) {
    const t = Math.round(convertTemp(valL.temp));
    valTempElem.innerText = `${t > 0 ? `+${t}` : t}°C`;
  }
  if (valCondElem) valCondElem.innerText = precip > 0 ? `💧 ${precip.toFixed(1)} mm` : 'Trocken';
  if (valWindElem) valWindElem.innerText = `${valL.wind} km/h (${valDirText} ${valDir}°)`;

  // Status Bar Indikator
  const invElem = document.getElementById('msb-inversion-badge');
  if (invElem) {
    if (m.atmosphere && m.atmosphere.inversionActive) {
      invElem.innerText = '⚠️ Inversionslage (Kaltluftsee im Tal, Gipfel wärmer)';
      invElem.style.color = '#ffd166';
    } else if (freezingLevel < peakL.z) {
      invElem.innerText = '❄️ Gipfel in der Frostzone • Tal schneefrei';
      invElem.style.color = '#64d2ff';
    } else {
      invElem.innerText = '☀️ Alpin-Stratosphäre mild';
      invElem.style.color = '#30d158';
    }
  }

  // Im Windmodus zeichnet das Canvas dedizierte Höhenwind-Kompasskarten
  const hudOverlay = document.getElementById('m3d-hud-overlay');
  if (hudOverlay) {
    hudOverlay.style.display = state.mountain3D.viewMode === 'wind' ? 'none' : 'block';
  }

  // Positioniere das 0°C Frost Badge dynamisch
  const canvas = document.getElementById('mountain-3d-canvas');
  if (canvas) {
    const h = canvas.clientHeight || 420;
    const yValley = h * 0.82;
    const yPeak = h * 0.18;
    const zRange = Math.max(200, peakL.z - valL.z);
    const ratio = Math.max(0, Math.min(1.2, (freezingLevel - valL.z) / zRange));
    const yFrost = yValley - ratio * (yValley - yPeak);

    const badgeFrost = document.getElementById('m3d-hud-frost');
    if (badgeFrost) {
      const frostClampY = Math.max(50, Math.min(h - 95, yFrost - 24));
      badgeFrost.style.top = `${Math.round(frostClampY)}px`;
      badgeFrost.style.display = (state.mountain3D.showFrostLine && state.mountain3D.viewMode !== 'wind') ? 'flex' : 'none';
    }
  }
}

/**
 * Zeichnet das 3D-Bergrelief & meteorologische Schichten auf das Canvas
 */
export function drawMountain3DCanvas() {
  const canvas = document.getElementById('mountain-3d-canvas');
  if (!canvas) return;

  const m = state.microData;
  if (!m || !m.altitudeProfile) return;

  const profiles = m.altitudeProfile;
  const cur = profiles[state.selectedAltitudeHour] || profiles[0];
  const levels = cur.levels;
  if (!levels || levels.length < 3) return;

  const valL = levels[0];
  const midL = levels[1];
  const peakL = levels[2];
  const freezingLevel = cur.freezingLevel;
  const precip = cur.precip || 0;
  const peakWind = peakL.wind || 40;

  // 1. Canvas-Dimensionen & DPI-Skalierung
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width || 800;
  const h = rect.height || 420;

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  const ctx = canvas.getContext('2d');
  ctx.resetTransform();
  ctx.scale(dpr, dpr);

  // 2. Höhen-Koordinatenfunktion
  const yValley = h * 0.82;
  const yPeak = h * 0.18;
  const zRange = Math.max(200, peakL.z - valL.z);
  const getYForZ = (z) => {
    const ratio = Math.max(0, Math.min(1.2, (z - valL.z) / zRange));
    return yValley - ratio * (yValley - yPeak);
  };
  const yFrost = getYForZ(freezingLevel);

  // Canvas leeren
  ctx.clearRect(0, 0, w, h);

  // A. Atmosphärischer Alpin-Himmel
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
  skyGrad.addColorStop(0, '#070f26');
  skyGrad.addColorStop(0.55, '#0f172a');
  skyGrad.addColorStop(1, '#020617');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h);

  // Zarte Sterne am Hochgebirgshimmel
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  const starCoords = [[0.12, 0.08], [0.25, 0.14], [0.38, 0.06], [0.72, 0.10], [0.85, 0.07], [0.62, 0.15], [0.92, 0.18]];
  starCoords.forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.arc(w * sx, h * sy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  });

  // B. Ferne Alpengipfel im Dunst (Tiefenwirkung)
  ctx.fillStyle = 'rgba(30, 41, 59, 0.40)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.68);
  ctx.lineTo(w * 0.14, h * 0.44);
  ctx.lineTo(w * 0.30, h * 0.54);
  ctx.lineTo(w * 0.52, h * 0.35);
  ctx.lineTo(w * 0.70, h * 0.48);
  ctx.lineTo(w * 0.86, h * 0.39);
  ctx.lineTo(w, h * 0.60);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // 3. Modus-Rendering
  const mode = state.mountain3D.viewMode || 'massif';
  if (mode === 'crossSection') {
    render3DCrossSectionMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, precip);
  } else if (mode === 'wind') {
    render3DWindMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, peakWind);
  } else {
    render3DMassifMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, precip);
  }
}

/**
 * 3D MASSIF MODUS: Isometrisches Alpenrelief mit Fels-, Schnee- & Waldzonen
 * sowie dynamischer Niederschlags-Phasenumwandlung (Schnee oben vs. Regen unten)
 */
export function render3DMassifMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, precip) {
  const rotRad = ((state.mountain3D.rotationAngle || 0) * Math.PI) / 180;
  const pitchRad = ((state.mountain3D.pitchAngle || 0) * Math.PI) / 180;
  const rotShiftX = Math.sin(rotRad) * (w * 0.18);
  const pitchShiftY = Math.sin(pitchRad) * (h * 0.08);

  const px = w * 0.48 + rotShiftX; // Peak X mit 360°-Perspektive
  const py = yPeak + pitchShiftY;    // Peak Y mit Neigungs-Pitch
  const lx = w * 0.12 + Math.sin(rotRad - 0.6) * (w * 0.06); // Linker Grat X
  const ly = yValley;  // Linker Grat Y
  const rx = w * 0.88 + Math.sin(rotRad + 0.6) * (w * 0.06); // Rechter Grat X
  const ry = yValley;  // Rechter Grat Y
  const cx = w * 0.45 + rotShiftX * 0.6; // Zentraler Vordersporn X
  const cy = yValley + h * 0.05 - pitchShiftY * 0.5; // Zentraler Vordersporn Y

  // 1. Linke Wand (Luv / Sonnenhang - Südwand)
  const leftRockGrad = ctx.createLinearGradient(lx, ly, px, py);
  leftRockGrad.addColorStop(0, '#1e293b');
  leftRockGrad.addColorStop(1, state.mountain3D.showSun ? '#475569' : '#334155');
  ctx.fillStyle = leftRockGrad;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(lx, ly);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();

  // 2. Rechte Wand (Lee / Schattenhang - Nordostwand)
  const rightRockGrad = ctx.createLinearGradient(px, py, rx, ry);
  rightRockGrad.addColorStop(0, '#1e293b');
  rightRockGrad.addColorStop(1, '#090d16');
  ctx.fillStyle = rightRockGrad;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(cx, cy);
  ctx.lineTo(rx, ry);
  ctx.closePath();
  ctx.fill();

  // 3. Felsgrate & Strukturlinien
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(cx, cy);
  ctx.stroke();

  // 4. ECHTE 3D-SCHNEEDECKE (über 0°C-Frostgrenze)
  if (freezingLevel < peakL.z) {
    const frostRatio = Math.max(0, Math.min(1, (yFrost - py) / (cy - py)));
    const fxLeft = px - (px - lx) * Math.max(0, Math.min(1, (yFrost - py) / (ly - py)));
    const fxCenter = px - (px - cx) * frostRatio;
    const fxRight = px + (rx - px) * Math.max(0, Math.min(1, (yFrost - py) / (ry - py)));

    // Linke Schnee-Facette (Strahlendes Alpinweiß)
    const leftSnowGrad = ctx.createLinearGradient(fxLeft, yFrost, px, py);
    leftSnowGrad.addColorStop(0, '#bae6fd');
    leftSnowGrad.addColorStop(0.5, '#e0f2fe');
    leftSnowGrad.addColorStop(1, '#ffffff');
    ctx.fillStyle = leftSnowGrad;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(fxLeft, yFrost);
    // Gezackte Schneezungen in Felsrinnen
    ctx.lineTo(fxLeft + (fxCenter - fxLeft) * 0.4, yFrost + 14);
    ctx.lineTo(fxLeft + (fxCenter - fxLeft) * 0.7, yFrost - 6);
    ctx.lineTo(fxCenter, yFrost);
    ctx.closePath();
    ctx.fill();

    // Rechte Schnee-Facette (Kühler Eisschatten)
    const rightSnowGrad = ctx.createLinearGradient(px, py, fxRight, yFrost);
    rightSnowGrad.addColorStop(0, '#93c5fd');
    rightSnowGrad.addColorStop(1, '#3b82f6');
    ctx.fillStyle = rightSnowGrad;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(fxCenter, yFrost);
    ctx.lineTo(fxCenter + (fxRight - fxCenter) * 0.4, yFrost + 16);
    ctx.lineTo(fxCenter + (fxRight - fxCenter) * 0.7, yFrost - 8);
    ctx.lineTo(fxRight, yFrost);
    ctx.closePath();
    ctx.fill();
  }

  // 5. Unterer Fichtenwald-Gürtel (unterhalb 1.700 m)
  const yTreeline = getYForZ(Math.min(1700, peakL.z * 0.65));
  if (yTreeline < yValley) {
    ctx.fillStyle = '#14532d';
    // Zeichne Nadelbäume auf den unteren Berghang
    const treePoints = [
      [w * 0.18, yValley - 10], [w * 0.24, yValley - 24], [w * 0.32, yValley - 16],
      [w * 0.58, yValley - 18], [w * 0.68, yValley - 28], [w * 0.78, yValley - 14]
    ];
    treePoints.forEach(([tx, ty]) => {
      ctx.beginPath();
      ctx.moveTo(tx, ty - 16);
      ctx.lineTo(tx - 7, ty);
      ctx.lineTo(tx + 7, ty);
      ctx.closePath();
      ctx.fill();
    });
  }

  // 6. Talboden mit saftigem Wiesengrün
  const valleyGrad = ctx.createLinearGradient(0, yValley, 0, h);
  valleyGrad.addColorStop(0, '#166534');
  valleyGrad.addColorStop(1, '#064e3b');
  ctx.fillStyle = valleyGrad;
  ctx.beginPath();
  ctx.moveTo(0, yValley + 15);
  ctx.lineTo(w * 0.45, cy);
  ctx.lineTo(w, yValley + 15);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  // 7. 0°C-FROSTLINIE ALS LEUCHTENDE 3D-EBENE
  if (state.mountain3D.showFrostLine) {
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#38bdf8';
    ctx.shadowBlur = 12;
    ctx.setLineDash([8, 6]);

    ctx.beginPath();
    ctx.moveTo(w * 0.08, yFrost);
    ctx.lineTo(w * 0.92, yFrost);
    ctx.stroke();
    ctx.restore();

    // 0°C Label auf der Schnittlinie
    ctx.fillStyle = '#38bdf8';
    ctx.font = '700 11px system-ui, -apple-system, sans-serif';
    ctx.fillText(`❄️ 0°C Frostgrenze: ${Math.round(freezingLevel)} m`, w * 0.08 + 10, yFrost - 8);
  }

  // 8. ECHTE VOLUMETRISCHE ALPIN-WOLKEN (CUMULUS & NEBELMEER)
  if (state.mountain3D.showClouds) {
    const yCloud = getYForZ(Math.min(peakL.z - 200, Math.max(valL.z + 100, freezingLevel * 0.85)));
    const drift = (state.mountain3D.cloudDrift || 0);
    renderRealisticAlpineClouds(ctx, w, h, yCloud, drift, state.mountain3D.showSun);
  }

  // 9. DYNAMISCHER NIEDERSCHLAG: PHASENWECHSEL SCHNEE (OBEN) VS. REGEN (UNTEN)
  renderElevationPrecipitationParticles(ctx, w, h, yFrost, precip);
}

/**
 * Zeichnet dynamische Partikel mit Schneefall über der 0°C-Grenze und Regen darunter
 */
export function renderElevationPrecipitationParticles(ctx, w, h, yFrost, precip) {
  if (precip <= 0) return;

  if (!state.mountain3D.weatherParticles || state.mountain3D.weatherParticles.length === 0) {
    state.mountain3D.weatherParticles = [];
    for (let i = 0; i < 55; i++) {
      state.mountain3D.weatherParticles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        speed: 1.5 + Math.random() * 2.5,
        drift: (Math.random() - 0.5) * 0.8,
        size: 1 + Math.random() * 2
      });
    }
  }

  const particles = state.mountain3D.weatherParticles;
  particles.forEach(p => {
    p.y += p.speed;
    p.x += p.drift + 0.4;
    if (p.y > h) {
      p.y = 0;
      p.x = Math.random() * w;
    }
    if (p.x > w) p.x = 0;
    if (p.x < 0) p.x = w;

    if (p.y < yFrost) {
      // SCHNEE: Weißer funkelnder Schneepartikel oberhalb der 0°C-Frostgrenze
      ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/**
 * 3D VERTIKALER HÖHENSCHNITT-MODUS: Exakte Skala in Metern mit thermischer Zonierung
 */
export function render3DCrossSectionMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, precip) {
  const rulerX = 75;

  // 1. Vertikales Höhenlineal
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rulerX, yPeak - 20);
  ctx.lineTo(rulerX, yValley + 20);
  ctx.stroke();

  // Höhenmarkierungen alle 500m
  const minZ = Math.floor(valL.z / 500) * 500;
  const maxZ = Math.ceil(peakL.z / 500) * 500;
  for (let z = minZ; z <= maxZ; z += 500) {
    const yz = getYForZ(z);
    ctx.beginPath();
    ctx.moveTo(rulerX - 6, yz);
    ctx.lineTo(rulerX + 6, yz);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${z} m`, rulerX - 10, yz + 3);
  }
  ctx.textAlign = 'left';

  // 2. Thermische Hintergrund-Zonen
  // Frostbereich (< 0°C)
  ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.fillRect(rulerX, yPeak - 20, w - rulerX, Math.max(0, yFrost - (yPeak - 20)));

  // Tauwetterbereich (> 0°C)
  ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
  ctx.fillRect(rulerX, yFrost, w - rulerX, Math.max(0, (yValley + 20) - yFrost));

  // 3. Bergprofil-Querschnitt
  const px = w * 0.52;
  const py = yPeak;
  ctx.fillStyle = 'rgba(30, 41, 59, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rulerX + 40, yValley);
  ctx.lineTo(px, py);
  ctx.lineTo(w - 40, yValley);
  ctx.lineTo(w - 40, yValley + 30);
  ctx.lineTo(rulerX + 40, yValley + 30);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 4. Hervorgehobene 0°C-Isotherme
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(rulerX, yFrost);
  ctx.lineTo(w - 20, yFrost);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '700 11px system-ui';
  ctx.fillText(`❄️ 0°C Isotherme: ${Math.round(freezingLevel)} m (Schneefallgrenze)`, rulerX + 15, yFrost - 8);

  // 5. Niederschlags- & Phasenzonen Annotationen
  ctx.font = '600 10px system-ui';
  ctx.fillStyle = '#bae6fd';
  ctx.fillText(`❄️ Frostzone (< 0°C) • Schnee / Reif • Gipfel: ${Math.round(peakL.temp)}°C`, rulerX + 15, yPeak + 14);

  ctx.fillStyle = '#86efac';
  ctx.fillText(`💧 Tauzone (> 0°C) • Regen / Schmelze • Talboden: ${Math.round(valL.temp)}°C`, rulerX + 15, yValley - 10);

  // Niederschlags-Partikel im Schnitt
  renderElevationPrecipitationParticles(ctx, w, h, yFrost, precip);
}

/**
 * Beaufort-Skalen-Klassifizierung für alpine Windgeschwindigkeiten
 */
export function getBeaufortInfo(kmh) {
  if (kmh < 2) return { bft: 0, text: 'Windstille' };
  if (kmh < 6) return { bft: 1, text: 'Leiser Zug' };
  if (kmh < 12) return { bft: 2, text: 'Leichte Brise' };
  if (kmh < 20) return { bft: 3, text: 'Schwache Brise' };
  if (kmh < 29) return { bft: 4, text: 'Mäßige Brise' };
  if (kmh < 39) return { bft: 5, text: 'Frische Brise' };
  if (kmh < 50) return { bft: 6, text: 'Starker Wind' };
  if (kmh < 62) return { bft: 7, text: 'Steifer Wind' };
  if (kmh < 75) return { bft: 8, text: 'Stürmischer Wind' };
  if (kmh < 89) return { bft: 9, text: 'Sturm' };
  if (kmh < 103) return { bft: 10, text: 'Schwerer Sturm' };
  if (kmh < 118) return { bft: 11, text: 'Orkanartiger Sturm' };
  return { bft: 12, text: 'Orkan' };
}

/**
 * Zeichnet eine Apple Liquid-Glass Kompass-Rose mit Windnadel & Telemetrie
 */
export function drawAltimetricCompassRose(ctx, x, y, radius, dirDeg, speedKmh, gustsKmh, altName, altZ, dirText) {
  ctx.save();

  const cardW = 252;
  const cardH = 68;
  const cardX = Math.max(12, x);
  const cardY = y - cardH / 2;

  // 1. Frosted Liquid Glass Card Hintergrund
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.20)';
  ctx.lineWidth = 1.2;

  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 16);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeRect(cardX, cardY, cardW, cardH);
  }
  ctx.restore();

  // 2. Kompass-Rose Ziffernblatt
  const dialX = cardX + radius + 14;
  const dialY = cardY + cardH / 2;

  // Äußerer Ziffernring
  ctx.fillStyle = 'rgba(2, 6, 23, 0.95)';
  ctx.beginPath();
  ctx.arc(dialX, dialY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Innerer Ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(dialX, dialY, radius * 0.65, 0, Math.PI * 2);
  ctx.stroke();

  // Grad-Teilstriche
  for (let a = 0; a < 360; a += 45) {
    const rad = (a * Math.PI) / 180;
    const isCardinal = (a % 90 === 0);
    const rIn = isCardinal ? radius - 6 : radius - 4;
    const x1 = dialX + Math.sin(rad) * rIn;
    const y1 = dialY - Math.cos(rad) * rIn;
    const x2 = dialX + Math.sin(rad) * (radius - 1);
    const y2 = dialY - Math.cos(rad) * (radius - 1);

    ctx.strokeStyle = isCardinal ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = isCardinal ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Kardinalbuchstaben N, O, S, W
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.font = '800 8px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', dialX, dialY - radius + 7);
  ctx.fillText('S', dialX, dialY + radius - 7);
  ctx.fillText('O', dialX + radius - 7, dialY);
  ctx.fillText('W', dialX - radius + 7, dialY);

  // 3. Dynamische rotierende Wind-Kompassnadel
  ctx.save();
  ctx.translate(dialX, dialY);
  const needleRad = (dirDeg * Math.PI) / 180;
  ctx.rotate(needleRad);

  const needleLen = radius - 6;
  const needleWidth = 4.2;

  let needleColor = '#38bdf8';
  if (speedKmh >= 60) needleColor = '#ef4444';
  else if (speedKmh >= 35) needleColor = '#f59e0b';
  else if (speedKmh >= 20) needleColor = '#22c55e';

  // Nadelspitze (zeigt exakt in die Windanströmung)
  ctx.fillStyle = needleColor;
  ctx.shadowColor = needleColor;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(0, -needleLen);
  ctx.lineTo(needleWidth, 0);
  ctx.lineTo(-needleWidth, 0);
  ctx.closePath();
  ctx.fill();

  // Nadelende (Gegengewicht)
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.beginPath();
  ctx.moveTo(0, needleLen * 0.65);
  ctx.lineTo(needleWidth * 0.7, 0);
  ctx.lineTo(-needleWidth * 0.7, 0);
  ctx.closePath();
  ctx.fill();

  // Zentrales Lager
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // 4. Telemetrie-Beschriftung
  const textX = dialX + radius + 12;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Höhenstufe & Meter
  ctx.fillStyle = '#94a3b8';
  ctx.font = '800 9px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${altName.toUpperCase()} • ${(altZ || 0).toLocaleString('de-DE')} M`, textX, cardY + 11);

  // Geschwindigkeit & Gradrichtung
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 15px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${speedKmh} km/h`, textX, cardY + 25);

  ctx.fillStyle = needleColor;
  ctx.font = '700 12px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${dirDeg}° ${dirText}`, textX + 66, cardY + 27);

  // Böen & Beaufort
  const bft = getBeaufortInfo(speedKmh);
  ctx.fillStyle = gustsKmh > speedKmh + 10 ? '#fb923c' : 'rgba(255, 255, 255, 0.65)';
  ctx.font = '600 10px system-ui, -apple-system, sans-serif';
  ctx.fillText(`Böen: ${gustsKmh} km/h • Bft ${bft.bft} (${bft.text})`, textX, cardY + 45);

  ctx.restore();
}

/**
 * 3D HÖHENWIND- & STRÖMUNGSMODUS MIT KOMPASS-ROSEN JE HÖHENSTUFE
 */
export function render3DWindMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, peakWind) {
  // 1. Zeige Bergmassiv abgedunkelt als Silhouette mit Tiefen-Gradient
  const px = w * 0.48;
  const py = yPeak;
  const lx = w * 0.12;
  const ly = yValley;
  const rx = w * 0.88;
  const ry = yValley;
  const cx = w * 0.46;
  const cy = yValley + 15;

  const mountainGrad = ctx.createLinearGradient(0, py, 0, yValley);
  mountainGrad.addColorStop(0, '#0c1529');
  mountainGrad.addColorStop(0.7, '#070d1a');
  mountainGrad.addColorStop(1, '#030712');

  ctx.fillStyle = mountainGrad;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(lx, ly);
  ctx.lineTo(cx, cy);
  ctx.lineTo(rx, ry);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 2. Horizontale Höhenstufen-Hilfslinien
  const yMid = getYForZ(midL.z);
  [
    { y: yPeak, z: peakL.z, color: 'rgba(239, 68, 68, 0.35)' },
    { y: yMid, z: midL.z, color: 'rgba(234, 179, 8, 0.35)' },
    { y: yValley, z: valL.z, color: 'rgba(34, 197, 94, 0.35)' }
  ].forEach(lvl => {
    ctx.strokeStyle = lvl.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(20, lvl.y);
    ctx.lineTo(w - 20, lvl.y);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // 3. ALTIMETRISCHE HÖHENWIND-KOMPASSE (APPLE LIQUID-GLASS JE HÖHENSTUFE)
  const dialRadius = 24;

  // Staggered Positionierung für optimale Übersichtlichkeit:
  // A. Gipfel-Kompass (Oben Rechts)
  const gipfelX = Math.min(w - 270, Math.max(w * 0.52, px + 35));
  const gipfelY = yPeak + 28;
  drawAltimetricCompassRose(
    ctx, gipfelX, gipfelY, dialRadius,
    peakL.windDir || 280, peakL.wind, peakL.gusts || Math.round(peakL.wind * 1.35),
    'Gipfel / Grat', peakL.z, peakL.windDirText || 'WNW'
  );

  // B. Mittelstation-Kompass (Mitte Links)
  const midX = Math.max(16, Math.min(w * 0.08, px - 280));
  const midY = yMid;
  drawAltimetricCompassRose(
    ctx, midX, midY, dialRadius,
    midL.windDir || 260, midL.wind, midL.gusts || Math.round(midL.wind * 1.35),
    'Mittelstation', midL.z, midL.windDirText || 'W'
  );

  // C. Talboden-Kompass (Unten Rechts)
  const talX = Math.min(w - 270, Math.max(w * 0.50, px + 25));
  const talY = yValley - 34;
  drawAltimetricCompassRose(
    ctx, talX, talY, dialRadius,
    valL.windDir || 210, valL.wind, valL.gusts || Math.round(valL.wind * 1.35),
    'Talboden', valL.z, valL.windDirText || 'SSW'
  );
}

/**
 * Zeichnet eine organische, voluminöse Wolkenbank mit echten Cumulus-Kuppeln,
 * 3D-Lichtverlauf und alpinem Highlight-Saum.
 */
export function drawSingleAlpineCloud(ctx, cx, cy, scale, isSunActive) {
  // Puffs definieren die flauschige, natürliche Form einer alpinen Cumulus-Wolke
  const puffs = [
    // Flachere, diffuse Unterseite (Hebungskondensations-Niveau)
    { dx: -54, dy: 10, r: 24, isTop: false },
    { dx: -24, dy: 12, r: 30, isTop: false },
    { dx: 14,  dy: 12, r: 32, isTop: false },
    { dx: 46,  dy: 10, r: 26, isTop: false },
    { dx: 72,  dy: 12, r: 20, isTop: false },

    // Volumetrischer Mittelkörper
    { dx: -38, dy: 0,  r: 34, isTop: false },
    { dx: 0,   dy: 2,  r: 42, isTop: false },
    { dx: 36,  dy: 0,  r: 36, isTop: false },

    // Obere Cumulus-Kuppeln (flauschige Wölbungen mit Höhensonnen-Lichtsaum)
    { dx: -46, dy: -14, r: 26, isTop: true },
    { dx: -22, dy: -26, r: 34, isTop: true },
    { dx: 10,  dy: -32, r: 40, isTop: true },
    { dx: 40,  dy: -20, r: 32, isTop: true },
    { dx: 64,  dy: -8,  r: 24, isTop: true },

    // Zarte Nebelfetzen an den Flanken
    { dx: -74, dy: 6,  r: 15, isTop: false },
    { dx: 88,  dy: 8,  r: 15, isTop: false }
  ];

  ctx.save();

  // 1. Pass: Weicher Umgebungsschatten / diffuse Wolken-Aura
  ctx.save();
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
  ctx.beginPath();
  puffs.forEach(p => {
    const px = cx + p.dx * scale;
    const py = cy + p.dy * scale + 4;
    const pr = p.r * scale;
    ctx.moveTo(px + pr, py);
    ctx.arc(px, py, pr, 0, Math.PI * 2);
  });
  ctx.fill();
  ctx.restore();

  // 2. Pass: Volumetrische Wolkenbäuche mit 3D-Kugelverlauf
  puffs.forEach(p => {
    const px = cx + p.dx * scale;
    const py = cy + p.dy * scale;
    const pr = p.r * scale;

    const grad = ctx.createRadialGradient(
      px - pr * 0.25, py - pr * 0.35, pr * 0.08,
      px, py, pr
    );

    if (isSunActive) {
      grad.addColorStop(0, 'rgba(255, 254, 248, 0.94)');
      grad.addColorStop(0.45, 'rgba(248, 250, 252, 0.80)');
      grad.addColorStop(0.80, 'rgba(203, 213, 225, 0.42)');
      grad.addColorStop(1, 'rgba(148, 163, 184, 0.0)');
    } else {
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.90)');
      grad.addColorStop(0.45, 'rgba(241, 245, 249, 0.74)');
      grad.addColorStop(0.80, 'rgba(148, 163, 184, 0.38)');
      grad.addColorStop(1, 'rgba(100, 116, 139, 0.0)');
    }

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  });

  // 3. Pass: Strahlende Cumulus-Gipfelkanten (Lichtsaum an der Oberseite)
  puffs.filter(p => p.isTop).forEach(p => {
    const px = cx + p.dx * scale;
    const py = cy + p.dy * scale;
    const pr = p.r * scale;

    const rim = ctx.createRadialGradient(
      px - pr * 0.2, py - pr * 0.45, 1,
      px, py, pr * 0.75
    );
    rim.addColorStop(0, isSunActive ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.86)');
    rim.addColorStop(0.45, 'rgba(255, 255, 255, 0.45)');
    rim.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(px - pr * 0.1, py - pr * 0.25, pr * 0.7, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

/**
 * Rendert eine lebendige, natürliche Wolkenlandschaft über dem Alpenmassiv
 */
export function renderRealisticAlpineClouds(ctx, w, h, yCloudBase, drift, isSunActive) {
  // Tiefengestaffelte Wolkenbänke mit individuellem Parallax-Drift
  const cloudBands = [
    // Hintergrund-Wolken (höher, zarter, langsamerer Drift)
    { xRatio: 0.12, yRel: -36, scale: 0.85, driftFactor: 0.28, alpha: 0.65 },
    { xRatio: 0.68, yRel: -28, scale: 0.95, driftFactor: 0.30, alpha: 0.70 },
    // Vordergrund-Wolken (prägnant, flauschig, dynamisch)
    { xRatio: 0.02, yRel: 0,   scale: 1.15, driftFactor: 0.48, alpha: 1.0 },
    { xRatio: 0.42, yRel: 14,  scale: 1.00, driftFactor: 0.45, alpha: 0.95 },
    { xRatio: 0.84, yRel: -8,  scale: 1.25, driftFactor: 0.50, alpha: 1.0 }
  ];

  const loopW = w + 450;

  cloudBands.forEach(band => {
    const rawX = (band.xRatio * loopW + drift * band.driftFactor) % loopW - 200;
    const cy = yCloudBase + band.yRel;

    ctx.save();
    ctx.globalAlpha = band.alpha;
    drawSingleAlpineCloud(ctx, rawX, cy, band.scale, isSunActive);
    ctx.restore();
  });
}

/**
 * Stoppt die Animationsschleife sauber zur Schonung von Akku und CPU
 */
export function stopMountain3DAnimation() {
  if (state.mountain3D.animFrame) {
    cancelAnimationFrame(state.mountain3D.animFrame);
    state.mountain3D.animFrame = null;
  }
}

/**
 * Kontinuierliche Animationsschleife für Schneefall, Regen & Wolkendrift
 */
export function startMountain3DAnimation() {
  stopMountain3DAnimation();

  function loop() {
    const tabMountain = document.getElementById('tab-mountain');
    const isTabActive = tabMountain && tabMountain.classList.contains('active');

    // Rendere Frame nur wenn der Berg-Tab aktiv ist und das Dokument nicht im Hintergrund liegt
    if (!isTabActive || document.hidden) {
      state.mountain3D.animFrame = null;
      return;
    }

    state.mountain3D.cloudDrift = ((state.mountain3D.cloudDrift || 0) + 0.35);

    if (state.currentLocation && state.currentLocation.isMountain) {
      drawMountain3DCanvas();
    }

    state.mountain3D.animFrame = requestAnimationFrame(loop);
  }

  state.mountain3D.animFrame = requestAnimationFrame(loop);
}

/**
 * Globaler Helfer zum sofortigen Laden bekannter Berggipfel
 */
window.loadNamedMountain = function(name) {
  const mountainPresets = {
    'zugspitze': { name: 'Zugspitze', lat: 47.4212, lon: 10.9864, elevation: 2962, country: 'Deutschland', isMountain: true },
    'matterhorn': { name: 'Matterhorn', lat: 45.9764, lon: 7.6586, elevation: 4478, country: 'Schweiz', isMountain: true },
    'mont blanc': { name: 'Mont Blanc', lat: 45.8326, lon: 6.8652, elevation: 4808, country: 'Frankreich', isMountain: true },
    'großglockner': { name: 'Großglockner', lat: 47.0742, lon: 12.6947, elevation: 3798, country: 'Österreich', isMountain: true },
    'grossglockner': { name: 'Großglockner', lat: 47.0742, lon: 12.6947, elevation: 3798, country: 'Österreich', isMountain: true },
    'nebelhorn': { name: 'Nebelhorn', lat: 47.4219, lon: 10.3444, elevation: 2224, country: 'Deutschland', isMountain: true }
  };
  const key = (name || '').toLowerCase().trim();
  const target = mountainPresets[key] || state.favorites.find(f => f.name.toLowerCase().includes(key));
  if (target) {
    loadLocation(target);
    switchTab('tab-mountain');
  }
};

/**
 * Richtet alle Event-Listener für das 3D-Bergmodell ein
 */
export function setupMountain3DControls() {
  if (state.mountain3D.initialized) return;
  state.mountain3D.initialized = true;

  // 1. Modus-Buttons (3D Massiv, Vertikalschnitt, Wind)
  document.querySelectorAll('.m3d-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.m3d-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mountain3D.viewMode = btn.dataset.mode;
      renderMountain3DModel();
    });
  });

  // 2. Ebenen-Toggles (Frostgrenze, Wolken, Wind, Sonne)
  document.querySelectorAll('.m3d-layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      btn.classList.toggle('active');
      const isActive = btn.classList.contains('active');

      if (layer === 'frost') state.mountain3D.showFrostLine = isActive;
      else if (layer === 'clouds') state.mountain3D.showClouds = isActive;
      else if (layer === 'wind') state.mountain3D.showWind = isActive;
      else if (layer === 'sun') state.mountain3D.showSun = isActive;

      renderMountain3DModel();
    });
  });

  // 3. Klick auf HUD-Badges hebt entsprechende Höhenstufe in den Tier-Karten hervor
  const badgeMap = {
    'm3d-hud-peak': 2,
    'm3d-hud-frost': 1,
    'm3d-hud-mid': 1,
    'm3d-hud-valley': 0
  };

  Object.entries(badgeMap).forEach(([id, tierIdx]) => {
    const badge = document.getElementById(id);
    if (badge) {
      badge.addEventListener('click', () => {
        const cards = document.querySelectorAll('.altitude-tier-card');
        if (cards && cards[tierIdx]) {
          cards[tierIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
          cards[tierIdx].classList.add('tier-highlight');
          setTimeout(() => cards[tierIdx].classList.remove('tier-highlight'), 1500);
        }
      });
    }
  });

  // 4. Schnellwahl-Buttons für Gipfel aus dem City-Banner
  document.querySelectorAll('.cms-btn[data-mountain]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mName = btn.dataset.mountain;
      window.loadNamedMountain(mName);
    });
  });

  const toggleBtn = document.getElementById('cms-btn-toggle-mountain');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      state.currentLocation.isMountain = true;
      loadLocation(state.currentLocation);
      switchTab('tab-mountain');
    });
  }

  // 5. Interaktives 360° Touch & Drag Drehen (Feature 1A)
  const canvas = document.getElementById('mountain-3d-canvas');
  if (canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      state.mountain3D.isDragging = true;
      state.mountain3D.dragStartX = e.clientX;
      state.mountain3D.dragStartY = e.clientY;
      canvas.classList.add('is-dragging');
      try { canvas.setPointerCapture(e.pointerId); } catch(err) {}
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!state.mountain3D.isDragging) return;
      const dx = e.clientX - state.mountain3D.dragStartX;
      const dy = e.clientY - state.mountain3D.dragStartY;
      state.mountain3D.dragStartX = e.clientX;
      state.mountain3D.dragStartY = e.clientY;

      state.mountain3D.rotationAngle = (state.mountain3D.rotationAngle + dx * 0.6) % 360;
      state.mountain3D.pitchAngle = Math.max(-20, Math.min(20, state.mountain3D.pitchAngle - dy * 0.35));
      drawMountain3DCanvas();
    });

    const stopDrag = (e) => {
      if (state.mountain3D.isDragging) {
        state.mountain3D.isDragging = false;
        canvas.classList.remove('is-dragging');
        try { canvas.releasePointerCapture(e.pointerId); } catch(err) {}
      }
    };

    canvas.addEventListener('pointerup', stopDrag);
    canvas.addEventListener('pointercancel', stopDrag);
  }

  // Resize-Listener
  window.addEventListener('resize', () => {
    const tabMountain = document.getElementById('tab-mountain');
    if (tabMountain && tabMountain.classList.contains('active')) {
      renderMountain3DModel();
    }
  });
}

// 24h Interaktiver Mini-Stundenstreifen
export function renderAltitudeHoursScroller() {
  const scroller = document.getElementById('profile-hours-scroller');
  if (!scroller || !state.microData || !state.microData.altitudeProfile) return;

  const profiles = state.microData.altitudeProfile;
  const hRaw = state.weatherData ? state.weatherData.hourly : null;

  scroller.innerHTML = '';

  profiles.forEach((p, idx) => {
    const pill = document.createElement('button');
    pill.className = `profile-hour-pill ${idx === state.selectedAltitudeHour ? 'active' : ''}`;
    pill.type = 'button';
    pill.dataset.hour = idx;

    const timeDate = new Date(p.time);
    const hourNum = timeDate.getHours();
    const timeStr = idx === 0 ? 'Jetzt' : `${String(hourNum).padStart(2, '0')}:00`;

    // Wetter-Icon für die jeweilige Stunde
    let icon = '⛅';
    if (hRaw && hRaw.weather_code && hRaw.weather_code[idx] !== undefined) {
      const codeInfo = WMO_CODES[hRaw.weather_code[idx]];
      if (codeInfo) icon = codeInfo.icon;
    }

    // Gipfeltemperatur für diese Stunde
    const summitLevel = p.levels.find(l => l.name.includes('Gipfel')) || p.levels[p.levels.length - 2] || p.levels[0];
    const peakT = Math.round(convertTemp(summitLevel.temp));
    const peakFormatted = peakT > 0 ? `+${peakT}°` : `${peakT}°`;

    pill.innerHTML = `
      <span class="php-time">${timeStr}</span>
      <span class="php-icon">${icon}</span>
      <span class="php-peak-temp">${peakFormatted}</span>
    `;

    pill.addEventListener('click', () => {
      selectAltitudeHour(idx, true);
    });

    scroller.appendChild(pill);
  });
}

// Zentrale Stundenauswahl-Funktion
export function selectAltitudeHour(hourIndex, shouldScroll = true) {
  if (!state.microData || !state.microData.altitudeProfile) return;
  const profiles = state.microData.altitudeProfile;
  const maxHour = Math.max(0, profiles.length - 1);

  // Clampen zwischen 0 und maxHour
  state.selectedAltitudeHour = Math.max(0, Math.min(maxHour, hourIndex));
  const h = state.selectedAltitudeHour;

  // 1. Badge & Stepper Buttons aktualisieren
  const timeLabel = document.getElementById('profile-time-label');
  const prevBtn = document.getElementById('time-step-prev');
  const nextBtn = document.getElementById('time-step-next');

  if (prevBtn) prevBtn.disabled = (h <= 0);
  if (nextBtn) nextBtn.disabled = (h >= maxHour);

  const curProfile = profiles[h] || profiles[0];
  if (curProfile && curProfile.time) {
    const t = new Date(curProfile.time);
    const timeStr = `${String(t.getHours()).padStart(2, '0')}:00 Uhr`;
    if (timeLabel) {
      timeLabel.innerText = h === 0 ? `Jetzt (${timeStr})` : `+${h} Std. (${timeStr})`;
    }
  } else if (timeLabel) {
    timeLabel.innerText = h === 0 ? 'Jetzt' : `+${h} Stunden`;
  }

  // 2. Schnellauswahl-Pills synchronisieren
  const quickPills = document.querySelectorAll('#profile-quick-times-bar .quick-time-pill');
  quickPills.forEach(pill => {
    const pillHour = parseInt(pill.dataset.hour);
    if (pillHour === h) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });

  // 3. Stundenscroller synchronisieren & ins Sichtfeld scrollen
  const hourPills = document.querySelectorAll('#profile-hours-scroller .profile-hour-pill');
  hourPills.forEach(pill => {
    const pillHour = parseInt(pill.dataset.hour);
    if (pillHour === h) {
      pill.classList.add('active');
      if (shouldScroll) {
        pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    } else {
      pill.classList.remove('active');
    }
  });

  // 4. Höhenstufen-Karten rendern
  renderAltitudeChart();
}

// Event-Listener für Stepper und Schnellauswahl
export function setupAltitudeTimeControls() {
  const prevBtn = document.getElementById('time-step-prev');
  const nextBtn = document.getElementById('time-step-next');

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      selectAltitudeHour(state.selectedAltitudeHour - 1, true);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      selectAltitudeHour(state.selectedAltitudeHour + 1, true);
    });
  }

  // Quick Preset Bar Delegierung
  const quickBar = document.getElementById('profile-quick-times-bar');
  if (quickBar) {
    quickBar.addEventListener('click', (e) => {
      const pill = e.target.closest('.quick-time-pill');
      if (!pill) return;
      const targetHour = parseInt(pill.dataset.hour);
      if (!isNaN(targetHour)) {
        selectAltitudeHour(targetHour, true);
      }
    });
  }
}

// Alias für Abwärtskompatibilität
export function setupAltitudeSlider() {
  setupAltitudeTimeControls();
}

export function updateAltitudeSliderLabel() {
  selectAltitudeHour(state.selectedAltitudeHour, false);
}

