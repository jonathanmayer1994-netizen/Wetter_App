import { MicroEngine } from '../microEngine.js';
/**
 * BEST WEATHER — Overview Domain Feature Module (Task 1a)
 * Hero header, 24h hourly forecast slider, 10-day trend, Multi-Model comparison,
 * Ensemble meteogram, Bento Grid telemetry, and hazard alerts.
 */

import { state } from '../core/state.js';
import { WMO_CODES } from '../core/constants.js';
import { escapeHtml, getLocalDateKey } from '../httpClient.js';
import { updateFavStarUI } from './favorites.js';
import { AlpineStorage } from '../storage.js';

export function parseLocalDateKey(dateStr) {
  const s = String(dateStr || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function getTodayDailyIndex(daily) {
  const todayKey = getLocalDateKey(new Date());
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) {
    return { idx: 0, todayKey, isExactToday: false, isAllPast: false };
  }
  const exactIdx = daily.time.findIndex(t => String(t).slice(0, 10) === todayKey);
  if (exactIdx >= 0) {
    return { idx: exactIdx, todayKey, isExactToday: true, isAllPast: false };
  }
  const futureIdx = daily.time.findIndex(t => String(t).slice(0, 10) > todayKey);
  if (futureIdx >= 0) {
    return { idx: futureIdx, todayKey, isExactToday: false, isAllPast: false };
  }
  return { idx: daily.time.length - 1, todayKey, isExactToday: false, isAllPast: true };
}

export function getClosestHourlyIndex(hourly, nowMs = Date.now()) {
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) return 0;
  let bestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < hourly.time.length; i++) {
    const tMs = new Date(hourly.time[i]).getTime();
    if (!Number.isFinite(tMs)) continue;
    const diff = Math.abs(tMs - nowMs);
    if (diff < minDiff) {
      minDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function getDayHourlyStartIndex(dateKey, rawDayIdx, hourly) {
  const defaultIdx = rawDayIdx * 24;
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) return defaultIdx;
  const key = String(dateKey || '').slice(0, 10);
  if (hourly.time[defaultIdx] && String(hourly.time[defaultIdx]).slice(0, 10) === key) {
    return defaultIdx;
  }
  const matched = hourly.time.findIndex(t => String(t).slice(0, 10) === key);
  return matched >= 0 ? matched : Math.min(defaultIdx, Math.max(0, hourly.time.length - 1));
}

/**
 * Meteorologisch harmonisierte Zustandserkennung für stündliche Vorhersagen.
 * Verhindert Widersprüche zwischen Sonnenscheindauer und rohen Modell-WMO-Codes
 * (z. B. wenn NWP-Modelle WMO-Code 3 "Bedeckt" wegen harmloser hoher Schleierwolken ausgeben,
 * obwohl 45-60 Minuten heller Sonnenschein gemessen/prognostiziert werden).
 */
export function getHarmonizedHourlyCondition({
  code = 0,
  sunSec = 0,
  precip = 0,
  pop = 0,
  cloudCover = null,
  isDay = true,
  temp = 10
}) {
  const sunMin = isDay ? Math.round(Math.max(0, Math.min(60, (sunSec || 0) / 60))) : 0;
  const hasPrecip = (precip >= 0.08) || (pop >= 65 && precip > 0.02);
  const isSnow = (code >= 71 && code <= 77) || code === 85 || code === 86 || (hasPrecip && temp <= 1.0);
  const isThunder = code >= 95;

  let icon = isDay ? '☀️' : '🌙';
  let label = isDay ? 'Sonnig' : 'Klar';

  if (isThunder) {
    icon = '⛈️';
    label = 'Gewitter';
  } else if (isSnow) {
    if (sunMin >= 15 && isDay) {
      icon = '🌨️';
      label = 'Sonne & Schnee';
    } else {
      icon = precip >= 1.5 ? '❄️' : '🌨️';
      label = 'Schneefall';
    }
  } else if (hasPrecip) {
    if (sunMin >= 15 && isDay) {
      icon = '🌦️';
      label = 'Sonne & Schauer';
    } else if (precip >= 2.0) {
      icon = '🌧️';
      label = 'Kräftiger Regen';
    } else if (precip >= 0.5) {
      icon = '🌧️';
      label = 'Regen';
    } else {
      icon = isDay ? '🌦️' : '🌧️';
      label = 'Leichter Regen';
    }
  } else {
    // Trocken (kein Niederschlag)
    if (isDay) {
      if (sunMin >= 40) {
        icon = '☀️';
        label = 'Sonnig';
      } else if (sunMin >= 20) {
        icon = '🌤️';
        label = 'Überwiegend sonnig';
      } else if (sunMin >= 8) {
        icon = '⛅';
        label = 'Teils sonnig';
      } else {
        // Unter 8 Min. Sonne
        const cc = (cloudCover !== null && cloudCover !== undefined)
          ? cloudCover
          : (code === 3 ? 90 : (code === 2 ? 60 : (code === 1 ? 30 : 10)));
        if (cc <= 25) {
          icon = '☀️';
          label = 'Sonnig';
        } else if (cc <= 55) {
          icon = '🌤️';
          label = 'Heiter';
        } else if (cc <= 80) {
          icon = '⛅';
          label = 'Wolkig';
        } else {
          icon = '☁️';
          label = 'Bedeckt';
        }
      }
    } else {
      // Nacht
      const cc = (cloudCover !== null && cloudCover !== undefined)
        ? cloudCover
        : (code === 3 ? 90 : (code === 2 ? 60 : (code === 1 ? 30 : 10)));
      if (cc <= 30) {
        icon = '🌙';
        label = 'Klar';
      } else if (cc <= 75) {
        icon = '☁️';
        label = 'Teils bewölkt';
      } else {
        icon = '☁️';
        label = 'Bedeckt';
      }
    }
  }

  // Striktes Nacht-Guardrail: Nachts darf niemals ein Sonnensymbol erscheinen
  if (!isDay) {
    if (icon === '☀️' || icon === '🌤️') icon = '🌙';
    else if (icon === '⛅' || icon === '🌥️') icon = '☁️';
    else if (icon === '🌦️') icon = '🌧️';
  }

  return { icon, label, sunMin, hasPrecip };
}

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
    searchInput.placeholder = 'Ort oder Berg suchen';
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
  const todayIdx = getTodayDailyIndex(weatherData.daily).idx;
  const curHourIdx = getClosestHourlyIndex(weatherData.hourly, now.getTime());
  const sunriseStr = weatherData.daily.sunrise[todayIdx] || weatherData.daily.sunrise[0];
  const sunsetStr = weatherData.daily.sunset[todayIdx] || weatherData.daily.sunset[0];
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
    cloud_cover: weatherData.hourly.cloud_cover ? weatherData.hourly.cloud_cover[curHourIdx] : 0
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

  const curHourIdx = getClosestHourlyIndex(w.hourly);
  const daily = w.daily;
  const todayInfo = getTodayDailyIndex(daily);
  const todayIdx = todayInfo.idx;

  const cur = w.current || (w.hourly ? {
    temperature_2m: w.hourly.temperature_2m[curHourIdx],
    apparent_temperature: w.hourly.apparent_temperature ? w.hourly.apparent_temperature[curHourIdx] : w.hourly.temperature_2m[curHourIdx],
    is_day: w.hourly.is_day ? w.hourly.is_day[curHourIdx] : 1,
    weather_code: w.hourly.weather_code ? w.hourly.weather_code[curHourIdx] : 0,
    wind_speed_10m: w.hourly.wind_speed_10m ? w.hourly.wind_speed_10m[curHourIdx] : 10,
    wind_direction_10m: w.hourly.wind_direction_10m ? w.hourly.wind_direction_10m[curHourIdx] : 180,
    relative_humidity_2m: w.hourly.relative_humidity_2m ? w.hourly.relative_humidity_2m[curHourIdx] : 60,
    pressure_msl: w.hourly.pressure_msl ? w.hourly.pressure_msl[curHourIdx] : 1013
  } : null);

  if (!cur) return;

  const isDay = cur.is_day === 1;
  const code = WMO_CODES[cur.weather_code] || WMO_CODES[0];
  const theme = isDay ? code.theme : code.themeNight;

  const isMapFullscreen = document.body.classList.contains('mobile-map-fullscreen-active');
  const isModalOpen = document.body.classList.contains('modal-open');
  const rootClasses = Array.from(document.documentElement.classList).filter(c => c.startsWith('weather-'));
  rootClasses.forEach(c => document.documentElement.classList.remove(c));
  document.documentElement.classList.add(`weather-${theme}`);

  const weatherClasses = Array.from(document.body.classList).filter(c => c.startsWith('weather-'));
  weatherClasses.forEach(c => document.body.classList.remove(c));
  document.body.classList.add(`weather-${theme}`);
  if (isMapFullscreen) {
    document.body.classList.add('mobile-map-fullscreen-active');
  }
  if (isModalOpen) {
    document.body.classList.add('modal-open');
  }
  if (state.canvasEngine) state.canvasEngine.setMode(theme, isDay);

  // Feature 10B: Dynamische Himmelsfarben & Alpenglühen
  updateAlpineSkyIllumination(w, state.currentLocation.elevation);

  // Exact Temperature (harmonisiert & dynamisch bias-korrigiert inkl. adiabatischer Höhenanpassung)
  const isMtnLoc = Boolean(state.currentLocation?.isMountain);
  const finalTemp = (m && isMtnLoc && m.microWeather && typeof m.microWeather.temperature10m === 'number')
    ? m.microWeather.temperature10m
    : cur.temperature_2m;
  const heroTempEl = document.getElementById('hero-current-temp');
  if (heroTempEl) {
    heroTempEl.innerText = Math.round(convertTemp(finalTemp));
  }

  // Datenquelle transparent setzen (DWD-Station mit Bias-Korrektur oder regionaler Modell-Konsens)
  const src = document.getElementById('hero-source-badge');
  if (src) {
    if (m && m.biasCorrection && m.biasCorrection.stationApplied) {
      const stName = m.biasCorrection.stationName || 'Bodenstation';
      const net = m.biasCorrection.stationNetwork || 'Station';
      src.innerText = `📡 ${stName} (${net})`;
    } else if (w._providerFallback) {
      src.innerText = `🌐 ${w._providerFallback.replace(' (Fallback)', '')} • Live`;
    } else if (state.multiModel && state.multiModel.activeRegionalModel) {
      src.innerText = `📡 ${state.multiModel.activeRegionalModel} / ECMWF`;
    } else if (m && m.regionalModelName) {
      src.innerText = `📡 ${m.regionalModelName} / ECMWF`;
    } else {
      src.innerText = '📡 ICON-EU / ECMWF';
    }
  }
  // Präzise Bestimmung von Niederschlagstyp (Schnee/Schneeregen/Regen) und Schneefallgrenze / 0°C-Niveau
  const curPrecip = (m && m.microWeather && m.microWeather.precipitationMm !== undefined)
    ? m.microWeather.precipitationMm
    : (cur.precipitation || (w.hourly && w.hourly.precipitation ? w.hourly.precipitation[curHourIdx] : 0));
  const isPrecipWmo = (cur.weather_code >= 51 && cur.weather_code <= 99);
  const isPrecip = curPrecip >= 0.05 || isPrecipWmo;

  // Schneefallgrenze (Wet-Bulb) und 0°C-Niveau aus MicroEngine oder Modell
  const snowLevel = (m && m.atmosphere && m.atmosphere.snowLevelMeters) ||
    (m && m.microWeather && m.microWeather.snowLevelMeters) ||
    (w.hourly && w.hourly.freezing_level_height ? w.hourly.freezing_level_height[curHourIdx] : null);
  const freezingLevel = (m && m.atmosphere && m.atmosphere.freezingLevelMeters) ||
    (m && m.microWeather && m.microWeather.freezingLevelMeters) ||
    (w.hourly && w.hourly.freezing_level_height ? w.hourly.freezing_level_height[curHourIdx] : null);

  let conditionLabel = code.label;

  if (isPrecip) {
    let precipType = (m && m.microWeather && m.microWeather.precipType && m.microWeather.precipType !== 'Trocken')
      ? m.microWeather.precipType
      : null;

    if (!precipType) {
      if ((cur.weather_code >= 71 && cur.weather_code <= 77) || [85, 86].includes(cur.weather_code)) {
        precipType = 'Schnee';
      } else if ([56, 57, 66, 67].includes(cur.weather_code)) {
        precipType = 'Schneeregen';
      } else {
        const rh = cur.relative_humidity_2m !== undefined ? cur.relative_humidity_2m : 75;
        const t = cur.temperature_2m !== undefined ? cur.temperature_2m : 10;
        const tw = t * Math.atan(0.151977 * Math.pow(rh + 8.313659, 0.5)) + Math.atan(t + rh) - Math.atan(rh - 1.676331) + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;
        if (tw <= 0.5) precipType = 'Schnee';
        else if (tw <= 1.8) precipType = 'Schneeregen';
        else precipType = 'Regen';
      }
    }

    if (precipType === 'Schnee') {
      if (curPrecip >= 2.5 || cur.weather_code === 75 || cur.weather_code === 86) conditionLabel = 'Starker Schneefall';
      else if (curPrecip >= 0.6 || cur.weather_code === 73) conditionLabel = 'Schneefall';
      else conditionLabel = 'Leichter Schnee';
    } else if (precipType === 'Schneeregen') {
      conditionLabel = 'Schneeregen';
    } else {
      if (cur.weather_code >= 95) {
        conditionLabel = code.label;
      } else if (curPrecip >= 4.0 || cur.weather_code === 65 || cur.weather_code === 82) {
        conditionLabel = 'Kräftiger Regen';
      } else if (curPrecip >= 1.0 || cur.weather_code === 63 || cur.weather_code === 81) {
        conditionLabel = 'Mäßiger Regen';
      } else {
        conditionLabel = 'Leichter Regen';
      }
    }
  } else {
    // Prüfe auf Inversions-Hochnebel (Allgäu / Voralpen Kaltluftsee)
    const isInversionActive = (m && m.atmosphere && m.atmosphere.inversionActive);
    const invTopMeters = (m && m.atmosphere && m.atmosphere.inversionTopMeters) ? m.atmosphere.inversionTopMeters : 1450;
    const invTopStr = invTopMeters.toLocaleString('de-DE');
    const orographicInsights = state.actualVerification && Array.isArray(state.actualVerification.orographicInsights)
      ? state.actualVerification.orographicInsights : [];
    const hasInversionFog = orographicInsights.some(i => i.type === 'inversion_fog_detected' || i.type === 'webcam_inversion_groundtruth') ||
      (isInversionActive && (cur.relative_humidity_2m >= 80 || cur.weather_code <= 2));

    const isMountainSummitAboveFog = state.currentLocation.isMountain && state.currentLocation.elevation >= (invTopMeters - 50);

    if (hasInversionFog || (isInversionActive && isMountainSummitAboveFog)) {
      if (!isMountainSummitAboveFog && state.currentLocation.elevation <= invTopMeters) {
        conditionLabel = `🌫️ Dichter Hochnebel (Inversion bis ~${invTopStr} m)`;
      } else {
        conditionLabel = isDay
          ? `☀️ Sonnig über dem Nebelmeer (Inversion bis ~${invTopStr} m)`
          : `🌙 Sternenklar über dem Nebelmeer (Inversion bis ~${invTopStr} m)`;
      }
    } else {
      // Trocken: Cloud-Cover in die Bedingung einbeziehen (Hero und Karte konsistent)
      const cloud = cur.cloud_cover !== undefined ? cur.cloud_cover : (w.hourly && w.hourly.cloud_cover ? w.hourly.cloud_cover[curHourIdx] : 0);
      if (isMountainSummitAboveFog && m && m.atmosphere && m.atmosphere.freezingLevelMeters > state.currentLocation.elevation + 400 && cloud < 45) {
        conditionLabel = 'Klar / Wolkenlos';
      } else if (cloud >= 75) conditionLabel = 'Bedeckt';
      else if (cloud >= 50) conditionLabel = 'Wolkig';
      else if (cloud >= 25) conditionLabel = 'Teilweise bewölkt';
      else if (cloud < 15 && (cur.weather_code === 0 || cur.weather_code === 1)) conditionLabel = 'Klar / Wolkenlos';
      else conditionLabel = code.label;
    }
  }

  // Föhn- & Talwind-Status im Hero anzeigen (inkl. synoptischer Föhn-Ampel)
  if (state.currentLocation.isMountain && m && m.microWeather) {
    if (m.microWeather.foehn && m.microWeather.foehn.active) {
      conditionLabel += ` · 💨 ${m.microWeather.foehn.label || m.microWeather.foehn.type}`;
    } else if (m.microWeather.foehnDiagnostic && m.microWeather.foehnDiagnostic.alertLevel >= 1) {
      conditionLabel += ` · 💨 ${m.microWeather.foehnDiagnostic.title}`;
    } else if (m.microWeather.valleyWind && m.microWeather.valleyWind.active) {
      const vIcon = m.microWeather.valleyWind.type === 'Anabatic' ? '☀️' : '🌙';
      conditionLabel += ` · ${vIcon} ${m.microWeather.valleyWind.label}`;
    }

    const elevPill = document.getElementById('hero-elevation-pill');
    if (elevPill) {
      let pillText = `🏔️ ${state.currentLocation.elevation.toLocaleString('de-DE')} m`;
      if (m.microWeather.foehn && m.microWeather.foehn.active) {
        pillText += ` · 💨 ${m.microWeather.foehn.type}`;
      } else if (m.microWeather.foehnDiagnostic && m.microWeather.foehnDiagnostic.alertLevel >= 1) {
        pillText += ` · 💨 ${m.microWeather.foehnDiagnostic.alertLevel === 2 ? 'Föhnsturm' : 'Föhnbereitschaft'}`;
      } else if (m.microWeather.valleyWind && m.microWeather.valleyWind.active) {
        const vIcon = m.microWeather.valleyWind.type === 'Anabatic' ? '☀️' : '🌙';
        pillText += ` · ${vIcon} ${m.microWeather.valleyWind.type}`;
      }
      elevPill.innerText = pillText;
    }
  }

  document.getElementById('hero-condition-text').innerText = conditionLabel;

  // Schneefallgrenze, Nullgradgrenze & Neuschnee darstellen
  const snowlineEl = document.getElementById('hero-snowline-row');
  if (snowlineEl) {
    const isMountain = !!state.currentLocation.isMountain;
    const snowPhysics = m && m.microWeather && m.microWeather.snow;
    if (snowPhysics && snowPhysics.isSnow && snowPhysics.freshSnowCm24h > 0) {
      snowlineEl.style.display = 'flex';
      const snowText = `❄️ +${snowPhysics.freshSnowCm24h} cm Neuschnee (24h) • ${snowPhysics.qualityLabel.split('•')[0].trim()}`;
      snowlineEl.innerHTML = `<span class="hero-snowline-mountain">${snowText}</span>`;
    } else if (isPrecip && snowLevel && (isMountain || snowLevel < 3500)) {
      const sfgVal = Math.round(snowLevel).toLocaleString('de-DE');
      snowlineEl.style.display = 'flex';
      if (isMountain) {
        snowlineEl.innerHTML = `<span class="hero-snowline-mountain">❄️ Schneefallgrenze: ~${sfgVal} m</span>`;
      } else {
        snowlineEl.innerHTML = `<span class="hero-snowline-city">❄️ Schneefallgrenze: ~${sfgVal} m</span>`;
      }
    } else if (!isPrecip && isMountain && freezingLevel) {
      const flVal = Math.round(freezingLevel).toLocaleString('de-DE');
      snowlineEl.style.display = 'flex';
      if (m && m.atmosphere && m.atmosphere.inversionActive && m.atmosphere.inversionTopMeters) {
        snowlineEl.innerHTML = `<span class="hero-snowline-mountain freezing">🌫️ Inversion bis ~${m.atmosphere.inversionTopMeters.toLocaleString('de-DE')} m • 🧊 0°C: ~${flVal} m</span>`;
      } else {
        snowlineEl.innerHTML = `<span class="hero-snowline-mountain freezing">🧊 Nullgradgrenze: ~${flVal} m</span>`;
      }
    } else {
      snowlineEl.style.display = 'none';
      snowlineEl.innerHTML = '';
    }
  }

  if (daily && daily.temperature_2m_max && daily.temperature_2m_max.length > 0) {
    document.getElementById('hero-temp-max').innerText = `${Math.round(convertTemp(daily.temperature_2m_max[todayIdx]))}°`;
    document.getElementById('hero-temp-min').innerText = `${Math.round(convertTemp(daily.temperature_2m_min[todayIdx]))}°`;
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

  const curHourIdx = getClosestHourlyIndex(hourly);
  const todayIdx = getTodayDailyIndex(daily).idx;

  const iconElem = document.getElementById('hha-icon');
  const badgeElem = document.getElementById('hha-badge');
  const msgElem = document.getElementById('hha-msg');
  const actionBtn = document.getElementById('hha-action-btn');

  let hazard = null;

  // 1. Akutes Gewitter & Blitzschlag (Priorität 1)
  const isThunder = [95, 96, 99].includes(cur.weather_code) ||
    (hourly && hourly.weather_code && [95, 96, 99].includes(hourly.weather_code[curHourIdx]));
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
    const maxDailyGust = (daily && daily.wind_gusts_10m_max && daily.wind_gusts_10m_max[todayIdx]) || 0;
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
  const activeAv = microData && (microData.avalancheReport || microData.avalanche);
  if (!hazard && state.currentLocation && (state.currentLocation.isMountain || state.currentLocation.elevation >= 1000) && activeAv) {
    const avLevel = activeAv.dangerLevel || 1;
    if (avLevel >= 3) {
      hazard = {
        icon: '⚠️',
        badge: `${activeAv.isOfficialBulletin ? '🟢 OFFIZ. ' : ''}LAWINENWARNSTUFE ${avLevel} (${avLevel >= 4 ? 'GROSS' : 'ERHEBLICH'})`,
        msg: `${activeAv.dangerTitle} über ${activeAv.criticalElevation?.toLocaleString('de-DE') || 2000} m: ${activeAv.safetyRule || 'Störanfällige Schneedecke & Triebschnee im Steilgelände.'}`,
        actionText: 'Lawinenbericht ➔',
        action: () => {
          switchTab('tab-mountain');
          setTimeout(() => {
            const card = document.getElementById('avalanche-danger-card') || document.getElementById('avalanche-report-card');
            if (card) card.scrollIntoView({ behavior: 'smooth' });
          }, 100);
        }
      };
    }
  }

  // 4. Starkregen / Flutgefahr (Priorität 4: >= 10 mm/h oder >= 35 mm/d)
  if (!hazard) {
    const precipSum = (daily && daily.precipitation_sum && daily.precipitation_sum[todayIdx]) || 0;
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
      (cur.temperature_2m <= 0.5 && (cur.precipitation > 0 || (hourly && hourly.precipitation && hourly.precipitation[curHourIdx] > 0)));
    if (isFreezing) {
      hazard = {
        icon: '🧊',
        badge: 'GLATTEISWARNUNG',
        msg: 'Gefrierende Nässe / Glatteisbildung auf Fahrbahnen, Brücken und Bergsteigen.',
        actionText: '24h-Details ➔',
        action: () => {
          if (daily && hourly && typeof openDayDetailModal === 'function') {
            openDayDetailModal(todayIdx, daily, hourly);
          } else {
            const hList = document.getElementById('hourly-forecast-list') || document.getElementById('bento-grid');
            if (hList) hList.scrollIntoView({ behavior: 'smooth' });
          }
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
      if (hazard.action && hazard.actionText) {
        actionBtn.innerText = hazard.actionText;
        actionBtn.onclick = (e) => {
          e.stopPropagation();
          hazard.action();
        };
        actionBtn.style.display = 'inline-flex';
        alertBox.style.cursor = 'pointer';
        alertBox.onclick = () => {
          hazard.action();
        };
      } else {
        actionBtn.style.display = 'none';
        actionBtn.onclick = null;
        alertBox.style.cursor = 'default';
        alertBox.onclick = null;
      }
    }
    alertBox.style.display = 'flex';
  } else {
    alertBox.style.display = 'none';
    alertBox.onclick = null;
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
      // Neuzeichnung des Ensemble-Meteogramms anstoßen, falls zuvor verborgen
      if (state.weatherData) {
        setTimeout(() => renderEnsembleMeteogram(), 50);
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

function parseForecastTimeMs(tsStr, utcOffsetSec = null) {
  if (!tsStr) return NaN;
  const s = String(tsStr);
  const hasZone = /[Z+\-]\d{2}:?\d{2}$/.test(s);
  if (!hasZone && typeof utcOffsetSec === 'number' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return Date.parse(`${s.slice(0, 16)}:00Z`) - utcOffsetSec * 1000;
  }
  return new Date(s).getTime();
}

function findTimeBracket(times, targetTs, utcOffsetSec = null) {
  if (!Array.isArray(times) || times.length === 0) return null;
  let i0 = 0;
  for (let i = 0; i < times.length; i++) {
    const tMs = parseForecastTimeMs(times[i], utcOffsetSec);
    if (!Number.isFinite(tMs)) continue;
    if (tMs <= targetTs) i0 = i;
    else break;
  }
  const i1 = Math.min(times.length - 1, i0 + 1);
  const t0 = parseForecastTimeMs(times[i0], utcOffsetSec);
  const t1 = parseForecastTimeMs(times[i1], utcOffsetSec);
  const span = Math.max(1, (Number.isFinite(t1) && Number.isFinite(t0)) ? (t1 - t0) : 0);
  const frac = (i1 > i0 && span > 0 && Number.isFinite(t0))
    ? Math.max(0, Math.min(1, (targetTs - t0) / span))
    : 0;
  return { i0, i1, frac, inRange: Number.isFinite(t0) && targetTs >= t0 - 15 * 60000 && targetTs <= (Number.isFinite(t1) ? t1 : t0) + 15 * 60000 };
}

function getInterpolatedHourlyPoint(hourly, nowMs, currentClosestIdx, minuteOffset) {
  const targetTs = nowMs + minuteOffset * 60000;
  const targetDate = new Date(targetTs);
  const w = state.weatherData || {};
  const m = state.microData;
  const cur = w.current || {};
  const utcOffsetSec = typeof w.utc_offset_seconds === 'number' ? w.utc_offset_seconds : null;
  const isMtnLoc = Boolean(state.currentLocation?.isMountain);
  const heroNowTemp = (m && isMtnLoc && m.microWeather && typeof m.microWeather.temperature10m === 'number')
    ? m.microWeather.temperature10m
    : (typeof cur.temperature_2m === 'number'
      ? cur.temperature_2m
      : (hourly.temperature_2m ? hourly.temperature_2m[currentClosestIdx] : 12));

  const bracket = findTimeBracket(hourly.time, targetTs, utcOffsetSec);
  const h0 = bracket ? bracket.i0 : Math.min(hourly.time.length - 1, currentClosestIdx);
  const h1 = bracket ? bracket.i1 : Math.min(hourly.time.length - 1, h0 + 1);
  const frac = bracket ? bracket.frac : 0;

  const interpArr = (arr, fallback = 0) => {
    if (!Array.isArray(arr)) return fallback;
    const v0 = (typeof arr[h0] === 'number' && !isNaN(arr[h0])) ? arr[h0] : fallback;
    const v1 = (typeof arr[h1] === 'number' && !isNaN(arr[h1])) ? arr[h1] : v0;
    return v0 * (1 - frac) + v1 * frac;
  };

  if (minuteOffset === 0) {
    const pop = hourly.precipitation_probability ? Math.round(hourly.precipitation_probability[currentClosestIdx] ?? 0) : 0;
    const wind = Math.round(cur.wind_speed_10m ?? interpArr(hourly.wind_speed_10m, 10));
    const precip = Math.round((cur.precipitation ?? interpArr(hourly.precipitation, 0)) * 10) / 10;
    const sunSec = Math.round(hourly.sunshine_duration?.[currentClosestIdx] ?? 0);
    const cloudCover = hourly.cloud_cover ? Math.round(hourly.cloud_cover[currentClosestIdx] ?? 0) : null;
    const code = cur.weather_code ?? (hourly.weather_code ? hourly.weather_code[currentClosestIdx] : 0);
    const isDay = (hourly.is_day && hourly.is_day[currentClosestIdx] !== undefined)
      ? hourly.is_day[currentClosestIdx] === 1
      : (targetDate.getHours() >= 6 && targetDate.getHours() <= 20);

    return {
      timestamp: targetDate,
      minuteOffset: 0,
      temp: heroNowTemp,
      pop,
      wind,
      precip,
      sunSec,
      cloudCover,
      code,
      isDay,
      isNow: true
    };
  }

  let temp = interpArr(hourly.temperature_2m, heroNowTemp);
  const pop = Math.round(interpArr(hourly.precipitation_probability, 0));
  let wind = Math.round(interpArr(hourly.wind_speed_10m, cur.wind_speed_10m ?? 10));
  let precip = Math.round(interpArr(hourly.precipitation, 0) * 10) / 10;
  const sunSec = Math.round(interpArr(hourly.sunshine_duration, 0));
  const ccRaw = hourly.cloud_cover ? interpArr(hourly.cloud_cover, null) : null;
  const cloudCover = (ccRaw !== null && !isNaN(ccRaw)) ? Math.round(ccRaw) : null;
  let code = frac < 0.5
    ? (hourly.weather_code ? hourly.weather_code[h0] : (cur.weather_code ?? 0))
    : (hourly.weather_code ? hourly.weather_code[h1] : (cur.weather_code ?? 0));

  // Echtes Open-Meteo 15-Minuten-Detailraster (minutely_15) einbeziehen falls vorhanden
  const m15 = w.minutely_15;
  let hasMin15Precip = false;
  if (m15 && Array.isArray(m15.time) && m15.time.length >= 2) {
    const mBracket = findTimeBracket(m15.time, targetTs, utcOffsetSec);
    if (mBracket && mBracket.inRange) {
      const m0 = mBracket.i0;
      const m1 = mBracket.i1;
      const mFrac = mBracket.frac;
      if (Array.isArray(m15.temperature_2m) && typeof m15.temperature_2m[m0] === 'number') {
        const mt0 = m15.temperature_2m[m0];
        const mt1 = (typeof m15.temperature_2m[m1] === 'number') ? m15.temperature_2m[m1] : mt0;
        const mTemp = mt0 * (1 - mFrac) + mt1 * mFrac;
        // Wenn Berg-Mikroklima oder Stationsbias aktiv ist, Offset sanft mitziehen
        const baseModelNow = cur.temperature_2m ?? temp;
        const microDelta = heroNowTemp - baseModelNow;
        temp = mTemp + (Math.abs(minuteOffset) <= 60 ? microDelta * (1 - Math.abs(minuteOffset) / 90) : 0);
      }
      if (Array.isArray(m15.precipitation) && typeof m15.precipitation[m0] === 'number') {
        const mp0 = Math.max(0, m15.precipitation[m0]);
        const mp1 = (typeof m15.precipitation[m1] === 'number') ? Math.max(0, m15.precipitation[m1]) : mp0;
        precip = Math.round((mp0 * (1 - mFrac) + mp1 * mFrac) * 10) / 10;
        hasMin15Precip = true;
      }
      if (Array.isArray(m15.wind_speed_10m) && typeof m15.wind_speed_10m[m0] === 'number') {
        const mw0 = m15.wind_speed_10m[m0];
        const mw1 = (typeof m15.wind_speed_10m[m1] === 'number') ? m15.wind_speed_10m[m1] : mw0;
        wind = Math.round(mw0 * (1 - mFrac) + mw1 * mFrac);
      }
      if (Array.isArray(m15.weather_code)) {
        const mCode = mFrac < 0.5 ? m15.weather_code[m0] : m15.weather_code[m1];
        if (typeof mCode === 'number' && !isNaN(mCode)) code = mCode;
      }
    }
  }

  // Sanfte Anbindung an aktuellen Mess-/Hero-Stand innerhalb von +/- 30 Min.
  if (Math.abs(minuteOffset) < 45) {
    const anchorW = 1 - Math.abs(minuteOffset) / 45;
    temp = heroNowTemp * anchorW + temp * (1 - anchorW);
    if (minuteOffset < 0 && typeof cur.wind_speed_10m === 'number') {
      wind = Math.round(cur.wind_speed_10m * anchorW + wind * (1 - anchorW));
    }
  }

  // Radar-Vektor-Nowcast (0..90 Min.) koppeln — aber echtes minutely_15 nicht mit trockenem Basis-Nullwert überschreiben
  let finalPop = pop;
  const radarIntervals = m?.biasCorrection?.radarNowcast90m?.intervals;
  if (minuteOffset > 0 && minuteOffset <= 90 && Array.isArray(radarIntervals) && radarIntervals.length > 0) {
    let rBest = radarIntervals[0];
    let bestMinDiff = Infinity;
    for (const iv of radarIntervals) {
      const d = Math.abs((iv.minute || 0) - minuteOffset);
      if (d < bestMinDiff) {
        bestMinDiff = d;
        rBest = iv;
      }
    }
    if (rBest && typeof rBest.precipMm === 'number') {
      const hasActiveRadarOrStation = Boolean(m?.biasCorrection?.stationApplied || rBest.precipMm > 0.05);
      if (!hasMin15Precip || hasActiveRadarOrStation) {
        const wRadar = hasMin15Precip
          ? Math.max(0.25, 0.65 - (minuteOffset / 90) * 0.40)
          : Math.max(0.25, 0.85 - (minuteOffset / 90) * 0.60);
        precip = Math.round((wRadar * rBest.precipMm + (1 - wRadar) * precip) * 10) / 10;
      }
      if (typeof rBest.probability === 'number' && rBest.precipMm > 0.05) {
        finalPop = Math.max(finalPop, rBest.probability);
      }
      if (precip >= 0.15 && code < 51) {
        code = temp <= 1.0 ? 71 : 61;
      }
    }
  }

  const dayIdx = frac < 0.5 ? h0 : h1;
  const isDay = (hourly.is_day && hourly.is_day[dayIdx] !== undefined)
    ? hourly.is_day[dayIdx] === 1
    : (targetDate.getHours() >= 6 && targetDate.getHours() <= 20);

  return {
    timestamp: targetDate,
    minuteOffset,
    temp,
    pop: finalPop,
    wind,
    precip,
    sunSec,
    cloudCover,
    code,
    isDay
  };
}

function getExactHourlyLlbBadge(ptDate) {
  const av = state.microData && state.microData.avalancheReport;
  const ob = state.microData && state.microData.officialBulletin;
  if (!av || !av.isOfficialBulletin || !ob || !ptDate) return '';
  const ms = ptDate.getTime();
  if (ms < ob.validStartMs || ms > ob.validEndMs) return '';
  const lvl = ptDate.getHours() < 12 ? av.morningDangerLevel : av.afternoonDangerLevel;
  const meta = MicroEngine.getEawsScaleMeta(lvl);
  return `<div class="hourly-llb-pill" style="background:${meta.color};color:${meta.textColor};" title="Exakter offizieller Lawinenlagebericht (${escapeHtml(av.stationAgency)}): Stufe ${meta.level}/5 (${escapeHtml(meta.label)})">Lawine ${meta.level}/5</div>`;
}

function createHourlyItemElement(pt, label, tag, typeClass) {
  const item = document.createElement('div');
  item.className = `hourly-item ${typeClass || ''}`;
  
  const temp = Math.round(convertTemp(pt.temp));
  const harm = getHarmonizedHourlyCondition({
    code: pt.code,
    sunSec: pt.sunSec,
    precip: pt.precip,
    pop: pt.pop,
    cloudCover: pt.cloudCover,
    isDay: pt.isDay,
    temp: pt.temp
  });
  const timeClock = pt.timestamp ? `${String(pt.timestamp.getHours()).padStart(2, '0')}:${String(pt.timestamp.getMinutes()).padStart(2, '0')}` : '';

  let tagHtml = '';
  if (tag === '5m') {
    tagHtml = `<span class="hourly-sub-tag tag-5m" title="5-Minuten Nowcast">5m</span>`;
  } else if (tag === '15m') {
    tagHtml = `<span class="hourly-sub-tag tag-15m" title="15-Minuten Intervall">15m</span>`;
  }

  let metricText = '';
  if (pt.precip && pt.precip > 0.05) {
    metricText = `<span style="font-size:9px; color:#38bdf8; font-weight:700;">💧 ${pt.precip.toFixed(1)}</span>`;
  } else if (pt.pop > 15) {
    metricText = `<span style="font-size:9px; color:var(--ios-cyan);">${pt.pop}%</span>`;
  } else if (harm.sunMin >= 15 && pt.isDay) {
    metricText = `<span style="font-size:9px; color:#fbbf24; font-weight:700;">☀️ ${harm.sunMin}m</span>`;
  }

  const llbBadgeHtml = getExactHourlyLlbBadge(pt.timestamp);

  item.innerHTML = `
    ${tagHtml}
    <div class="hourly-time">
      <span class="ht-label">${label}</span>
      ${timeClock ? `<small class="ht-clock">${timeClock}</small>` : ''}
    </div>
    <div class="hourly-icon">${harm.icon}</div>
    <div class="hourly-pop">${metricText}</div>
    <div class="hourly-temp">${temp}°</div>
    ${llbBadgeHtml}
    <div class="hourly-wind">💨 ${pt.wind} <small>km/h</small></div>
  `;
  return item;
}

export function renderHourlySlider(hourly) {
  const container = document.getElementById('hourly-forecast-list');
  if (!container || !hourly || !hourly.time || hourly.time.length === 0) return;

  container.innerHTML = '';
  const nowMs = Date.now();

  // Finde den Index der aktuellen Stunde (ohne künstliches 48h-Limit)
  const currentClosestIdx = getClosestHourlyIndex(hourly, nowMs);

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
      const pop = hourly.precipitation_probability ? (hourly.precipitation_probability[idx] || 0) : 0;
      const precip = hourly.precipitation ? (hourly.precipitation[idx] || 0) : 0;
      const sunSec = hourly.sunshine_duration ? (hourly.sunshine_duration[idx] || 0) : 0;
      const cloudCover = hourly.cloud_cover ? hourly.cloud_cover[idx] : null;
      const code = hourly.weather_code ? hourly.weather_code[idx] : 0;
      const isDay = (hourly.is_day && hourly.is_day[idx] !== undefined)
        ? hourly.is_day[idx] === 1
        : (t.getHours() >= 6 && t.getHours() <= 20);
      const harm = getHarmonizedHourlyCondition({ code, sunSec, precip, pop, cloudCover, isDay, temp: hourly.temperature_2m[idx] });
      const wind = hourly.wind_speed_10m ? Math.round(hourly.wind_speed_10m[idx]) : '--';

      let metricText = '';
      if (precip > 0.05) {
        metricText = `<span style="font-size:9px; color:#38bdf8; font-weight:700;">💧 ${precip.toFixed(1)}</span>`;
      } else if (pop > 15) {
        metricText = `<span style="font-size:9px; color:var(--ios-cyan);">${pop}%</span>`;
      } else if (harm.sunMin >= 15 && isDay) {
        metricText = `<span style="font-size:9px; color:#fbbf24; font-weight:700;">☀️ ${harm.sunMin}m</span>`;
      }

      const llbBadgeHtml = getExactHourlyLlbBadge(t);
      const item = document.createElement('div');
      item.className = 'hourly-item';
      item.innerHTML = `
        <div class="hourly-time">${label}</div>
        <div class="hourly-icon">${harm.icon}</div>
        <div class="hourly-pop">${metricText}</div>
        <div class="hourly-temp">${temp}°</div>
        ${llbBadgeHtml}
        <div class="hourly-wind">💨 ${wind} <small>km/h</small></div>
      `;
      fragment.appendChild(item);
    }
  } else {
    // Klassischer Stundenschritt
    const startIdx = Math.max(0, currentClosestIdx - 6);
    const endIdx = Math.min(hourly.time.length, startIdx + 30);

    const curForNow = (state.weatherData && state.weatherData.current) ? state.weatherData.current : null;
    const mForNow = state.microData;
    const isMtnNow = Boolean(state.currentLocation?.isMountain);
    const heroNowTemp = (mForNow && isMtnNow && mForNow.microWeather && typeof mForNow.microWeather.temperature10m === 'number')
      ? mForNow.microWeather.temperature10m
      : (curForNow && typeof curForNow.temperature_2m === 'number' ? curForNow.temperature_2m : null);

    for (let i = startIdx; i < endIdx; i++) {
      const t = new Date(hourly.time[i]);
      const isNow = i === currentClosestIdx;
      const label = isNow ? 'Jetzt' : `${String(t.getHours()).padStart(2, '0')}:00`;
      const rawT = (isNow && heroNowTemp !== null) ? heroNowTemp : hourly.temperature_2m[i];
      const temp = Math.round(convertTemp(rawT));
      const pop = hourly.precipitation_probability ? (hourly.precipitation_probability[i] || 0) : 0;
      const precip = (isNow && curForNow && typeof curForNow.precipitation === 'number')
        ? curForNow.precipitation
        : (hourly.precipitation ? (hourly.precipitation[i] || 0) : 0);
      const sunSec = hourly.sunshine_duration ? (hourly.sunshine_duration[i] || 0) : 0;
      const cloudCover = hourly.cloud_cover ? hourly.cloud_cover[i] : null;
      const code = (isNow && curForNow && typeof curForNow.weather_code === 'number')
        ? curForNow.weather_code
        : (hourly.weather_code ? hourly.weather_code[i] : 0);
      const isDay = (hourly.is_day && hourly.is_day[i] !== undefined)
        ? hourly.is_day[i] === 1
        : (t.getHours() >= 6 && t.getHours() <= 20);
      const harm = getHarmonizedHourlyCondition({ code, sunSec, precip, pop, cloudCover, isDay, temp: rawT });
      const windSource = (isNow && curForNow && typeof curForNow.wind_speed_10m === 'number')
        ? curForNow.wind_speed_10m
        : (hourly.wind_speed_10m ? hourly.wind_speed_10m[i] : null);
      const wind = windSource !== null && windSource !== undefined ? Math.round(windSource) : '--';

      let metricText = '';
      if (precip > 0.05) {
        metricText = `<span style="font-size:9px; color:#38bdf8; font-weight:700;">💧 ${precip.toFixed(1)}</span>`;
      } else if (pop > 15) {
        metricText = `<span style="font-size:9px; color:var(--ios-cyan);">${pop}%</span>`;
      } else if (harm.sunMin >= 15 && isDay) {
        metricText = `<span style="font-size:9px; color:#fbbf24; font-weight:700;">☀️ ${harm.sunMin}m</span>`;
      }

      const llbBadgeHtml = getExactHourlyLlbBadge(t);
      const item = document.createElement('div');
      item.className = `hourly-item ${isNow ? 'current-now' : ''}`;
      item.innerHTML = `
        <div class="hourly-time">${label}</div>
        <div class="hourly-icon">${harm.icon}</div>
        <div class="hourly-pop">${metricText}</div>
        <div class="hourly-temp">${temp}°</div>
        ${llbBadgeHtml}
        <div class="hourly-wind">💨 ${wind} <small>km/h</small></div>
      `;
      fragment.appendChild(item);
    }
  }

  // Single-commit DOM update (Task 4b)
  container.replaceChildren(fragment);

  // Auto-Scroll sanft zur aktuellen Stunde / Jetzt (nur horizontal im Slider, niemals vertikal auf Window!)
  const activeNowItem = container.querySelector('.hourly-item.current-now');
  if (activeNowItem) {
    setTimeout(() => {
      const targetLeft = activeNowItem.offsetLeft - (container.clientWidth / 2) + (activeNowItem.offsetWidth / 2);
      container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    }, 80);
  }
}

/**
 * ULTRA-PRÄZISER APPLE-WEATHER-GRADE 24H TAGESÜBERBLICK (SVG)
 * Kombiniert Temperaturverlauf als geschmeidige Spline, Sonnenstunden als solare Lichtbalken,
 * exakte Sonnenauf- & -untergangs-Meilensteine sowie bedingte Niederschlagsbalken (NUR wenn Niederschlag fällt).
 */
export function renderDayOverviewSVG({
  dayIndex,
  hourlyTemps,
  hourlySunSecList,
  hourlyPrecip,
  hourlyPop,
  sunriseStr,
  sunsetStr,
  sunriseDec,
  sunsetDec,
  tMin,
  tMax,
  isToday = (dayIndex === 0)
}) {
  const isDesktop = (typeof window !== 'undefined' && window.innerWidth >= 900);
  const validTemps = (Array.isArray(hourlyTemps) && hourlyTemps.length === 24) ? hourlyTemps : new Array(24).fill(10);
  const minT = (typeof tMin === 'number' && !isNaN(tMin)) ? tMin : Math.min(...validTemps);
  const maxT = (typeof tMax === 'number' && !isNaN(tMax)) ? tMax : Math.max(...validTemps);
  const tempRange = Math.max(2, maxT - minT);

  const hasPrecip = Array.isArray(hourlyPrecip) && hourlyPrecip.some(p => p > 0.05);
  const W = isDesktop ? 680 : 380;
  const H = hasPrecip ? (isDesktop ? 175 : 205) : (isDesktop ? 150 : 175);
  const padLeft = isDesktop ? 26 : 22;
  const padRight = isDesktop ? 26 : 22;
  const chartW = W - padLeft - padRight; // Desktop: 628px, Mobile: 336px

  const getX = (hour) => padLeft + (Math.max(0, Math.min(24, hour)) / 24) * chartW;

  // Y-Bereich für Temperaturkurve
  const chartTop = isDesktop ? 30 : 38;
  const chartBottom = isDesktop ? 116 : 136;
  const chartHeight = chartBottom - chartTop; // Desktop: 86px, Mobile: 98px
  const getY = (t) => chartBottom - ((t - minT) / tempRange) * chartHeight;

  // Sonnenauf- & Untergangs-Positionen
  const xSunrise = Math.max(padLeft, Math.min(W - padRight, getX(sunriseDec)));
  const xSunset = Math.max(padLeft, Math.min(W - padRight, getX(sunsetDec)));

  // SVG IDs für Gradienten & Filter
  const gradId = `dayTempGrad_${dayIndex}`;
  const fillId = `dayTempFill_${dayIndex}`;
  const sunGradId = `daySunGrad_${dayIndex}`;

  // 1. Sonnenstunden-Balken (Tageslicht & Intensität)
  let sunBarsHtml = '';
  if (Array.isArray(hourlySunSecList)) {
    for (let h = 0; h < 24; h++) {
      const sSec = hourlySunSecList[h] || 0;
      const sunMin = Math.round(sSec / 60);
      if (sunMin >= 5) {
        const bx = getX(h) + (isDesktop ? 2 : 1);
        const bw = Math.max(3, (chartW / 24) - (isDesktop ? 4 : 2));
        const maxBarHeight = isDesktop ? 48 : 58;
        const barH = Math.max(6, Math.round((sunMin / 60) * maxBarHeight));
        const by = chartBottom - barH;
        const opacity = Math.min(0.7, (sunMin / 60) * 0.45 + 0.2);
        sunBarsHtml += `<rect class="day-sun-bar" data-hour="${h}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}" rx="3" fill="url(#${sunGradId})" fill-opacity="${opacity.toFixed(2)}" />`;
      }
    }
  }

  // 2. Temperaturkurve als glatter kubischer Bezier-Pfad
  const pts = [];
  for (let h = 0; h < 24; h++) {
    pts.push({ x: getX(h + 0.5), y: getY(validTemps[h]), t: validTemps[h], h });
  }

  let pathD = `M ${getX(0).toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let idx = 0; idx < pts.length - 1; idx++) {
    const p0 = pts[Math.max(0, idx - 1)];
    const p1 = pts[idx];
    const p2 = pts[idx + 1];
    const p3 = pts[Math.min(pts.length - 1, idx + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  pathD += ` L ${getX(24).toFixed(1)} ${pts[pts.length - 1].y.toFixed(1)}`;

  const fillD = `${pathD} L ${getX(24).toFixed(1)} ${chartBottom.toFixed(1)} L ${getX(0).toFixed(1)} ${chartBottom.toFixed(1)} Z`;

  // Min / Max Marker
  let minPt = pts[0], maxPt = pts[0];
  for (const pt of pts) {
    if (pt.t < minPt.t) minPt = pt;
    if (pt.t > maxPt.t) maxPt = pt;
  }

  const pillWidth = 44;
  const pillHalf = pillWidth / 2;
  const maxLabelX = Math.max(padLeft + pillHalf, Math.min(W - padRight - pillHalf, maxPt.x));
  const maxLabelY = Math.max(isDesktop ? 26 : 34, maxPt.y - 11);
  const minLabelX = Math.max(padLeft + pillHalf, Math.min(W - padRight - pillHalf, minPt.x));
  const minLabelY = minPt.y > chartBottom - 20 ? (minPt.y - 11) : (minPt.y + 16);

  // 3. Niederschlagsteil (Bedingt: NUR Balken pur, keine unleserlichen Zahlen-Überlappungen!)
  let precipSectionHtml = '';
  const pBaseY = isDesktop ? 146 : 178;
  if (hasPrecip) {
    const maxPrecipVal = Math.max(2, ...hourlyPrecip);
    const pMaxH = isDesktop ? 20 : 24;
    const pLineY = isDesktop ? 120 : 142;
    const pHeaderY = isDesktop ? 130 : 152;

    let pBars = '';
    for (let h = 0; h < 24; h++) {
      const pAmt = hourlyPrecip[h] || 0;
      const popVal = (hourlyPop && hourlyPop[h]) || 0;
      if (pAmt > 0.05 || popVal >= 15) {
        const bx = getX(h) + (isDesktop ? 2 : 1);
        const bw = Math.max(3, (chartW / 24) - (isDesktop ? 4 : 2));
        const bH = Math.max(4, Math.round((pAmt / maxPrecipVal) * pMaxH));
        const by = pBaseY - bH;
        pBars += `<rect class="day-precip-bar" data-hour="${h}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bH.toFixed(1)}" rx="2.5" fill="#38bdf8" fill-opacity="0.80" />`;
      }
    }

    precipSectionHtml = `
      <!-- Niederschlags-Trennlinie & Sektion (Minimalistisches Regenprofil ohne störende Zahlenüberlappungen) -->
      <line x1="${padLeft}" y1="${pLineY}" x2="${W - padRight}" y2="${pLineY}" stroke="rgba(255, 255, 255, 0.09)" stroke-width="1" />
      <text x="${padLeft}" y="${pHeaderY}" font-size="${isDesktop ? '10' : '10.5'}" font-weight="800" fill="#38bdf8" letter-spacing="0.4">💧 NIEDERSCHLAG (mm / h)</text>
      ${pBars}
    `;
  }

  const timeAxisY = hasPrecip ? (isDesktop ? 168 : 198) : (isDesktop ? 144 : 162);
  const sunriseAnchor = xSunrise < padLeft + 30 ? 'start' : 'middle';
  const sunsetAnchor = xSunset > W - padRight - 30 ? 'end' : 'middle';

  // Zeitachsen-Beschriftung (Desktop: präzise 3h-Intervalle, Mobile: 6h-Intervalle)
  let timeAxisHtml = '';
  if (isDesktop) {
    const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    timeAxisHtml = hours.map(h => {
      const anchor = h === 0 ? 'start' : (h === 24 ? 'end' : 'middle');
      const label = `${String(h).padStart(2, '0')}:00`;
      return `<text x="${getX(h).toFixed(1)}" y="${timeAxisY}" text-anchor="${anchor}">${label}</text>`;
    }).join('');
  } else {
    timeAxisHtml = `
      <text x="${getX(0).toFixed(1)}" y="${timeAxisY}" text-anchor="start">00:00</text>
      <text x="${getX(6).toFixed(1)}" y="${timeAxisY}" text-anchor="middle">06:00</text>
      <text x="${getX(12).toFixed(1)}" y="${timeAxisY}" text-anchor="middle">12:00</text>
      <text x="${getX(18).toFixed(1)}" y="${timeAxisY}" text-anchor="middle">18:00</text>
      <text x="${getX(24).toFixed(1)}" y="${timeAxisY}" text-anchor="end">24:00</text>
    `;
  }

  // 4. Dezent-eleganter JETZT-Indikator (nur für den aktuellen Tag)
  const isCurrentDay = (isToday === true || dayIndex === 0);
  let nowIndicatorHtml = '';
  if (isCurrentDay) {
    const now = new Date();
    const curHourDec = now.getHours() + (now.getMinutes() / 60);

    if (curHourDec >= 0 && curHourDec <= 24) {
      const xNow = getX(curHourDec);

      // Temperatur am aktuellen Zeitpunkt entlang der Kurve interpolieren
      const hFloor = Math.min(22, Math.floor(curHourDec));
      const hCeil = Math.min(23, hFloor + 1);
      const hFrac = curHourDec - hFloor;
      const tNow = validTemps[hFloor] + (validTemps[hCeil] - validTemps[hFloor]) * hFrac;
      const yNow = getY(tNow);

      const lineBottomY = hasPrecip ? pBaseY : chartBottom;

      // Kollisions-Prüfung mit Sonnenaufgang & Sonnenuntergang (y = 16)
      const distSunrise = Math.abs(xNow - xSunrise);
      const distSunset = Math.abs(xNow - xSunset);
      const distMaxLabel = Math.abs(xNow - maxLabelX);

      let badgeY = 15;
      let badgeX = xNow;

      if (distSunrise < 38) {
        badgeX = (xNow >= xSunrise) ? (xNow + 18) : (xNow - 18);
      } else if (distSunset < 38) {
        badgeX = (xNow <= xSunset) ? (xNow - 18) : (xNow + 18);
      } else if (distMaxLabel < 38) {
        badgeX = (xNow <= maxLabelX) ? (xNow - 20) : (xNow + 20);
      }

      // Verhindere Randüberlauf links/rechts
      const pillW = 28;
      const pillHalfW = pillW / 2;
      if (badgeX - pillHalfW < padLeft) {
        badgeX = padLeft + pillHalfW;
      } else if (badgeX + pillHalfW > W - padRight) {
        badgeX = W - padRight - pillHalfW;
      }

      const pillH = isDesktop ? 13 : 14;

      nowIndicatorHtml = `
        <!-- Dezent-eleganter JETZT-Indikator (Aktuelle Position im Tagesverlauf) -->
        <g class="day-chart-now-marker" style="pointer-events:none;">
          <!-- Vertikale zarte Zeitlinie -->
          <line class="day-now-line" x1="${xNow.toFixed(1)}" y1="20" x2="${xNow.toFixed(1)}" y2="${lineBottomY}" stroke="#00e5ff" stroke-width="1.1" stroke-dasharray="2,3" stroke-opacity="0.55" />

          <!-- Sanfter Glow-Ring & Core-Punkt auf der Temperaturkurve -->
          <circle class="day-now-glow" cx="${xNow.toFixed(1)}" cy="${yNow.toFixed(1)}" r="${isDesktop ? '5.5' : '6'}" fill="rgba(0, 229, 255, 0.18)" />
          <circle class="day-now-dot" cx="${xNow.toFixed(1)}" cy="${yNow.toFixed(1)}" r="${isDesktop ? '2.4' : '2.8'}" fill="#00e5ff" stroke="#ffffff" stroke-width="1.2" />

          <!-- Minimalistisches 'JETZT'-Pill-Badge -->
          <rect x="${(badgeX - pillW / 2).toFixed(1)}" y="${(badgeY - pillH / 2 - 1).toFixed(1)}" width="${pillW}" height="${pillH}" rx="3.5" fill="rgba(15, 23, 42, 0.88)" stroke="rgba(0, 229, 255, 0.55)" stroke-width="0.8" />
          <text x="${badgeX.toFixed(1)}" y="${(badgeY + 3).toFixed(1)}" text-anchor="middle" font-size="${isDesktop ? '8' : '8.5'}" font-weight="800" fill="#00e5ff" letter-spacing="0.5">JETZT</text>
        </g>
      `;
    }
  }

  return `
    <svg class="inline-day-svg" viewBox="0 0 ${W} ${H}" width="100%" height="auto" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#38bdf8" />
          <stop offset="35%" stop-color="#fbbf24" />
          <stop offset="70%" stop-color="#f97316" />
          <stop offset="100%" stop-color="#38bdf8" />
        </linearGradient>
        <linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.25" />
          <stop offset="65%" stop-color="#38bdf8" stop-opacity="0.05" />
          <stop offset="100%" stop-color="#0f172a" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="${sunGradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fde047" />
          <stop offset="100%" stop-color="#f59e0b" />
        </linearGradient>
        <filter id="glow_${dayIndex}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#f59e0b" flood-opacity="0.35" />
        </filter>
      </defs>

      <!-- Volle Event-Erfassung für flüssigen Scrubber (über gesamte Chart-Fläche) -->
      <rect class="svg-pointer-catch" x="0" y="0" width="${W}" height="${H}" fill="transparent" pointer-events="all" style="cursor: crosshair;" />

      <!-- Tageslicht-Glow Hintergrundzone zwischen Sonnenaufgang und Untergang -->
      ${xSunset > xSunrise ? `
        <rect x="${xSunrise.toFixed(1)}" y="${chartTop}" width="${(xSunset - xSunrise).toFixed(1)}" height="${chartHeight}" rx="4" fill="rgba(245, 158, 11, 0.08)" />
      ` : ''}

      <!-- Horizontale Hilfslinien -->
      <line x1="${padLeft}" y1="${chartBottom}" x2="${W - padRight}" y2="${chartBottom}" stroke="rgba(255, 255, 255, 0.09)" stroke-width="1" />
      <line x1="${padLeft}" y1="${chartTop}" x2="${W - padRight}" y2="${chartTop}" stroke="rgba(255, 255, 255, 0.05)" stroke-dasharray="2,4" stroke-width="1" />

      <!-- Sonnenstunden Balken (Golden Solar Glow) -->
      ${sunBarsHtml}

      <!-- Temperaturverlauf Flächenfüllung & Spline -->
      <path d="${fillD}" fill="url(#${fillId})" />
      <path d="${pathD}" fill="none" stroke="url(#${gradId})" stroke-width="${isDesktop ? '2.8' : '3.2'}" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow_${dayIndex})" />

      <!-- Min & Max Marker mit Hochkontrast-Pill -->
      <circle cx="${maxPt.x.toFixed(1)}" cy="${maxPt.y.toFixed(1)}" r="${isDesktop ? '4.2' : '4.8'}" fill="#ffffff" stroke="#fbbf24" stroke-width="${isDesktop ? '2' : '2.5'}" />
      <rect x="${(maxLabelX - pillHalf).toFixed(1)}" y="${(maxLabelY - 14).toFixed(1)}" width="${pillWidth}" height="${isDesktop ? '17' : '18'}" rx="5" fill="rgba(15, 23, 42, 0.88)" stroke="rgba(251, 191, 36, 0.5)" stroke-width="0.8" />
      <text x="${maxLabelX.toFixed(1)}" y="${maxLabelY.toFixed(1)}" text-anchor="middle" font-size="${isDesktop ? '11.5' : '12.5'}" font-weight="800" fill="#fde047">H ${Math.round(maxPt.t)}°</text>

      <circle cx="${minPt.x.toFixed(1)}" cy="${minPt.y.toFixed(1)}" r="${isDesktop ? '4.2' : '4.8'}" fill="#ffffff" stroke="#38bdf8" stroke-width="${isDesktop ? '2' : '2.5'}" />
      <rect x="${(minLabelX - pillHalf).toFixed(1)}" y="${(minLabelY - 14).toFixed(1)}" width="${pillWidth}" height="${isDesktop ? '17' : '18'}" rx="5" fill="rgba(15, 23, 42, 0.88)" stroke="rgba(56, 189, 248, 0.5)" stroke-width="0.8" />
      <text x="${minLabelX.toFixed(1)}" y="${minLabelY.toFixed(1)}" text-anchor="middle" font-size="${isDesktop ? '11.5' : '12.5'}" font-weight="800" fill="#7dd3fc">T ${Math.round(minPt.t)}°</text>

      <!-- Sonnenauf- & Sonnenuntergang Vertikale Linien & Meilensteine -->
      <line x1="${xSunrise.toFixed(1)}" y1="22" x2="${xSunrise.toFixed(1)}" y2="${chartBottom}" stroke="rgba(251, 191, 36, 0.75)" stroke-width="1.3" stroke-dasharray="3,3" />
      <text x="${xSunrise.toFixed(1)}" y="16" text-anchor="${sunriseAnchor}" font-size="${isDesktop ? '11' : '11.5'}" font-weight="800" fill="#fbbf24">🌅 ${sunriseStr}</text>

      <line x1="${xSunset.toFixed(1)}" y1="22" x2="${xSunset.toFixed(1)}" y2="${chartBottom}" stroke="rgba(251, 146, 60, 0.75)" stroke-width="1.3" stroke-dasharray="3,3" />
      <text x="${xSunset.toFixed(1)}" y="16" text-anchor="${sunsetAnchor}" font-size="${isDesktop ? '11' : '11.5'}" font-weight="800" fill="#fb923c">🌇 ${sunsetStr}</text>

      <!-- Niederschlag (nur wenn Niederschlag vorhanden) -->
      ${precipSectionHtml}

      <!-- Zeitachse -->
      <g class="chart-time-axis" font-size="${isDesktop ? '10.5' : '11'}" font-weight="700" fill="#94a3b8">
        ${timeAxisHtml}
      </g>

      <!-- Dezent-eleganter JETZT-Indikator (Aktuelle Position im Tagesverlauf) -->
      ${nowIndicatorHtml}

      <!-- Interaktiver Scrubber (Linie & Punkt auf Temperaturkurve) -->
      <g class="chart-scrubber-group" style="display:none; pointer-events:none;">
        <line class="scrubber-line" x1="0" y1="${chartTop - 6}" x2="0" y2="${hasPrecip ? pBaseY : chartBottom}" stroke="rgba(56, 189, 248, 0.85)" stroke-width="1.5" stroke-dasharray="3,3" />
        <circle class="scrubber-dot-glow" cx="0" cy="0" r="7.5" fill="rgba(56, 189, 248, 0.28)" />
        <circle class="scrubber-dot" cx="0" cy="0" r="4.2" fill="#ffffff" stroke="#38bdf8" stroke-width="2.2" />
      </g>
    </svg>
  `;
}

/**
 * Interaktiver Stunden-Scrubber für den 24h-Tagesverlauf
 * Ermöglicht stufenloses Hovern & Touch-Scrubben mit minimalem HUD ohne Inhaltsverdeckung
 */
export function setupDayChartScrubber(chartCard, data) {
  if (!chartCard || !data) return;
  const svg = chartCard.querySelector('.inline-day-svg');
  const hudIdle = chartCard.querySelector('.dch-idle');
  const hudActive = chartCard.querySelector('.dch-active');
  const valTime = chartCard.querySelector('.dch-val-time');
  const valTemp = chartCard.querySelector('.dch-val-temp');
  const valSun = chartCard.querySelector('.dch-val-sun');
  const valPrecip = chartCard.querySelector('.dch-val-precip');
  const scrubberGroup = svg?.querySelector('.chart-scrubber-group');
  const scrubberLine = svg?.querySelector('.scrubber-line');
  const scrubberDot = svg?.querySelector('.scrubber-dot');
  const scrubberGlow = svg?.querySelector('.scrubber-dot-glow');

  if (!svg || !hudActive || !scrubberGroup) return;

  const isDesktop = (typeof window !== 'undefined' && window.innerWidth >= 900);
  const W = isDesktop ? 680 : 380;
  const padLeft = isDesktop ? 26 : 22;
  const padRight = isDesktop ? 26 : 22;
  const chartW = W - padLeft - padRight;
  const chartTop = isDesktop ? 30 : 38;
  const chartBottom = isDesktop ? 116 : 136;
  const chartHeight = chartBottom - chartTop;

  const validTemps = data.hourlyTemps;
  const minT = (typeof data.tMin === 'number' && !isNaN(data.tMin)) ? data.tMin : Math.min(...validTemps);
  const maxT = (typeof data.tMax === 'number' && !isNaN(data.tMax)) ? data.tMax : Math.max(...validTemps);
  const tempRange = Math.max(2, maxT - minT);

  const getX = (hour) => padLeft + (Math.max(0, Math.min(24, hour)) / 24) * chartW;
  const getY = (t) => chartBottom - ((t - minT) / tempRange) * chartHeight;

  let resetTimer = null;

  function updateScrub(hour) {
    if (hour < 0 || hour > 23) return;

    if (hudIdle) hudIdle.style.display = 'none';
    hudActive.style.display = 'flex';

    if (valTime) valTime.textContent = `${String(hour).padStart(2, '0')}:00 Uhr`;
    if (valTemp) valTemp.textContent = `${Math.round(validTemps[hour])}°`;

    const sSec = (data.hourlySunSecList && data.hourlySunSecList[hour]) || 0;
    const sMin = Math.round(sSec / 60);
    if (valSun) valSun.textContent = `${sMin} Min.`;

    const pAmt = (data.hourlyPrecip && data.hourlyPrecip[hour]) || 0;
    const popVal = (data.hourlyPop && data.hourlyPop[hour]) || 0;
    if (valPrecip) {
      if (pAmt > 0.05 || popVal >= 10) {
        valPrecip.textContent = `${pAmt.toFixed(1)} mm (${popVal}%)`;
      } else {
        valPrecip.textContent = `0,0 mm (0%)`;
      }
    }

    const hX = getX(hour + 0.5);
    const hY = getY(validTemps[hour]);

    if (scrubberLine) {
      scrubberLine.setAttribute('x1', hX.toFixed(1));
      scrubberLine.setAttribute('x2', hX.toFixed(1));
    }
    if (scrubberDot) {
      scrubberDot.setAttribute('cx', hX.toFixed(1));
      scrubberDot.setAttribute('cy', hY.toFixed(1));
    }
    if (scrubberGlow) {
      scrubberGlow.setAttribute('cx', hX.toFixed(1));
      scrubberGlow.setAttribute('cy', hY.toFixed(1));
    }
    scrubberGroup.style.display = 'block';

    svg.querySelectorAll('.day-sun-bar').forEach(b => {
      b.classList.toggle('is-scrubbed', b.dataset.hour === String(hour));
    });
    svg.querySelectorAll('.day-precip-bar').forEach(b => {
      b.classList.toggle('is-scrubbed', b.dataset.hour === String(hour));
    });
  }

  function resetScrub() {
    if (hudIdle) hudIdle.style.display = 'flex';
    if (hudActive) hudActive.style.display = 'none';
    if (scrubberGroup) scrubberGroup.style.display = 'none';
    svg.querySelectorAll('.day-sun-bar.is-scrubbed').forEach(b => b.classList.remove('is-scrubbed'));
    svg.querySelectorAll('.day-precip-bar.is-scrubbed').forEach(b => b.classList.remove('is-scrubbed'));
  }

  function handlePointer(e) {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }

    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;

    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : null);
    if (clientX === null) return;

    const svgRelX = clientX - rect.left;
    const scale = W / rect.width;
    const viewBoxX = svgRelX * scale;

    const chartRelX = viewBoxX - padLeft;
    const frac = Math.max(0, Math.min(0.999, chartRelX / chartW));
    const hour = Math.floor(frac * 24);

    updateScrub(hour);
  }

  const svgWrap = chartCard.querySelector('.day-chart-svg-wrap') || svg;

  svgWrap.addEventListener('pointermove', handlePointer);
  svgWrap.addEventListener('pointerdown', handlePointer);
  svgWrap.addEventListener('mousemove', handlePointer);
  svgWrap.addEventListener('touchmove', handlePointer, { passive: true });

  svgWrap.addEventListener('pointerleave', () => {
    resetTimer = setTimeout(resetScrub, 1200);
  });
  svgWrap.addEventListener('mouseleave', () => {
    resetTimer = setTimeout(resetScrub, 1200);
  });
  svgWrap.addEventListener('pointerup', () => {
    resetTimer = setTimeout(resetScrub, 1500);
  });
  svgWrap.addEventListener('touchend', () => {
    resetTimer = setTimeout(resetScrub, 1500);
  });
  svgWrap.addEventListener('pointercancel', () => {
    resetTimer = setTimeout(resetScrub, 600);
  });
}

export function render10DayForecast(daily, hourly) {
  const container = document.getElementById('daily-forecast-list');
  if (!container || !daily || !daily.time || daily.time.length === 0) return;

  const fragment = document.createDocumentFragment();
  const weekdaysShort = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const weekdaysFull = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  const todayKey = getLocalDateKey(new Date());
  const visibleDayIndices = [];
  for (let i = 0; i < daily.time.length; i++) {
    const dk = String(daily.time[i] || '').slice(0, 10);
    if (!dk || dk >= todayKey) {
      visibleDayIndices.push(i);
      if (visibleDayIndices.length >= 10) break;
    }
  }
  if (visibleDayIndices.length === 0) {
    const todayLabel = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'short' });
    const lastCachedDate = parseLocalDateKey(String(daily.time[daily.time.length - 1] || '').slice(0, 10));
    const offlineCard = document.createElement('div');
    offlineCard.className = 'daily-stale-notice';
    offlineCard.style.cssText = 'padding:14px 16px;margin:4px 0;border-radius:16px;background:rgba(15,23,42,0.55);border:1px solid rgba(56,189,248,0.35);color:#e2e8f0;font-size:13px;line-height:1.45;display:flex;flex-direction:column;gap:10px;';
    offlineCard.innerHTML = `
      <div><strong>Heute ist ${escapeHtml(todayLabel)}</strong> — die gespeicherten Offline-Daten enden bereits am ${escapeHtml(lastCachedDate.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }))} und werden nicht mehr als aktueller Trend angezeigt.</div>
      <button type="button" class="daily-retry-fresh-btn" style="align-self:flex-start;padding:8px 14px;border-radius:999px;border:1px solid rgba(56,189,248,0.5);background:rgba(56,189,248,0.18);color:#e0f2fe;font-weight:700;font-size:12px;cursor:pointer;">🔄 Live-Daten für heute laden</button>
    `;
    const retryBtn = offlineCard.querySelector('.daily-retry-fresh-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (window.loadLocation && state.currentLocation) {
          window.loadLocation(state.currentLocation, { forceRefresh: true });
        }
      });
    }
    container.replaceChildren(offlineCard);
    return;
  }

  let gMin = Infinity, gMax = -Infinity;
  const count = visibleDayIndices.length;
  for (const rawIdx of visibleDayIndices) {
    if (daily.temperature_2m_min[rawIdx] < gMin) gMin = daily.temperature_2m_min[rawIdx];
    if (daily.temperature_2m_max[rawIdx] > gMax) gMax = daily.temperature_2m_max[rawIdx];
  }
  const totalRange = (gMax - gMin) || 1;
  const curTemp = state.weatherData?.current ? state.weatherData.current.temperature_2m : null;

  for (let visibleIdx = 0; visibleIdx < count; visibleIdx++) {
    const i = visibleDayIndices[visibleIdx];
    const dateKey = String(daily.time[i] || '').slice(0, 10);
    const d = parseLocalDateKey(dateKey || daily.time[i]);
    const isToday = Boolean(dateKey && dateKey === todayKey);
    const dayNameShort = isToday ? 'Heute' : weekdaysShort[d.getDay()];
    const dayNameFull = isToday ? 'Heute' : weekdaysFull[d.getDay()];
    const dateShort = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });

    const syn = MicroEngine.computeRepresentativeDailyCondition(i, daily, hourly, isToday, state.weatherData?.current);
    const condIcon = syn.icon;
    const condLabel = syn.label;
    const pop = daily.precipitation_probability_max ? Math.round(daily.precipitation_probability_max[i] || 0) : 0;
    const rainSum = (daily.precipitation_sum && daily.precipitation_sum[i] != null) ? Number(daily.precipitation_sum[i]) : 0;
    const windSpd = Math.round(daily.wind_speed_10m_max ? daily.wind_speed_10m_max[i] : 12);
    const windGusts = Math.round(daily.wind_gusts_10m_max ? daily.wind_gusts_10m_max[i] : windSpd * 1.4);
    const uvMax = daily.uv_index_max ? Math.round(daily.uv_index_max[i]) : 1;
    const minVal = daily.temperature_2m_min[i];
    const maxVal = daily.temperature_2m_max[i];

    // 24h-Stundenarrays für diesen spezifischen Tag extrahieren (per Datum-Abgleich)
    const dayStartHourIdx = getDayHourlyStartIndex(dateKey, i, hourly);
    const hourlyTemps = [];
    const hourlySunSecList = [];
    const hourlyPrecip = [];
    const hourlyPop = [];

    let totalDaySunSec = 0;
    for (let h = 0; h < 24; h++) {
      const hIdx = dayStartHourIdx + h;
      
      // Temperatur
      let t = 10;
      if (hourly && hourly.temperature_2m && hourly.temperature_2m[hIdx] != null && !isNaN(hourly.temperature_2m[hIdx])) {
        t = hourly.temperature_2m[hIdx];
      }
      hourlyTemps.push(convertTemp(t));

      // Sonnenschein
      let sSec = 0;
      if (hourly && hourly.sunshine_duration && hourly.sunshine_duration[hIdx] != null && !isNaN(hourly.sunshine_duration[hIdx])) {
        sSec = hourly.sunshine_duration[hIdx];
      } else if (hourly && hourly.cloud_cover && hourly.cloud_cover[hIdx] != null) {
        const isDay = (hourly.is_day ? hourly.is_day[hIdx] === 1 : (h >= 7 && h <= 17));
        sSec = isDay ? Math.max(0, (100 - (hourly.cloud_cover[hIdx] || 0)) / 100 * 3600) : 0;
      }
      hourlySunSecList.push(sSec);
      totalDaySunSec += sSec;

      // Niederschlag
      let p = 0;
      if (hourly && hourly.precipitation && hourly.precipitation[hIdx] != null && !isNaN(hourly.precipitation[hIdx])) {
        p = hourly.precipitation[hIdx];
      }
      hourlyPrecip.push(p);

      // Niederschlagswahrscheinlichkeit
      let popVal = 0;
      if (hourly && hourly.precipitation_probability && hourly.precipitation_probability[hIdx] != null) {
        popVal = hourly.precipitation_probability[hIdx];
      }
      hourlyPop.push(popVal);
    }

    // Sunshine hours & daylight duration calculations — 100% mathematische Konsistenz
    const daylightSec = daily.daylight_duration ? (daily.daylight_duration[i] || 0) : 0;
    const sunDurSec = Math.max(totalDaySunSec, daily.sunshine_duration ? (daily.sunshine_duration[i] || 0) : 0);
    const sunHours = sunDurSec / 3600;
    const sunHoursFormatted = sunHours >= 10 ? Math.round(sunHours) + ' h' : sunHours.toFixed(1).replace('.', ',') + ' h';
    const daylightHours = daylightSec > 0 ? (daylightSec / 3600) : 0;
    const sunQuotaPct = daylightSec > 0 ? Math.min(100, Math.round((sunDurSec / daylightSec) * 100)) : 0;

    // Mini sparkline for daylight hours (06:00 to 18:00 = 13 hours) — greift exakt auf dieselben hourlySunSecList zu
    const sparkHours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    const miniBars = [];
    for (const h of sparkHours) {
      const hSunSec = hourlySunSecList[h] || 0;
      const sunMin = Math.round(Math.min(60, Math.max(0, hSunSec / 60)));

      let miniClass = 'msb-overcast';
      let miniHeightPct = 18;
      if (sunMin >= 45) {
        miniClass = 'msb-full';
        miniHeightPct = 100;
      } else if (sunMin >= 20) {
        miniClass = 'msb-mid';
        miniHeightPct = 60;
      } else if (sunMin >= 5) {
        miniClass = 'msb-low';
        miniHeightPct = 35;
      } else {
        const hIdx = dayStartHourIdx + h;
        const isDayHour = hourly && hourly.is_day ? hourly.is_day[hIdx] === 1 : (h >= 7 && h <= 17);
        if (!isDayHour) {
          miniClass = 'msb-night';
          miniHeightPct = 10;
        }
      }
      miniBars.push(`<span class="msb-bar ${miniClass}" style="height:${miniHeightPct}%;" title="${h}:00 Uhr: ${sunMin} Min. Sonne"></span>`);
    }
    const miniBarsHtml = miniBars.join('');

    const sunriseDate = daily.sunrise && daily.sunrise[i] ? new Date(daily.sunrise[i]) : null;
    const sunsetDate = daily.sunset && daily.sunset[i] ? new Date(daily.sunset[i]) : null;
    const sunriseStr = sunriseDate && !isNaN(sunriseDate.getTime()) ? sunriseDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const sunsetStr = sunsetDate && !isNaN(sunsetDate.getTime()) ? sunsetDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--';
    const sunriseDec = sunriseDate && !isNaN(sunriseDate.getTime()) ? (sunriseDate.getHours() + sunriseDate.getMinutes() / 60) : 7.25;
    const sunsetDec = sunsetDate && !isNaN(sunsetDate.getTime()) ? (sunsetDate.getHours() + sunsetDate.getMinutes() / 60) : 16.75;

    // Harmonisiere Min/Max-Temperaturen mit den stündlichen Werten (verhindert Widersprüche zwischen Badge und Chart)
    const minHourlyT = hourlyTemps.length ? Math.min(...hourlyTemps) : convertTemp(minVal);
    const maxHourlyT = hourlyTemps.length ? Math.max(...hourlyTemps) : convertTemp(maxVal);
    const harmonizedMin = Math.min(convertTemp(minVal), minHourlyT);
    const harmonizedMax = Math.max(convertTemp(maxVal), maxHourlyT);

    // SVG Chart für den 24h-Tagesüberblick
    const dayChartSvg = renderDayOverviewSVG({
      dayIndex: i,
      hourlyTemps,
      hourlySunSecList,
      hourlyPrecip,
      hourlyPop,
      sunriseStr,
      sunsetStr,
      sunriseDec,
      sunsetDec,
      tMin: harmonizedMin,
      tMax: harmonizedMax,
      isToday: (i === 0)
    });

    const isExtended = visibleIdx >= 3;
    const isInitiallyCollapsed = isExtended && !state.daily10DayExpanded;
    const wrapper = document.createElement('div');
    wrapper.className = `daily-item-wrapper ${isExtended ? (isInitiallyCollapsed ? 'daily-extended-item is-collapsed' : 'daily-extended-item') : ''}`;
    wrapper.id = `daily-item-${i}`;

    wrapper.innerHTML = `
      <div class="daily-interactive-row" data-index="${i}" role="button" tabindex="0" aria-expanded="false" aria-controls="inline-accordion-${i}">
        <!-- TOP DECK (Deck 1 on Mobile, flows in desktop grid) -->
        <div class="daily-row-mobile-top">
          <!-- 1. Day & Date -->
          <div class="daily-date-cell">
            <div class="daily-day-label">
              <span class="day-full">${dayNameFull}</span>
              <span class="day-short">${dayNameShort}</span>
            </div>
            <div class="daily-date-badge">${dateShort}</div>
          </div>

          <!-- 2. Condition & Icon -->
          <div class="daily-condition-cell">
            <span class="daily-icon-box" title="${condLabel}">${condIcon}</span>
            <span class="daily-cond-text" title="${condLabel}">${condLabel}</span>
          </div>

          <!-- 3. Minimalist Crisp Temperature Min / Max -->
          <div class="daily-temp-cell">
            <span class="daily-temp-badge">
              <span class="dt-min" title="Tiefsttemperatur">${Math.round(harmonizedMin)}°</span>
              <span class="dt-sep">/</span>
              <span class="dt-max" title="Höchsttemperatur">${Math.round(harmonizedMax)}°</span>
            </span>
          </div>

          <!-- 4. Expand Chevron Indicator -->
          <div class="daily-action-cell">
            <span class="daily-expand-chevron" aria-hidden="true">›</span>
          </div>
        </div>

        <!-- BOTTOM DECK (Deck 2 on Mobile, flows in desktop grid) -->
        <div class="daily-row-mobile-bottom">
          <!-- 5. Sunshine Hours, Mini-Sparkline & Sunrise/Sunset -->
          <div class="daily-sun-cell">
            <div class="daily-sun-mini-group" title="${sunHoursFormatted} Sonnenschein">
              <span class="dsm-hours">☀️ ${sunHoursFormatted}</span>
              <div class="dsm-chart" title="Verteilung von 06:00 bis 18:00 Uhr">
                ${miniBarsHtml}
              </div>
            </div>
            <div class="daily-astro-pill" title="Sonnenaufgang: ${sunriseStr} Uhr · Sonnenuntergang: ${sunsetStr} Uhr">
              <span class="dap-item">🌅 ${sunriseStr}</span>
              <span class="dap-dot">•</span>
              <span class="dap-item">🌇 ${sunsetStr}</span>
            </div>
          </div>

          <!-- 6. Precipitation & Exact EAWS Avalanche Score (when official bulletin active) -->
          <div class="daily-precip-cell">
            ${(() => {
              const avDays = (state.microData && state.microData.avalancheReport && Array.isArray(state.microData.avalancheReport.forecast10Days))
                ? state.microData.avalancheReport.forecast10Days : [];
              const avDay = avDays.find(x => x.dateKey === dateKey);
              let llbChip = '';
              if (avDay && avDay.isOfficialDay) {
                const maxLvl = Math.max(avDay.morning.level, avDay.afternoon.level);
                const meta = MicroEngine.getEawsScaleMeta(maxLvl);
                const lbl = avDay.morning.level === avDay.afternoon.level ? `Lawinenstufe ${maxLvl}/5` : `Lawinenstufe ${avDay.morning.level}/${avDay.afternoon.level}`;
                llbChip = `<span class="daily-llb-pill" style="background:${meta.color};color:${meta.textColor};" title="Exakter offizieller Lawinenlagebericht: Vormittag ${avDay.morning.level}/5 • Nachmittag ${avDay.afternoon.level}/5">🟢 ${lbl}</span>`;
              }
              const snowSum = daily.snowfall_sum ? (daily.snowfall_sum[i] || 0) : 0;
              const parts = [];
              if (pop > 10 || rainSum > 0.05) {
                const rainVal = (rainSum >= 10 && Math.abs(rainSum - Math.round(rainSum)) < 0.05) ? Math.round(rainSum) : (Math.round(rainSum * 10) / 10);
                const rainStr = String(rainVal).replace('.', ',');
                parts.push(`💧 ${pop}% ${rainStr} mm`);
              }
              if (snowSum > 0.05) {
                const snowVal = (snowSum >= 10 && Math.abs(snowSum - Math.round(snowSum)) < 0.05) ? Math.round(snowSum) : (Math.round(snowSum * 10) / 10);
                const snowStr = String(snowVal).replace('.', ',');
                parts.push(`❄️ ${snowStr} cm`);
              }
              const precipHtml = parts.length === 0
                ? '<span class="daily-precip-dry">💧 0%</span>'
                : `<span class="daily-precip-chip ${rainSum >= 5 || snowSum >= 5 ? 'heavy-rain' : ''}">${parts.join(' · ')}</span>`;
              return `${llbChip}${precipHtml}`;
            })()}
          </div>
        </div>
      </div>

      <!-- INLINE EXPANDABLE METEOROLOGICAL ACCORDION -->
      <div class="daily-inline-accordion" id="inline-accordion-${i}" style="display:none;">
        <div class="inline-accordion-inner">
          
          <!-- 24h-Tagesverlauf (Apple-Weather-Grade SVG: Temperaturverlauf, Sonnenstunden, Meilensteine & bedingter Niederschlag) -->
          <div class="inline-section-header">
            <span class="ish-title">⏱️ 24h-Tagesverlauf</span>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              ${(() => {
                const avDays = (state.microData && state.microData.avalancheReport && Array.isArray(state.microData.avalancheReport.forecast10Days))
                  ? state.microData.avalancheReport.forecast10Days : [];
                const avDay = avDays.find(x => x.dateKey === dateKey);
                if (avDay && avDay.isOfficialDay) {
                  const maxLvl = Math.max(avDay.morning.level, avDay.afternoon.level);
                  const meta = MicroEngine.getEawsScaleMeta(maxLvl);
                  return `<span class="ish-badge ish-llb-badge" style="background:${meta.color};color:${meta.textColor};">🟢 Offizieller Lawinenlagebericht: Vormittag ${avDay.morning.level}/5 • Nachmittag ${avDay.afternoon.level}/5</span>`;
                }
                return '';
              })()}
              <span class="ish-badge">☀️ ${sunHoursFormatted}${sunQuotaPct > 0 ? ` (${sunQuotaPct}% Sonne)` : ''}</span>
            </div>
          </div>
          <div class="inline-day-chart-card" data-day-index="${i}">
            <!-- Minimalist Dynamic Scrubber HUD (Stunden-Details ohne Inhaltsverdeckung) -->
            <div class="day-chart-hud" id="day-chart-hud-${i}">
              <div class="dch-idle">
                <span class="dch-hint-dot"></span>
                <span class="dch-hint-text">Diagramm berühren oder mit Maus überfahren</span>
              </div>
              <div class="dch-active" style="display:none;">
                <span class="dch-badge dch-badge-time"><strong class="dch-val-time">--:--</strong></span>
                <span class="dch-badge dch-badge-temp">🌡️ <strong class="dch-val-temp">--°</strong></span>
                <span class="dch-badge dch-badge-sun">☀️ <strong class="dch-val-sun">-- Min.</strong></span>
                <span class="dch-badge dch-badge-precip">💧 <strong class="dch-val-precip">--</strong></span>
              </div>
            </div>
            <div class="day-chart-svg-wrap">
              ${dayChartSvg}
            </div>
          </div>

          <!-- Key Meteorological Metrics -->
          <div class="inline-stats-grid">
            <div class="isg-card">
              <span class="isg-icon">💨</span>
              <div class="isg-content">
                <span class="isg-lbl">Wind & Spitzenböen</span>
                <span class="isg-val">${windSpd} km/h <span class="isg-sub">(Böen ${windGusts} km/h)</span></span>
              </div>
            </div>
            <div class="isg-card">
              <span class="isg-icon">💧</span>
              <div class="isg-content">
                <span class="isg-lbl">Niederschlag 24h</span>
                <span class="isg-val">${rainSum > 0 ? `${rainSum.toFixed(1)} mm` : '0,0 mm'} <span class="isg-sub">(${pop}% Risiko)</span></span>
              </div>
            </div>
            <div class="isg-card">
              <span class="isg-icon">☀️</span>
              <div class="isg-content">
                <span class="isg-lbl">Maximaler UV-Index</span>
                <span class="isg-val">UV ${uvMax} <span class="isg-sub">(${uvMax <= 2 ? 'Niedrig' : uvMax <= 5 ? 'Mäßig' : 'Hoch'})</span></span>
              </div>
            </div>
            <div class="isg-card">
              <span class="isg-icon">🌡️</span>
              <div class="isg-content">
                <span class="isg-lbl">Gefühlte Temperatur</span>
                <span class="isg-val">${Math.round(convertTemp(daily.apparent_temperature_min ? daily.apparent_temperature_min[i] : minVal))}° bis ${Math.round(convertTemp(daily.apparent_temperature_max ? daily.apparent_temperature_max[i] : maxVal))}°</span>
              </div>
            </div>
          </div>

          <!-- Deep Modal Link Button -->
          <div class="inline-footer-actions">
            <button type="button" class="inline-modal-launch-btn" data-day-index="${i}">
              Vollständige 24h-Detailanalyse öffnen ↗
            </button>
          </div>

        </div>
      </div>
    `;

    // Toggle inline accordion on clicking ANYWHERE on the day row
    const rowElem = wrapper.querySelector('.daily-interactive-row');
    const accordion = wrapper.querySelector('.daily-inline-accordion');

    rowElem.addEventListener('click', (e) => {
      // If user clicked the launch modal button, do not toggle accordion
      if (e.target.closest('.inline-modal-launch-btn')) return;

      const isExpanded = accordion.style.display === 'block';
      accordion.style.display = isExpanded ? 'none' : 'block';
      wrapper.classList.toggle('expanded', !isExpanded);
      rowElem.setAttribute('aria-expanded', !isExpanded ? 'true' : 'false');

      if (!isExpanded) {
        const chartCard = accordion.querySelector('.inline-day-chart-card');
        if (chartCard) {
          const svgWrap = chartCard.querySelector('.day-chart-svg-wrap');
          if (svgWrap) {
            svgWrap.innerHTML = renderDayOverviewSVG({
              dayIndex: i,
              hourlyTemps,
              hourlySunSecList,
              hourlyPrecip,
              hourlyPop,
              sunriseStr,
              sunsetStr,
              sunriseDec,
              sunsetDec,
              tMin: harmonizedMin,
              tMax: harmonizedMax,
              isToday: (i === 0)
            });
          }
          setupDayChartScrubber(chartCard, {
            dayIndex: i,
            hourlyTemps,
            hourlySunSecList,
            hourlyPrecip,
            hourlyPop,
            tMin: harmonizedMin,
            tMax: harmonizedMax
          });
        }
      }
    });

    rowElem.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        rowElem.click();
      }
    });

    const modalBtn = wrapper.querySelector('.inline-modal-launch-btn');
    if (modalBtn) {
      modalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDayDetailModal(i, daily, hourly);
      });
    }

    const initialCard = wrapper.querySelector('.inline-day-chart-card');
    if (initialCard) {
      setupDayChartScrubber(initialCard, {
        dayIndex: i,
        hourlyTemps,
        hourlySunSecList,
        hourlyPrecip,
        hourlyPop,
        tMin: harmonizedMin,
        tMax: harmonizedMax
      });
    }

    fragment.appendChild(wrapper);
  }

  // 3-Tage-Fokus: "Ganze 10 Tage anzeigen" Toggle Button
  if (count > 3) {
    const isExpanded = Boolean(state.daily10DayExpanded);
    const expandBtnWrapper = document.createElement('div');
    expandBtnWrapper.className = 'daily-expand-bar';
    expandBtnWrapper.innerHTML = `
      <button type="button" class="daily-expand-toggle-btn ${isExpanded ? 'active' : ''}" id="daily-expand-toggle-btn" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <span class="det-icon">📅</span>
        <span class="det-text">${isExpanded ? 'Weniger Tage anzeigen' : `Ganze 10 Tage anzeigen (noch ${count - 3} Tage)`}</span>
        <span class="det-arrow">▾</span>
      </button>
    `;

    const toggleBtn = expandBtnWrapper.querySelector('#daily-expand-toggle-btn');
    const handleToggle = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const willExpand = !state.daily10DayExpanded;
      state.daily10DayExpanded = willExpand;

      const activeBtn = document.getElementById('daily-expand-toggle-btn') || toggleBtn;
      if (activeBtn) {
        activeBtn.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
        activeBtn.classList.toggle('active', willExpand);
        const detText = activeBtn.querySelector('.det-text');
        if (detText) {
          detText.innerText = willExpand ? 'Weniger Tage anzeigen' : `Ganze 10 Tage anzeigen (noch ${count - 3} Tage)`;
        }
      }

      const extendedItems = document.querySelectorAll('#daily-forecast-list .daily-extended-item');
      extendedItems.forEach(el => {
        el.classList.toggle('is-collapsed', !willExpand);
      });
      syncDailyColumnWidths();
    };

    toggleBtn.addEventListener('click', handleToggle);
    expandBtnWrapper.addEventListener('click', (e) => {
      if (e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
        handleToggle(e);
      }
    });

    fragment.appendChild(expandBtnWrapper);
  }

  // Single-commit atomic DOM update (Task 4b)
  container.replaceChildren(fragment);
  requestAnimationFrame(() => {
    syncDailyColumnWidths();
  });
}

let resizeDailySyncAttached = false;

/**
 * Dynamically synchronizes daily table column widths based on actual measured content.
 * Guarantees zero clipping of sun/moon hours or sunset timestamps on any system font rendering,
 * while expanding the condition text column flexibly with zero dead whitespace before temperature.
 */
export function syncDailyColumnWidths() {
  if (typeof window === 'undefined') return;
  const container = document.getElementById('daily-forecast-list');
  const card = document.querySelector('.daily-card');
  if (!container || !card) return;

  if (!resizeDailySyncAttached) {
    resizeDailySyncAttached = true;
    window.addEventListener('resize', () => {
      requestAnimationFrame(syncDailyColumnWidths);
    }, { passive: true });
  }

  // On mobile screens (<= 768px), layout is flex column deck
  if (window.innerWidth <= 768) return;

  const rows = container.querySelectorAll('.daily-interactive-row');
  if (!rows.length) return;

  let maxSun = 0;
  rows.forEach(row => {
    // Only measure visible elements (uncollapsed)
    if (row.offsetParent !== null) {
      const sunCell = row.querySelector('.daily-sun-cell');
      if (sunCell) {
        const w = sunCell.scrollWidth;
        if (w > maxSun) maxSun = w;
      }
    }
  });

  const finalSunW = Math.max(265, Math.ceil(maxSun) + 6);
  card.style.setProperty('--daily-col-sun', `${finalSunW}px`);
}

// =============================================================================
// MULTI-MODELL-ENSEMBLE (ECMWF IFS 0.25° VS. GFS SEAMLESS)
// =============================================================================
export function renderMultiModelComparison() {
  const mm = state.multiModel;
  if (!mm) return;

  const consensusText = document.getElementById('model-consensus-text');
  if (consensusText) {
    if (mm.activeRegionalModel) {
      consensusText.innerText = `${mm.activeRegionalModel} priorisiert (${mm.consensusScore}%)`;
    } else {
      consensusText.innerText = `${mm.consensusText} (${mm.consensusScore}%)`;
    }
  }

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

  const regWeightPct = (mm.weights && typeof mm.weights.regional === 'number') ? Math.round(mm.weights.regional * 100) : 55;
  const regName = mm.regional ? mm.regional.name : (mm.activeRegionalModel || 'High-Res Modell');

  if (confidencePct) confidencePct.innerText = `${mm.consensusScore}% • ${regName}`;
  if (stabilityVal) {
    stabilityVal.innerText = mm.consensusScore >= 85 ? 'Sehr stabil (Hohe Sicherheit)' : mm.consensusScore >= 70 ? 'Stabil (Geringe Abweichung)' : 'Volatil (Diskrepanz vorhanden)';
    stabilityVal.style.color = mm.consensusScore >= 80 ? '#30d158' : mm.consensusScore >= 65 ? '#ffd166' : '#ff9f0a';
  }

  if (verdictText) {
    if (mm.consensusScore >= 85) {
      verdictText.innerText = `${regName} (${regWeightPct}% Gewicht) & ECMWF prognostizieren ein stabiles, konsistentes Wetterfenster.`;
    } else if (dPrecip > 3) {
      verdictText.innerText = `Niederschlags-Diskrepanz: ${mm.ecmwf.precip24h > mm.gfs.precip24h ? 'ECMWF berechnet stärkere Schauer' : `${regName} berechnet lokale Schauer`}.`;
    } else {
      verdictText.innerText = `${regName} mit ${regWeightPct}% Gewicht vor globalem ECMWF priorisiert.`;
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

  const curHourIdx = getClosestHourlyIndex(rawH);
  const alignedTimes = (mm && Array.isArray(mm.hourlyTime) && mm.hourlyTime.length >= 2)
    ? mm.hourlyTime
    : rawH.time.slice(curHourIdx);

  // Zeitbasis: echte verfügbare Stunden bis maximal 240h (10 Tage)
  const count = Math.min(240, alignedTimes.length);
  if (count < 2) return;

  const titleEl = document.getElementById('meteogram-title');
  if (titleEl) {
    const daysCount = Math.max(1, Math.min(10, Math.ceil(count / 24)));
    titleEl.innerText = `📈 ENSEMBLE-METEOGRAMM (${daysCount}-TAGE SPAGHETTI-VERGLEICH):`;
  }

  // Echte Datenreihen extrahieren (strikt ohne synthetische Sinus-/Faktor-Kurven; fehlende Horizont-Stunden bleiben null)
  const ecmwfData = [];
  const gfsData = [];
  const iconData = [];
  let unit = '°C';
  const hasRegionalSeries = Boolean(mm && mm.regional);

  const toFiniteNum = (v) => (typeof v === 'number' && !isNaN(v)) ? v : null;

  if (metric === 'temp') {
    unit = state.unit === 'fahrenheit' ? '°F' : '°C';
    const rawIcon = hasRegionalSeries
      ? (mm.regional.hourlyTemp || [])
      : (rawH.temperature_2m || []).slice(curHourIdx);
    const rawEc = (mm && mm.ecmwf && mm.ecmwf.hourlyTemp) ? mm.ecmwf.hourlyTemp : [];
    const rawGfs = (mm && mm.gfs && mm.gfs.hourlyTemp) ? mm.gfs.hourlyTemp : [];

    for (let i = 0; i < count; i++) {
      const iv = toFiniteNum(rawIcon[i]);
      const ev = toFiniteNum(rawEc[i]);
      const gv = toFiniteNum(rawGfs[i]);
      iconData.push(iv !== null ? convertTemp(iv) : null);
      ecmwfData.push(ev !== null ? convertTemp(ev) : null);
      gfsData.push(gv !== null ? convertTemp(gv) : null);
    }
  } else if (metric === 'precip') {
    unit = 'mm';
    const rawIcon = hasRegionalSeries
      ? (mm.regional.hourlyPrecip || [])
      : (rawH.precipitation || []).slice(curHourIdx);
    const rawEc = (mm && mm.ecmwf && mm.ecmwf.hourlyPrecip) ? mm.ecmwf.hourlyPrecip : [];
    const rawGfs = (mm && mm.gfs && mm.gfs.hourlyPrecip) ? mm.gfs.hourlyPrecip : [];

    for (let i = 0; i < count; i++) {
      const iv = toFiniteNum(rawIcon[i]);
      const ev = toFiniteNum(rawEc[i]);
      const gv = toFiniteNum(rawGfs[i]);
      iconData.push(iv !== null ? Math.round(Math.max(0, iv) * 10) / 10 : null);
      ecmwfData.push(ev !== null ? Math.round(Math.max(0, ev) * 10) / 10 : null);
      gfsData.push(gv !== null ? Math.round(Math.max(0, gv) * 10) / 10 : null);
    }
  } else if (metric === 'wind') {
    unit = 'km/h';
    const rawIcon = hasRegionalSeries
      ? (mm.regional.hourlyWind || [])
      : (rawH.wind_speed_10m || []).slice(curHourIdx);
    const rawEc = (mm && mm.ecmwf && mm.ecmwf.hourlyWind) ? mm.ecmwf.hourlyWind : [];
    const rawGfs = (mm && mm.gfs && mm.gfs.hourlyWind) ? mm.gfs.hourlyWind : [];

    for (let i = 0; i < count; i++) {
      const iv = toFiniteNum(rawIcon[i]);
      const ev = toFiniteNum(rawEc[i]);
      const gv = toFiniteNum(rawGfs[i]);
      iconData.push(iv !== null ? Math.round(Math.max(0, iv)) : null);
      ecmwfData.push(ev !== null ? Math.round(Math.max(0, ev)) : null);
      gfsData.push(gv !== null ? Math.round(Math.max(0, gv)) : null);
    }
  }

  // Aktualisiere Legende auf das tatsächliche regionale High-Res Modell
  const iconLeg = document.querySelector('.m-legend-item .icon')?.parentElement;
  if (iconLeg && mm && mm.activeRegionalModel) {
    iconLeg.innerHTML = `<span class="m-leg-dot icon"></span> ${escapeHtml(mm.activeRegionalModel)}`;
  }

  // Min- und Max-Werte nur über tatsächlich vorhandene Modell-Werte bestimmen
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let i = 0; i < count; i++) {
    const vals = [ecmwfData[i], gfsData[i], iconData[i]].filter(v => v !== null);
    for (const v of vals) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
    minVal = 0;
    maxVal = 10;
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

  const safeCountDenom = Math.max(1, count - 1);
  const getX = idx => padL + (idx / safeCountDenom) * plotW;
  const getY = val => padT + plotH - ((val - minVal) / range) * plotH;

  // Unsicherheits-Korridor & segmentierte SVG-Polylines (sauberes Ende bei Modellhorizont ohne NaN-Sprung)
  const corridorPolys = [];
  let segTop = [];
  let segBot = [];
  for (let i = 0; i < count; i++) {
    const x = getX(i);
    const vals = [ecmwfData[i], gfsData[i], iconData[i]].filter(v => v !== null);
    if (vals.length >= 2) {
      const topV = Math.max(...vals);
      const botV = Math.min(...vals);
      segTop.push(`${x.toFixed(1)},${getY(topV).toFixed(1)}`);
      segBot.unshift(`${x.toFixed(1)},${getY(botV).toFixed(1)}`);
    } else if (segTop.length > 1) {
      corridorPolys.push(segTop.concat(segBot).join(' '));
      segTop = [];
      segBot = [];
    } else {
      segTop = [];
      segBot = [];
    }
  }
  if (segTop.length > 1) {
    corridorPolys.push(segTop.concat(segBot).join(' '));
  }

  const buildPolylines = (series, color, width = 2.5) => {
    const segments = [];
    let current = [];
    for (let i = 0; i < count; i++) {
      const val = series[i];
      if (val !== null) {
        current.push(`${getX(i).toFixed(1)},${getY(val).toFixed(1)}`);
      } else if (current.length > 1) {
        segments.push(current.join(' '));
        current = [];
      } else {
        current = [];
      }
    }
    if (current.length > 1) segments.push(current.join(' '));
    return segments
      .map(pts => `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" />`)
      .join('');
  };

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
    const date = new Date(alignedTimes[i] || rawH.time[i]);
    if (isNaN(date.getTime())) continue;
    const dayName = daysMap[date.getDay()];
    const dateNum = date.getDate();
    dayMarkersHtml += `
      <line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${H - padB}" stroke="rgba(255,255,255,0.12)" />
      <text x="${x.toFixed(1)}" y="${H - 12}" fill="rgba(255,255,255,0.7)" font-size="11" font-weight="700" text-anchor="middle">${dayName} ${dateNum}.</text>
    `;
  }

  const corridorHtml = corridorPolys
    .map(poly => `<polygon points="${poly}" fill="url(#corridor-gradient)" />`)
    .join('');

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

    <!-- Echter Unsicherheits-Streubereich (Korridor) -->
    ${corridorHtml}

    <!-- Echte Modell-Kurven -->
    ${buildPolylines(ecmwfData, '#38bdf8', 2.5)}
    ${buildPolylines(gfsData, '#f59e0b', 2.5)}
    ${buildPolylines(iconData, '#10b981', 2.5)}

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
  const regLabel = (mm && mm.activeRegionalModel) ? escapeHtml(mm.activeRegionalModel) : 'ICON Best-Match';

  if (hitbox) {
    hitbox.addEventListener('mousemove', e => {
      const rect = svg.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * W;
      const relX = Math.max(0, Math.min(plotW, mouseX - padL));
      const idx = Math.min(count - 1, Math.max(0, Math.round((relX / plotW) * (count - 1))));

      const cx = getX(idx);
      hoverLine.setAttribute('x1', cx);
      hoverLine.setAttribute('x2', cx);
      hoverLine.style.display = 'block';

      const activeYs = [];
      const setDot = (dotEl, val) => {
        if (!dotEl) return;
        if (val !== null) {
          const py = getY(val);
          dotEl.setAttribute('cx', cx);
          dotEl.setAttribute('cy', py);
          dotEl.style.display = 'block';
          activeYs.push(py);
        } else {
          dotEl.style.display = 'none';
        }
      };

      setDot(dotEc, ecmwfData[idx]);
      setDot(dotGfs, gfsData[idx]);
      setDot(dotIcon, iconData[idx]);

      if (tooltip) {
        const d = new Date(alignedTimes[idx] || rawH.time[idx]);
        const dayStr = isNaN(d.getTime()) ? '' : d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
        const timeStr = isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const validAtIdx = [ecmwfData[idx], gfsData[idx], iconData[idx]].filter(v => v !== null);
        const delta = validAtIdx.length >= 2
          ? (Math.max(...validAtIdx) - Math.min(...validAtIdx)).toFixed(1)
          : '—';

        const fmtVal = v => v !== null ? `${v} ${unit}` : '<span style="color:#94a3b8;">Horizont ende</span>';
        const topY = activeYs.length ? Math.min(...activeYs) : (padT + 20);

        tooltip.innerHTML = `
          <div style="font-weight:700; color:var(--ios-cyan); margin-bottom:4px;">⏱️ ${dayStr} • ${timeStr} Uhr</div>
          <div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:#38bdf8;">🇪🇺 ECMWF IFS:</span> <strong>${fmtVal(ecmwfData[idx])}</strong></div>
          <div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:#f59e0b;">🇺🇸 GFS Seamless:</span> <strong>${fmtVal(gfsData[idx])}</strong></div>
          <div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:#10b981;">🇩🇪 ${regLabel}:</span> <strong>${fmtVal(iconData[idx])}</strong></div>
          <div style="border-top:1px solid rgba(255,255,255,0.15); margin-top:4px; padding-top:4px; color:#cbd5e1; font-size:10px;">
            Streubreite: <strong>${delta === '—' ? '1 Modell' : `Δ ${delta} ${unit}`}</strong>
          </div>
        `;
        tooltip.style.left = `${(cx / W) * 100}%`;
        tooltip.style.top = `${topY - 10}px`;
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
  if (!modal || !daily || !Array.isArray(daily.time) || dayIndex < 0 || dayIndex >= daily.time.length) return;

  const dateKey = String(daily.time[dayIndex] || '').slice(0, 10);
  const d = parseLocalDateKey(dateKey || daily.time[dayIndex]);
  const isToday = Boolean(dateKey && dateKey === getLocalDateKey(new Date()));
  const dateStr = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const syn = MicroEngine.computeRepresentativeDailyCondition(dayIndex, daily, hourly, isToday, state.weatherData?.current);

  // 1. Header & Ort
  const locBadge = document.getElementById('modal-location-badge');
  if (locBadge && state.currentLocation) {
    const isMtn = state.currentLocation.isMountain;
    locBadge.innerText = `${isMtn ? '🏔️ Berggipfel' : '📍 Ort'}: ${state.currentLocation.name} (${Math.round(state.currentLocation.elevation).toLocaleString('de-DE')} m)`;
  }

  document.getElementById('modal-day-name').innerText = dateStr;
  document.getElementById('modal-day-condition').innerText = `${syn.icon} ${syn.label} • ${syn.synopNote}`;

  // 2. Extrahiere die 24 Stunden dieses spezifischen Tages
  const dayStartHourIdx = getDayHourlyStartIndex(dateKey, dayIndex, hourly);
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

  // Bento Metriken — harmonisiert mit stündlichen Extremwerten
  const minHourlyT = hoursTemp.length ? Math.min(...hoursTemp.map(t => convertTemp(t))) : convertTemp(daily.temperature_2m_min[dayIndex]);
  const maxHourlyT = hoursTemp.length ? Math.max(...hoursTemp.map(t => convertTemp(t))) : convertTemp(daily.temperature_2m_max[dayIndex]);
  const maxT = Math.round(Math.max(convertTemp(daily.temperature_2m_max[dayIndex]), maxHourlyT));
  const minT = Math.round(Math.min(convertTemp(daily.temperature_2m_min[dayIndex]), minHourlyT));
  document.getElementById('modal-max-temp').innerText = `${maxT}°`;
  document.getElementById('modal-min-temp').innerText = `${minT}°`;

  const validHoursApp = hoursApparent.filter(v => typeof v === 'number' && !isNaN(v)).map(t => convertTemp(t));
  const rawAppMax = daily.apparent_temperature_max ? convertTemp(daily.apparent_temperature_max[dayIndex]) : maxT;
  const rawAppMin = daily.apparent_temperature_min ? convertTemp(daily.apparent_temperature_min[dayIndex]) : minT;
  const appMax = Math.round(validHoursApp.length ? Math.max(rawAppMax, ...validHoursApp) : rawAppMax);
  const appMin = Math.round(validHoursApp.length ? Math.min(rawAppMin, ...validHoursApp) : rawAppMin);
  document.getElementById('modal-apparent-range').innerText = `Gefühlt: ${appMin}° bis ${appMax}°`;

  const popMax = daily.precipitation_probability_max ? (daily.precipitation_probability_max[dayIndex] || 0) : 0;
  const rawSum = (daily.precipitation_sum && daily.precipitation_sum[dayIndex] != null) ? Number(daily.precipitation_sum[dayIndex]) : 0;
  const precipSum = rawSum.toFixed(1);
  const precipHours = daily.precipitation_hours ? Math.round(daily.precipitation_hours[dayIndex]) : 0;

  // Präzise zeitliche Einordnung des Niederschlags (beseitigt scheinbare Widersprüche zu Sonnenstunden)
  let morningRainSum = 0;      // 00:00 - 08:00
  let middayRainSum = 0;       // 08:00 - 17:00
  let eveningNightRainSum = 0;  // 17:00 - 24:00
  let lastMorningRainHour = -1;

  for (let h = 0; h < 24; h++) {
    const p = hoursPrecip[h] || 0;
    if (p > 0.05) {
      if (h < 9) {
        morningRainSum += p;
        lastMorningRainHour = Math.max(lastMorningRainHour, h);
      } else if (h < 18) {
        middayRainSum += p;
      } else {
        eveningNightRainSum += p;
      }
    }
  }

  let rainTimingDesc = '';
  if (rawSum > 0.05) {
    if (morningRainSum > 0.75 * rawSum && middayRainSum <= 0.2) {
      const endH = lastMorningRainHour >= 0 ? `${String(lastMorningRainHour + 1).padStart(2, '0')}:00` : '08:00';
      rainTimingDesc = `Frühregen (bis ~${endH} Uhr)`;
    } else if (eveningNightRainSum > 0.75 * rawSum && middayRainSum <= 0.2) {
      rainTimingDesc = 'Später Abend / Nachtregen';
    } else if (middayRainSum > 0.5 * rawSum) {
      rainTimingDesc = 'Tagsüber Schauer / Regen';
    } else {
      rainTimingDesc = precipHours > 0 ? `~${precipHours} h Dauer` : 'Gelegentliche Schauer';
    }
  } else {
    rainTimingDesc = 'Trocken';
  }

  document.getElementById('modal-pop').innerText = `${popMax}%`;
  document.getElementById('modal-precip-sum').innerText = `Menge: ${precipSum} mm • ${rainTimingDesc}`;

  const windSpdMax = Math.round(daily.wind_speed_10m_max ? daily.wind_speed_10m_max[dayIndex] : (hoursWind.length ? Math.max(...hoursWind) : 0));
  const windGustMax = Math.round(daily.wind_gusts_10m_max ? daily.wind_gusts_10m_max[dayIndex] : (hoursGusts.length ? Math.max(...hoursGusts) : 0));
  document.getElementById('modal-wind-spd').innerText = `${windSpdMax} km/h`;
  document.getElementById('modal-wind-gusts').innerText = `Spitzenböen bis ${windGustMax} km/h`;

  // Sonne & Tageslicht (synchronisiert mit 10-Tage-Trend)
  let modalSunSumSec = 0;
  for (let h = 0; h < 24; h++) {
    const hIdx = dayStartHourIdx + h;
    if (hourly && hourly.sunshine_duration && hourly.sunshine_duration[hIdx] != null && !isNaN(hourly.sunshine_duration[hIdx])) {
      modalSunSumSec += hourly.sunshine_duration[hIdx];
    }
  }
  const daylightSec = (daily.daylight_duration && daily.daylight_duration[dayIndex] !== undefined)
    ? daily.daylight_duration[dayIndex]
    : 0;
  const sunDurSec = Math.max(modalSunSumSec, daily.sunshine_duration ? (daily.sunshine_duration[dayIndex] || 0) : 0);
  const sunQuotaPct = daylightSec > 0 ? Math.min(100, Math.round((sunDurSec / daylightSec) * 100)) : 0;

  if (modalSunSumSec > 0 || (daily.sunshine_duration && daily.sunshine_duration[dayIndex] !== undefined)) {
    const sunHours = (sunDurSec / 3600).toFixed(1).replace('.', ',');
    document.getElementById('modal-sunshine-dur').innerText = `${sunHours} h`;
  } else {
    const wCode = (daily.weather_code && daily.weather_code[dayIndex] !== undefined) ? daily.weather_code[dayIndex] : 0;
    document.getElementById('modal-sunshine-dur').innerText = wCode <= 1 ? '~8 h' : (wCode <= 3 ? '~4 h' : '< 1 h');
  }

  if (daylightSec > 0) {
    const dlH = Math.floor(daylightSec / 3600);
    const dlM = Math.round((daylightSec % 3600) / 60);
    document.getElementById('modal-daylight-dur').innerText = `Tageslänge: ${dlH} h ${dlM} min (${sunQuotaPct}% Sonne)`;
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

  // Astronomische Zeiten für Tag/Nacht-Erkennung
  const sunriseDate = daily.sunrise && daily.sunrise[dayIndex] ? new Date(daily.sunrise[dayIndex]) : null;
  const sunsetDate = daily.sunset && daily.sunset[dayIndex] ? new Date(daily.sunset[dayIndex]) : null;
  const sunriseDec = sunriseDate && !isNaN(sunriseDate.getTime()) ? (sunriseDate.getHours() + sunriseDate.getMinutes() / 60) : 7.25;
  const sunsetDec = sunsetDate && !isNaN(sunsetDate.getTime()) ? (sunsetDate.getHours() + sunsetDate.getMinutes() / 60) : 16.75;

  // 3. Stündlicher 24-Stunden-Verlauf für DIESEN Tag
  const hourlyContainer = document.getElementById('modal-day-hourly-list');
  hourlyContainer.innerHTML = '';

  for (let h = 0; h < 24; h++) {
    const timeLabel = `${String(h).padStart(2, '0')}:00`;
    const hCode = hoursCode[h] !== undefined ? hoursCode[h] : 0;
    const hSunSec = (hourly && hourly.sunshine_duration) ? (hourly.sunshine_duration[dayStartHourIdx + h] || 0) : 0;
    const hCloud = (hourly && hourly.cloud_cover) ? (hourly.cloud_cover[dayStartHourIdx + h] ?? null) : null;
    const hPrecip = hoursPrecip[h] !== undefined ? hoursPrecip[h] : 0;
    const hPop = hoursPop[h] !== undefined ? hoursPop[h] : 0;
    const rawTempC = hoursTemp[h] !== undefined ? hoursTemp[h] : 10;
    const isDay = (hourly && hourly.is_day && hourly.is_day[dayStartHourIdx + h] !== undefined)
      ? hourly.is_day[dayStartHourIdx + h] === 1
      : (h >= Math.floor(sunriseDec) && h < Math.ceil(sunsetDec));

    const harm = getHarmonizedHourlyCondition({
      code: hCode,
      sunSec: hSunSec,
      precip: hPrecip,
      pop: hPop,
      cloudCover: hCloud,
      isDay,
      temp: rawTempC
    });

    const hTemp = hoursTemp[h] !== undefined ? Math.round(convertTemp(hoursTemp[h])) : '--';
    const hApp = hoursApparent[h] !== undefined ? Math.round(convertTemp(hoursApparent[h])) : hTemp;
    const hWind = hoursWind[h] !== undefined ? Math.round(hoursWind[h]) : 0;
    const hGust = hoursGusts[h] !== undefined ? Math.round(hoursGusts[h]) : hWind;

    let cardExtraClass = '';
    let metricSpan = '';

    if (harm.hasPrecip) {
      cardExtraClass = 'is-rain-card';
      const pDisplay = hPrecip >= 0.1 ? `${hPrecip.toFixed(1)} mm` : `${hPop}%`;
      metricSpan = `<span class="mhi-pop is-rain">💧 ${pDisplay}</span>`;
    } else if (isDay && harm.sunMin >= 15) {
      cardExtraClass = 'is-sunny-card';
      metricSpan = `<span class="mhi-sun">☀️ ${harm.sunMin}m</span>`;
    } else if (hPop >= 15) {
      metricSpan = `<span class="mhi-pop-dim">💧 ${hPop}%</span>`;
    } else {
      metricSpan = `<span class="mhi-dry">Trocken</span>`;
    }

    const windDisplay = (hGust >= hWind + 6)
      ? `💨 ${hWind} <small>(${hGust})</small>`
      : `💨 ${hWind} <small>km/h</small>`;

    const item = document.createElement('div');
    item.className = `modal-hourly-item ${cardExtraClass}`.trim();
    item.innerHTML = `
      <span class="mhi-time">${timeLabel}</span>
      <span class="mhi-icon">${harm.icon}</span>
      <span class="mhi-temp">${hTemp}°</span>
      <span class="mhi-apparent">${hApp}° gef.</span>
      ${metricSpan}
      <span class="mhi-wind">${windDisplay}</span>
    `;
    hourlyContainer.appendChild(item);
  }

  // 4. Vier ausführliche Tagesabschnitte mit echter Aggregation der 5-6 Stundenblöcke
  const partsContainer = document.getElementById('modal-day-parts');
  partsContainer.innerHTML = '';

  const dayParts = [
    { name: 'Morgens', timeRange: '06:00 – 11:00', startH: 6, endH: 11, defaultIcon: '🌅' },
    { name: 'Mittags', timeRange: '11:00 – 16:00', startH: 11, endH: 16, defaultIcon: '☀️' },
    { name: 'Abends', timeRange: '16:00 – 21:00', startH: 16, endH: 21, defaultIcon: '🌇' },
    { name: 'Nachts', timeRange: '21:00 – 06:00', startH: 21, endH: 24, defaultIcon: '🌙' }
  ];

  for (const part of dayParts) {
    const partTemps = [];
    const partApparent = [];
    const partPop = [];
    let partPrecipSum = 0;
    let partSunSec = 0;
    const partWinds = [];
    const partGusts = [];
    const partRH = [];
    const partDP = [];

    for (let h = part.startH; h < part.endH; h++) {
      if (hoursTemp[h] !== undefined) partTemps.push(hoursTemp[h]);
      if (hoursApparent[h] !== undefined) partApparent.push(hoursApparent[h]);
      if (hoursPop[h] !== undefined) partPop.push(hoursPop[h]);
      if (hoursPrecip[h] !== undefined) partPrecipSum += hoursPrecip[h];
      const hSun = (hourly && hourly.sunshine_duration) ? (hourly.sunshine_duration[dayStartHourIdx + h] || 0) : 0;
      partSunSec += hSun;
      if (hoursWind[h] !== undefined) partWinds.push(hoursWind[h]);
      if (hoursGusts[h] !== undefined) partGusts.push(hoursGusts[h]);
      if (hoursHumidity[h] !== undefined) partRH.push(hoursHumidity[h]);
      if (hoursDewPoint[h] !== undefined) partDP.push(hoursDewPoint[h]);
    }

    const avgT = partTemps.length ? Math.round(convertTemp(partTemps.reduce((a, b) => a + b, 0) / partTemps.length)) : 10;
    const avgApp = partApparent.length ? Math.round(convertTemp(partApparent.reduce((a, b) => a + b, 0) / partApparent.length)) : avgT;
    const maxPop = partPop.length ? Math.max(...partPop) : 0;
    const maxWind = partWinds.length ? Math.round(Math.max(...partWinds)) : 10;
    const maxGust = partGusts.length ? Math.round(Math.max(...partGusts)) : maxWind;
    const avgRH = partRH.length ? Math.round(partRH.reduce((a, b) => a + b, 0) / partRH.length) : 70;
    const avgDP = partDP.length ? Math.round(convertTemp(partDP.reduce((a, b) => a + b, 0) / partDP.length)) : 5;

    const isNightPart = part.name === 'Nachts';
    const sunHoursPart = isNightPart ? 0 : (partSunSec / 3600);
    const hasPartRain = (partPrecipSum >= 0.2) || (maxPop >= 60 && partPrecipSum > 0.05);

    let partIcon = part.defaultIcon;
    let partLabel = isNightPart ? 'Klar' : 'Heiter';

    if (hasPartRain) {
      if (!isNightPart && sunHoursPart >= 1.0) {
        partIcon = '🌦️';
        partLabel = 'Sonne & Schauer';
      } else if (partPrecipSum >= 2.0) {
        partIcon = '🌧️';
        partLabel = 'Dauerregen';
      } else {
        partIcon = '🌧️';
        partLabel = 'Regnerisch';
      }
    } else if (isNightPart) {
      partIcon = '🌙';
      partLabel = 'Klar';
    } else {
      if (sunHoursPart >= 2.5) {
        partIcon = '☀️';
        partLabel = 'Sonnig';
      } else if (sunHoursPart >= 1.0) {
        partIcon = '🌤️';
        partLabel = 'Überwiegend sonnig';
      } else if (sunHoursPart >= 0.3) {
        partIcon = '⛅';
        partLabel = 'Teils sonnig';
      } else {
        partIcon = '☁️';
        partLabel = 'Bedeckt';
      }
    }

    let rainHtml = '';
    if (partPrecipSum > 0.05) {
      rainHtml = `💧 ${maxPop}% (${partPrecipSum.toFixed(1)} mm)`;
    } else if (!isNightPart && sunHoursPart >= 0.5) {
      rainHtml = `☀️ ${sunHoursPart.toFixed(1).replace('.', ',')} h Sonne`;
    } else {
      rainHtml = '💧 Trocken (0%)';
    }

    const box = document.createElement('div');
    box.className = 'day-part-box';
    box.innerHTML = `
      <div class="dp-name">${part.name}</div>
      <div style="font-size: 10px; color: var(--text-tertiary);">${part.timeRange}</div>
      <div class="dp-icon">${partIcon}</div>
      <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">${partLabel}</div>
      <div class="dp-temp">${avgT}°C</div>
      <div class="dp-apparent">Gefühlt ${avgApp}°C</div>
      <div class="dp-rain" style="margin-top: 4px;">${rainHtml}</div>
      <div class="dp-wind">💨 ${maxWind} km/h • Böen ${maxGust}</div>
      <div style="font-size: 10px; color: var(--text-tertiary); margin-top: 2px;">💧 ${avgRH}% • TP ${avgDP}°C</div>
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
  const rainSum = (daily.precipitation_sum && daily.precipitation_sum[dayIndex] != null) ? Number(daily.precipitation_sum[dayIndex]) : 0;
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

export function getUvRiskMeta(uvRaw) {
  const uv = Math.max(0, Math.round(uvRaw ?? 0));
  if (uv === 0) {
    return {
      uv,
      label: 'Keine UV (Nacht)',
      color: '#30d158',
      hint: 'Kein UV-Schutz erforderlich.',
      sheetDesc: 'Aktuell keine relevante UV-Strahlung.',
      skinTimes: { I: '> 60 Min.', II: '> 60 Min.', III: '> 90 Min.', IV: '> 120 Min.' }
    };
  }
  const fmtMin = (m) => (m > 60 ? '> 60 Min.' : `~${Math.max(5, Math.round(m))} Min.`);
  const skinTimes = {
    I: fmtMin(150 / uv),
    II: fmtMin(210 / uv),
    III: fmtMin(300 / uv),
    IV: fmtMin(450 / uv)
  };
  if (uv <= 2) {
    return {
      uv,
      label: 'Gering',
      color: '#30d158',
      hint: 'Kein besonderer Schutz erforderlich.',
      sheetDesc: 'Geringe UV-Belastung. Schutz nur bei extremer Schneereflexion im Hochgebirge.',
      skinTimes
    };
  }
  if (uv <= 5) {
    return {
      uv,
      label: 'Mäßig',
      color: '#ffd166',
      hint: 'Sonnenschutz (LSF 30+) bei längerer Exposition.',
      sheetDesc: 'Sonnenschutz bei längerer Exposition empfohlen (Hut, Sonnenbrille, LSF 30+).',
      skinTimes
    };
  }
  if (uv <= 7) {
    return {
      uv,
      label: 'Hoch',
      color: '#ff9f0a',
      hint: 'Schutz nötig: LSF 30+, Sonnenbrille & Mittagsschatten.',
      sheetDesc: 'Schutz dringend erforderlich! Schatten suchen, LSF 30+, Sonnenbrille UV400.',
      skinTimes
    };
  }
  if (uv <= 10) {
    return {
      uv,
      label: 'Sehr hoch',
      color: '#ff453a',
      hint: 'Intensive Strahlung: LSF 50+, Mittagssonne meiden.',
      sheetDesc: 'Intensive Berg-/Mittagssonne! Aufenthalt in der prallen Sonne meiden, LSF 50+.',
      skinTimes
    };
  }
  return {
    uv,
    label: 'Extrem',
    color: '#bf5af2',
    hint: 'Gefährlich! LSF 50+, Kleidung & UV-Schutz zwingend.',
    sheetDesc: 'Gefährliche Strahlung! Ungeschützter Aufenthalt führt rasch zu Verbrennungen.',
    skinTimes
  };
}

export function getHumidityAndDewPoint(cur, hourly, curHourIdx) {
  const temp = cur?.temperature_2m ?? hourly?.temperature_2m?.[curHourIdx] ?? 10;
  const rhRaw = cur?.relative_humidity_2m ?? hourly?.relative_humidity_2m?.[curHourIdx] ?? 65;
  const rh = Math.max(1, Math.min(100, Math.round(rhRaw)));
  const hDew = hourly?.dew_point_2m?.[curHourIdx];
  const dewPoint = (typeof hDew === 'number' && !isNaN(hDew))
    ? Math.round(hDew * 10) / 10
    : MicroEngine.computeDewPoint(temp, rh);
  const spread = Math.round((temp - dewPoint) * 10) / 10;

  let riskShort = 'Normal';
  let fogRisk = 'Gering (Trocken / Klar)';
  let riskClass = 'text-green';
  if (spread <= 1.5) {
    riskShort = 'Hoch (Nebel-/Tau-Gefahr)';
    fogRisk = 'Sehr hoch (Nebel & Taubeschlag)';
    riskClass = 'text-accent';
  } else if (spread <= 3.5) {
    riskShort = 'Mäßig (Dunst / feucht)';
    fogRisk = 'Mäßig (Dunst & lokale Nebelneigung)';
    riskClass = 'text-yellow';
  } else if (spread <= 8.0) {
    riskShort = 'Normal (Ausgeglichen)';
    fogRisk = 'Gering bis normal';
    riskClass = 'text-green';
  } else {
    riskShort = 'Gering (Trockene Luft)';
    fogRisk = 'Sehr gering (Trockene Luftmasse)';
    riskClass = 'text-green';
  }

  return { temp, rh, dewPoint, spread, riskShort, fogRisk, riskClass };
}

export function getBarometricTrend(cur, hourly, curHourIdx) {
  const pArr = hourly && Array.isArray(hourly.pressure_msl) ? hourly.pressure_msl : null;
  const qnhVal = cur?.pressure_msl ?? pArr?.[curHourIdx] ?? 1013;
  const qfeVal = cur?.surface_pressure ?? hourly?.surface_pressure?.[curHourIdx] ?? qnhVal;
  const qnh = Math.round(qnhVal);
  const qfe = Math.round(qfeVal);

  let delta3h = 0;
  let isForecastTrend = false;
  if (pArr && pArr.length > 0) {
    const pNow = typeof pArr[curHourIdx] === 'number' ? pArr[curHourIdx] : qnhVal;
    if (curHourIdx >= 1) {
      const step = Math.min(3, curHourIdx);
      const pPast = pArr[curHourIdx - step];
      if (typeof pPast === 'number' && !isNaN(pPast)) {
        delta3h = Math.round((((pNow - pPast) / step) * 3) * 10) / 10;
      }
    } else if (pArr.length > 3 && typeof pArr[3] === 'number' && !isNaN(pArr[3])) {
      delta3h = Math.round((pArr[3] - pNow) * 10) / 10;
      isForecastTrend = true;
    }
  }

  const signed = `${delta3h >= 0 ? '+' : ''}${delta3h.toFixed(1)}`;
  const unitLabel = isForecastTrend ? 'hPa/3h Prog.' : 'hPa/3h';
  let arrow = '➡️';
  let trendLabel = 'Stabil';
  let trendDesc = `Ausgeglichener Luftdruckverlauf (${signed} ${unitLabel}).`;

  if (delta3h <= -3.0) {
    arrow = '⏬';
    trendLabel = 'Stark fallend';
    trendDesc = `Rascher Druckfall (${signed} ${unitLabel}) deutet auf Frontdurchzug oder Sturmgefahr hin.`;
  } else if (delta3h <= -0.8) {
    arrow = '↘️';
    trendLabel = 'Fallend';
    trendDesc = `Leichter bis mäßiger Druckfall (${signed} ${unitLabel}): Bewölkungszunahme oder Schauer möglich.`;
  } else if (delta3h >= 3.0) {
    arrow = '⏫';
    trendLabel = 'Stark steigend';
    trendDesc = `Kräftiger Druckanstieg (${signed} ${unitLabel}) signalisiert rasche Wetterberuhigung auf der Rückseite.`;
  } else if (delta3h >= 0.8) {
    arrow = '↗️';
    trendLabel = 'Steigend';
    trendDesc = `Steigender Luftdruck (${signed} ${unitLabel}): Zunehmender Hochdruckeinfluss.`;
  } else if (qnh > 1022) {
    trendDesc = `Stabiles Hochdruckgebiet (${signed} ${unitLabel}) sorgt für ruhige Verhältnisse.`;
  } else if (qnh < 1004) {
    trendDesc = `Tiefdruckeinfluss (${signed} ${unitLabel}) begünstigt Quellwolken und wechselhaftes Wetter.`;
  }

  return {
    qnh,
    qfe,
    delta3h,
    signed,
    arrow,
    trendLabel,
    compactText: `Tendenz: ${arrow} ${trendLabel} (${signed} hPa/3h)`,
    trendDesc
  };
}

export function getRolling24hPrecipSummary(cur, daily, hourly, curHourIdx, todayIdx, micro = null) {
  let rollingPrecip = 0;
  let rollingSnowCm = 0;
  let hasHourlyPrecip = false;

  if (hourly && Array.isArray(hourly.precipitation) && hourly.precipitation.length > 0) {
    const startIdx = Math.max(0, curHourIdx);
    const endIdx = Math.min(hourly.precipitation.length, startIdx + 24);
    for (let i = startIdx; i < endIdx; i++) {
      const p = hourly.precipitation[i];
      if (typeof p === 'number' && !isNaN(p)) {
        rollingPrecip += Math.max(0, p);
        hasHourlyPrecip = true;
      }
      if (Array.isArray(hourly.snowfall) && typeof hourly.snowfall[i] === 'number' && !isNaN(hourly.snowfall[i])) {
        rollingSnowCm += Math.max(0, hourly.snowfall[i]);
      }
    }
  }

  const dailyPrecip = (daily && daily.precipitation_sum && daily.precipitation_sum[todayIdx] != null)
    ? Number(daily.precipitation_sum[todayIdx]) : 0;
  const total24hMm = Math.round((hasHourlyPrecip ? rollingPrecip : dailyPrecip) * 10) / 10;
  const totalSnowCm = Math.round((hasHourlyPrecip ? rollingSnowCm : (daily?.snowfall_sum?.[todayIdx] || 0)) * 10) / 10;

  const fl = micro?.atmosphere?.freezingLevelMeters ??
    micro?.microWeather?.freezingLevelMeters ??
    hourly?.freezing_level_height?.[curHourIdx] ?? null;
  const snowLevel = micro?.atmosphere?.snowLevelMeters ??
    micro?.microWeather?.snowLevelMeters ??
    (fl !== null ? Math.max(0, fl - 300) : null);

  return { total24hMm, totalSnowCm, dailyPrecip, freezingLevel: fl, snowLevel };
}

export function computeAstronomicalSunData(daily, todayIdx, lat = 48) {
  const now = new Date();
  let sunriseStr = '--:--';
  let sunsetStr = '--:--';
  let daylightStr = '-- h Licht';
  let progressPct = 0;
  let isSunUp = true;

  if (daily && Array.isArray(daily.sunrise) && Array.isArray(daily.sunset) && daily.sunrise.length > 0) {
    const rise = new Date(daily.sunrise[todayIdx] || daily.sunrise[0]);
    const set = new Date(daily.sunset[todayIdx] || daily.sunset[0]);
    if (!isNaN(rise.getTime()) && !isNaN(set.getTime()) && set > rise) {
      sunriseStr = rise.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      sunsetStr = set.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const totalMin = (set.getTime() - rise.getTime()) / 60000;
      const elapsedMin = (now.getTime() - rise.getTime()) / 60000;
      daylightStr = `${(totalMin / 60).toFixed(1)} h Licht`;
      isSunUp = now >= rise && now <= set;
      progressPct = Math.max(0, Math.min(100, (elapsedMin / totalMin) * 100));
    }
  }

  // Quadratischer Bezier-Punkt auf M 5 35 Q 50 5 95 35 (viewBox 0 0 100 40)
  const t = progressPct / 100;
  const omt = 1 - t;
  const arcX = (omt * omt * 5) + (2 * omt * t * 50) + (t * t * 95);
  const arcY = (omt * omt * 35) + (2 * omt * t * 5) + (t * t * 35);

  // Astronomische bürgerliche Dämmerungsdauer (Sonnenstand -0.833° bis -6°)
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor((now - startOfYear) / 86400000);
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const decl = 23.44 * rad * Math.sin((2 * Math.PI / 365) * (doy - 81));
  const latRad = Math.max(-65, Math.min(65, Number(lat) || 48)) * rad;
  const cosH0 = Math.max(-0.99, Math.min(0.99, (Math.cos(90.833 * rad) / (Math.cos(latRad) * Math.cos(decl))) - Math.tan(latRad) * Math.tan(decl)));
  const cosH6 = Math.max(-0.99, Math.min(0.99, (Math.cos(96.0 * rad) / (Math.cos(latRad) * Math.cos(decl))) - Math.tan(latRad) * Math.tan(decl)));
  const twilightMin = Math.max(20, Math.min(90, Math.round((Math.acos(cosH6) * deg - Math.acos(cosH0) * deg) * 4)));

  return { sunriseStr, sunsetStr, daylightStr, progressPct, isSunUp, arcX, arcY, twilightMin };
}

export function renderBentoGrid(cur, daily, hourly) {
  const todayIdx = getTodayDailyIndex(daily).idx;
  const curHourIdx = getClosestHourlyIndex(hourly);
  const micro = state.microData;
  const loc = state.currentLocation || { lat: 48, elevation: 520 };

  // 1. UV-Index
  const uvMeta = getUvRiskMeta(cur.uv_index ?? hourly?.uv_index?.[curHourIdx] ?? 0);
  const uvValEl = document.getElementById('uv-index-val');
  const uvDescEl = document.getElementById('uv-index-desc');
  const uvHintEl = document.getElementById('uv-index-hint');
  const uvPtrEl = document.getElementById('uv-gauge-pointer');
  if (uvValEl) uvValEl.innerText = uvMeta.uv;
  if (uvDescEl) {
    uvDescEl.innerText = uvMeta.label;
    uvDescEl.style.color = uvMeta.color;
  }
  if (uvHintEl) {
    const uvMaxToday = daily?.uv_index_max?.[todayIdx] != null ? Math.round(daily.uv_index_max[todayIdx]) : null;
    uvHintEl.innerText = (uvMeta.uv === 0 && uvMaxToday !== null && uvMaxToday > 0)
      ? `${uvMeta.hint} • Tagesmax: UV ${uvMaxToday}`
      : uvMeta.hint;
  }
  if (uvPtrEl) uvPtrEl.style.left = `${Math.min(100, (uvMeta.uv / 11) * 100)}%`;

  // 2. Wind & Böen
  const windSpd = Math.round(cur.wind_speed_10m ?? hourly?.wind_speed_10m?.[curHourIdx] ?? 0);
  const windDir = cur.wind_direction_10m ?? hourly?.wind_direction_10m?.[curHourIdx] ?? 0;
  const windGusts = Math.round(cur.wind_gusts_10m ?? hourly?.wind_gusts_10m?.[curHourIdx] ?? windSpd * 1.4);
  const compass = getCompassDirectionName(windDir);
  document.getElementById('wind-speed-val').innerHTML = `${windSpd} <small>km/h</small>`;
  document.getElementById('compass-arrow').style.transform = `rotate(${windDir}deg)`;
  document.getElementById('wind-direction-text').innerText = `${compass.code} (${Math.round(windDir)}°)`;
  document.getElementById('wind-gusts-text').innerText = `Böenspitzen bis ${windGusts} km/h`;

  // 3. Sonnenstand & animierter Sonnenbogen
  const sunData = computeAstronomicalSunData(daily, todayIdx, loc.lat);
  document.getElementById('sunrise-time-val').innerText = sunData.sunriseStr;
  document.getElementById('sunset-time-val').innerText = sunData.sunsetStr;
  document.getElementById('daylight-hours-val').innerText = sunData.daylightStr;
  const sunsetLabelEl = document.getElementById('sunset-label');
  if (sunsetLabelEl) {
    sunsetLabelEl.innerText = sunData.isSunUp ? 'Sonnenuntergang' : 'Sonnenuntergang (Nacht)';
  }
  const sunProgressPath = document.getElementById('sun-arc-progress');
  const sunPoint = document.getElementById('sun-arc-point');
  if (sunProgressPath) {
    const arcLen = 112;
    sunProgressPath.setAttribute('stroke-dasharray', `${arcLen}`);
    sunProgressPath.setAttribute('stroke-dashoffset', `${(arcLen * (1 - sunData.progressPct / 100)).toFixed(1)}`);
  }
  if (sunPoint) {
    sunPoint.setAttribute('cx', sunData.arcX.toFixed(1));
    sunPoint.setAttribute('cy', sunData.arcY.toFixed(1));
    sunPoint.setAttribute('fill', sunData.isSunUp ? '#ffb703' : 'rgba(255, 255, 255, 0.35)');
  }

  // 4. Niederschlag (rollierende 24h-Summe inkl. Nowcast & Schneefallgrenze)
  const precipSummary = getRolling24hPrecipSummary(cur, daily, hourly, curHourIdx, todayIdx, micro);
  document.getElementById('precip-total-val').innerHTML = `${precipSummary.total24hMm.toFixed(1)} <small>mm</small>`;
  const pHintEl = document.getElementById('precip-forecast-hint');
  if (pHintEl) {
    if (precipSummary.total24hMm > 0.05) {
      const snowNote = precipSummary.totalSnowCm >= 0.5 ? ` (~${precipSummary.totalSnowCm.toFixed(0)} cm Schnee)` : '';
      if (precipSummary.snowLevel !== null) {
        pHintEl.innerText = `Nächste 24h${snowNote} • Schneefallgrenze ca. ${Math.round(precipSummary.snowLevel).toLocaleString('de-DE')} m`;
      } else {
        pHintEl.innerText = `Erwartet in den nächsten 24h${snowNote}: ${precipSummary.total24hMm.toFixed(1)} mm`;
      }
    } else {
      pHintEl.innerText = 'Kein wesentlicher Niederschlag in den nächsten 24h.';
    }
  }

  // 5. Feuchte, Taupunkt & Kondensationsrisiko
  const hum = getHumidityAndDewPoint(cur, hourly, curHourIdx);
  document.getElementById('humidity-val').innerText = `${hum.rh}%`;
  document.getElementById('dew-point-sub').innerText = `Taupunkt: ${hum.dewPoint.toFixed(1)}°C`;
  const condHintEl = document.getElementById('condensation-risk-hint');
  if (condHintEl) {
    condHintEl.innerText = `Spread ${hum.spread.toFixed(1)}°C • Risiko: ${hum.riskShort}`;
  }

  // 6. Luftdruck & echte 3h-Tendenz
  const baro = getBarometricTrend(cur, hourly, curHourIdx);
  document.getElementById('pressure-val').innerHTML = `${baro.qnh} <small>hPa</small>`;
  document.getElementById('pressure-qfe').innerText = `Stationsdruck (QFE): ${baro.qfe} hPa`;
  const pTrendEl = document.getElementById('pressure-trend');
  if (pTrendEl) {
    pTrendEl.innerText = baro.compactText;
  }
}
