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
      if (label) label.innerText = 'Berg & Höhe';
    }
    if (mobileTab) {
      const icon = mobileTab.querySelector('.mbn-icon');
      const label = mobileTab.querySelector('.mbn-label');
      if (icon) icon.innerText = '🏔️';
      if (label) label.innerText = 'Berg & Höhe';
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
  const snowLevel = m.atmosphere.snowLevelMeters || m.atmosphere.freezingLevelMeters;
  const fl = m.atmosphere.freezingLevelMeters;
  const flEl = document.getElementById('m-freezing-level');
  if (flEl) {
    if (snowLevel && fl && Math.abs(snowLevel - fl) >= 50) {
      flEl.innerText = `~${Math.round(snowLevel)} m (0°C: ${Math.round(fl)} m)`;
    } else {
      flEl.innerText = `${Math.round(snowLevel || fl)} m`;
    }
  }

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

    const precipIcon = level.precipIcon || (level.precipType === 'Schnee' ? '❄️' : level.precipType === 'Schneeregen' ? '🌨️' : level.isAboveFreezing ? '💧' : '❄️');
    const precipType = level.precipType || (level.isAboveFreezing ? 'Regen' : 'Schnee');
    const precipClass = level.precipType === 'Schnee'
      ? 'precip-snow'
      : level.precipType === 'Schneeregen'
      ? 'precip-sleet'
      : level.isAboveFreezing
      ? 'precip-rain'
      : 'precip-snow';

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
            ${level.foehnActive ? `<span class="tier-foehn-pill" style="display:inline-flex;align-items:center;gap:3px;background:rgba(255,159,10,0.18);border:1px solid rgba(255,159,10,0.45);color:#ff9f0a;font-size:0.75rem;padding:2px 7px;border-radius:12px;font-weight:600;">💨 ${level.foehnNote || 'Föhn'}</span>` : (level.windNote ? `<span class="tier-valley-pill" style="display:inline-flex;align-items:center;gap:3px;background:rgba(90,200,250,0.18);border:1px solid rgba(90,200,250,0.45);color:#5ac8fa;font-size:0.75rem;padding:2px 7px;border-radius:12px;font-weight:600;">${level.windNote === 'Hangaufwind' ? '☀️' : '🌙'} ${level.windNote}</span>` : '')}
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
        <div class="tier-precip-pill ${precipClass}">
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
}

/**
 * 3D-Bergmodell vollständig entfernt.
 * Sichere Kompatibilitäts-Stubs für bestehende Referenzen.
 */
export function renderMountain3DModel() {}
export function updateMountain3DHUD() {}
export function drawMountain3DCanvas() {}
export function startMountain3DAnimation() {}
export function stopMountain3DAnimation() {}

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
 * Initialisiert Event-Listener für Berggipfel-Presets und Bergmodus-Umschaltung
 */
export function setupMountainControls() {
  // Schnellwahl-Buttons für Gipfel aus dem City-Banner
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
}

// Abwärtskompatibler Alias
export const setupMountain3DControls = setupMountainControls;

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

