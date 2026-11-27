/**
 * BEST WEATHER — Map HUD, Tap-to-Inspect, Legend, Attribution & Thunderstorm Alert Module (v2.0)
 * - Tap-to-Inspect + verschiebbares Fadenkreuz-Pin mit explizitem "Als Hauptort laden" CTA
 * - Korrekte Baseline-Synthese mit dynamischer Standort-Höhe (statt hardcoded 520m)
 * - Dynamische Tile- & Radar-Attribution (.ms-map-attribution)
 * - Live Gewitter-Warnpanel (#thunderstorm-alert-box) mit CAPE- & Blitzdistanz-Daten
 * - Synchronisierte Sports/GPX-Brücke
 */

import { state } from '../../core/state.js';
import { BASE_LAYERS, REGIONAL_STATIONS, WMO_CODES } from '../../core/constants.js';
import { selectExactLocation } from '../search.js';
import { MicroEngine } from '../../microEngine.js';
import { isMapCurrentlyDark } from '../mapSolar.js';
import { escapeHtml, resilientFetch } from '../../httpClient.js';
import { WeatherCanvasEngine } from './mapCanvas.js';
import { ViewportDemStore, ViewportForecastGridStore } from './mapStores.js';
import { getActiveInterpolatedRadarSpec } from './mapTimeline.js';

export function formatCleanLocationName(loc) {
  const raw = loc && loc.name ? String(loc.name).trim() : 'Standort';
  const parenMatch = raw.match(/^Mein Standort\s*\(([^)]+)\)$/i);
  if (parenMatch && parenMatch[1]) return parenMatch[1].trim();
  if (/^Mein Standort$/i.test(raw)) return 'Standort';
  return raw;
}

export function createUserLocationBeaconIcon(loc) {
  const name = formatCleanLocationName(loc);
  const ele = loc && loc.elevation ? `${loc.elevation} m` : '';
  return L.divIcon({
    className: 'custom-location-beacon-container',
    html: `
      <div class="user-location-beacon ms-beacon" title="${escapeHtml(name)} ${ele ? `(${ele})` : ''}">
        <div class="beacon-halo-disk"></div>
        <div class="beacon-pulse-ring"></div>
        <div class="beacon-core-dot"></div>
      </div>
    `,
    iconSize: [72, 72],
    iconAnchor: [36, 36]
  });
}

export function createInspectorPinIcon(elev) {
  return L.divIcon({
    className: 'ms-inspector-pin-container',
    html: `
      <div class="ms-inspector-crosshair" title="Verschiebbarer Inspektor-Pin (${elev} m)">
        <div class="ms-ic-ring"></div>
        <div class="ms-ic-ch-h"></div>
        <div class="ms-ic-ch-v"></div>
        <div class="ms-ic-dot"></div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22]
  });
}

export function getWindCardinalName(deg) {
  const cards = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return cards[idx];
}

export function updateMapAttribution() {
  const attrEl = document.querySelector('.ms-map-attribution');
  if (!attrEl) return;

  const baseKey = (state.map && state.map.activeBase && BASE_LAYERS[state.map.activeBase])
    ? state.map.activeBase
    : 'osm-dark';
  const baseAttr = (BASE_LAYERS[baseKey].options && BASE_LAYERS[baseKey].options.attribution)
    ? BASE_LAYERS[baseKey].options.attribution
    : '© OpenStreetMap';
  const overlay = (state.map && state.map.activeOverlay) || 'precip';
  const overlayAttr = (overlay === 'precip' || overlay === 'rainviewer-radar')
    ? 'Radar: RainViewer · NWP: Open-Meteo/DWD · DEM: AWS Terrarium'
    : 'NWP: Open-Meteo/DWD · DEM: AWS Terrarium';

  attrEl.setAttribute('aria-hidden', 'false');
  attrEl.innerText = `${baseAttr} | ${overlayAttr}`;
}

export function syncMeteoSwissHudControls() {
  const activeOverlay = (state.map && state.map.activeOverlay) || 'precip';

  const subMap = {
    'precip': state.map && state.map.precipPhaseEnabled === false ? 'Niederschlag (Intensität)' : 'Niederschlag & Niederschlagstyp',
    'rainviewer-radar': 'Niederschlag & Niederschlagstyp',
    'wind': 'Wind & Böen (Alpinfeld)',
    'clouds': 'Bewölkung & Hochnebel',
    'temp': 'Temperatur & 0°C-Grenze',
    'pressure': 'Luftdruck QNH & Isobaren',
    'lightning': 'Blitze & Konvektion (CAPE)'
  };
  const subEl = document.getElementById('map-overlay-subtitle');
  if (subEl) subEl.innerText = subMap[activeOverlay] || 'Niederschlag & Niederschlagstyp';

  const fabLight = document.getElementById('ms-fab-lightning');
  if (fabLight) {
    const on = activeOverlay === 'lightning' || !!(state.map && state.map.showLightningOverlay);
    fabLight.classList.toggle('is-active', on);
    fabLight.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  const fabStratus = document.getElementById('ms-fab-stratus');
  if (fabStratus) {
    const on = state.map ? state.map.showStratusOverlay !== false : true;
    fabStratus.classList.toggle('is-active', on);
    fabStratus.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  const fabPhase = document.getElementById('ms-fab-precip-type');
  if (fabPhase) {
    const on = state.map ? state.map.precipPhaseEnabled !== false : true;
    fabPhase.classList.toggle('is-phase-active', on);
    fabPhase.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  const phaseAxisLabel = document.getElementById('ms-phase-axis-label');
  if (phaseAxisLabel) {
    const on = state.map ? state.map.precipPhaseEnabled !== false : true;
    phaseAxisLabel.innerText = on ? 'Niederschlagstyp' : 'Intensität';
  }

  const legendBtn = document.getElementById('map-legend-toggle-btn');
  const legendCard = document.getElementById('map-legend-card');
  if (legendBtn && legendCard) {
    const isVis = !!(state.map && state.map.legendVisible);
    legendCard.classList.toggle('ms-legend-force-open', isVis);
    legendBtn.classList.toggle('is-active', isVis);
    legendBtn.setAttribute('aria-pressed', isVis ? 'true' : 'false');
    if (!isVis && typeof legendBtn.blur === 'function') legendBtn.blur();
  }

  updateMapAttribution();
}

export function updateMapLayerPill() {
  const pillIcon = document.getElementById('mlp-icon');
  const pillText = document.getElementById('mlp-text');
  const pillTag = document.getElementById('mlp-tag');

  const overlayMap = {
    'precip': { icon: '🌧️', name: '48h Radar' },
    'wind': { icon: '💨', name: 'Wind' },
    'lightning': { icon: '⚡', name: 'Blitze' },
    'clouds': { icon: '☁️', name: 'Wolken' },
    'temp': { icon: '🌡️', name: 'Temperatur' },
    'pressure': { icon: '⏲️', name: 'Luftdruck' }
  };
  const baseMap = {
    'osm-dark': 'Relief',
    'osm-outdoor': 'Topo',
    'osm-standard': 'Standard',
    'satellite': 'Satellit'
  };

  const curOverlay = overlayMap[state.map.activeOverlay] || overlayMap['precip'];
  const curBase = baseMap[state.map.activeBase] || 'Relief';

  if (pillIcon) pillIcon.innerText = curOverlay.icon;
  if (pillText) pillText.innerText = curOverlay.name;
  if (pillTag) pillTag.innerText = curBase;
}

/**
 * Fix der 520m-Verzerrung: nutzt die echte aktuelle Standort-Höhe als Referenzhöhe!
 */
export function getSynthesizedBaselineStations() {
  const cur = (state.weatherData && state.weatherData.current) ? state.weatherData.current : {};
  const refElev = (state.currentLocation && Number.isFinite(state.currentLocation.elevation))
    ? state.currentLocation.elevation
    : 520;
  const baseT = cur.temperature_2m !== undefined ? cur.temperature_2m : 12.0;
  const baseRh = cur.relative_humidity_2m !== undefined ? cur.relative_humidity_2m : 82;
  const baseP = cur.surface_pressure !== undefined ? cur.surface_pressure : 1014.2;
  const baseWind = cur.wind_speed_10m !== undefined ? cur.wind_speed_10m : 16.0;
  const baseDir = cur.wind_direction_10m !== undefined ? cur.wind_direction_10m : 240;
  const baseCloud = cur.cloud_cover !== undefined ? cur.cloud_cover : 55;
  const freezeLvl = Math.round(refElev + (baseT / 0.65) * 100);

  return REGIONAL_STATIONS.map(st => {
    const stElev = st.elevation !== undefined ? st.elevation : 500;
    const deltaElev = stElev - refElev;
    const t = Math.round((baseT - (deltaElev / 100) * 0.65) * 10) / 10;
    const rh = Math.min(99, Math.round(baseRh + (st.isMountain ? 6 : 0)));
    const synopticP = baseP + (st.lat - 47.5) * 2.2 - (st.lon - 11.0) * 1.5;
    const pMsl = Math.round(synopticP * 10) / 10;
    const spd = Math.round(baseWind * (st.isMountain ? 1.85 : 1.0));
    const gust = Math.round(spd * (st.isMountain ? 1.6 : 1.35));
    const dir = (baseDir + (st.isMountain ? 15 : -10) + 360) % 360;
    const cloud = st.isMountain ? Math.min(100, baseCloud + 15) : baseCloud;
    const basePrecip = (cur.precipitation !== undefined) ? cur.precipitation : (cur.rain || 0);
    const stPrecip = basePrecip > 0
      ? (st.isMountain ? Math.round(basePrecip * 1.35 * 10) / 10 : basePrecip)
      : (st.isMountain && cloud >= 82 ? 0.2 : 0);
    const wCodeGuess = stPrecip > 0 ? 61 : (cloud > 75 ? 3 : 1);
    const cloudCoverLow = !st.isMountain && cloud >= 60 ? Math.min(98, Math.round(cloud * 0.85)) : Math.round(cloud * 0.55);

    const phaseInfo = MicroEngine.classifyPrecipPhase({
      tempC: t, rhPct: rh, precipMm: stPrecip,
      rainMm: t > 1.5 ? stPrecip : 0, snowCm: t <= 0.5 ? stPrecip : 0,
      elevation: stElev, freezingLevelM: freezeLvl, wCode: stPrecip > 0 ? 61 : 2
    });
    const isSnow = phaseInfo.snowRatio >= 0.55;
    const stSnow = isSnow && stPrecip > 0 ? Math.round(stPrecip * phaseInfo.snowRatio * 10) / 10 : 0;

    return {
      name: st.name, lat: st.lat, lon: st.lon, elevation: stElev,
      isMountain: !!st.isMountain, precip: stPrecip,
      rain: Math.round(stPrecip * (1 - phaseInfo.snowRatio) * 100) / 100,
      snow: stSnow, temperature: t, relativeHumidity: rh,
      wetBulbC: phaseInfo.wetBulbC, freezingLevelHeight: freezeLvl,
      snowRatio: phaseInfo.snowRatio, phase: phaseInfo.phase,
      weatherCode: isSnow && stPrecip > 0 ? 71 : wCodeGuess,
      cloudCover: cloud, cloudCoverLow, pressureMsl: pMsl,
      windSpeed: spd, windDirection: dir, windGusts: gust, cape: 0, isSnow
    };
  });
}

export async function loadRegionalStationWeather() {
  if (state.map.regionalStationsData && state.map.regionalStationsData.length) return state.map.regionalStationsData;
  const lats = REGIONAL_STATIONS.map(s => s.lat.toFixed(3)).join(',');
  const lons = REGIONAL_STATIONS.map(s => s.lon.toFixed(3)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,cloud_cover_low,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m`;

  try {
    const data = await resilientFetch(url, {
      ttlMs: 30 * 60 * 1000,
      persist: true,
      staleTtlMs: 24 * 60 * 60 * 1000,
      allowStaleOnError: true
    });
    const stationResults = Array.isArray(data) ? data : [data];

    state.map.regionalStationsData = REGIONAL_STATIONS.map((station, i) => {
      const resObj = stationResults[i] || {};
      const weather = resObj.current || {};
      const modelElev = Number.isFinite(resObj.elevation) ? Math.round(resObj.elevation) : station.elevation;
      const stElev = station.elevation !== undefined ? station.elevation : modelElev;
      const rawT = weather.temperature_2m !== undefined ? weather.temperature_2m : 11;
      const elevGap = stElev - modelElev;
      const t = (station.isMountain && elevGap > 80) ? Math.round((rawT - (elevGap / 100) * 0.62) * 10) / 10 : rawT;
      const rh = weather.relative_humidity_2m !== undefined ? weather.relative_humidity_2m : 84;
      const precip = Math.max(weather.precipitation || 0, (weather.rain || 0) + (weather.showers || 0));
      const snow = weather.snowfall || 0;
      const freezeLvl = Math.round(stElev + (t / 0.65) * 100);
      const wCode = weather.weather_code || 1;

      const phaseInfo = MicroEngine.classifyPrecipPhase({
        tempC: t, rhPct: rh, precipMm: precip,
        rainMm: (weather.rain || 0) + (weather.showers || 0),
        snowCm: snow, elevation: stElev, freezingLevelM: freezeLvl, wCode
      });

      return {
        ...station,
        elevation: stElev, weather, temperature: t, relativeHumidity: rh,
        wetBulbC: phaseInfo.wetBulbC, freezingLevelHeight: freezeLvl,
        snowRatio: phaseInfo.snowRatio, phase: phaseInfo.phase,
        precip, rain: (weather.rain || 0) + (weather.showers || 0), snow, weatherCode: wCode,
        cloudCover: weather.cloud_cover !== undefined ? weather.cloud_cover : 50,
        cloudCoverLow: weather.cloud_cover_low !== undefined
          ? weather.cloud_cover_low
          : ((wCode === 45 || wCode === 48) ? 94 : Math.round((weather.cloud_cover !== undefined ? weather.cloud_cover : 50) * (stElev < 950 ? 0.78 : 0.48))),
        pressureMsl: weather.pressure_msl || 1013.5,
        windSpeed: weather.wind_speed_10m || 15,
        windDirection: weather.wind_direction_10m || 240,
        windGusts: weather.wind_gusts_10m || 22,
        cape: 0,
        isSnow: phaseInfo.snowRatio >= 0.55
      };
    });

    return state.map.regionalStationsData;
  } catch (err) {
    console.warn('Regional weather batch fetch fallback:', err.message);
    state.map.regionalStationsData = getSynthesizedBaselineStations();
    return state.map.regionalStationsData;
  }
}

/**
 * Berechnet punktgenaue Wetterdaten für entweder den temporären Inspektor-Punkt (0ms)
 * oder den globalen Hauptstandort.
 */
export function getLocationWeatherForFrame(frame) {
  const inspected = state.map && state.map.inspectedPoint ? state.map.inspectedPoint : null;
  if (inspected) {
    const stations = (frame && frame.stations && frame.stations.length > 0)
      ? frame.stations
      : ((state.map && state.map.regionalStationsData && state.map.regionalStationsData.length > 0)
          ? state.map.regionalStationsData
          : getSynthesizedBaselineStations());

    const mergedStations = WeatherCanvasEngine._mergeWithViewportGrid
      ? WeatherCanvasEngine._mergeWithViewportGrid(stations, frame)
      : stations;

    const elev = Math.round(inspected.elevation !== undefined
      ? inspected.elevation
      : ViewportDemStore.getElevation(inspected.lat, inspected.lon, mergedStations));

    // Stations-Temperatur mit echter DEM-Lapse-Rate berechnen
    let sumWT = 0, sumTMsl = 0;
    for (let i = 0; i < mergedStations.length; i++) {
      const s = mergedStations[i];
      const d2 = (inspected.lat - s.lat) ** 2 + (inspected.lon - s.lon) ** 2 + 0.00008;
      const w = 1 / Math.pow(d2, 1.35);
      const sElev = s.elevation ?? 520;
      const sT = s.temperature ?? 10;
      sumWT += w;
      sumTMsl += w * (sT + (sElev / 100) * 0.65);
    }
    const tMsl = sumWT > 0 ? sumTMsl / sumWT : 14;
    const t = Math.round((tMsl - (elev / 100) * 0.65) * 10) / 10;
    const rh = Math.round(WeatherCanvasEngine.interpolateStationMetric(inspected.lat, inspected.lon, mergedStations, 'relativeHumidity') || 80);
    const vec = WeatherCanvasEngine.interpolateWindVector(inspected.lat, inspected.lon, mergedStations);
    const gust = Math.round(WeatherCanvasEngine.interpolateStationMetric(inspected.lat, inspected.lon, mergedStations, 'windGusts') || vec.speed * 1.35);
    const clouds = Math.round(WeatherCanvasEngine.interpolateStationMetric(inspected.lat, inspected.lon, mergedStations, 'cloudCover') || 45);
    const press = Math.round(WeatherCanvasEngine.interpolateStationMetric(inspected.lat, inspected.lon, mergedStations, 'pressureMsl') || 1014);
    const radarSample = WeatherCanvasEngine.sampleAtLatLon(inspected.lat, inspected.lon, frame, { overrideElevation: elev });
    const precip = radarSample && radarSample.rateMmH >= 0.04 ? radarSample.rateMmH : 0;
    const snow = (precip > 0 && radarSample.snowRatio >= 0.55) ? Math.round(precip * radarSample.snowRatio * 100) / 100 : 0;
    const freezingLvl = Math.round(elev + (t / 0.65) * 100);
    const code = precip >= 0.2 ? (radarSample.phase === 'snow' ? 71 : 61) : (clouds >= 80 ? 3 : (clouds >= 45 ? 2 : 0));

    return {
      name: inspected.name || `${elev >= 1100 ? 'Bergpunkt' : 'Kartenpunkt'} (${elev} m)`,
      isInspected: true,
      isMountain: elev >= 1100,
      elevation: elev,
      freezingLevelM: Math.max(0, freezingLvl),
      temp: t,
      relativeHumidity: rh,
      wetBulbC: MicroEngine.computeWetBulbTemp(t, rh),
      snowRatio: radarSample ? radarSample.snowRatio : 0,
      precipPhase: precip >= 0.04 ? (radarSample ? radarSample.phase : 'rain') : 'dry',
      radarDbz: radarSample ? radarSample.dbz : 0,
      radarIntensityLabel: radarSample ? radarSample.intensityLabel : '',
      windSpeed: Math.round(vec.speed),
      windGusts: gust,
      windDir: Math.round(vec.dir),
      precip,
      snow,
      cloudCover: clouds,
      pressure: press,
      weatherCode: code,
      isDay: new Date((frame && frame.timestampMs) || Date.now()).getHours() >= 6 && new Date((frame && frame.timestampMs) || Date.now()).getHours() <= 20
    };
  }

  const loc = state.currentLocation || { name: 'Standort', elevation: 500 };
  const cur = (state.weatherData && state.weatherData.current) ? state.weatherData.current : {};
  const hourly = (state.weatherData && state.weatherData.hourly) ? state.weatherData.hourly : {};
  const locName = loc.name || 'Standort';

  if (!hourly.time || hourly.time.length === 0) {
    const curSpd = cur.wind_speed_10m !== undefined ? Math.round(cur.wind_speed_10m) : 15;
    const elev = loc.elevation !== undefined ? loc.elevation : 500;
    const tVal = cur.temperature_2m !== undefined ? cur.temperature_2m : 12;
    const rhVal = cur.relative_humidity_2m !== undefined ? Math.round(cur.relative_humidity_2m) : 84;
    let pVal = cur.precipitation !== undefined ? cur.precipitation : (cur.rain || 0);
    let snowVal = cur.snowfall || 0;
    const wCodeVal = cur.weather_code !== undefined ? cur.weather_code : 1;

    let phaseInfo = MicroEngine.classifyPrecipPhase({
      tempC: tVal, rhPct: rhVal, precipMm: pVal, rainMm: pVal, snowCm: snowVal,
      elevation: elev, freezingLevelM: null, wCode: wCodeVal
    });

    let radarSample = null;
    if (loc.lat !== undefined && loc.lon !== undefined && WeatherCanvasEngine.sampleAtLatLon) {
      radarSample = WeatherCanvasEngine.sampleAtLatLon(loc.lat, loc.lon, frame, { overrideElevation: elev });
      if (radarSample && (radarSample.source === 'radar' || radarSample.source === 'synthetic' || radarSample.rateMmH >= 0.14)) {
        pVal = radarSample.rateMmH >= 0.14 ? Math.round(radarSample.rateMmH * 10) / 10 : 0;
        snowVal = (pVal > 0 && radarSample.snowRatio >= 0.55) ? Math.round(pVal * radarSample.snowRatio * 10) / 10 : 0;
        phaseInfo = { ...phaseInfo, snowRatio: radarSample.snowRatio, phase: pVal >= 0.14 ? radarSample.phase : 'dry' };
      }
    }

    return {
      name: locName,
      isMountain: !!loc.isMountain,
      elevation: elev,
      freezingLevelM: Math.max(0, Math.round(elev + (tVal / 0.65) * 100)),
      temp: Math.round(tVal * 10) / 10,
      relativeHumidity: rhVal,
      wetBulbC: phaseInfo.wetBulbC,
      snowRatio: phaseInfo.snowRatio,
      precipPhase: phaseInfo.phase,
      radarDbz: radarSample ? radarSample.dbz : 0,
      radarIntensityLabel: radarSample ? radarSample.intensityLabel : '',
      windSpeed: curSpd,
      windGusts: cur.wind_gusts_10m !== undefined ? Math.round(cur.wind_gusts_10m) : Math.round(curSpd * 1.35),
      windDir: cur.wind_direction_10m !== undefined ? Math.round(cur.wind_direction_10m) : 240,
      precip: pVal,
      snow: snowVal,
      cloudCover: cur.cloud_cover !== undefined ? cur.cloud_cover : 40,
      pressure: cur.surface_pressure !== undefined ? Math.round(cur.surface_pressure) : 1014,
      weatherCode: wCodeVal,
      isDay: cur.is_day !== undefined ? cur.is_day === 1 : (new Date().getHours() >= 6 && new Date().getHours() <= 20)
    };
  }

  const targetTimeMs = (frame && frame.timestampMs) ? frame.timestampMs : Date.now();
  const isLiveNow = (frame && (frame.isLive || frame.minuteOffset === 0)) || Math.abs(targetTimeMs - Date.now()) < 3 * 60000;

  let idxBefore = 0, idxAfter = 0, fraction = 0, foundRange = false;
  for (let i = 0; i < hourly.time.length - 1; i++) {
    const t0 = new Date(hourly.time[i]).getTime();
    const t1 = new Date(hourly.time[i + 1]).getTime();
    if (targetTimeMs >= t0 && targetTimeMs <= t1) {
      idxBefore = i; idxAfter = i + 1;
      fraction = t1 > t0 ? (targetTimeMs - t0) / (t1 - t0) : 0;
      foundRange = true;
      break;
    }
  }
  if (!foundRange) {
    let bestIdx = 0, minDiff = Infinity;
    for (let i = 0; i < hourly.time.length; i++) {
      const diff = Math.abs(new Date(hourly.time[i]).getTime() - targetTimeMs);
      if (diff < minDiff) { minDiff = diff; bestIdx = i; }
    }
    idxBefore = bestIdx; idxAfter = bestIdx;
  }

  const lerp = (arr, fallback = 0) => {
    if (!arr || !arr.length) return fallback;
    const v0 = arr[idxBefore] !== undefined ? arr[idxBefore] : fallback;
    const v1 = arr[idxAfter] !== undefined ? arr[idxAfter] : v0;
    return v0 + (v1 - v0) * fraction;
  };
  const interpAngle = (arr, fallback = 240) => {
    if (!arr || !arr.length) return fallback;
    const a = arr[idxBefore] !== undefined ? arr[idxBefore] : fallback;
    const b = arr[idxAfter] !== undefined ? arr[idxAfter] : a;
    let diff = (b - a) % 360;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    return Math.round(((a + diff * fraction) % 360 + 360) % 360);
  };

  const t = (isLiveNow && cur.temperature_2m !== undefined)
    ? cur.temperature_2m
    : lerp(hourly.temperature_2m, cur.temperature_2m !== undefined ? cur.temperature_2m : 12);
  const rh = (isLiveNow && cur.relative_humidity_2m !== undefined)
    ? Math.round(cur.relative_humidity_2m)
    : Math.round(lerp(hourly.relative_humidity_2m, 84));
  const spd = (isLiveNow && cur.wind_speed_10m !== undefined)
    ? Math.round(cur.wind_speed_10m)
    : Math.round(lerp(hourly.wind_speed_10m, cur.wind_speed_10m !== undefined ? cur.wind_speed_10m : 15));
  const gust = (isLiveNow && cur.wind_gusts_10m !== undefined)
    ? Math.round(cur.wind_gusts_10m)
    : Math.round(lerp(hourly.wind_gusts_10m, cur.wind_gusts_10m !== undefined ? cur.wind_gusts_10m : Math.round(spd * 1.35)));
  const dir = (isLiveNow && cur.wind_direction_10m !== undefined)
    ? Math.round(cur.wind_direction_10m)
    : interpAngle(hourly.wind_direction_10m, cur.wind_direction_10m !== undefined ? cur.wind_direction_10m : 240);
  let precip = (isLiveNow && cur.precipitation !== undefined)
    ? cur.precipitation
    : Math.max(0, Math.round(lerp(hourly.precipitation, 0) * 100) / 100);
  let snow = Math.max(0, Math.round(lerp(hourly.snowfall, 0) * 100) / 100);
  const rainVal = Math.max(0, Math.round(lerp(hourly.rain, precip) * 100) / 100);
  const freezingLvl = (hourly.freezing_level_height && hourly.freezing_level_height.length)
    ? Math.round(lerp(hourly.freezing_level_height, null))
    : null;
  const clouds = (isLiveNow && cur.cloud_cover !== undefined) ? cur.cloud_cover : Math.round(lerp(hourly.cloud_cover, 40));
  const press = Math.round(lerp(hourly.surface_pressure || hourly.pressure_msl, cur.surface_pressure !== undefined ? cur.surface_pressure : 1014));
  const code = (isLiveNow && cur.weather_code !== undefined)
    ? cur.weather_code
    : (fraction < 0.5 ? (hourly.weather_code ? hourly.weather_code[idxBefore] : 1) : (hourly.weather_code ? hourly.weather_code[idxAfter] : 1));

  const elev = loc.elevation !== undefined ? loc.elevation : 500;
  let phaseInfo = MicroEngine.classifyPrecipPhase({
    tempC: t, rhPct: rh, precipMm: precip, rainMm: rainVal, snowCm: snow,
    elevation: elev, freezingLevelM: freezingLvl, wCode: code
  });

  let radarSample = null;
  if (loc.lat !== undefined && loc.lon !== undefined && WeatherCanvasEngine.sampleAtLatLon) {
    radarSample = WeatherCanvasEngine.sampleAtLatLon(loc.lat, loc.lon, frame, { overrideElevation: elev });
    if (radarSample && (radarSample.source === 'radar' || radarSample.source === 'synthetic')) {
      precip = radarSample.rateMmH >= 0.04 ? Math.round(radarSample.rateMmH * 100) / 100 : 0;
      snow = (precip > 0 && radarSample.snowRatio >= 0.55) ? Math.round(precip * radarSample.snowRatio * 100) / 100 : 0;
      phaseInfo = { ...phaseInfo, snowRatio: radarSample.snowRatio, phase: precip >= 0.04 ? radarSample.phase : 'dry' };
    } else if (radarSample && radarSample.rateMmH >= 0.04 && precip < 0.04) {
      precip = Math.round(radarSample.rateMmH * 100) / 100;
      snow = radarSample.snowRatio >= 0.55 ? Math.round(precip * radarSample.snowRatio * 100) / 100 : snow;
      phaseInfo.snowRatio = radarSample.snowRatio;
      phaseInfo.phase = radarSample.phase;
    }
  }

  const targetDateForDay = new Date(targetTimeMs);
  const nearestDayIdx = fraction < 0.5 ? idxBefore : idxAfter;
  const isDay = (hourly.is_day && hourly.is_day[nearestDayIdx] !== undefined)
    ? hourly.is_day[nearestDayIdx] === 1
    : (isLiveNow && cur.is_day !== undefined)
      ? cur.is_day === 1
      : (targetDateForDay.getHours() >= 6 && targetDateForDay.getHours() <= 20);

  return {
    name: locName,
    isMountain: !!loc.isMountain,
    elevation: elev,
    freezingLevelM: freezingLvl || Math.max(0, Math.round(elev + (t / 0.65) * 100)),
    temp: Math.round(t * 10) / 10,
    relativeHumidity: rh,
    wetBulbC: phaseInfo.wetBulbC,
    snowRatio: phaseInfo.snowRatio,
    precipPhase: phaseInfo.phase,
    radarDbz: radarSample ? radarSample.dbz : 0,
    radarIntensityLabel: radarSample ? radarSample.intensityLabel : '',
    windSpeed: spd,
    windGusts: gust,
    windDir: dir,
    precip,
    snow,
    cloudCover: clouds,
    pressure: press,
    weatherCode: code,
    isDay
  };
}

export function updateWindCompassWidget(frame) {
  const widget = document.getElementById('map-wind-compass-widget');
  if (!widget) return;
  if (state.map.activeOverlay !== 'wind') {
    widget.style.display = 'none';
    return;
  }

  widget.style.display = 'flex';
  const locWeather = getLocationWeatherForFrame(frame);
  const speed = locWeather.windSpeed;
  const dir = locWeather.windDir;
  const gust = locWeather.windGusts;
  const card = getWindCardinalName(dir);

  let desc = 'Mäßiger Wind • Freie Strömung';
  let color = '#22c55e';
  if (gust >= 80) { desc = '⚠️ Orkanartige Böen • Sturmgefahr!'; color = '#c084fc'; }
  else if (gust >= 60) { desc = '⚠️ Starker Sturm auf Berggipfeln'; color = '#ef4444'; }
  else if (gust >= 40) { desc = 'Frische Brise • Kräftige Böen'; color = '#f59e0b'; }
  else if (speed >= 25) { desc = 'Mäßiger Tal- & Hangwind'; color = '#38bdf8'; }

  const speedEl = document.getElementById('mwc-speed-val');
  if (speedEl) { speedEl.innerText = speed; speedEl.style.color = color; }
  const gustEl = document.getElementById('mwc-gust-val');
  if (gustEl) gustEl.innerText = gust;
  const dirChip = document.getElementById('mwc-dir-chip');
  if (dirChip) dirChip.innerText = `${card} • ${dir}°`;
  const descEl = document.getElementById('mwc-desc');
  if (descEl) descEl.innerText = `${formatCleanLocationName({ name: locWeather.name })} • ${desc}`;

  const needleWrap = document.getElementById('mwc-needle-wrap');
  if (needleWrap) {
    const rawTarget = dir + 180;
    const prev = state.map._compassNeedleAngle;
    if (typeof prev === 'number' && Number.isFinite(prev)) {
      let delta = ((rawTarget - prev) % 360 + 540) % 360 - 180;
      state.map._compassNeedleAngle = prev + delta;
    } else {
      state.map._compassNeedleAngle = rawTarget;
    }
    needleWrap.style.transform = `rotate(${state.map._compassNeedleAngle}deg)`;
  }
}

export function updatePointWeatherCard(frame) {
  const card = document.getElementById('map-point-weather-card');
  if (!card) return;

  if (!frame) {
    const activeSpec = getActiveInterpolatedRadarSpec();
    if (activeSpec) frame = activeSpec.frame;
  }

  const inspected = state.map && state.map.inspectedPoint ? state.map.inspectedPoint : null;
  const loc = inspected || state.currentLocation || { name: 'München', elevation: 520 };
  const locWeather = getLocationWeatherForFrame(frame);
  const codeInfo = WMO_CODES[locWeather.weatherCode] || WMO_CODES[0] || { label: 'Heiter', icon: '☀️' };

  card.classList.toggle('is-inspecting', !!inspected);

  const nameEl = document.getElementById('mpw-location-name');
  if (nameEl) nameEl.innerText = formatCleanLocationName(loc);

  const inspectBar = document.getElementById('mpw-inspect-actions');
  if (inspectBar) {
    inspectBar.style.display = inspected ? 'flex' : 'none';
  }

  const typeBadge = document.getElementById('mpw-type-badge');
  const hasWet = locWeather.precip >= 0.04 || locWeather.snow >= 0.05;
  const effPhase = hasWet ? (locWeather.precipPhase || (locWeather.snow > 0 ? 'snow' : 'rain')) : 'dry';

  if (typeBadge) {
    if (inspected) {
      typeBadge.innerText = effPhase === 'snow' ? '🔍 ❄️ SCHNEE' : (effPhase === 'rain' ? '🔍 🌧️ REGEN' : '🔍 INSPEKTOR');
      typeBadge.style.color = '#fbbf24';
      typeBadge.style.borderColor = 'rgba(251, 191, 36, 0.55)';
      typeBadge.style.background = 'rgba(245, 158, 11, 0.18)';
    } else if (effPhase === 'snow') {
      typeBadge.innerText = '❄️ SCHNEE';
      typeBadge.style.color = '#e0f4ff';
      typeBadge.style.borderColor = 'rgba(132, 218, 251, 0.65)';
      typeBadge.style.background = 'rgba(56, 189, 248, 0.20)';
    } else if (effPhase === 'sleet') {
      typeBadge.innerText = '🌨️ SCHNEEREGEN';
      typeBadge.style.color = '#6ee7b7';
      typeBadge.style.borderColor = 'rgba(20, 184, 146, 0.60)';
      typeBadge.style.background = 'rgba(16, 185, 129, 0.22)';
    } else if (effPhase === 'rain' || effPhase === 'trace') {
      typeBadge.innerText = '🌧️ REGEN';
      typeBadge.style.color = '#93c5fd';
      typeBadge.style.borderColor = 'rgba(59, 130, 246, 0.55)';
      typeBadge.style.background = 'rgba(37, 99, 235, 0.24)';
    } else {
      typeBadge.innerText = loc.isMountain ? '🏔️ BERG' : '📍 ORT';
      typeBadge.style.color = '#38bdf8';
      typeBadge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
      typeBadge.style.background = 'rgba(56, 189, 248, 0.2)';
    }
  }

  const elevChip = document.getElementById('mpw-elevation-chip');
  if (elevChip) elevChip.innerText = `${locWeather.elevation !== undefined ? locWeather.elevation : 500} m`;

  const timeBadge = document.getElementById('mpw-time-badge');
  if (timeBadge) {
    const rawMo = frame && frame.minuteOffset !== undefined ? Number(frame.minuteOffset) : undefined;
    const dispMo = (rawMo !== undefined && Number.isFinite(rawMo)) ? Math.round(rawMo) : undefined;
    if (frame && !frame.isLive && dispMo !== undefined && dispMo !== 0) {
      let text = '';
      if (Math.abs(dispMo) < 60) text = dispMo > 0 ? `+${dispMo}m` : `${dispMo}m`;
      else if (dispMo % 60 === 0) text = dispMo > 0 ? `+${dispMo / 60}h` : `${dispMo / 60}h`;
      else {
        const h = Math.floor(Math.abs(dispMo) / 60), m = Math.abs(dispMo) % 60;
        text = dispMo > 0 ? `+${h}h ${m}m` : `-${h}h ${m}m`;
      }
      timeBadge.innerText = text;
      timeBadge.className = 'mpw-time-badge forecast';
    } else if (frame && !frame.isLive && frame.hoursFromNow !== undefined && Math.abs(frame.hoursFromNow) >= 0.05) {
      const hRound = Math.round(frame.hoursFromNow * 10) / 10;
      timeBadge.innerText = hRound > 0 ? `+${hRound}h` : `${hRound}h`;
      timeBadge.className = 'mpw-time-badge forecast';
    } else {
      timeBadge.innerText = 'LIVE';
      timeBadge.className = 'mpw-time-badge live';
    }
  }

  const wmoIcon = locWeather.isDay === false ? (codeInfo.iconNight || '🌙') : (codeInfo.icon || '🌤️');
  const phaseIcon = effPhase === 'snow' ? '❄️' : effPhase === 'sleet' ? '🌨️' : effPhase === 'rain' ? '🌧️' : wmoIcon;
  const iconEl = document.getElementById('mpw-condition-icon');
  if (iconEl) iconEl.innerText = phaseIcon;

  const tempEl = document.getElementById('mpw-temp-val');
  const quickTempEl = document.getElementById('mpw-quick-temp-chip');
  if (tempEl) {
    const tempVal = typeof locWeather.temp === 'number' ? Math.round(locWeather.temp) : 12;
    tempEl.innerText = `${tempVal}°`;
    if (quickTempEl) quickTempEl.innerText = `${tempVal}° ${phaseIcon}`;
  }

  const condLabel = document.getElementById('mpw-condition-label');
  if (condLabel) {
    if (effPhase === 'snow') condLabel.innerText = locWeather.radarIntensityLabel ? `Schnee (${locWeather.radarIntensityLabel})` : 'Schneefall';
    else if (effPhase === 'sleet') condLabel.innerText = locWeather.radarIntensityLabel ? `Schneeregen (${locWeather.radarIntensityLabel})` : 'Schneeregen / Mix';
    else if (effPhase === 'rain') condLabel.innerText = locWeather.radarIntensityLabel ? `Regen (${locWeather.radarIntensityLabel})` : (codeInfo.label || 'Regen');
    else condLabel.innerText = codeInfo.label || 'Trocken';
  }

  const rainEl = document.getElementById('mpw-rain-val');
  if (rainEl) {
    const parentPill = rainEl.closest('.mpw-metric-pill');
    if (effPhase === 'snow') {
      rainEl.innerText = locWeather.precip > 0 ? `${locWeather.precip.toFixed(1)} mm/h` : `${locWeather.snow.toFixed(1)} cm`;
      if (parentPill) {
        parentPill.title = 'Schneefall-Intensität';
        const icon = parentPill.querySelector('.mpw-metric-icon');
        if (icon) icon.innerText = '❄️';
      }
    } else if (effPhase === 'sleet') {
      rainEl.innerText = `${(locWeather.precip || 0).toFixed(1)} mm/h`;
      if (parentPill) {
        parentPill.title = 'Schneeregen / Mischphase';
        const icon = parentPill.querySelector('.mpw-metric-icon');
        if (icon) icon.innerText = '🌨️';
      }
    } else {
      rainEl.innerText = `${(locWeather.precip || 0).toFixed(1)} mm/h`;
      if (parentPill) {
        parentPill.title = 'Niederschlagsintensität (Regen)';
        const icon = parentPill.querySelector('.mpw-metric-icon');
        if (icon) icon.innerText = '💧';
      }
    }
  }

  const windEl = document.getElementById('mpw-wind-val');
  if (windEl) {
    const cardDir = getWindCardinalName(locWeather.windDir);
    windEl.innerText = `${locWeather.windSpeed} km/h · ${cardDir}`;
    if (windEl.parentElement) {
      windEl.parentElement.title = `Windgeschwindigkeit: ${locWeather.windSpeed} km/h aus ${cardDir} (${locWeather.windDir}°)`;
    }
  }

  const gustEl = document.getElementById('mpw-gust-val');
  if (gustEl) gustEl.innerText = `${locWeather.windGusts} km/h`;

  const cloudsEl = document.getElementById('mpw-clouds-val');
  if (cloudsEl) cloudsEl.innerText = `${Math.round(locWeather.cloudCover)}%`;

  const motionValEl = document.getElementById('mpw-front-motion-val');
  if (motionValEl) {
    const windDir = locWeather.windDir !== undefined ? locWeather.windDir : 240;
    const windSpeed = locWeather.windSpeed !== undefined ? locWeather.windSpeed : 15;
    const fromCard = getWindCardinalName(windDir);
    const toCard = getWindCardinalName((windDir + 180) % 360);
    motionValEl.innerText = `${fromCard} ➔ ${toCard} (${windSpeed} km/h)`;
  }
}

/**
 * Tap-to-Inspect: Zeigt sofort (0ms) Live-/Prognosewerte am gewünschten Punkt + verschiebbaren Fadenkreuz-Pin,
 * ohne die gesamte App (Tab 1/2/4) umzuschalten!
 */
export function inspectMapPoint(lat, lon, { pan = false, zoomPreserve = true } = {}) {
  if (!state.map || !state.map.instance || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const stations = (state.map.regionalStationsData && state.map.regionalStationsData.length)
    ? state.map.regionalStationsData
    : REGIONAL_STATIONS;

  const elev = Math.round(ViewportDemStore.getElevation(lat, lon, stations));
  const isMtn = elev >= 1100;
  const name = `${isMtn ? 'Bergpunkt' : 'Kartenpunkt'} (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`;

  state.map.inspectedPoint = { lat, lon, name, elevation: elev, isMountain: isMtn, isMapPoint: true };
  state.map._pointCardDismissed = false;

  if (!state.map.inspectorMarker) {
    state.map.inspectorMarker = L.marker([lat, lon], {
      icon: createInspectorPinIcon(elev),
      draggable: true,
      zIndexOffset: 3200
    }).addTo(state.map.instance);

    state.map.inspectorMarker.on('drag', (ev) => {
      const pos = ev.target.getLatLng();
      const dragElev = Math.round(ViewportDemStore.getElevation(pos.lat, pos.lng, stations));
      state.map.inspectedPoint = {
        lat: pos.lat,
        lon: pos.lng,
        name: `${dragElev >= 1100 ? 'Bergpunkt' : 'Kartenpunkt'} (${pos.lat.toFixed(2)}°, ${pos.lng.toFixed(2)}°)`,
        elevation: dragElev,
        isMountain: dragElev >= 1100,
        isMapPoint: true
      };
      updatePointWeatherCard();
    });
    state.map.inspectorMarker.on('dragend', (ev) => {
      const pos = ev.target.getLatLng();
      inspectMapPoint(pos.lat, pos.lng, { pan: false });
    });
  } else {
    state.map.inspectorMarker.setLatLng([lat, lon]);
    state.map.inspectorMarker.setIcon(createInspectorPinIcon(elev));
    if (!state.map.instance.hasLayer(state.map.inspectorMarker)) {
      state.map.inspectorMarker.addTo(state.map.instance);
    }
  }

  if (pan) {
    state.map.instance.panTo([lat, lon], { animate: true });
  }

  const pwCard = document.getElementById('map-point-weather-card');
  if (pwCard && pwCard.classList.contains('collapsed')) {
    pwCard.classList.remove('collapsed');
    const pwToggle = document.getElementById('mpw-mobile-toggle-btn');
    if (pwToggle) pwToggle.innerText = '▾';
  }
  updatePointWeatherCard();
}

export function clearInspectedMapPoint() {
  if (!state.map) return;
  state.map.inspectedPoint = null;
  if (state.map.inspectorMarker && state.map.instance && state.map.instance.hasLayer(state.map.inspectorMarker)) {
    state.map.instance.removeLayer(state.map.inspectorMarker);
  }
  updatePointWeatherCard();
}

export function promoteInspectedPointToPrimary() {
  const pt = state.map && state.map.inspectedPoint;
  if (!pt) return;
  const elev = Math.round(pt.elevation || 500);
  const label = `${pt.isMountain ? 'Bergpunkt' : 'Kartenpunkt'} (${elev} m)`;
  clearInspectedMapPoint();
  if (state.map.marker) {
    state.map.marker.setLatLng([pt.lat, pt.lon]);
  }
  selectExactLocation({
    name: label,
    lat: pt.lat,
    lon: pt.lon,
    elevation: elev,
    country: '',
    isMountain: elev >= 1100,
    isMapPoint: true
  }, { addToRecents: false });
}

export function updateThunderstormAlertBox(frame, overlay, stations) {
  const box = document.getElementById('thunderstorm-alert-box');
  if (!box) return;

  const isStormMode = overlay === 'lightning' || !!(state.map && state.map.showLightningOverlay);
  if (!isStormMode || state.map._thunderAlertDismissed) {
    box.style.display = 'none';
    return;
  }

  const refLoc = (state.map && state.map.inspectedPoint) || state.currentLocation;
  const lat = (refLoc && refLoc.lat !== undefined) ? refLoc.lat : 48.137;
  const lon = (refLoc && refLoc.lon !== undefined) ? refLoc.lon : 11.581;
  const isFuture = !!(frame && !frame.isLive && frame.minuteOffset > 20);

  let nearestKm = null;
  let maxCape = 0;

  if (!isFuture && MicroEngine && MicroEngine.computeLightningActivity) {
    const storm = MicroEngine.computeLightningActivity(lat, lon, state.weatherData);
    if (storm && Array.isArray(storm.strikes) && storm.strikes.length > 0) {
      nearestKm = Math.min(...storm.strikes.map(s => Number(s.distKm) || 99));
    }
  } else if (stations && stations.length) {
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      if ((s.cape || 0) > maxCape) maxCape = s.cape || 0;
      const isStorm = (s.weatherCode >= 95) || ((s.cape || 0) >= 550 && (s.precip || 0) >= 1.2) || ((s.precip || 0) >= 3.5 && (s.temperature || 0) >= 15);
      if (isStorm) {
        const dKm = Math.hypot(s.lat - lat, (s.lon - lon) * 0.68) * 111.0;
        if (nearestKm === null || dKm < nearestKm) nearestKm = dKm;
      }
    }
  }

  if (nearestKm === null && maxCape < 450) {
    if (overlay === 'lightning') {
      box.style.display = 'block';
      const threat = document.getElementById('tab-threat-level');
      const distEl = document.getElementById('tab-dist-val');
      const delayEl = document.getElementById('tab-delay-val');
      const etaEl = document.getElementById('tab-eta-val');
      const advice = document.getElementById('tab-advice');
      if (threat) threat.innerText = 'Ruhige Lage • Keine Blitze';
      if (distEl) distEl.innerText = '> 50 km';
      if (delayEl) delayEl.innerText = '--';
      if (etaEl) etaEl.innerText = 'Kein Gewitterzug';
      if (advice) advice.innerText = 'Aktuell keine akute elektrische Konvektion im Sichtbereich.';
    } else {
      box.style.display = 'none';
    }
    return;
  }

  const distVal = nearestKm !== null ? Math.max(0.5, Math.round(nearestKm * 10) / 10) : 28;
  const delaySec = Math.round(distVal * 3); // Schall ~340 m/s ≈ 3 Sek./km
  const avgWind = (stations && stations[0] && stations[0].windSpeed) ? Math.max(15, stations[0].windSpeed) : 28;
  const etaMin = Math.max(1, Math.round((distVal / avgWind) * 60));

  box.style.display = 'block';
  const threat = document.getElementById('tab-threat-level');
  const distEl = document.getElementById('tab-dist-val');
  const delayEl = document.getElementById('tab-delay-val');
  const etaEl = document.getElementById('tab-eta-val');
  const advice = document.getElementById('tab-advice');

  if (threat) {
    threat.innerText = distVal <= 12
      ? '🚨 Akute Gewittergefahr!'
      : (maxCape >= 800 ? `⚡ Starke Konvektion (CAPE ${maxCape} J/kg)` : '⚡ Gewitterzelle im Umfeld');
  }
  if (distEl) distEl.innerText = `${distVal} km`;
  if (delayEl) delayEl.innerText = `${delaySec} Sek.`;
  if (etaEl) etaEl.innerText = distVal <= 3 ? 'Direkt vor Ort!' : `ca. ${etaMin} Min.`;
  if (advice) {
    advice.innerText = distVal <= 15
      ? '⚠️ Grate, Gipfel und Klettersteige unverzüglich verlassen!'
      : '⚠️ Gewitterentwicklung beobachten & Schutzmöglichkeiten einplanen.';
  }
}

export function updateMapLegend(overlay = state.map.activeOverlay) {
  const legendTitle = document.getElementById('map-legend-title');
  const legendBar = document.getElementById('map-legend-bar');
  const legendLabels = document.getElementById('map-legend-labels');
  if (!legendTitle || !legendBar || !legendLabels) return;

  if (overlay === 'precip' || overlay === 'rainviewer-radar') {
    legendTitle.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:8px;">
        <span>📡 48h Radar (mm/h)</span>
        <span style="font-size:9px; color:#94a3b8; font-weight:600;">MeteoSwiss Skala</span>
      </div>
    `;
    legendBar.innerHTML = `
      <div class="legend-precip-grid">
        <div class="legend-precip-row">
          <span class="legend-phase-tag rain">🌧️ Regen</span>
          <div class="legend-swatch-strip">
            <span class="legend-swatch-item" style="background:#68d4f6; color:#082f49;">&lt;0.2</span>
            <span class="legend-swatch-item" style="background:#409cff; color:#eff6ff;">0.2</span>
            <span class="legend-swatch-item" style="background:#1c5cf0; color:#eff6ff;">0.5</span>
            <span class="legend-swatch-item" style="background:#0e2acc; color:#eff6ff;">1.0</span>
            <span class="legend-swatch-item" style="background:#14ae3a; color:#f0fdf4;">2.5</span>
            <span class="legend-swatch-item" style="background:#a2e61c; color:#1a2e05;">5</span>
            <span class="legend-swatch-item" style="background:#fad214; color:#422006;">7.5</span>
            <span class="legend-swatch-item" style="background:#f97316; color:#fff7ed;">10</span>
            <span class="legend-swatch-item" style="background:linear-gradient(90deg, #e02222 55%, #9e0e1a 100%); color:#fef2f2;">20+</span>
          </div>
        </div>
        <div class="legend-precip-row">
          <span class="legend-phase-tag mix">🌨️ Mix</span>
          <div class="legend-swatch-strip legend-strip-half">
            <span class="legend-swatch-item" style="background:#22b2c6; color:#042f2e;">Leicht</span>
            <span class="legend-swatch-item" style="background:#18ce7a; color:#022c22;">Stark</span>
          </div>
          <span class="legend-phase-tag snow">❄️ Schnee</span>
          <div class="legend-swatch-strip legend-strip-half">
            <span class="legend-swatch-item" style="background:#84dafb; color:#082f49;">Leicht</span>
            <span class="legend-swatch-item" style="background:#e8f8ff; color:#0c4a6e;">Stark</span>
          </div>
        </div>
      </div>
    `;
    legendBar.style.background = 'transparent';
    legendBar.style.height = 'auto';
    legendLabels.innerHTML = `
      <div style="display:flex; justify-content:space-between; width:100%; font-size:8.5px; color:#94a3b8;">
        <span>Ohne Farbe = <strong style="color:#cbd5e1;">Trocken</strong></span>
        <span>Intensität in mm/h</span>
      </div>
    `;
  } else {
    legendBar.innerHTML = '';
    legendBar.style.height = '7px';
  }

  if (overlay === 'wind') {
    legendTitle.innerText = '💨 48h Windströmung & Böen (Alpen & Flachland):';
    const isDark = isMapCurrentlyDark();
    if (isDark) {
      legendBar.style.background = 'linear-gradient(90deg, #22c55e, #38bdf8, #f59e0b, #ef4444, #c084fc)';
      legendLabels.innerHTML = `
        <span style="color:#22c55e; font-weight:800;">&lt; 20 km/h</span>
        <span style="color:#38bdf8; font-weight:700;">35 km/h</span>
        <span style="color:#f59e0b; font-weight:700;">55 km/h</span>
        <span style="color:#c084fc; font-weight:700;">&gt; 75 km/h Sturm</span>
      `;
    } else {
      legendBar.style.background = 'linear-gradient(90deg, #002855, #0d47a1, #1e40af, #b45309, #991b1b)';
      legendLabels.innerHTML = `
        <span style="color:#7dd3fc; font-weight:800;">&lt; 20 km/h</span>
        <span style="color:#93c5fd; font-weight:700;">35 km/h</span>
        <span style="color:#f59e0b; font-weight:700;">55 km/h</span>
        <span style="color:#f87171; font-weight:700;">&gt; 75 km/h Sturm</span>
      `;
    }
  } else if (overlay === 'lightning') {
    legendTitle.innerText = '⚡ Live-Blitzortung & Gewitterpotenzial (CAPE):';
    legendBar.style.background = 'linear-gradient(90deg, #ff3b30, #ff9500, #ffd166, #64d2ff)';
    legendLabels.innerHTML = `
      <span style="color:#ff3b30;">🚨 &lt; 5 Min. / Hoch</span>
      <span style="color:#ff9500;">⚡ 5–15 Min.</span>
      <span style="color:#ffd166;">⚡ 15–30 Min.</span>
      <span style="color:#64d2ff;">⚡ &gt; 30 Min.</span>
    `;
  } else if (overlay === 'clouds') {
    legendTitle.innerText = '☁️ 48h Bewölkungsgrad (Wolkenfelder & Inversion):';
    legendBar.style.background = 'linear-gradient(90deg, #ffd166, #cbd5e1, #94a3b8, #1e293b)';
    legendLabels.innerHTML = `
      <span style="color:#ffd166;">0% Wolkenlos</span>
      <span style="color:#cbd5e1;">40% Heiter</span>
      <span style="color:#94a3b8;">80% Bedeckt</span>
    `;
  } else if (overlay === 'temp') {
    legendTitle.innerText = '🌡️ 48h Temperaturfeld (DEM-Höhenkorrektur & 0°C-Isotherme):';
    legendBar.style.background = 'linear-gradient(90deg, #1e40af, #06b6d4, #22c55e, #eab308, #f97316, #ef4444)';
    legendLabels.innerHTML = `
      <span style="color:#1e40af;">&lt; -5°C</span>
      <span style="color:#06b6d4;">0°C Frostgrenze</span>
      <span style="color:#22c55e;">10°C</span>
      <span style="color:#f97316;">20°C</span>
      <span style="color:#ef4444;">&gt; 28°C</span>
    `;
  } else if (overlay === 'pressure') {
    legendTitle.innerText = '⏱️ 48h Luftdruck QNH & Marching-Squares Isobaren:';
    legendBar.style.background = 'linear-gradient(90deg, #ef4444, #93c5fd, #3b82f6)';
    legendLabels.innerHTML = `
      <span style="color:#ef4444;">&lt; 1008 hPa Tief (T)</span>
      <span style="color:#93c5fd;">1013 hPa Normal</span>
      <span style="color:#3b82f6;">&gt; 1022 hPa Hoch (H)</span>
    `;
  }
}

/** Synchronisiert optional geladene Sports-Tab-Route auf die Hauptkarte. */
export function syncSportsRouteOverlay() {
  if (!state.map || !state.map.instance) return;
  const gpx = state.sports && state.sports.parsedGPX;
  if (!gpx || !Array.isArray(gpx.points) || gpx.points.length < 2) return;

  if (state.map._syncedSportsTrackId === gpx.name && state.map._sportsMirrorLayer) return;
  if (state.map._sportsMirrorLayer) {
    try { state.map.instance.removeLayer(state.map._sportsMirrorLayer); } catch (_) {}
  }

  const latLngs = gpx.points.map(p => [p.lat, p.lon]);
  const grp = L.layerGroup([
    L.polyline(latLngs, { color: '#020617', weight: 6, opacity: 0.75 }),
    L.polyline(latLngs, { color: '#00e5ff', weight: 3.5, opacity: 0.95 })
  ]).addTo(state.map.instance);

  state.map._sportsMirrorLayer = grp;
  state.map._syncedSportsTrackId = gpx.name;

  const tourBanner = document.getElementById('gpx-active-tour-banner');
  const gatbName = document.getElementById('gatb-name');
  const gatbStats = document.getElementById('gatb-stats');
  if (tourBanner && gpx.name) {
    tourBanner.style.display = 'flex';
    if (gatbName) gatbName.innerText = gpx.name;
    if (gatbStats && gpx.totalDistanceKm !== undefined) {
      gatbStats.innerText = `(${gpx.totalDistanceKm} km, +${gpx.totalAscentM || 0} Hm)`;
    }
  }
}
