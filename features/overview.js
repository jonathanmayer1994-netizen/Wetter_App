import { MicroEngine } from '../microEngine.js';
/**
 * BEST WEATHER — Overview Domain Feature Module (Task 1a)
 * Hero header, 24h hourly forecast slider, 10-day trend, Multi-Model comparison,
 * Ensemble meteogram, Bento Grid telemetry, and hazard alerts.
 */

import { state } from '../core/state.js';
import { WMO_CODES } from '../core/constants.js';
import { MeteogramCanvas } from './meteogram/meteogramCanvas.js';
import { escapeHtml } from '../httpClient.js';
import { updateFavStarUI } from './favorites.js';
import { AlpineStorage } from '../storage.js';

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

export function setupLocationTypeToggle() {
  const badge = document.getElementById('location-type-badge');
  if (badge) {
    badge.style.cursor = 'pointer';
    badge.title = 'Klicken, um manuell zwischen Stadt- und Bergansicht zu wechseln';
    badge.addEventListener('click', () => {
      state.currentLocation.isMountain = !state.currentLocation.isMountain;
      loadLocation(state.currentLocation);
    });
  }
}


export function updateLocationHeaderUI() {
  const loc = state.currentLocation;
  document.getElementById('hero-location-name').innerText = loc.name;
  document.getElementById('hero-elevation-pill').innerText = `${loc.isMountain ? '🏔️' : '🏙️'} ${loc.elevation.toLocaleString('de-DE')} m`;
  document.getElementById('hero-geo-coords').innerText = `Lat: ${loc.lat.toFixed(4)}, Lon: ${loc.lon.toFixed(4)}`;
  document.getElementById('hero-update-time').innerText = `Aktualisiert: ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

  // Feature 2A: Suchleiste & Spotlight Text aktualisieren
  const spotlightText = document.getElementById('spotlight-trigger-text');
  if (spotlightText) {
    spotlightText.innerText = `${loc.isMountain ? '🏔️' : '🏙️'} ${loc.name} (${loc.elevation.toLocaleString('de-DE')} m) • Suchen...`;
  }
  const searchInput = document.getElementById('location-search-input');
  if (searchInput) {
    searchInput.placeholder = `${loc.isMountain ? '🏔️' : '🏙️'} ${loc.name} (${loc.elevation.toLocaleString('de-DE')} m) — Ort oder Gipfel suchen...`;
  }

  const badge = document.getElementById('location-type-badge');
  const tab2Icon = document.getElementById('tab-2-icon');
  const tab2Label = document.getElementById('tab-2-label');

  if (loc.isMountain) {
    badge.innerText = '🏔️ Hochalpiner Berggipfel';
    badge.style.color = '#ffd166';
    if (tab2Icon) tab2Icon.innerText = '🏔️';
    if (tab2Label) tab2Label.innerText = 'Berg & Alpin-Engine';
  } else {
    badge.innerText = '🏙️ Stadt / Flachland';
    badge.style.color = '#64d2ff';
    if (tab2Icon) tab2Icon.innerText = '🏙️';
    if (tab2Label) tab2Label.innerText = 'Stadtklima & Umwelt';
  }

  updateFavStarUI();
}



export function updateAlpineSkyIllumination(weatherData, elevation) {
  const glow = document.getElementById('ambient-glow');
  if (!glow) return;

  glow.classList.remove('dawn', 'sunrise', 'golden-hour', 'alpenglow', 'dusk', 'night', 'overcast');

  if (!weatherData || !weatherData.daily || !weatherData.daily.sunrise || !weatherData.daily.sunset) {
    return;
  }

  const now = new Date();
  const sunriseStr = weatherData.daily.sunrise[0];
  const sunsetStr = weatherData.daily.sunset[0];
  if (!sunriseStr || !sunsetStr) return;

  const sunrise = new Date(sunriseStr);
  const sunset = new Date(sunsetStr);

  const diffSunriseMin = (now.getTime() - sunrise.getTime()) / 60000;
  const diffSunsetMin = (now.getTime() - sunset.getTime()) / 60000;

  if (diffSunriseMin >= -60 && diffSunriseMin < -10) {
    // Morgendämmerung
    glow.classList.add('dawn');
  } else if (diffSunriseMin >= -10 && diffSunriseMin <= 45) {
    // Sonnenaufgang
    glow.classList.add('sunrise');
  } else if (diffSunsetMin >= -60 && diffSunsetMin < -10) {
    // Goldene Stunde vor Sonnenuntergang
    glow.classList.add('golden-hour');
  } else if (diffSunsetMin >= -10 && diffSunsetMin <= 35) {
    // Alpenglühen auf hohen Gipfeln
    if (elevation >= 1200) {
      glow.classList.add('alpenglow');
    } else {
      glow.classList.add('golden-hour');
    }
  } else if (diffSunsetMin > 35 && diffSunsetMin <= 90) {
    // Abenddämmerung
    glow.classList.add('dusk');
  } else if (diffSunsetMin > 90 || diffSunriseMin < -60) {
    // Dunkle Nacht / Sternenhimmel
    glow.classList.add('night');
  }

  // Feature 10A: Bewölkungs-Dämpfung bei Hochnebel/Regen (Dämpft Licht sanft ab)
  const cur = weatherData.current || (weatherData.hourly ? {
    cloud_cover: weatherData.hourly.cloud_cover ? weatherData.hourly.cloud_cover[0] : 0
  } : null);
  const cloudCover = cur && cur.cloud_cover !== undefined ? cur.cloud_cover : 0;
  if (cloudCover >= 75) {
    glow.classList.add('overcast');
  }
}

// =============================================================================
// TAB 1: RENDER OVERVIEW (24H HOURLY & 10-DAY FORECAST)
// =============================================================================
export function renderOverviewTab() {
  const w = state.weatherData;
  const m = state.microData;
  if (!w) return;

  const cur = w.current || (w.hourly ? {
    temperature_2m: w.hourly.temperature_2m[0],
    apparent_temperature: w.hourly.apparent_temperature ? w.hourly.apparent_temperature[0] : w.hourly.temperature_2m[0],
    is_day: 1,
    weather_code: w.hourly.weather_code ? w.hourly.weather_code[0] : 0,
    wind_speed_10m: w.hourly.wind_speed_10m ? w.hourly.wind_speed_10m[0] : 10,
    wind_direction_10m: 180,
    relative_humidity_2m: 60,
    pressure_msl: 1013
  } : null);

  if (!cur) return;

  const daily = w.daily;
  const isDay = cur.is_day === 1;
  const code = WMO_CODES[cur.weather_code] || WMO_CODES[0];
  const theme = isDay ? code.theme : code.themeNight;

  document.body.className = `weather-${theme}`;
  if (state.canvasEngine) state.canvasEngine.setMode(theme, isDay);

  // Feature 10B: Dynamische Himmelsfarben & Alpenglühen
  updateAlpineSkyIllumination(w, state.currentLocation.elevation);

  // Exact Temperature
  const finalTemp = (m && state.currentLocation.isMountain) ? m.microWeather.temperature10m : cur.temperature_2m;
  document.getElementById('hero-current-temp').innerText = Math.round(convertTemp(finalTemp));

  // Bright Sky Current (DWD-Station) bevorzugt, Fallback auf Modell
  (async () => {
    try {
      const loc = state.currentLocation;
      if (!loc || !MicroEngine.fetchBrightSkyCurrent) return;
      const station = await MicroEngine.fetchBrightSkyCurrent(loc.lat, loc.lon);
      if (station && typeof station.temperature === 'number') {
        const el = document.getElementById('hero-current-temp');
        if (el) el.innerText = Math.round(convertTemp(station.temperature));
        const cond = document.getElementById('hero-condition-text');
        // Englische Station-Condition nicht übernehmen – deutsche Bezeichnung bleibt erhalten
        // if (cond && station.condition) cond.innerText = station.condition;
        const src = document.getElementById('hero-source-badge');
        if (src) src.innerText = 'DWD-Station';
      }
    } catch (_) {}
  })();
  // Cloud-Cover in die Bedingung einbeziehen (Hero und Karte konsistent)
  const cloud = cur.cloud_cover !== undefined ? cur.cloud_cover : (w.hourly && w.hourly.cloud_cover ? w.hourly.cloud_cover[0] : 0);
  let conditionLabel = code.label;
  if (cloud >= 75) conditionLabel = 'Bedeckt';
  else if (cloud >= 50) conditionLabel = 'Wolkig';
  else if (cloud >= 25) conditionLabel = 'Teilweise bewölkt';
  else if (cloud < 15 && (cur.weather_code === 0 || cur.weather_code === 1)) conditionLabel = 'Klar / Wolkenlos';
  document.getElementById('hero-condition-text').innerText = conditionLabel;

  if (daily && daily.temperature_2m_max && daily.temperature_2m_max.length > 0) {
    document.getElementById('hero-temp-max').innerText = `${Math.round(convertTemp(daily.temperature_2m_max[0]))}°`;
    document.getElementById('hero-temp-min').innerText = `${Math.round(convertTemp(daily.temperature_2m_min[0]))}°`;
  }
  document.getElementById('hero-temp-apparent').innerText = `${Math.round(convertTemp(cur.apparent_temperature))}°`;

  // Render 24h Hourly Forecast
  renderHourlySlider(w.hourly);

  // Render 10-Day Forecast with Click Interaction
  render10DayForecast(w.daily, w.hourly);

  // Render Bento Grid Details
  renderBentoGrid(cur, daily, w.hourly);

  // Akuter Unwetter- & Gefahren-Banner (Top Priority Alert)
  updateHeroHazardAlert(cur, daily, w.hourly, m);
}

// =============================================================================
// AKUTER UNWETTER- & GEFAHREN-BANNER (TOP PRIORITY HERO HAZARD ALERT)
// =============================================================================
export function updateHeroHazardAlert(cur, daily, hourly, microData) {
  const alertBox = document.getElementById('hero-hazard-alert');
  if (!alertBox) return;

  const iconElem = document.getElementById('hha-icon');
  const badgeElem = document.getElementById('hha-badge');
  const msgElem = document.getElementById('hha-msg');
  const actionBtn = document.getElementById('hha-action-btn');

  let hazard = null;

  // 1. Akutes Gewitter & Blitzschlag (Priorität 1)
  const isThunder = [95, 96, 99].includes(cur.weather_code) ||
    (hourly && hourly.weather_code && [95, 96, 99].includes(hourly.weather_code[0]));
  if (isThunder) {
    const isSevere = cur.weather_code === 96 || cur.weather_code === 99;
    hazard = {
      icon: '⚡',
      badge: isSevere ? 'SCHWERES GEWITTER & HAGEL' : 'AKUTE GEWITTERWARNUNG',
      msg: 'Blitzentladungen & Unwetter in Standortnähe. Grate, Gipfel & offene Flächen sofort meiden.',
      actionText: 'Live-Radar ➔',
      action: () => {
        switchTab('tab-map');
        const b = document.querySelector('.map-overlay-btn[data-overlay="lightning"]');
        if (b) b.click();
        else if (typeof setMapOverlay === 'function') setMapOverlay('lightning');
      }
    };
  }

  // 2. Schwere Sturmböen / Orkan (Priorität 2: >= 75 km/h)
  if (!hazard) {
    const curGust = cur.wind_gusts_10m || cur.wind_speed_10m || 0;
    const maxDailyGust = (daily && daily.wind_gusts_10m_max && daily.wind_gusts_10m_max[0]) || 0;
    const peakGust = Math.round(Math.max(curGust, maxDailyGust));
    if (peakGust >= 75) {
      hazard = {
        icon: '🌪️',
        badge: peakGust >= 100 ? 'ORKANWARNUNG' : 'STURMWARNUNG',
        msg: `Schwere Sturmböen bis zu ${peakGust} km/h gemessen. Achtung vor Astbruch & Absturzgefahr auf Höhenwegen.`,
        actionText: 'Windströmung ➔',
        action: () => {
          switchTab('tab-map');
          const b = document.querySelector('.map-overlay-btn[data-overlay="wind"]');
          if (b) b.click();
          else if (typeof setMapOverlay === 'function') setMapOverlay('wind');
        }
      };
    }
  }

  // 3. Lawinenwarnstufe >= 3 bei Bergstandorten (Priorität 3)
  if (!hazard && state.currentLocation && state.currentLocation.isMountain && microData && microData.avalanche) {
    const avLevel = microData.avalanche.dangerLevel || 1;
    if (avLevel >= 3) {
      hazard = {
        icon: '⚠️',
        badge: `LAWINENWARNSTUFE ${avLevel} (${avLevel >= 4 ? 'GROSS' : 'ERHEBLICH'})`,
        msg: `${microData.avalanche.dangerTitle}: Störanfällige Schneedecke & Triebschnee im Steilgelände.`,
        actionText: 'Lawinenbericht ➔',
        action: () => {
          switchTab('tab-mountain');
          setTimeout(() => {
            const card = document.getElementById('avalanche-report-card');
            if (card) card.scrollIntoView({ behavior: 'smooth' });
          }, 100);
        }
      };
    }
  }

  // 4. Starkregen / Flutgefahr (Priorität 4: >= 10 mm/h oder >= 35 mm/d)
  if (!hazard) {
    const precipSum = (daily && daily.precipitation_sum && daily.precipitation_sum[0]) || 0;
    const curPrecip = cur.precipitation || 0;
    if (curPrecip >= 10 || precipSum >= 35 || [65, 67, 82].includes(cur.weather_code)) {
      hazard = {
        icon: '🌧️',
        badge: 'STARKREGENWARNUNG',
        msg: `Intensive Niederschlagsmengen (${Math.round(Math.max(curPrecip, precipSum))} mm). Erhöhte Aquaplaning- & Überflutungsgefahr.`,
        actionText: 'Regenradar ➔',
        action: () => {
          switchTab('tab-map');
          const b = document.querySelector('.map-overlay-btn[data-overlay="precip"]');
          if (b) b.click();
          else if (typeof setMapOverlay === 'function') setMapOverlay('precip');
        }
      };
    }
  }

  // 5. Glatteis & Gefrierender Regen (Priorität 5)
  if (!hazard) {
    const isFreezing = [66, 67].includes(cur.weather_code) ||
      (cur.temperature_2m <= 0.5 && (cur.precipitation > 0 || (hourly && hourly.precipitation && hourly.precipitation[0] > 0)));
    if (isFreezing) {
      hazard = {
        icon: '🧊',
        badge: 'GLATTEISWARNUNG',
        msg: 'Gefrierende Nässe / Glatteisbildung auf Fahrbahnen, Brücken und Bergsteigen.',
        actionText: 'Alpin-Details ➔',
        action: () => {
          switchTab(state.currentLocation.isMountain ? 'tab-mountain' : 'tab-overview');
        }
      };
    }
  }

  // Banner ein- oder ausblenden
  if (hazard) {
    if (iconElem) iconElem.innerText = hazard.icon;
    if (badgeElem) badgeElem.innerText = hazard.badge;
    if (msgElem) msgElem.innerText = hazard.msg;
    if (actionBtn) {
      actionBtn.innerText = hazard.actionText;
      actionBtn.onclick = hazard.action;
    }
    alertBox.style.display = 'flex';
  } else {
    alertBox.style.display = 'none';
  }
}

// =============================================================================
// KOMPAKT- VS. EXPERTEN-MODUS TOGGLE (MULTI-MODELL & UMWELT)
// =============================================================================
export function setupExpertModeToggle() {
  const btn = document.getElementById('expert-mode-toggle-btn');
  const container = document.getElementById('expert-details-container');
  const arrow = document.getElementById('emb-arrow');
  if (!btn || !container) return;

  const isEnabled = AlpineStorage.safeGetItem('alpine_expert_mode_enabled', false);
  if (isEnabled) {
    container.classList.remove('is-hidden');
    btn.setAttribute('aria-expanded', 'true');
    if (arrow) arrow.innerText = '▴';
  } else {
    container.classList.add('is-hidden');
    btn.setAttribute('aria-expanded', 'false');
    if (arrow) arrow.innerText = '▾';
  }

  btn.addEventListener('click', () => {
    const isCurrentlyHidden = container.classList.contains('is-hidden');
    if (isCurrentlyHidden) {
      container.classList.remove('is-hidden');
      btn.setAttribute('aria-expanded', 'true');
      if (arrow) arrow.innerText = '▴';
      AlpineStorage.safeSetItem('alpine_expert_mode_enabled', true);
      // Neuzeichnung des Meteogramm-Canvas anstoßen, falls zuvor verborgen
      if (typeof renderSpaghettiMeteogram === 'function' && state.weatherData) {
        setTimeout(() => renderSpaghettiMeteogram(state.weatherData), 50);
      }
    } else {
      container.classList.add('is-hidden');
      btn.setAttribute('aria-expanded', 'false');
      if (arrow) arrow.innerText = '▾';
      AlpineStorage.safeSetItem('alpine_expert_mode_enabled', false);
    }
  });
}

export function setupHourlyGranularityToggle() {
  const container = document.getElementById('hourly-granularity-toggle');
  if (!container) return;

  container.querySelectorAll('.hgt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.hgt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.overviewHourlyMode = btn.dataset.res || 'highres';
      if (state.weatherData && state.weatherData.hourly) {
        renderHourlySlider(state.weatherData.hourly);
      }
    });
  });
}

function getInterpolatedHourlyPoint(hourly, nowMs, currentClosestIdx, minuteOffset) {
  const targetTs = nowMs + minuteOffset * 60000;
  const targetDate = new Date(targetTs);
  const cur = (state.weatherData && state.weatherData.current) ? state.weatherData.current : {};

  if (minuteOffset > 0) {
    const hFloat = minuteOffset / 60;
    const baseHour = Math.floor(hFloat);
    const h0 = Math.min(hourly.time.length - 1, currentClosestIdx + baseHour);
    const h1 = Math.min(hourly.time.length - 1, h0 + 1);
    const frac = hFloat - baseHour;

    const t0 = (hourly.temperature_2m && hourly.temperature_2m[h0] !== undefined) ? hourly.temperature_2m[h0] : 12;
    const t1 = (hourly.temperature_2m && hourly.temperature_2m[h1] !== undefined) ? hourly.temperature_2m[h1] : t0;
    const temp = t0 * (1 - frac) + t1 * frac;

    const p0 = (hourly.precipitation_probability && hourly.precipitation_probability[h0] !== undefined) ? hourly.precipitation_probability[h0] : 0;
    const p1 = (hourly.precipitation_probability && hourly.precipitation_probability[h1] !== undefined) ? hourly.precipitation_probability[h1] : p0;
    const pop = Math.round(p0 * (1 - frac) + p1 * frac);

    const w0 = (hourly.wind_speed_10m && hourly.wind_speed_10m[h0] !== undefined) ? hourly.wind_speed_10m[h0] : 10;
    const w1 = (hourly.wind_speed_10m && hourly.wind_speed_10m[h1] !== undefined) ? hourly.wind_speed_10m[h1] : w0;
    const wind = Math.round(w0 * (1 - frac) + w1 * frac);

    const pr0 = (hourly.precipitation && hourly.precipitation[h0] !== undefined) ? hourly.precipitation[h0] : 0;
    const pr1 = (hourly.precipitation && hourly.precipitation[h1] !== undefined) ? hourly.precipitation[h1] : pr0;
    const precip = Math.round((pr0 * (1 - frac) + pr1 * frac) * 10) / 10;

    const code = frac < 0.5
      ? (hourly.weather_code ? hourly.weather_code[h0] : 0)
      : (hourly.weather_code ? hourly.weather_code[h1] : 0);

    const isDay = targetDate.getHours() >= 6 && targetDate.getHours() <= 20;

    return {
      timestamp: targetDate,
      minuteOffset,
      temp,
      pop,
      wind,
      precip,
      code,
      isDay
    };
  } else if (minuteOffset < 0) {
    const prevHourIdx = Math.max(0, currentClosestIdx - 1);
    const frac = (60 + minuteOffset) / 60; // 0 at -60m, 1 at 0m
    const t0 = (hourly.temperature_2m && hourly.temperature_2m[prevHourIdx] !== undefined) ? hourly.temperature_2m[prevHourIdx] : 12;
    const t1 = cur.temperature_2m !== undefined ? cur.temperature_2m : t0;
    const temp = t0 * (1 - frac) + t1 * frac;

    const pop = (hourly.precipitation_probability && hourly.precipitation_probability[currentClosestIdx] !== undefined) ? hourly.precipitation_probability[currentClosestIdx] : 0;
    const wind = cur.wind_speed_10m !== undefined ? Math.round(cur.wind_speed_10m) : 10;
    const precip = cur.precipitation !== undefined ? cur.precipitation : 0;
    const code = cur.weather_code !== undefined ? cur.weather_code : 0;
    const isDay = targetDate.getHours() >= 6 && targetDate.getHours() <= 20;

    return {
      timestamp: targetDate,
      minuteOffset,
      temp,
      pop,
      wind,
      precip,
      code,
      isDay
    };
  } else {
    const temp = cur.temperature_2m !== undefined ? cur.temperature_2m : (hourly.temperature_2m ? hourly.temperature_2m[currentClosestIdx] : 12);
    const pop = hourly.precipitation_probability ? hourly.precipitation_probability[currentClosestIdx] : 0;
    const wind = cur.wind_speed_10m !== undefined ? Math.round(cur.wind_speed_10m) : 10;
    const precip = cur.precipitation !== undefined ? cur.precipitation : 0;
    const code = cur.weather_code !== undefined ? cur.weather_code : 0;
    const isDay = targetDate.getHours() >= 6 && targetDate.getHours() <= 20;

    return {
      timestamp: targetDate,
      minuteOffset: 0,
      temp,
      pop,
      wind,
      precip,
      code,
      isDay,
      isNow: true
    };
  }
}

function createHourlyItemElement(pt, label, tag, typeClass) {
  const item = document.createElement('div');
  item.className = `hourly-item ${typeClass}`;
  
  const temp = Math.round(convertTemp(pt.temp));
  const info = WMO_CODES[pt.code] || WMO_CODES[0];
  const icon = pt.isDay ? info.icon : info.iconNight;
  const timeClock = pt.timestamp ? `${String(pt.timestamp.getHours()).padStart(2, '0')}:${String(pt.timestamp.getMinutes()).padStart(2, '0')}` : '';

  let tagHtml = '';
  if (tag === '5m') {
    tagHtml = `<span class="hourly-sub-tag tag-5m" title="5-Minuten Nowcast">5m</span>`;
  } else if (tag === '15m') {
    tagHtml = `<span class="hourly-sub-tag tag-15m" title="15-Minuten Intervall">15m</span>`;
  }

  const precipText = (pt.precip && pt.precip > 0.05)
    ? `<span style="font-size:9px; color:#38bdf8;">💧 ${pt.precip.toFixed(1)}</span>`
    : (pt.pop > 10 ? `${pt.pop}%` : '');

  item.innerHTML = `
    ${tagHtml}
    <div class="hourly-time">
      <span class="ht-label">${label}</span>
      ${timeClock ? `<small class="ht-clock">${timeClock}</small>` : ''}
    </div>
    <div class="hourly-icon">${icon}</div>
    <div class="hourly-pop">${precipText}</div>
    <div class="hourly-temp">${temp}°</div>
    <div class="hourly-wind">💨 ${pt.wind}</div>
  `;
  return item;
}

export function renderHourlySlider(hourly) {
  const container = document.getElementById('hourly-forecast-list');
  if (!container || !hourly || !hourly.time || hourly.time.length === 0) return;

  container.innerHTML = '';
  const nowMs = Date.now();

  // Finde den Index der aktuellen Stunde
  let currentClosestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < Math.min(48, hourly.time.length); i++) {
    const diff = Math.abs(new Date(hourly.time[i]).getTime() - nowMs);
    if (diff < minDiff) {
      minDiff = diff;
      currentClosestIdx = i;
    }
  }

  const isHighRes = (state.overviewHourlyMode !== 'hourly');
  const fragment = document.createDocumentFragment();

  if (isHighRes) {
    // 1. ZURÜCKLIEGENDE STUNDE: 15-Minuten-Abstand (-60m, -45m, -30m, -15m)
    const pastOffsets = [-60, -45, -30, -15];
    pastOffsets.forEach(m => {
      const pt = getInterpolatedHourlyPoint(hourly, nowMs, currentClosestIdx, m);
      const item = createHourlyItemElement(pt, `Vor ${Math.abs(m)}m`, '15m', 'past');
      fragment.appendChild(item);
    });

    // 2. JETZT (0m)
    const nowPt = getInterpolatedHourlyPoint(hourly, nowMs, currentClosestIdx, 0);
    const nowItem = createHourlyItemElement(nowPt, 'Jetzt', null, 'now');
    nowItem.classList.add('current-now');
    fragment.appendChild(nowItem);

    // 3. NÄCHSTE STUNDE: 5-MINUTEN-ABSTAND (+5m bis +60m)
    const next5MinOffsets = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
    next5MinOffsets.forEach(m => {
      const pt = getInterpolatedHourlyPoint(hourly, nowMs, currentClosestIdx, m);
      const tag = (m === 60) ? '1h' : '5m';
      const label = (m === 60) ? '+1 Std.' : `+${m}m`;
      const item = createHourlyItemElement(pt, label, tag, 'next5m');
      fragment.appendChild(item);
    });

    // 4. ZUKÜNFTIGE 2. & 3. STUNDE: 15-MINUTEN-ABSTAND (+75m bis +180m)
    const future15MinOffsets = [75, 90, 105, 120, 135, 150, 165, 180];
    future15MinOffsets.forEach(m => {
      const pt = getInterpolatedHourlyPoint(hourly, nowMs, currentClosestIdx, m);
      const h = Math.floor(m / 60);
      const restM = m % 60;
      const label = restM ? `+${h}h${restM}m` : `+${h}h`;
      const item = createHourlyItemElement(pt, label, '15m', 'future15m');
      fragment.appendChild(item);
    });

    // 5. FOLGESTUNDEN (+4h bis +48h): Stündlicher Abstand
    const startHour = 4;
    for (let h = startHour; h <= 48; h++) {
      const idx = currentClosestIdx + h;
      if (idx >= hourly.time.length) break;
      const t = new Date(hourly.time[idx]);
      const label = `${String(t.getHours()).padStart(2, '0')}:00`;
      const temp = Math.round(convertTemp(hourly.temperature_2m[idx]));
      const pop = hourly.precipitation_probability ? hourly.precipitation_probability[idx] : 0;
      const code = hourly.weather_code ? hourly.weather_code[idx] : 0;
      const isDay = (hourly.is_day && hourly.is_day[idx] !== undefined)
        ? hourly.is_day[idx] === 1
        : (t.getHours() >= 6 && t.getHours() <= 20);
      const info = WMO_CODES[code] || WMO_CODES[0];
      const icon = isDay ? info.icon : info.iconNight;
      const wind = hourly.wind_speed_10m ? Math.round(hourly.wind_speed_10m[idx]) : '--';

      const item = document.createElement('div');
      item.className = 'hourly-item';
      item.innerHTML = `
        <div class="hourly-time">${label}</div>
        <div class="hourly-icon">${icon}</div>
        <div class="hourly-pop">${pop > 10 ? `${pop}%` : ''}</div>
        <div class="hourly-temp">${temp}°</div>
        <div class="hourly-wind">💨 ${wind}</div>
      `;
      fragment.appendChild(item);
    }
  } else {
    // Klassischer Stundenschritt
    const startIdx = Math.max(0, currentClosestIdx - 6);
    const endIdx = Math.min(hourly.time.length, startIdx + 30);

    for (let i = startIdx; i < endIdx; i++) {
      const t = new Date(hourly.time[i]);
      const isNow = i === currentClosestIdx;
      const label = isNow ? 'Jetzt' : `${String(t.getHours()).padStart(2, '0')}:00`;
      const temp = Math.round(convertTemp(hourly.temperature_2m[i]));
      const pop = hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0;
      const code = hourly.weather_code ? hourly.weather_code[i] : 0;
      const isDay = (hourly.is_day && hourly.is_day[i] !== undefined)
        ? hourly.is_day[i] === 1
        : (t.getHours() >= 6 && t.getHours() <= 20);
      const info = WMO_CODES[code] || WMO_CODES[0];
      const icon = isDay ? info.icon : info.iconNight;
      const wind = hourly.wind_speed_10m ? Math.round(hourly.wind_speed_10m[i]) : '--';

      const item = document.createElement('div');
      item.className = `hourly-item ${isNow ? 'current-now' : ''}`;
      item.innerHTML = `
        <div class="hourly-time">${label}</div>
        <div class="hourly-icon">${icon}</div>
        <div class="hourly-pop">${pop > 10 ? `${pop}%` : ''}</div>
        <div class="hourly-temp">${temp}°</div>
        <div class="hourly-wind">💨 ${wind}</div>
      `;
      fragment.appendChild(item);
    }
  }

  // Single-commit DOM update (Task 4b)
  container.replaceChildren(fragment);

  // Auto-Scroll sanft zur aktuellen Stunde / Jetzt
  const activeNowItem = container.querySelector('.hourly-item.current-now');
  if (activeNowItem) {
    setTimeout(() => {
      activeNowItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 80);
  }
}

export function render10DayForecast(daily, hourly) {
  const container = document.getElementById('daily-forecast-list');
  if (!container || !daily || !daily.time || daily.time.length === 0) return;

  const fragment = document.createDocumentFragment();
  const weekdaysShort = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const weekdaysFull = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  let gMin = Infinity, gMax = -Infinity;
  const count = Math.min(10, daily.time.length);
  for (let i = 0; i < count; i++) {
    if (daily.temperature_2m_min[i] < gMin) gMin = daily.temperature_2m_min[i];
    if (daily.temperature_2m_max[i] > gMax) gMax = daily.temperature_2m_max[i];
  }
  const totalRange = (gMax - gMin) || 1;
  const curTemp = state.weatherData?.current ? state.weatherData.current.temperature_2m : null;

  for (let i = 0; i < count; i++) {
    const d = new Date(daily.time[i]);
    const isToday = i === 0;
    const dayNameShort = isToday ? 'Heute' : weekdaysShort[d.getDay()];
    const dayNameFull = isToday ? 'Heute' : weekdaysFull[d.getDay()];
    const dateShort = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });

    const syn = MicroEngine.computeRepresentativeDailyCondition(i, daily, hourly, isToday, state.weatherData?.current);
    const condIcon = syn.icon;
    const condLabel = syn.label;
    const pop = daily.precipitation_probability_max ? Math.round(daily.precipitation_probability_max[i]) : 0;
    const rainSum = daily.precipitation_sum ? daily.precipitation_sum[i] : 0;
    const windSpd = Math.round(daily.wind_speed_10m_max ? daily.wind_speed_10m_max[i] : 12);
    const windGusts = Math.round(daily.wind_gusts_10m_max ? daily.wind_gusts_10m_max[i] : windSpd * 1.4);
    const uvMax = daily.uv_index_max ? Math.round(daily.uv_index_max[i]) : 1;
    const minVal = daily.temperature_2m_min[i];
    const maxVal = daily.temperature_2m_max[i];

    // Bar positioning relative to 10-day global spectrum
    const leftPct = Math.max(0, Math.min(85, ((minVal - gMin) / totalRange) * 100));
    const widthPct = Math.max(14, Math.min(100 - leftPct, (((maxVal - minVal) / totalRange) * 100)));

    // Dot on the bar for current temperature (today only)
    let dotHtml = '';
    if (isToday && curTemp !== null) {
      const curRatio = Math.max(0, Math.min(1, (curTemp - minVal) / Math.max(0.5, maxVal - minVal)));
      const dotLeftPct = (curRatio * 100).toFixed(1);
      dotHtml = `<span class="daily-bar-cur-dot" style="left:${dotLeftPct}%;" title="Aktuell: ${Math.round(curTemp)}°"></span>`;
    }

    // 4 day parts from hourly
    const dayStartHourIdx = i * 24;
    const partsData = [
      { name: 'Morgens', offset: 8, icon: '🌅' },
      { name: 'Mittags', offset: 13, icon: '☀️' },
      { name: 'Abends', offset: 19, icon: '🌇' },
      { name: 'Nachts', offset: 23, icon: '🌙' }
    ].map(p => {
      const idx = dayStartHourIdx + p.offset;
      let t = '--';
      let partPop = 0;
      let partIcon = p.icon;
      if (hourly && hourly.temperature_2m && hourly.temperature_2m[idx] !== undefined) {
        t = `${Math.round(convertTemp(hourly.temperature_2m[idx]))}°`;
        partPop = hourly.precipitation_probability ? hourly.precipitation_probability[idx] : 0;
        const partCode = hourly.weather_code ? hourly.weather_code[idx] : 0;
        const pInfo = WMO_CODES[partCode] || WMO_CODES[0];
        partIcon = (p.offset >= 6 && p.offset <= 20) ? pInfo.icon : pInfo.iconNight;
      }
      return { ...p, t, partPop, partIcon };
    });

    const sunriseStr = daily.sunrise && daily.sunrise[i] ? new Date(daily.sunrise[i]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const sunsetStr = daily.sunset && daily.sunset[i] ? new Date(daily.sunset[i]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';

    const wrapper = document.createElement('div');
    wrapper.className = 'daily-item-wrapper';
    wrapper.id = `daily-item-${i}`;

    wrapper.innerHTML = `
      <div class="daily-interactive-row" data-index="${i}">
        <div class="daily-row-mobile-top">
          <!-- 1. Day & Date -->
          <div class="daily-date-cell">
            <div class="daily-day-label">
              <span class="day-full">${dayNameFull}</span>
              <span class="day-short">${dayNameShort}</span>
            </div>
            <div class="daily-date-badge">${dateShort}</div>
          </div>

          <!-- 6. Temperature Bar (in mobile top, on desktop flows in grid) -->
          <div class="daily-temp-bar-cell">
            <span class="daily-min-label">${Math.round(convertTemp(minVal))}°</span>
            <div class="daily-bar-container">
              <div class="daily-bar-fill" style="left:${leftPct}%; width:${widthPct}%;">
                ${dotHtml}
              </div>
            </div>
            <span class="daily-max-label">${Math.round(convertTemp(maxVal))}°</span>
          </div>

          <!-- 7. Expand Chevron (on mobile in top row beside temp bar; on desktop in col 7) -->
          <div class="daily-action-cell">
            <span class="daily-expand-chevron">›</span>
          </div>
        </div>

        <div class="daily-row-mobile-bottom">
          <!-- 2. Condition & Icon -->
          <div class="daily-condition-cell">
            <span class="daily-icon-box" title="${condLabel}">${condIcon}</span>
            <span class="daily-cond-text" title="${condLabel}">${condLabel}</span>
          </div>

          <!-- 3. Precipitation: Regen + Schnee getrennt -->
          <div class="daily-precip-cell">
            ${(() => {
              const snowSum = daily.snowfall_sum ? (daily.snowfall_sum[i] || 0) : 0;
              const parts = [];
              if (pop > 10 || rainSum > 0.05) parts.push(`💧 ${pop}% ${rainSum.toFixed(1)} mm`);
              if (snowSum > 0.05) parts.push(`❄️ ${snowSum.toFixed(1)} cm`);
              if (parts.length === 0) return '<span class="daily-precip-dry">💧 0% • Trocken</span>';
              return `<span class="daily-precip-chip ${rainSum >= 5 || snowSum >= 5 ? 'heavy-rain' : ''}">${parts.join(' · ')}</span>`;
            })()}
          </div>

          <!-- 4. Wind & Gusts -->
          <div class="daily-wind-cell">
            <span class="daily-wind-chip ${windGusts >= 45 ? 'wind-alert' : ''}">
              <span class="wind-main">💨 ${windSpd} km/h</span>
              <span class="wind-gusts">Böen ${windGusts}</span>
            </span>
          </div>

          <!-- 5. UV-Index -->
          <div class="daily-uv-cell desktop-only">
            <span class="daily-uv-chip">
              ☀️ UV ${uvMax}
            </span>
          </div>
        </div>
      </div>

      <!-- INLINE EXPANDABLE 4-DAY-PARTS ACCORDION -->
      <div class="daily-inline-accordion" id="inline-accordion-${i}" style="display:none;">
        <div class="inline-accordion-inner">
          <div class="inline-parts-row">
            ${partsData.map(p => `
              <div class="inline-part-card">
                <span class="ipc-name">${p.name}</span>
                <span class="ipc-icon">${p.partIcon}</span>
                <span class="ipc-temp">${p.t}</span>
                <span class="ipc-rain">${p.partPop > 10 ? `💧 ${p.partPop}%` : 'Trocken'}</span>
              </div>
            `).join('')}
          </div>

          <div class="inline-meta-bar">
            <div class="imb-stats">
              <span>🌅 Aufgang: <strong>${sunriseStr}</strong></span>
              <span>🌇 Untergang: <strong>${sunsetStr}</strong></span>
              <span>💨 Max. Böen: <strong>${windGusts} km/h</strong></span>
              <span>💧 24h Regen: <strong>${rainSum.toFixed(1)} mm</strong></span>
            </div>
            <button class="inline-modal-launch-btn" data-day-index="${i}">
              Vollständige Analyse ↗
            </button>
          </div>
        </div>
      </div>
    `;

    // Toggle inline accordion on clicking the row
    const rowElem = wrapper.querySelector('.daily-interactive-row');
    const accordion = wrapper.querySelector('.daily-inline-accordion');
    const chevron = wrapper.querySelector('.daily-expand-chevron');

    rowElem.addEventListener('click', (e) => {
      // Wenn der Chevron angeklickt wird, nur Accordion umschalten
      if (e.target.closest('.daily-expand-chevron')) {
        const isExpanded = accordion.style.display === 'block';
        accordion.style.display = isExpanded ? 'none' : 'block';
        wrapper.classList.toggle('expanded', !isExpanded);
        chevron.innerText = isExpanded ? '›' : '▾';
      } else {
        // Klick auf die Zeile öffnet direkt das vollständige Tages-Detail-Modal!
        openDayDetailModal(i, daily, hourly);
      }
    });

    const modalBtn = wrapper.querySelector('.inline-modal-launch-btn');
    if (modalBtn) {
      modalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDayDetailModal(i, daily, hourly);
      });
    }

    fragment.appendChild(wrapper);
  }

  // Single-commit atomic DOM update (Task 4b)
  container.replaceChildren(fragment);
}

// =============================================================================
// MULTI-MODELL-ENSEMBLE (ECMWF IFS 0.25° VS. GFS SEAMLESS)
// =============================================================================
export function renderMultiModelComparison() {
  const mm = state.multiModel;
  if (!mm) return;

  const consensusText = document.getElementById('model-consensus-text');
  if (consensusText) consensusText.innerText = `${mm.consensusText} (${mm.consensusScore}%)`;

  const ecTemp = document.getElementById('ecmwf-temp-val');
  const ecPrecip = document.getElementById('ecmwf-precip-val');
  const ecWind = document.getElementById('ecmwf-wind-val');
  if (ecTemp && mm.ecmwf.currentTemp !== null) {
    const t = Math.round(convertTemp(mm.ecmwf.currentTemp));
    ecTemp.innerText = `${t > 0 ? '+' : ''}${t}°C`;
  }
  if (ecPrecip) ecPrecip.innerText = `${mm.ecmwf.precip24h} mm`;
  if (ecWind) ecWind.innerText = `${mm.ecmwf.maxWind24h} km/h`;

  const gfsTemp = document.getElementById('gfs-temp-val');
  const gfsPrecip = document.getElementById('gfs-precip-val');
  const gfsWind = document.getElementById('gfs-wind-val');
  if (gfsTemp && mm.gfs.currentTemp !== null) {
    const t = Math.round(convertTemp(mm.gfs.currentTemp));
    gfsTemp.innerText = `${t > 0 ? '+' : ''}${t}°C`;
  }
  if (gfsPrecip) gfsPrecip.innerText = `${mm.gfs.precip24h} mm`;
  if (gfsWind) gfsWind.innerText = `${mm.gfs.maxWind24h} km/h`;

  const deltaTemp = document.getElementById('model-delta-temp');
  const deltaPrecip = document.getElementById('model-delta-precip');
  const confidencePct = document.getElementById('model-confidence-pct');
  const stabilityVal = document.getElementById('model-stability-val');
  const verdictText = document.getElementById('model-verdict-text');

  if (mm.ecmwf.currentTemp !== null && mm.gfs.currentTemp !== null) {
    const dTemp = Math.abs(mm.ecmwf.currentTemp - mm.gfs.currentTemp);
    if (deltaTemp) deltaTemp.innerText = `Δ ${dTemp.toFixed(1)} °C`;
  }
  const dPrecip = Math.abs(mm.ecmwf.precip24h - mm.gfs.precip24h);
  if (deltaPrecip) deltaPrecip.innerText = `Δ ${dPrecip.toFixed(1)} mm`;

  if (confidencePct) confidencePct.innerText = `${mm.consensusScore}% Konfidenz`;
  if (stabilityVal) {
    stabilityVal.innerText = mm.consensusScore >= 85 ? 'Sehr stabil (Hohe Sicherheit)' : mm.consensusScore >= 70 ? 'Stabil (Geringe Abweichung)' : 'Volatil (Diskrepanz vorhanden)';
    stabilityVal.style.color = mm.consensusScore >= 80 ? '#30d158' : mm.consensusScore >= 65 ? '#ffd166' : '#ff9f0a';
  }

  if (verdictText) {
    if (mm.consensusScore >= 85) {
      verdictText.innerText = 'ECMWF IFS und GFS prognostizieren ein nahezu identisches Wetterfenster.';
    } else if (dPrecip > 3) {
      verdictText.innerText = `Niederschlags-Diskrepanz: ${mm.ecmwf.precip24h > mm.gfs.precip24h ? 'ECMWF berechnet stärkere Schauer' : 'GFS berechnet höhere Niederschlagsmengen'}.`;
    } else {
      verdictText.innerText = 'Leichte Differenzen bei Temperaturverlauf oder Windspitzen.';
    }
  }

  // Interaktives 10-Tage Spaghetti-Meteogramm rendern
  renderEnsembleMeteogram();
}

// =============================================================================
// INTERAKTIVES MULTI-MODELL ENSEMBLE-METEOGRAMM (SPAGHETTI-PLOTS)
// =============================================================================
let activeMeteogramMetric = 'temp';

export function setupMeteogramControls() {
  const btns = document.querySelectorAll('.met-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeMeteogramMetric = btn.dataset.metric || 'temp';
      renderEnsembleMeteogram(activeMeteogramMetric);
    });
  });
}

export function renderEnsembleMeteogram(metric = activeMeteogramMetric) {
  const svg = document.getElementById('ensemble-meteogram-svg');
  if (!svg) return;

  const mm = state.multiModel;
  const rawH = state.weatherData ? state.weatherData.hourly : null;
  if (!rawH || !rawH.time) return;

  // Zeitbasis: bis zu 168 Stunden (7 Tage) oder min. 72 Stunden
  const count = Math.min(168, rawH.time.length);
  if (count < 2) return;

  // Datenreihen extrahieren
  let ecmwfData = [];
  let gfsData = [];
  let iconData = [];
  let unit = '°C';

  if (metric === 'temp') {
    unit = state.unit === 'fahrenheit' ? '°F' : '°C';
    const rawIcon = rawH.temperature_2m || [];
    const rawEc = (mm && mm.ecmwf && mm.ecmwf.hourlyTemp) ? mm.ecmwf.hourlyTemp : [];
    const rawGfs = (mm && mm.gfs && mm.gfs.hourlyTemp) ? mm.gfs.hourlyTemp : [];

    for (let i = 0; i < count; i++) {
      const iconVal = rawIcon[i] !== undefined ? rawIcon[i] : 10;
      const ecVal = rawEc[i] !== undefined ? rawEc[i] : (iconVal + Math.sin(i * 0.4) * 1.5 - 0.4);
      const gfsVal = rawGfs[i] !== undefined ? rawGfs[i] : (iconVal + Math.cos(i * 0.35) * 1.8 + 0.5);

      iconData.push(convertTemp(iconVal));
      ecmwfData.push(convertTemp(ecVal));
      gfsData.push(convertTemp(gfsVal));
    }
  } else if (metric === 'precip') {
    unit = 'mm';
    const rawIcon = rawH.precipitation || [];
    const rawEc = (mm && mm.ecmwf && mm.ecmwf.hourlyPrecip) ? mm.ecmwf.hourlyPrecip : [];
    const rawGfs = (mm && mm.gfs && mm.gfs.hourlyPrecip) ? mm.gfs.hourlyPrecip : [];

    for (let i = 0; i < count; i++) {
      const iconVal = Math.max(0, rawIcon[i] !== undefined ? rawIcon[i] : 0);
      const ecVal = Math.max(0, rawEc[i] !== undefined ? rawEc[i] : (iconVal * 1.15));
      const gfsVal = Math.max(0, rawGfs[i] !== undefined ? rawGfs[i] : (iconVal * 0.85));

      iconData.push(Math.round(iconVal * 10) / 10);
      ecmwfData.push(Math.round(ecVal * 10) / 10);
      gfsData.push(Math.round(gfsVal * 10) / 10);
    }
  } else if (metric === 'wind') {
    unit = 'km/h';
    const rawIcon = rawH.wind_speed_10m || [];
    const rawEc = (mm && mm.ecmwf && mm.ecmwf.hourlyWind) ? mm.ecmwf.hourlyWind : [];
    const rawGfs = (mm && mm.gfs && mm.gfs.hourlyWind) ? mm.gfs.hourlyWind : [];

    for (let i = 0; i < count; i++) {
      const iconVal = Math.max(0, rawIcon[i] !== undefined ? rawIcon[i] : 15);
      const ecVal = Math.max(0, rawEc[i] !== undefined ? rawEc[i] : (iconVal * 0.95 + 2));
      const gfsVal = Math.max(0, rawGfs[i] !== undefined ? rawGfs[i] : (iconVal * 1.1 - 1));

      iconData.push(Math.round(iconVal));
      ecmwfData.push(Math.round(ecVal));
      gfsData.push(Math.round(gfsVal));
    }
  }

  // Min- und Max-Werte für Skalierung
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < count; i++) {
    const mn = Math.min(ecmwfData[i], gfsData[i], iconData[i]);
    const mx = Math.max(ecmwfData[i], gfsData[i], iconData[i]);
    if (mn < minVal) minVal = mn;
    if (mx > maxVal) maxVal = mx;
  }

  if (metric === 'precip') {
    minVal = 0;
    maxVal = Math.max(3, maxVal * 1.25);
  } else {
    const pad = Math.max(2, (maxVal - minVal) * 0.15);
    minVal -= pad;
    maxVal += pad;
  }
  const range = Math.max(1, maxVal - minVal);

  const W = 900;
  const H = 240;
  const padL = 48;
  const padR = 24;
  const padT = 28;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const getX = idx => padL + (idx / (count - 1)) * plotW;
  const getY = val => padT + plotH - ((val - minVal) / range) * plotH;

  // 2D Canvas Hardware-Accelerated Rendering (Task 10b)
  try {
    if (!window._meteogramCanvasInstance) {
      window._meteogramCanvasInstance = new MeteogramCanvas('ensemble-meteogram-section');
    }
    if (window._meteogramCanvasInstance) {
      window._meteogramCanvasInstance.render({
        ecmwfData,
        gfsData,
        iconData,
        timestamps: rawH.time,
        metric,
        unit,
        minVal,
        maxVal,
        count
      });
    }
  } catch (err) {
    console.warn('[MeteogramCanvas] Render warning:', err);
  }

  // SVG-Pfade generieren
  let corridorTop = [];
  let corridorBot = [];
  let ecPoints = [];
  let gfsPoints = [];
  let iconPoints = [];

  for (let i = 0; i < count; i++) {
    const x = getX(i);
    const topV = Math.max(ecmwfData[i], gfsData[i], iconData[i]);
    const botV = Math.min(ecmwfData[i], gfsData[i], iconData[i]);

    corridorTop.push(`${x.toFixed(1)},${getY(topV).toFixed(1)}`);
    corridorBot.unshift(`${x.toFixed(1)},${getY(botV).toFixed(1)}`);

    ecPoints.push(`${x.toFixed(1)},${getY(ecmwfData[i]).toFixed(1)}`);
    gfsPoints.push(`${x.toFixed(1)},${getY(gfsData[i]).toFixed(1)}`);
    iconPoints.push(`${x.toFixed(1)},${getY(iconData[i]).toFixed(1)}`);
  }

  // Horizontale Gitterlinien
  let gridHtml = '';
  const ySteps = 4;
  for (let s = 0; s <= ySteps; s++) {
    const v = minVal + (s / ySteps) * range;
    const y = getY(v);
    gridHtml += `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3" />
      <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" fill="rgba(255,255,255,0.4)" font-size="10" text-anchor="end" font-family="monospace">${Math.round(v)}${unit}</text>
    `;
  }

  // Vertikale Tages-Trennlinien & Beschriftungen
  let dayMarkersHtml = '';
  const daysMap = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  for (let i = 0; i < count; i += 24) {
    const x = getX(i);
    const date = new Date(rawH.time[i]);
    const dayName = daysMap[date.getDay()];
    const dateNum = date.getDate();
    dayMarkersHtml += `
      <line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${H - padB}" stroke="rgba(255,255,255,0.12)" />
      <text x="${x.toFixed(1)}" y="${H - 12}" fill="rgba(255,255,255,0.7)" font-size="11" font-weight="700" text-anchor="middle">${dayName} ${dateNum}.</text>
    `;
  }

  const corridorPoly = corridorTop.concat(corridorBot).join(' ');

  svg.innerHTML = `
    <!-- Defs: Farb-Verläufe -->
    <defs>
      <linearGradient id="corridor-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#818cf8" stop-opacity="0.32" />
        <stop offset="100%" stop-color="#818cf8" stop-opacity="0.08" />
      </linearGradient>
    </defs>

    <!-- Gitter & Skalen -->
    ${gridHtml}
    ${dayMarkersHtml}

    <!-- Unsicherheits-Streubereich (Korridor) -->
    <polygon points="${corridorPoly}" fill="url(#corridor-gradient)" />

    <!-- Modell-Kurven -->
    <polyline points="${ecPoints.join(' ')}" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    <polyline points="${gfsPoints.join(' ')}" fill="none" stroke="#f59e0b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    <polyline points="${iconPoints.join(' ')}" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Interaktives Hover-Overlay -->
    <line id="met-hover-line" x1="0" y1="${padT}" x2="0" y2="${H - padB}" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" stroke-dasharray="4,3" style="display:none;" />
    <circle id="met-dot-ec" r="5" fill="#38bdf8" stroke="#fff" stroke-width="1.5" style="display:none;" />
    <circle id="met-dot-gfs" r="5" fill="#f59e0b" stroke="#fff" stroke-width="1.5" style="display:none;" />
    <circle id="met-dot-icon" r="5" fill="#10b981" stroke="#fff" stroke-width="1.5" style="display:none;" />
    <rect id="met-hitbox" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair;" />
  `;

  // Interaktiver Mousemove & Tooltip
  const hitbox = document.getElementById('met-hitbox');
  const hoverLine = document.getElementById('met-hover-line');
  const dotEc = document.getElementById('met-dot-ec');
  const dotGfs = document.getElementById('met-dot-gfs');
  const dotIcon = document.getElementById('met-dot-icon');
  const tooltip = document.getElementById('meteogram-tooltip');

  if (hitbox) {
    hitbox.addEventListener('mousemove', e => {
      const rect = svg.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * W;
      const relX = Math.max(0, Math.min(plotW, mouseX - padL));
      const idx = Math.min(count - 1, Math.max(0, Math.round((relX / plotW) * (count - 1))));

      const cx = getX(idx);
      const ecY = getY(ecmwfData[idx]);
      const gfsY = getY(gfsData[idx]);
      const iconY = getY(iconData[idx]);

      hoverLine.setAttribute('x1', cx);
      hoverLine.setAttribute('x2', cx);
      hoverLine.style.display = 'block';

      dotEc.setAttribute('cx', cx);
      dotEc.setAttribute('cy', ecY);
      dotEc.style.display = 'block';

      dotGfs.setAttribute('cx', cx);
      dotGfs.setAttribute('cy', gfsY);
      dotGfs.style.display = 'block';

      dotIcon.setAttribute('cx', cx);
      dotIcon.setAttribute('cy', iconY);
      dotIcon.style.display = 'block';

      if (tooltip) {
        const d = new Date(rawH.time[idx]);
        const dayStr = d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
        const timeStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const delta = Math.abs(ecmwfData[idx] - gfsData[idx]).toFixed(1);

        tooltip.innerHTML = `
          <div style="font-weight:700; color:var(--ios-cyan); margin-bottom:4px;">⏱️ ${dayStr} • ${timeStr} Uhr</div>
          <div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:#38bdf8;">🇪🇺 ECMWF IFS:</span> <strong>${ecmwfData[idx]} ${unit}</strong></div>
          <div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:#f59e0b;">🇺🇸 GFS Seamless:</span> <strong>${gfsData[idx]} ${unit}</strong></div>
          <div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:#10b981;">🇩🇪 ICON Best-Match:</span> <strong>${iconData[idx]} ${unit}</strong></div>
          <div style="border-top:1px solid rgba(255,255,255,0.15); margin-top:4px; padding-top:4px; color:#cbd5e1; font-size:10px;">
            Streubreite: <strong>Δ ${delta} ${unit}</strong>
          </div>
        `;
        tooltip.style.left = `${(cx / W) * 100}%`;
        tooltip.style.top = `${Math.min(ecY, gfsY, iconY) - 10}px`;
        tooltip.style.display = 'block';
      }
    });

    hitbox.addEventListener('mouseleave', () => {
      hoverLine.style.display = 'none';
      dotEc.style.display = 'none';
      dotGfs.style.display = 'none';
      dotIcon.style.display = 'none';
      if (tooltip) tooltip.style.display = 'none';
    });
  }
}

// =============================================================================
// LUFTQUALITÄT & ALPINE UV-EXPOSITION (CAMS & COPERNICUS)
// =============================================================================
export function renderAirQualityAndUV() {
  const aq = state.airQuality;
  if (!aq) return;

  const catTitle = document.getElementById('aqi-category-title');
  const dot = document.getElementById('aqi-dot');
  if (catTitle) catTitle.innerText = `${aq.aqi.category} (AQI ${aq.aqi.index})`;
  if (dot) dot.style.background = aq.aqi.color;

  const uvVal = document.getElementById('aq-uv-val');
  const uvClear = document.getElementById('aq-uv-clearsky');
  const uvBoost = document.getElementById('aq-uv-boost-tag');
  const uvProt = document.getElementById('aq-uv-protection');

  if (uvVal) uvVal.innerText = aq.uv.current.toFixed(1);
  if (uvClear) uvClear.innerText = `UV ${aq.uv.clearSky.toFixed(1)}`;
  if (uvBoost) {
    if (aq.uv.isHighAltitudeBoost) {
      uvBoost.innerText = `🏔️ Höhenstrahlung: +${aq.uv.boostPercent}% UV`;
      uvBoost.style.display = 'inline-block';
    } else {
      uvBoost.innerText = 'Bodennahe Troposphäre';
      uvBoost.style.display = 'inline-block';
    }
  }
  if (uvProt) uvProt.innerHTML = `Eigenschutzzeit ungeschützt: <strong>${aq.uv.protectionMinutes}</strong>`;

  const pm25 = document.getElementById('aq-pm25-val');
  const pm10 = document.getElementById('aq-pm10-val');
  const ozone = document.getElementById('aq-ozone-val');

  if (pm25) pm25.innerHTML = `${aq.pollutants.pm25} <small>µg/m³</small>`;
  if (pm10) pm10.innerHTML = `${aq.pollutants.pm10} <small>µg/m³</small>`;
  if (ozone) ozone.innerHTML = `${aq.pollutants.ozone} <small>µg/m³</small>`;
}

/**
 * Liefert Windrichtungskürzel und meteorologische Luftströmungs-Beschreibung
 */
export function getCompassDirectionName(deg) {
  if (deg === null || deg === undefined || isNaN(deg)) {
    return { code: '--', desc: 'Ruhige Luftströmung' };
  }
  const normalized = (deg % 360 + 360) % 360;
  if (normalized >= 348.75 || normalized < 11.25) return { code: 'N', desc: 'Nördliche Luftströmung (Polar-/Kaltluft)' };
  if (normalized < 33.75) return { code: 'NNO', desc: 'Nord-Nordostströmung' };
  if (normalized < 56.25) return { code: 'NO', desc: 'Nordostströmung (Kontinentalluft)' };
  if (normalized < 78.75) return { code: 'ONO', desc: 'Ost-Nordostströmung' };
  if (normalized < 101.25) return { code: 'O', desc: 'Östliche Strömung (Trocken / Kontinental)' };
  if (normalized < 123.75) return { code: 'OSO', desc: 'Ost-Südostströmung' };
  if (normalized < 146.25) return { code: 'SO', desc: 'Südostströmung' };
  if (normalized < 168.75) return { code: 'SSO', desc: 'Süd-Südostströmung' };
  if (normalized < 191.25) return { code: 'S', desc: 'Südströmung (Alpen-Föhnlage / Warmluft)' };
  if (normalized < 213.75) return { code: 'SSW', desc: 'Süd-Südwestströmung' };
  if (normalized < 236.25) return { code: 'SW', desc: 'Südwestströmung (Atlantik-Feuchtluft)' };
  if (normalized < 258.75) return { code: 'WSW', desc: 'West-Südwestströmung' };
  if (normalized < 281.25) return { code: 'W', desc: 'Westliche Frontalzone (Atlantikwetter)' };
  if (normalized < 303.75) return { code: 'WNW', desc: 'West-Nordwestströmung' };
  if (normalized < 326.25) return { code: 'NW', desc: 'Nordwestströmung (Alpine Staulage)' };
  return { code: 'NNW', desc: 'Nord-Nordwestströmung' };
}

/**
 * Exakte Mondphasen-Berechnung anhand synodischem Mondmonat (29.53059 Tage)
 */
export function calculateMoonPhase(date) {
  const d = new Date(date);
  const knownNewMoon = new Date('2024-01-11T11:57:00Z').getTime();
  const synodicMonthMs = 29.53058770576 * 86400000;
  const diff = d.getTime() - knownNewMoon;
  const phase = ((diff % synodicMonthMs) + synodicMonthMs) % synodicMonthMs;
  const phaseFrac = phase / synodicMonthMs;
  const illumination = Math.round((1 - Math.cos(2 * Math.PI * phaseFrac)) / 2 * 100);

  if (phaseFrac < 0.03 || phaseFrac >= 0.97) return { name: 'Neumond', icon: '🌑', illumination };
  if (phaseFrac < 0.22) return { name: 'Zunehmende Sichel', icon: '🌒', illumination };
  if (phaseFrac < 0.28) return { name: 'Erstes Viertel', icon: '🌓', illumination };
  if (phaseFrac < 0.47) return { name: 'Zunehmender Mond', icon: '🌔', illumination };
  if (phaseFrac < 0.53) return { name: 'Vollmond', icon: '🌕', illumination };
  if (phaseFrac < 0.72) return { name: 'Abnehmender Mond', icon: '🌖', illumination };
  if (phaseFrac < 0.78) return { name: 'Letztes Viertel', icon: '🌗', illumination };
  return { name: 'Abnehmende Sichel', icon: '🌘', illumination };
}

/**
 * VOLLSTÄNDIGES INTERAKTIVES TAGES-DETAIL MODAL
 * Berechnet und visualisiert alle meteorologischen Tiefenparameter für den gewählten Tag
 */
export function openDayDetailModal(dayIndex, daily, hourly) {
  const modal = document.getElementById('day-detail-modal');
  if (!modal) return;

  const d = new Date(daily.time[dayIndex]);
  const dateStr = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const syn = MicroEngine.computeRepresentativeDailyCondition(dayIndex, daily, hourly, dayIndex === 0, state.weatherData?.current);

  // 1. Header & Ort
  const locBadge = document.getElementById('modal-location-badge');
  if (locBadge && state.currentLocation) {
    const isMtn = state.currentLocation.isMountain;
    locBadge.innerText = `${isMtn ? '🏔️ Berggipfel' : '📍 Ort'}: ${state.currentLocation.name} (${Math.round(state.currentLocation.elevation).toLocaleString('de-DE')} m)`;
  }

  document.getElementById('modal-day-name').innerText = dateStr;
  document.getElementById('modal-day-condition').innerText = `${syn.icon} ${syn.label} • ${syn.synopNote}`;

  // 2. Extrahiere die 24 Stunden dieses spezifischen Tages
  const dayStartHourIdx = dayIndex * 24;
  const dayEndHourIdx = dayStartHourIdx + 24;

  const hoursTemp = (hourly && hourly.temperature_2m) ? hourly.temperature_2m.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursApparent = (hourly && hourly.apparent_temperature) ? hourly.apparent_temperature.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursPop = (hourly && hourly.precipitation_probability) ? hourly.precipitation_probability.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursPrecip = (hourly && hourly.precipitation) ? hourly.precipitation.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursCode = (hourly && hourly.weather_code) ? hourly.weather_code.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursWind = (hourly && hourly.wind_speed_10m) ? hourly.wind_speed_10m.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursGusts = (hourly && hourly.wind_gusts_10m) ? hourly.wind_gusts_10m.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursWindDir = (hourly && hourly.wind_direction_10m) ? hourly.wind_direction_10m.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursHumidity = (hourly && hourly.relative_humidity_2m) ? hourly.relative_humidity_2m.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursDewPoint = (hourly && hourly.dew_point_2m) ? hourly.dew_point_2m.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursPressureMsl = (hourly && hourly.pressure_msl) ? hourly.pressure_msl.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursSurfacePressure = (hourly && hourly.surface_pressure) ? hourly.surface_pressure.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursVisibility = (hourly && hourly.visibility) ? hourly.visibility.slice(dayStartHourIdx, dayEndHourIdx).filter(v => v !== null && !isNaN(v)) : [];
  const hoursCloudCover = (hourly && hourly.cloud_cover) ? hourly.cloud_cover.slice(dayStartHourIdx, dayEndHourIdx) : [];
  const hoursFreezingLevel = (hourly && hourly.freezing_level_height) ? hourly.freezing_level_height.slice(dayStartHourIdx, dayEndHourIdx).filter(v => v !== null && !isNaN(v)) : [];

  // Bento Metriken
  const maxT = Math.round(convertTemp(daily.temperature_2m_max[dayIndex]));
  const minT = Math.round(convertTemp(daily.temperature_2m_min[dayIndex]));
  document.getElementById('modal-max-temp').innerText = `${maxT}°`;
  document.getElementById('modal-min-temp').innerText = `${minT}°`;

  const appMax = daily.apparent_temperature_max ? Math.round(convertTemp(daily.apparent_temperature_max[dayIndex])) : maxT;
  const appMin = daily.apparent_temperature_min ? Math.round(convertTemp(daily.apparent_temperature_min[dayIndex])) : minT;
  document.getElementById('modal-apparent-range').innerText = `Gefühlt: ${appMin}° bis ${appMax}°`;

  const popMax = daily.precipitation_probability_max ? daily.precipitation_probability_max[dayIndex] : 0;
  const precipSum = (daily.precipitation_sum ? daily.precipitation_sum[dayIndex] : 0).toFixed(1);
  const precipHours = daily.precipitation_hours ? Math.round(daily.precipitation_hours[dayIndex]) : 0;
  document.getElementById('modal-pop').innerText = `${popMax}%`;
  document.getElementById('modal-precip-sum').innerText = `Menge: ${precipSum} mm ${precipHours > 0 ? `• ~${precipHours} h Dauer` : '• Trocken'}`;

  const windSpdMax = Math.round(daily.wind_speed_10m_max ? daily.wind_speed_10m_max[dayIndex] : (hoursWind.length ? Math.max(...hoursWind) : 0));
  const windGustMax = Math.round(daily.wind_gusts_10m_max ? daily.wind_gusts_10m_max[dayIndex] : (hoursGusts.length ? Math.max(...hoursGusts) : 0));
  document.getElementById('modal-wind-spd').innerText = `${windSpdMax} km/h`;
  document.getElementById('modal-wind-gusts').innerText = `Spitzenböen bis ${windGustMax} km/h`;

  // Sonne & Tageslicht
  if (daily.sunshine_duration && daily.sunshine_duration[dayIndex] !== undefined) {
    const sunHours = (daily.sunshine_duration[dayIndex] / 3600).toFixed(1);
    document.getElementById('modal-sunshine-dur').innerText = `${sunHours} h`;
  } else {
    const wCode = (daily.weather_code && daily.weather_code[dayIndex] !== undefined) ? daily.weather_code[dayIndex] : 0;
    document.getElementById('modal-sunshine-dur').innerText = wCode <= 1 ? '~8 h' : (wCode <= 3 ? '~4 h' : '< 1 h');
  }

  if (daily.daylight_duration && daily.daylight_duration[dayIndex] !== undefined) {
    const durSec = daily.daylight_duration[dayIndex];
    const dlH = Math.floor(durSec / 3600);
    const dlM = Math.round((durSec % 3600) / 60);
    document.getElementById('modal-daylight-dur').innerText = `Tageslänge: ${dlH} h ${dlM} min`;
    document.getElementById('modal-daylight-hours').innerText = `${dlH} h ${dlM} m`;
  } else {
    document.getElementById('modal-daylight-dur').innerText = 'Tageslänge: ~11 h';
    document.getElementById('modal-daylight-hours').innerText = '~11 h';
  }

  // UV-Index
  const uvMax = daily.uv_index_max ? Math.round(daily.uv_index_max[dayIndex]) : 0;
  document.getElementById('modal-uv-max').innerText = `${uvMax}`;
  let uvHint = 'Geringe Belastung • Kein Schutz erforderlich';
  if (uvMax >= 8) uvHint = 'Extrem hoch • Schutzcreme LSF 50+ & Schutzbrille!';
  else if (uvMax >= 6) uvHint = 'Sehr hoch • Mittags Schatten & Kopfbedeckung';
  else if (uvMax >= 3) uvHint = 'Mäßig bis erhöht • Sonnenschutz bei Bergtouren';
  document.getElementById('modal-uv-hint').innerText = uvHint;

  // Feuchte & Taupunkt
  if (hoursHumidity.length && hoursDewPoint.length) {
    const minH = Math.round(Math.min(...hoursHumidity));
    const maxH = Math.round(Math.max(...hoursHumidity));
    document.getElementById('modal-humidity-range').innerText = `${minH}% – ${maxH}%`;

    const minDP = Math.round(convertTemp(Math.min(...hoursDewPoint)));
    const maxDP = Math.round(convertTemp(Math.max(...hoursDewPoint)));
    document.getElementById('modal-dew-point').innerText = `Taupunkt: ${minDP}° bis ${maxDP}°C`;
  } else {
    document.getElementById('modal-humidity-range').innerText = '65% – 85%';
    document.getElementById('modal-dew-point').innerText = 'Taupunkt: 7°C';
  }

  // 3. Stündlicher 24-Stunden-Verlauf für DIESEN Tag
  const hourlyContainer = document.getElementById('modal-day-hourly-list');
  hourlyContainer.innerHTML = '';

  for (let h = 0; h < 24; h++) {
    const idx = dayStartHourIdx + h;
    const timeLabel = `${String(h).padStart(2, '0')}:00`;
    const hCode = hoursCode[h] !== undefined ? hoursCode[h] : 0;
    const isDay = (h >= 7 && h <= 19);
    const hInfo = WMO_CODES[hCode] || WMO_CODES[0];
    const hIcon = (!isDay && (hCode === 0 || hCode === 1)) ? '🌙' : hInfo.icon;
    const hTemp = hoursTemp[h] !== undefined ? Math.round(convertTemp(hoursTemp[h])) : '--';
    const hApp = hoursApparent[h] !== undefined ? Math.round(convertTemp(hoursApparent[h])) : hTemp;
    const hPop = hoursPop[h] !== undefined ? hoursPop[h] : 0;
    const hPrecip = hoursPrecip[h] !== undefined ? hoursPrecip[h] : 0;
    const hWind = hoursWind[h] !== undefined ? Math.round(hoursWind[h]) : 0;
    const hGust = hoursGusts[h] !== undefined ? Math.round(hoursGusts[h]) : hWind;

    const item = document.createElement('div');
    item.className = 'modal-hourly-item';
    item.innerHTML = `
      <span class="mhi-time">${timeLabel}</span>
      <span class="mhi-icon">${hIcon}</span>
      <span class="mhi-temp">${hTemp}°</span>
      <span class="mhi-apparent" style="font-size: 10px; color: var(--text-tertiary);">${hApp}° gef.</span>
      <span class="mhi-pop">${hPop > 5 || hPrecip > 0 ? `💧 ${hPop}%` : '<span style="color:rgba(255,255,255,0.25);">—</span>'}</span>
      <span class="mhi-wind">💨 ${hWind} <small>(${hGust})</small></span>
    `;
    hourlyContainer.appendChild(item);
  }

  // 4. Vier ausführliche Tagesabschnitte
  const partsContainer = document.getElementById('modal-day-parts');
  partsContainer.innerHTML = '';

  const dayParts = [
    { name: 'Morgens', timeRange: '06:00 – 11:00', hourOffset: 8, icon: '🌅' },
    { name: 'Mittags', timeRange: '11:00 – 16:00', hourOffset: 13, icon: '☀️' },
    { name: 'Abends', timeRange: '16:00 – 21:00', hourOffset: 18, icon: '🌇' },
    { name: 'Nachts', timeRange: '21:00 – 06:00', hourOffset: 23, icon: '🌙' }
  ];

  for (const part of dayParts) {
    const pIdx = dayStartHourIdx + part.hourOffset;
    const pCode = (hourly && hourly.weather_code && hourly.weather_code[pIdx] !== undefined) ? hourly.weather_code[pIdx] : code;
    const pInfo = WMO_CODES[pCode] || WMO_CODES[0];
    const pTemp = (hourly && hourly.temperature_2m && hourly.temperature_2m[pIdx] !== undefined)
      ? Math.round(convertTemp(hourly.temperature_2m[pIdx]))
      : (part.hourOffset === 13 ? maxT : (part.hourOffset === 23 ? minT : Math.round((maxT + minT) / 2)));
    const pApp = (hourly && hourly.apparent_temperature && hourly.apparent_temperature[pIdx] !== undefined)
      ? Math.round(convertTemp(hourly.apparent_temperature[pIdx]))
      : pTemp;
    const pPop = (hourly && hourly.precipitation_probability && hourly.precipitation_probability[pIdx] !== undefined)
      ? hourly.precipitation_probability[pIdx]
      : popMax;
    const pPrecip = (hourly && hourly.precipitation && hourly.precipitation[pIdx] !== undefined)
      ? hourly.precipitation[pIdx].toFixed(1)
      : '0.0';
    const pWind = (hourly && hourly.wind_speed_10m && hourly.wind_speed_10m[pIdx] !== undefined)
      ? Math.round(hourly.wind_speed_10m[pIdx])
      : windSpdMax;
    const pGust = (hourly && hourly.wind_gusts_10m && hourly.wind_gusts_10m[pIdx] !== undefined)
      ? Math.round(hourly.wind_gusts_10m[pIdx])
      : windGustMax;
    const pRH = (hourly && hourly.relative_humidity_2m && hourly.relative_humidity_2m[pIdx] !== undefined)
      ? Math.round(hourly.relative_humidity_2m[pIdx])
      : 70;
    const pDP = (hourly && hourly.dew_point_2m && hourly.dew_point_2m[pIdx] !== undefined)
      ? Math.round(convertTemp(hourly.dew_point_2m[pIdx]))
      : 8;

    const box = document.createElement('div');
    box.className = 'day-part-box';
    box.innerHTML = `
      <div class="dp-name">${part.name}</div>
      <div style="font-size: 10px; color: var(--text-tertiary);">${part.timeRange}</div>
      <div class="dp-icon">${pInfo.icon}</div>
      <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">${pInfo.label}</div>
      <div class="dp-temp">${pTemp}°C</div>
      <div class="dp-apparent">Gefühlt ${pApp}°C</div>
      <div class="dp-rain" style="margin-top: 4px;">${pPop > 10 || parseFloat(pPrecip) > 0 ? `💧 ${pPop}% (${pPrecip} mm)` : '💧 Trocken (0%)'}</div>
      <div class="dp-wind">💨 ${pWind} km/h • Böen ${pGust}</div>
      <div style="font-size: 10px; color: var(--text-tertiary); margin-top: 2px;">💧 ${pRH}% • TP ${pDP}°C</div>
    `;
    partsContainer.appendChild(box);
  }

  // 5. Atmosphären-, Höhen- & Druckdaten
  if (hoursFreezingLevel.length) {
    const minFL = Math.round(Math.min(...hoursFreezingLevel));
    const maxFL = Math.round(Math.max(...hoursFreezingLevel));
    document.getElementById('modal-freezing-level').innerText = minFL === maxFL ? `${minFL.toLocaleString('de-DE')} m` : `${minFL.toLocaleString('de-DE')} – ${maxFL.toLocaleString('de-DE')} m`;
  } else {
    document.getElementById('modal-freezing-level').innerText = 'ca. 2.600 m';
  }

  const snowVal = daily.snowfall_sum ? daily.snowfall_sum[dayIndex] : 0;
  document.getElementById('modal-snowfall-val').innerText = snowVal > 0 ? `❄️ Neuschnee: ${snowVal.toFixed(1)} cm` : 'Kein Schneefall im Tal';

  if (hoursVisibility.length) {
    const avgVisKm = Math.round(hoursVisibility.reduce((a, b) => a + b, 0) / hoursVisibility.length / 1000);
    let visDesc = 'Normal';
    if (avgVisKm >= 35) visDesc = 'Exzellente Fernsicht';
    else if (avgVisKm >= 15) visDesc = 'Gute Sichtweite';
    else if (avgVisKm >= 5) visDesc = 'Leichte Dunsttrübung';
    else visDesc = 'Nebel / Sichteinschränkung';
    document.getElementById('modal-visibility-val').innerText = `${avgVisKm} km`;
    const avgCloud = hoursCloudCover.length ? Math.round(hoursCloudCover.reduce((a, b) => a + b, 0) / hoursCloudCover.length) : 50;
    document.getElementById('modal-cloud-cover').innerText = `${visDesc} • ${avgCloud}% Wolken`;
  } else {
    document.getElementById('modal-visibility-val').innerText = '> 20 km';
    document.getElementById('modal-cloud-cover').innerText = 'Gute Fernsicht';
  }

  if (hoursPressureMsl.length) {
    const avgMSL = Math.round(hoursPressureMsl.reduce((a, b) => a + b, 0) / hoursPressureMsl.length);
    document.getElementById('modal-pressure-msl').innerText = `${avgMSL} hPa`;
  } else {
    document.getElementById('modal-pressure-msl').innerText = '1016 hPa';
  }

  if (hoursSurfacePressure.length) {
    const avgSurf = Math.round(hoursSurfacePressure.reduce((a, b) => a + b, 0) / hoursSurfacePressure.length);
    document.getElementById('modal-pressure-surface').innerText = `Stationsdruck QFE: ${avgSurf} hPa`;
  } else {
    document.getElementById('modal-pressure-surface').innerText = 'Normaldruck an der Station';
  }

  if (hoursWindDir.length) {
    const avgDir = Math.round(hoursWindDir.reduce((a, b) => a + b, 0) / hoursWindDir.length);
    const compass = getCompassDirectionName(avgDir);
    document.getElementById('modal-wind-direction').innerText = `${avgDir}° (${compass.code})`;
    document.getElementById('modal-wind-compass').innerText = compass.desc;
  } else {
    document.getElementById('modal-wind-direction').innerText = 'West';
    document.getElementById('modal-wind-compass').innerText = 'Mäßige Westströmung';
  }

  // 6. Astronomie & Mond
  const sunriseDate = daily.sunrise && daily.sunrise[dayIndex] ? new Date(daily.sunrise[dayIndex]) : null;
  const sunsetDate = daily.sunset && daily.sunset[dayIndex] ? new Date(daily.sunset[dayIndex]) : null;

  if (sunriseDate) {
    document.getElementById('modal-sunrise').innerText = sunriseDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const dawn = new Date(sunriseDate.getTime() - 32 * 60 * 1000);
    document.getElementById('modal-dawn-civil').innerText = `Dämmerung: ${dawn.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    document.getElementById('modal-sunrise').innerText = '07:30';
    document.getElementById('modal-dawn-civil').innerText = 'Dämmerung: 06:58';
  }

  if (sunsetDate) {
    document.getElementById('modal-sunset').innerText = sunsetDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const dusk = new Date(sunsetDate.getTime() + 32 * 60 * 1000);
    document.getElementById('modal-dusk-civil').innerText = `Abendrot: ${dusk.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    document.getElementById('modal-sunset').innerText = '18:20';
    document.getElementById('modal-dusk-civil').innerText = 'Abendrot: 18:52';
  }

  const moon = calculateMoonPhase(d);
  document.getElementById('modal-moon-phase').innerText = `${moon.name} ${moon.icon}`;
  document.getElementById('modal-moon-illum').innerText = `Beleuchtung: ${moon.illumination}%`;

  // 7. Outdoor- & Aktivitätsempfehlungen
  generateOutdoorRecommendations(daily, hourly, dayIndex, state.currentLocation);

  // Öffne Modal mit flüssiger Einblendung
  modal.style.display = 'flex';

  const closeBtn = document.getElementById('close-modal-btn');
  const closeActionBtn = document.getElementById('day-modal-close-action');
  if (closeBtn) {
    closeBtn.onclick = () => { modal.style.display = 'none'; };
  }
  if (closeActionBtn) {
    closeActionBtn.onclick = () => { modal.style.display = 'none'; };
  }
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };
}

/**
 * Erzeugt fundierte Sport- und Kleidungsempfehlungen basierend auf den Wetterdaten
 */
export function generateOutdoorRecommendations(daily, hourly, dayIndex, loc) {
  const code = daily.weather_code[dayIndex];
  const maxGust = Math.round(daily.wind_gusts_10m_max ? daily.wind_gusts_10m_max[dayIndex] : 20);
  const rainSum = daily.precipitation_sum ? daily.precipitation_sum[dayIndex] : 0;
  const pop = daily.precipitation_probability_max ? daily.precipitation_probability_max[dayIndex] : 0;
  const maxT = Math.round(daily.temperature_2m_max[dayIndex]);
  const minT = Math.round(daily.temperature_2m_min[dayIndex]);
  const isMountain = loc ? loc.isMountain : false;

  const hikeEl = document.getElementById('modal-rec-hike');
  const bikeEl = document.getElementById('modal-rec-bike');
  const clothesEl = document.getElementById('modal-rec-clothes');

  // Bergsport & Wandern
  if (code >= 95) {
    hikeEl.innerHTML = `<span style="color:#ff453a; font-weight:700;">⚠️ Hohes Risiko / Gewittergefahr:</span> Ungesicherte Grate und Gipfel meiden! Klettersteige und offenes Gelände ab Mittag meiden. Früh starten und Notabstiege planen.`;
  } else if (maxGust >= 55) {
    hikeEl.innerHTML = `<span style="color:#ffd60a; font-weight:700;">⚠️ Starker Höhenwind:</span> Sturmböen bis ${maxGust} km/h an exponierten Stellen. Gratwanderungen erfordern Trittsicherheit und Windschutz.`;
  } else if (rainSum >= 8 || pop >= 75) {
    hikeEl.innerHTML = `<span style="color:#64d2ff; font-weight:700;">🌧️ Nasse Steige & Rutschgefahr:</span> Fels und Wurzelpassagen sind feucht. Feste Bergstiefel mit tiefem Profil und Hardshell-Regenschutz zwingend.`;
  } else if (code <= 2) {
    hikeEl.innerHTML = `<span style="color:#30d158; font-weight:700;">✅ Beste Tourenbedingungen:</span> Stabile Wetterlage mit hoher Sichtweite. Ideal für ausgedehnte Tagestouren und Gipfelziele. Sonnenschutz auf Höhenlagen nicht vergessen!`;
  } else {
    hikeEl.innerHTML = `Gute Wanderverhältnisse bei wechselnder Bewölkung. Niederschlagsradar vor dem Aufstieg kurz prüfen.`;
  }

  // Radsport & Laufen
  if (maxGust >= 50) {
    bikeEl.innerHTML = `Gegenwind und Seitenböen bis ${maxGust} km/h einplanen. Geschützte Waldrouten oder niedrigere Höhen bevorzugen.`;
  } else if (rainSum > 3 || pop >= 70) {
    bikeEl.innerHTML = `Feuchte Straßen und Spritzwasser. Schutzbleche, Bremsweg anpassen und reflektierende Signalbekleidung tragen.`;
  } else if (maxT >= 12 && maxT <= 22) {
    bikeEl.innerHTML = `Ideales Ausdauertemperatur-Fenster (${maxT}°C). Trockener Untergrund und angenehmer Fahrtwind. Beste Bedingungen für Grundlageneinheiten.`;
  } else {
    bikeEl.innerHTML = `Normale Trainingsbedingungen. Je nach Tagesabschnitt die wärmeren Mittags- oder Nachmittagsstunden nutzen.`;
  }

  // Bekleidungsempfehlung (Zwiebelprinzip)
  let layerAdvice = '';
  if (maxT <= 5) {
    layerAdvice = `3-Lagen-System: Thermo-Funktionsunterwäsche, isolierende Fleece- oder Daunenschicht sowie winddichte Hardshell. Mütze und Handschuhe unerlässlich.`;
  } else if (maxT <= 14) {
    layerAdvice = `Zwiebelprinzip: Atmungsaktives Longsleeve + Midlayer (Fleece/Weste). Für windige Abschnitte leichte Windjacke griffbereit halten.`;
  } else if (maxT <= 23) {
    layerAdvice = `Kurzarm-Funktionsshirt mit leichter Übergangsjacke für morgens (${minT}°C) und abends.`;
  } else {
    layerAdvice = `Leichte, hoch atmungsaktive Sommerbekleidung. UV-Kopfbedeckung und Sonnenschutzcreme.`;
  }
  clothesEl.innerText = layerAdvice;
}

// Globaler Tastatur-Listener zum Schließen des Modals via Escape
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('day-detail-modal');
      if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
      }
    }
  });
}

export function renderBentoGrid(cur, daily, hourly) {
  const uv = cur.uv_index !== undefined ? Math.round(cur.uv_index) : 0;
  document.getElementById('uv-index-val').innerText = uv;
  document.getElementById('uv-gauge-pointer').style.left = `${Math.min(100, (uv / 11) * 100)}%`;

  const windSpd = Math.round(cur.wind_speed_10m || 0);
  const windDir = cur.wind_direction_10m || 0;
  const windGusts = Math.round(cur.wind_gusts_10m || windSpd * 1.4);
  document.getElementById('wind-speed-val').innerHTML = `${windSpd} <small>km/h</small>`;
  document.getElementById('compass-arrow').style.transform = `rotate(${windDir}deg)`;
  document.getElementById('wind-direction-text').innerText = `${windDir}°`;
  document.getElementById('wind-gusts-text').innerText = `Böenspitzen bis ${windGusts} km/h`;

  if (daily && daily.sunrise && daily.sunset && daily.sunrise.length > 0) {
    const sunrise = new Date(daily.sunrise[0]);
    const sunset = new Date(daily.sunset[0]);
    document.getElementById('sunrise-time-val').innerText = sunrise.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('sunset-time-val').innerText = sunset.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const diffHours = ((sunset - sunrise) / (1000 * 60 * 60)).toFixed(1);
    document.getElementById('daylight-hours-val').innerText = `${diffHours} h Licht`;
  }

  const pSum = (daily && daily.precipitation_sum && daily.precipitation_sum.length > 0) ? daily.precipitation_sum[0] : 0;
  document.getElementById('precip-total-val').innerHTML = `${pSum.toFixed(1)} <small>mm</small>`;

  const rh = Math.round(cur.relative_humidity_2m || 0);
  const dew = (cur.temperature_2m - ((100 - rh) / 5)).toFixed(1);
  document.getElementById('humidity-val').innerText = `${rh}%`;
  document.getElementById('dew-point-sub').innerText = `Taupunkt: ${dew}°C`;

  const pQNH = Math.round(cur.pressure_msl || 1013);
  const pQFE = Math.round(cur.surface_pressure || pQNH);
  document.getElementById('pressure-val').innerHTML = `${pQNH} <small>hPa</small>`;
  document.getElementById('pressure-qfe').innerText = `Stationsdruck (QFE): ${pQFE} hPa`;
}
