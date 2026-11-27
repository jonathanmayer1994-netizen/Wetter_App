/**
 * BEST WEATHER — 48h Radar Timeline & Playback Engine (v2.0)
 * - Echte Vergangenheits-Interpolation (-60m..-15m)
 * - Fester UTC-Modellanker für NWP-Prognosen (keine mitlaufende Modellzeit)
 * - Zeitproportionales Playback (beseitigt den 12x-Geschwindigkeitssprung ab +4h)
 * - Dedupliziertes 3-Ring-Preloading & 120-FPS Scrubber-HUD
 */

import { state } from '../../core/state.js';
import { REGIONAL_STATIONS, WMO_CODES } from '../../core/constants.js';
import { MicroEngine } from '../../microEngine.js';
import { updateMapSolarTransition } from '../mapSolar.js';
import { resilientFetch } from '../../httpClient.js';
import {
  RainViewerRadarStore,
  ViewportDemStore,
  ViewportForecastGridStore
} from './mapStores.js';

let _helpers = {
  getSynthesizedBaselineStations: () => [],
  renderActiveWeatherOverlayForFrame: () => {},
  getLocationWeatherForFrame: () => null
};

export function setTimelineHelpers(h) {
  if (h) _helpers = { ..._helpers, ...h };
}

/**
 * Interpoliert Wetterstationen stufenlos — sowohl in der Zukunft (+5m..+48h)
 * als auch physikalisch konsistent für Vergangenheit (-60m..-15m) aus den historischen Stunden.
 */
export function interpolateStationsForMinute(forecastFrames, minuteOffset, baseLiveStations) {
  const base = (baseLiveStations && baseLiveStations.length)
    ? baseLiveStations
    : _helpers.getSynthesizedBaselineStations();
  if (minuteOffset === 0 || !forecastFrames || !forecastFrames.length) {
    return base;
  }

  const targetHour = minuteOffset / 60;

  // Historische Vergangenheit (-60m..0m): aus den zurückliegenden Hourly-Einträgen des Hauptstandorts interpolieren
  if (targetHour < 0) {
    const hourly = state.weatherData && state.weatherData.hourly;
    const nowMs = Date.now();
    const pastTargetMs = nowMs + minuteOffset * 60000;
    let dTemp = 0, dPrecip = 0, dWind = 0, dPress = 0, dCloud = 0;

    if (hourly && Array.isArray(hourly.time) && hourly.time.length >= 2) {
      let iNow = -1, iPast = -1;
      let bestNowDiff = Infinity, bestPastDiff = Infinity;
      for (let i = 0; i < hourly.time.length; i++) {
        const ts = new Date(hourly.time[i]).getTime();
        const dn = Math.abs(ts - nowMs);
        const dp = Math.abs(ts - pastTargetMs);
        if (dn < bestNowDiff) { bestNowDiff = dn; iNow = i; }
        if (dp < bestPastDiff) { bestPastDiff = dp; iPast = i; }
      }
      if (iNow >= 0 && iPast >= 0 && iNow !== iPast) {
        const ratio = Math.min(1, Math.max(0, Math.abs(minuteOffset) / 60));
        if (hourly.temperature_2m) dTemp = ((hourly.temperature_2m[iPast] ?? 0) - (hourly.temperature_2m[iNow] ?? 0)) * ratio;
        if (hourly.precipitation) dPrecip = ((hourly.precipitation[iPast] ?? 0) - (hourly.precipitation[iNow] ?? 0)) * ratio;
        if (hourly.wind_speed_10m) dWind = ((hourly.wind_speed_10m[iPast] ?? 0) - (hourly.wind_speed_10m[iNow] ?? 0)) * ratio;
        if (hourly.surface_pressure || hourly.pressure_msl) {
          const pArr = hourly.surface_pressure || hourly.pressure_msl;
          dPress = ((pArr[iPast] ?? 1013) - (pArr[iNow] ?? 1013)) * ratio;
        }
        if (hourly.cloud_cover) dCloud = ((hourly.cloud_cover[iPast] ?? 50) - (hourly.cloud_cover[iNow] ?? 50)) * ratio;
      }
    }

    if (Math.abs(dTemp) < 0.05 && Math.abs(dPrecip) < 0.02 && Math.abs(dWind) < 0.3 && Math.abs(dPress) < 0.1) {
      return base.map(st => ({ ...st }));
    }

    return base.map(st => ({
      ...st,
      temperature: Math.round(((st.temperature || 0) + dTemp) * 10) / 10,
      precip: Math.max(0, Math.round(((st.precip || 0) + dPrecip) * 100) / 100),
      windSpeed: Math.max(0, Math.round((st.windSpeed || 0) + dWind)),
      windGusts: Math.max(0, Math.round((st.windGusts || (st.windSpeed || 0) * 1.35) + dWind * 1.3)),
      pressureMsl: Math.round(((st.pressureMsl || 1013) + dPress) * 10) / 10,
      cloudCover: Math.max(0, Math.min(100, Math.round((st.cloudCover || 50) + dCloud)))
    }));
  }

  const hFloor = Math.floor(targetHour);
  const hCeil = Math.ceil(targetHour);
  const ratio = targetHour - hFloor;

  const getStationsAtHour = (h) => {
    if (h === 0) return base;
    const f = forecastFrames.find(ff => ff.hoursFromNow === h);
    if (f && f.stations && f.stations.length) return f.stations;
    if (forecastFrames[h] && forecastFrames[h].stations) return forecastFrames[h].stations;
    return base;
  };

  const stFloor = getStationsAtHour(hFloor);
  const stCeil = getStationsAtHour(hCeil);

  if (hFloor === hCeil || ratio === 0) {
    return stFloor.map(st => ({ ...st }));
  }

  const interpAngle = (a, b, t) => {
    let diff = (b - a) % 360;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    return Math.round(((a + diff * t) % 360 + 360) % 360);
  };

  return stFloor.map((s0, idx) => {
    const s1 = (stCeil[idx] && stCeil[idx].name === s0.name)
      ? stCeil[idx]
      : (stCeil.find(c => c.name === s0.name) || s0);

    const temp = Math.round((s0.temperature + (s1.temperature - s0.temperature) * ratio) * 10) / 10;
    const precip = Math.max(0, Math.round((s0.precip + (s1.precip - s0.precip) * ratio) * 100) / 100);
    const rain = Math.max(0, Math.round(((s0.rain || 0) + ((s1.rain || 0) - (s0.rain || 0)) * ratio) * 100) / 100);
    const snow = Math.max(0, Math.round((s0.snow + (s1.snow - s0.snow) * ratio) * 100) / 100);
    const rh = Math.round((s0.relativeHumidity || 84) + ((s1.relativeHumidity || 84) - (s0.relativeHumidity || 84)) * ratio);
    const fz0 = s0.freezingLevelHeight !== undefined ? s0.freezingLevelHeight : 1400;
    const fz1 = s1.freezingLevelHeight !== undefined ? s1.freezingLevelHeight : fz0;
    const freezingLevelHeight = Math.round(fz0 + (fz1 - fz0) * ratio);
    const cloudCover = Math.round(s0.cloudCover + (s1.cloudCover - s0.cloudCover) * ratio);
    const pressureMsl = Math.round((s0.pressureMsl + (s1.pressureMsl - s0.pressureMsl) * ratio) * 10) / 10;
    const windSpeed = Math.round(s0.windSpeed + (s1.windSpeed - s0.windSpeed) * ratio);
    const windGusts = Math.round(s0.windGusts + (s1.windGusts - s0.windGusts) * ratio);
    const windDirection = interpAngle(s0.windDirection || 240, s1.windDirection || 240, ratio);
    const weatherCode = ratio < 0.5 ? s0.weatherCode : s1.weatherCode;
    const cape = Math.round((s0.cape || 0) + ((s1.cape || 0) - (s0.cape || 0)) * ratio);

    const phaseInfo = MicroEngine.classifyPrecipPhase({
      tempC: temp,
      rhPct: rh,
      precipMm: precip,
      rainMm: rain,
      snowCm: snow,
      elevation: s0.elevation || 500,
      freezingLevelM: freezingLevelHeight,
      wCode: weatherCode
    });

    return {
      ...s0,
      temperature: temp,
      relativeHumidity: rh,
      freezingLevelHeight,
      wetBulbC: phaseInfo.wetBulbC,
      snowRatio: phaseInfo.snowRatio,
      phase: phaseInfo.phase,
      precip,
      rain,
      snow,
      cloudCover,
      pressureMsl,
      windSpeed,
      windGusts,
      windDirection,
      weatherCode,
      cape,
      isSnow: phaseInfo.snowRatio >= 0.55
    };
  });
}

let _radarLoadInFlight = null;
let _radarFreshnessInterval = null;
let _lastRadarFreshnessCheckAt = 0;

/**
 * Richtet die Timeline an der Wanduhrzeit aus, ohne feste UTC-NWP-Modellzeitstempel driften zu lassen!
 */
export function realignRadarTimelineTimestamps(nowMs = Date.now()) {
  const frames = state.map && state.map.unifiedRadarFrames;
  if (!frames || !frames.length) return;

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    delete f._cachedSummary;
    if (f.fixedValidMs && f.type === 'future' && f.minuteOffset > 180) {
      // NWP-Stundenprognosen halten ihre exakte UTC-Gültigkeitszeit; nur relative Minuten verschieben sich
      f.timestampMs = f.fixedValidMs;
      f.minuteOffset = Math.round((f.fixedValidMs - nowMs) / 60000);
      f.hoursFromNow = f.minuteOffset / 60;
      f.time = Math.floor(f.timestampMs / 1000);
      f.timeStr = new Date(f.timestampMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } else if (f.minuteOffset !== undefined) {
      f.timestampMs = nowMs + f.minuteOffset * 60000;
      f.time = Math.floor(f.timestampMs / 1000);
      f.timeStr = new Date(f.timestampMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
  }

  const curIdx = Number.isFinite(state.map.radarFloatIndex)
    ? state.map.radarFloatIndex
    : (state.map.liveRadarIndex !== undefined ? state.map.liveRadarIndex : 0);

  showUnifiedRadarFrame(curIdx);
}

export async function ensureFreshMapRadar(force = false) {
  const now = Date.now();
  if (state.map && state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length > 0) {
    realignRadarTimelineTimestamps(now);
  }

  const lastLoaded = (state.map && state.map._lastRadarEngineLoadedAt) || 0;
  const ageMs = now - lastLoaded;

  let liveDriftMs = 0;
  if (state.map && state.map.unifiedRadarFrames && state.map.liveRadarIndex !== undefined) {
    const liveFrame = state.map.unifiedRadarFrames[state.map.liveRadarIndex];
    if (liveFrame && liveFrame.timestampMs) {
      liveDriftMs = Math.abs(now - liveFrame.timestampMs);
    }
  }

  const isStale = force || !(state.map && state.map._radarLoaded) || ageMs >= (2.5 * 60 * 1000) || liveDriftMs >= (2.5 * 60 * 1000);
  if (!isStale) {
    if (liveDriftMs >= 45 * 1000) realignRadarTimelineTimestamps(now);
    return;
  }

  if (!force && (now - _lastRadarFreshnessCheckAt) < 15000 && _radarLoadInFlight) {
    return _radarLoadInFlight;
  }
  _lastRadarFreshnessCheckAt = now;
  return loadUnifiedRadarEngine(force);
}

export async function loadUnifiedRadarEngine(force = false) {
  if (_radarLoadInFlight && !force) return _radarLoadInFlight;
  _radarLoadInFlight = (async () => {
    try {
      if (!_radarFreshnessInterval) {
        _radarFreshnessInterval = setInterval(() => {
          if (state.activeTab === 'tab-map' && !document.hidden && !(state.map && state.map.radarPlaying)) {
            const now = Date.now();
            const lastLoaded = (state.map && state.map._lastRadarEngineLoadedAt) || 0;
            if ((now - lastLoaded) >= 2.5 * 60 * 1000) {
              ensureFreshMapRadar(true);
            } else {
              realignRadarTimelineTimestamps(now);
            }
          }
        }, 60000);
      }

      // 0ms Sofort-Baseline für UI ohne Preload-Doppelausführung
      if (!state.map.unifiedRadarFrames || state.map.unifiedRadarFrames.length === 0) {
        const initNow = Date.now();
        const baselineSt = _helpers.getSynthesizedBaselineStations();
        const quickFrames = [];
        for (const m of [-60, -45, -30, -15, 0, 15, 30, 60, 120, 180]) {
          quickFrames.push({
            type: m <= 0 ? 'past' : 'future',
            minuteOffset: m,
            hoursFromNow: m / 60,
            timestampMs: initNow + m * 60000,
            label: m === 0 ? '🔴 Live-Scan (Jetzt)' : (m < 0 ? `Vor ${Math.abs(m)} Min.` : `+${m}m`),
            isLive: m === 0,
            stations: baselineSt
          });
        }
        const livePos = 4;
        state.map.unifiedRadarFrames = quickFrames;
        state.map.liveRadarIndex = livePos;
        state.map.radarFloatIndex = livePos;
        const quickSlider = document.getElementById('radar-time-slider');
        if (quickSlider) {
          quickSlider.min = 0;
          quickSlider.max = quickFrames.length - 1;
          quickSlider.step = 'any';
          quickSlider.value = livePos;
        }
        showUnifiedRadarFrame(livePos);
      } else {
        realignRadarTimelineTimestamps(Date.now());
      }

      const rvPromise = resilientFetch('https://api.rainviewer.com/public/weather-maps.json', {
        ttlMs: 5 * 60 * 1000,
        persist: true,
        forceRefresh: !!force
      }).catch(e => {
        console.warn('RainViewer API nicht erreichbar:', e);
        return null;
      });

      const forecastPromise = MicroEngine.fetch48hRadarForecast
        ? MicroEngine.fetch48hRadarForecast(REGIONAL_STATIONS, state.weatherData, !!force)
        : MicroEngine.fetch24hRadarForecast(REGIONAL_STATIONS, state.weatherData);

      const [rvData, forecastFrames] = await Promise.all([rvPromise, forecastPromise]);

      const unifiedFrames = [];
      const nowMs = Date.now();
      const pastList = (rvData && rvData.radar && rvData.radar.past) || [];
      const nowcastList = (rvData && rvData.radar && rvData.radar.nowcast) || [];
      if (rvData && rvData.host) state.map.radarHost = rvData.host;

      const baseLiveStations = (forecastFrames && forecastFrames[0] && forecastFrames[0].stations && forecastFrames[0].stations.length > 0)
        ? forecastFrames[0].stations
        : _helpers.getSynthesizedBaselineStations();

      const findClosestRvTile = (targetMs, list) => {
        if (!list || !list.length) return null;
        let closest = null;
        let minDiff = Infinity;
        for (let i = 0; i < list.length; i++) {
          const diff = Math.abs(list[i].time * 1000 - targetMs);
          if (diff < minDiff) { minDiff = diff; closest = list[i]; }
        }
        return minDiff <= 20 * 60 * 1000 ? closest : null;
      };

      // 1. Vergangenheit (-60..-15m in 15m Schritten)
      [-60, -45, -30, -15].forEach(m => {
        const fTimeMs = nowMs + m * 60000;
        const rvTile = findClosestRvTile(fTimeMs, pastList);
        const tilePath = rvTile ? rvTile.path : (pastList.length ? pastList[0].path : '');
        unifiedFrames.push({
          type: 'past',
          time: Math.floor(fTimeMs / 1000),
          minuteOffset: m,
          hoursFromNow: m / 60,
          path: tilePath,
          rvPath: tilePath,
          timestampMs: fTimeMs,
          label: `Vor ${Math.abs(m)} Min. (15m)`,
          isLive: false,
          stations: interpolateStationsForMinute(forecastFrames, m, baseLiveStations)
        });
      });

      // 2. Live-Scan (0m)
      const liveTile = nowcastList.length > 0 ? nowcastList[0] : (pastList.length > 0 ? pastList[pastList.length - 1] : null);
      const livePath = liveTile ? liveTile.path : '';
      state.map.liveRadarPath = livePath;
      const liveIdx = unifiedFrames.length;
      unifiedFrames.push({
        type: 'past',
        time: liveTile ? liveTile.time : Math.floor(nowMs / 1000),
        minuteOffset: 0,
        hoursFromNow: 0,
        path: livePath,
        rvPath: livePath,
        timestampMs: nowMs,
        label: '🔴 Live-Scan (Jetzt)',
        isLive: true,
        stations: baseLiveStations
      });

      // 3. Nowcast (+5m..+90m in 5m Schritten)
      for (let m = 5; m <= 90; m += 5) {
        const fTimeMs = nowMs + m * 60000;
        const rvTile = findClosestRvTile(fTimeMs, nowcastList);
        const tilePath = rvTile ? rvTile.path : livePath;
        const timeStr = new Date(fTimeMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const stationsInterp = interpolateStationsForMinute(forecastFrames, m, baseLiveStations);
        const maxPrecip = Math.max(...stationsInterp.map(s => s.precip || 0));

        unifiedFrames.push({
          type: 'future',
          minuteOffset: m,
          hoursFromNow: m / 60,
          timestampMs: fTimeMs,
          timeStr,
          label: `+${m}m Nowcast (5m)`,
          is5MinNowcast: true,
          hasPrecipitation: maxPrecip > 0.05,
          maxPrecipMm: maxPrecip,
          path: tilePath,
          rvPath: tilePath,
          cells: [],
          stations: stationsInterp
        });
      }

      // 4. Detail-Prognose (+105m..+180m in 15m Schritten)
      for (let m = 105; m <= 180; m += 15) {
        const fTimeMs = nowMs + m * 60000;
        const timeStr = new Date(fTimeMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        const stationsInterp = interpolateStationsForMinute(forecastFrames, m, baseLiveStations);
        const maxPrecip = Math.max(...stationsInterp.map(s => s.precip || 0));
        const hStr = m % 60 === 0 ? `+${m / 60}h` : `+${Math.floor(m / 60)}h ${m % 60}m`;

        unifiedFrames.push({
          type: 'future',
          minuteOffset: m,
          hoursFromNow: m / 60,
          timestampMs: fTimeMs,
          timeStr,
          label: `${hStr} Prognose (15m)`,
          is15MinForecast: true,
          hasPrecipitation: maxPrecip > 0.05,
          maxPrecipMm: maxPrecip,
          path: '',
          rvPath: '',
          cells: [],
          stations: stationsInterp
        });
      }

      // 5. Stündliche NWP-Vorhersage (+4h..+48h) mit festem UTC-Validitätsanker (fixedValidMs)
      if (forecastFrames && Array.isArray(forecastFrames)) {
        forecastFrames.forEach(ff => {
          if (ff.hoursFromNow >= 4 && ff.hoursFromNow <= 48) {
            const validMs = ff.timestampMs || (nowMs + ff.hoursFromNow * 3600000);
            const relMin = Math.round((validMs - nowMs) / 60000);
            unifiedFrames.push({
              type: 'future',
              minuteOffset: relMin,
              hoursFromNow: relMin / 60,
              fixedValidMs: validMs,
              timestampMs: validMs,
              timeStr: ff.time,
              label: `+${ff.hoursFromNow} Std. Prognose`,
              hasPrecipitation: ff.hasPrecipitation,
              maxPrecipMm: ff.maxPrecipMm,
              cells: ff.cells || [],
              stations: ff.stations || []
            });
          }
        });
      }

      const prevLiveIdx = state.map.liveRadarIndex !== undefined ? state.map.liveRadarIndex : liveIdx;
      const prevFloat = state.map.radarFloatIndex;
      const wasAtLive = !Number.isFinite(prevFloat) || Math.abs(prevFloat - prevLiveIdx) < 0.4;

      let targetIdx = liveIdx;
      if (!wasAtLive && Number.isFinite(state.map._currentScrubbedMinuteOffset)) {
        const prevOffset = state.map._currentScrubbedMinuteOffset;
        let bestDist = Infinity, bestMatch = liveIdx;
        for (let i = 0; i < unifiedFrames.length; i++) {
          const d = Math.abs(unifiedFrames[i].minuteOffset - prevOffset);
          if (d < bestDist) { bestDist = d; bestMatch = i; }
        }
        targetIdx = bestMatch;
      }

      state.map.unifiedRadarFrames = unifiedFrames;
      state.map.liveRadarIndex = liveIdx;
      state.map.radarFloatIndex = targetIdx;
      state.map._radarLoaded = true;
      state.map._lastRadarEngineLoadedAt = nowMs;

      const slider = document.getElementById('radar-time-slider');
      if (slider) {
        slider.min = 0;
        slider.max = Math.max(0, unifiedFrames.length - 1);
        slider.step = 'any';
        slider.value = targetIdx;
      }

      showUnifiedRadarFrame(targetIdx);

      // Ein einziger koordinierter 3-Ring-Preload (kein doppelter Tile-Burst!)
      startPredictive3RingPreload(unifiedFrames, state.map.radarHost);
      if (state.map.instance) {
        ViewportDemStore.scheduleFetchForMap(state.map.instance);
        ViewportForecastGridStore.scheduleFetchForMap(state.map.instance);
      }
    } catch (err) {
      console.error('Fehler beim Initialisieren der 48h-Radar-Engine:', err);
    } finally {
      _radarLoadInFlight = null;
    }
  })();
  return _radarLoadInFlight;
}

export function preloadRadarFrames(frames, host) {
  if (!frames || !host || !state.map.instance) return;
  const mapZoom = state.map.instance.getZoom() || 8;
  const rvZoom = Math.min(7, Math.max(4, Math.floor(mapZoom)));
  const b = state.map.instance.getBounds();
  const seen = new Set();

  frames.forEach(f => {
    const p = f.rvPath || f.path;
    if ((f.type === 'past' || f.is5MinNowcast) && p && !seen.has(p)) {
      seen.add(p);
      RainViewerRadarStore.requestVisibleTiles(p, host, rvZoom, b.getSouth(), b.getNorth(), b.getWest(), b.getEast());
    }
  });
}

export function startPredictive3RingPreload(frames, host) {
  if (!frames || frames.length === 0) return;
  const liveIdx = state.map && state.map.liveRadarIndex !== undefined ? state.map.liveRadarIndex : 4;

  setTimeout(() => {
    if (state.activeTab && state.activeTab !== 'tab-map' && document.hidden) return;
    const r1Start = Math.max(0, liveIdx - 8);
    const r1End = Math.min(frames.length - 1, liveIdx + 24);
    for (let i = r1Start; i <= r1End; i++) {
      if (frames[i]) getFrameWeatherSummary(frames[i]);
    }
    if (host && state.map && state.map.instance) {
      preloadRadarFrames(frames.slice(0, liveIdx + 12), host);
    }
  }, 10);

  const runIdle = (typeof window !== 'undefined' && window.requestIdleCallback)
    ? window.requestIdleCallback
    : (cb) => setTimeout(cb, 100);

  runIdle(() => {
    if (state.activeTab && state.activeTab !== 'tab-map' && document.hidden) return;
    const r2Start = Math.min(frames.length - 1, liveIdx + 25);
    const r2End = Math.min(frames.length - 1, liveIdx + 96);
    for (let i = r2Start; i <= r2End; i++) {
      if (frames[i]) getFrameWeatherSummary(frames[i]);
    }
  });

  runIdle(() => {
    if (state.activeTab && state.activeTab !== 'tab-map' && document.hidden) return;
    const r3Start = Math.min(frames.length - 1, liveIdx + 97);
    const r3End = frames.length - 1;
    for (let i = r3Start; i <= r3End; i++) {
      if (frames[i]) getFrameWeatherSummary(frames[i]);
    }
  });
}

export function renderFutureRadarCells() {
  if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();
}

export function interpolateStationLists(stListA, stListB, alpha) {
  if (!stListA || !stListA.length) return stListB || [];
  if (!stListB || !stListB.length || alpha <= 0.001) return stListA;
  if (alpha >= 0.999) return stListB;

  const inv = 1 - alpha;
  const byNameB = new Map();
  for (let i = 0; i < stListB.length; i++) {
    if (stListB[i] && stListB[i].name) byNameB.set(stListB[i].name, stListB[i]);
  }

  return stListA.map((s0, idx) => {
    const s1 = (stListB[idx] && stListB[idx].name === s0.name)
      ? stListB[idx]
      : (byNameB.get(s0.name) || s0);

    const temp = Math.round(((s0.temperature || 0) * inv + (s1.temperature || 0) * alpha) * 10) / 10;
    const precip = Math.max(0, Math.round(((s0.precip || 0) * inv + (s1.precip || 0) * alpha) * 100) / 100);
    const rain = Math.max(0, Math.round(((s0.rain || 0) * inv + (s1.rain || 0) * alpha) * 100) / 100);
    const snow = Math.max(0, Math.round(((s0.snow || 0) * inv + (s1.snow || 0) * alpha) * 100) / 100);
    const rh = Math.round((s0.relativeHumidity || 84) * inv + (s1.relativeHumidity || 84) * alpha);
    const fz0 = s0.freezingLevelHeight !== undefined ? s0.freezingLevelHeight : 1400;
    const fz1 = s1.freezingLevelHeight !== undefined ? s1.freezingLevelHeight : fz0;
    const freezingLevelHeight = Math.round(fz0 * inv + fz1 * alpha);
    const cloudCover = Math.round((s0.cloudCover !== undefined ? s0.cloudCover : 50) * inv + (s1.cloudCover !== undefined ? s1.cloudCover : 50) * alpha);
    const p0 = s0.pressureMsl !== undefined ? s0.pressureMsl : 1013.2;
    const p1 = s1.pressureMsl !== undefined ? s1.pressureMsl : p0;
    const pressureMsl = Math.round((p0 * inv + p1 * alpha) * 10) / 10;
    const windSpeed = Math.round((s0.windSpeed || 0) * inv + (s1.windSpeed || 0) * alpha);
    const windGusts = Math.round((s0.windGusts || (s0.windSpeed || 0) * 1.35) * inv + (s1.windGusts || (s1.windSpeed || 0) * 1.35) * alpha);
    const cape = Math.round((s0.cape || 0) * inv + (s1.cape || 0) * alpha);

    const a0 = s0.windDirection !== undefined ? s0.windDirection : 240;
    const a1 = s1.windDirection !== undefined ? s1.windDirection : a0;
    let diff = (a1 - a0) % 360;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    const windDirection = Math.round(((a0 + diff * alpha) % 360 + 360) % 360);

    const weatherCode = alpha < 0.5 ? s0.weatherCode : s1.weatherCode;
    const phaseInfo = (MicroEngine && MicroEngine.classifyPrecipPhase)
      ? MicroEngine.classifyPrecipPhase({
          tempC: temp, rhPct: rh, precipMm: precip, rainMm: rain, snowCm: snow,
          elevation: s0.elevation || 500, freezingLevelM: freezingLevelHeight, wCode: weatherCode
        })
      : {
          wetBulbC: temp,
          snowRatio: (s0.snowRatio !== undefined && s1.snowRatio !== undefined) ? (s0.snowRatio * inv + s1.snowRatio * alpha) : (s0.snowRatio || 0),
          phase: s0.phase || 'dry'
        };

    return {
      ...s0,
      temperature: temp,
      relativeHumidity: rh,
      freezingLevelHeight,
      wetBulbC: phaseInfo.wetBulbC,
      snowRatio: phaseInfo.snowRatio,
      phase: phaseInfo.phase,
      precip, rain, snow, cloudCover, pressureMsl, windSpeed, windGusts, windDirection, weatherCode, cape,
      isSnow: phaseInfo.snowRatio >= 0.55
    };
  });
}

export function getInterpolatedRadarSpec(floatIdx) {
  const frames = state.map && state.map.unifiedRadarFrames;
  if (!frames || !frames.length) return null;

  const maxIdx = frames.length - 1;
  const numIdx = Number(floatIdx);
  const clamped = Math.max(0, Math.min(maxIdx, Number.isFinite(numIdx) ? numIdx : 0));
  const i0 = Math.floor(clamped);
  const i1 = Math.min(maxIdx, Math.ceil(clamped));
  const alpha = clamped - i0;
  const f0 = frames[i0];
  const f1 = frames[i1];
  const nearestIdx = Math.round(clamped);

  if (i0 === i1 || alpha <= 0.001) {
    return { floatIdx: clamped, nearestIdx, frame: f0, frameA: f0, frameB: null, morphAlpha: 0 };
  }
  if (alpha >= 0.999) {
    return { floatIdx: clamped, nearestIdx, frame: f1, frameA: f1, frameB: null, morphAlpha: 0 };
  }

  const mo0 = f0 && f0.minuteOffset !== undefined ? f0.minuteOffset : 0;
  const mo1 = f1 && f1.minuteOffset !== undefined ? f1.minuteOffset : mo0;
  const mo = mo0 + (mo1 - mo0) * alpha;
  const ts0 = (f0 && f0.timestampMs) || Date.now();
  const ts1 = (f1 && f1.timestampMs) || ts0;
  const ts = Math.round(ts0 + (ts1 - ts0) * alpha);
  const timeStr = new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const isLive = Math.abs(mo) < 0.5;
  const type = mo <= 0 ? 'past' : 'future';

  const frame = {
    ...f0,
    type,
    isLive,
    minuteOffset: mo,
    hoursFromNow: mo / 60,
    timestampMs: ts,
    timeStr,
    rvPath: alpha < 0.5 ? (f0.rvPath || f0.path || '') : (f1.rvPath || f1.path || ''),
    path: alpha < 0.5 ? (f0.path || f0.rvPath || '') : (f1.path || f1.rvPath || ''),
    stations: interpolateStationLists(f0.stations, f1.stations, alpha)
  };

  return { floatIdx: clamped, nearestIdx, frame, frameA: f0, frameB: f1, morphAlpha: alpha };
}

export function getActiveInterpolatedRadarSpec() {
  const floatIdx = (state.map && state.map.radarFloatIndex !== undefined)
    ? state.map.radarFloatIndex
    : ((state.map && state.map.radarIndex) || 0);
  return getInterpolatedRadarSpec(floatIdx);
}

export function updateMeteoSwissTimelineUI(frame, idx, total, renderOpts = {}) {
  const frames = state.map && state.map.unifiedRadarFrames ? state.map.unifiedRadarFrames : [];
  const count = total || frames.length || 1;
  const maxIdx = Math.max(1, count - 1);
  const clampedIdx = Math.max(0, Math.min(maxIdx, idx || 0));
  const pct = (clampedIdx / maxIdx) * 100;
  const liveIdx = (state.map && state.map.liveRadarIndex !== undefined)
    ? Math.max(0, Math.min(maxIdx, state.map.liveRadarIndex))
    : Math.min(4, maxIdx);
  const livePct = (liveIdx / maxIdx) * 100;

  const ts = (frame && frame.timestampMs) || Date.now();
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');

  const watermark = document.getElementById('ms-radar-watermark');
  if (watermark) watermark.innerText = `${dd}.${mm}.${yy} | ${hh}:${min}`;

  // Kompakte Status-Zonen-Anzeige (fällt optional auf Callout-Badge falls noch vorhanden)
  const cTime = document.getElementById('mscb-time');
  if (cTime) cTime.innerText = `${hh}:${min}`;
  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const cDay = document.getElementById('mscb-day');
  if (cDay) {
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const isTomorrow = d.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    cDay.innerText = isToday ? 'Heute' : (isTomorrow ? 'Morgen' : weekdays[d.getDay()]);
  }
  const isMeasured = !!(frame && (frame.isLive || frame.type === 'past' || (frame.minuteOffset !== undefined && frame.minuteOffset <= 0.4)));
  const cKind = document.getElementById('mscb-kind');
  if (cKind) {
    cKind.innerText = isMeasured ? 'Messung' : 'Prognose';
    cKind.classList.toggle('is-live', isMeasured);
  }

  if (!renderOpts.skipNeedleUpdate) {
    const needle = document.getElementById('ms-scrubber-needle');
    if (needle) needle.style.left = `${pct.toFixed(2)}%`;
  }

  if (state.map._lastRenderedLivePct !== livePct) {
    state.map._lastRenderedLivePct = livePct;
    const barMeasured = document.getElementById('ms-bar-measured');
    if (barMeasured) barMeasured.style.width = `${livePct.toFixed(2)}%`;
    const dotNow = document.getElementById('ms-dot-now');
    if (dotNow) dotNow.style.left = `${livePct.toFixed(2)}%`;
    const tickNow = document.querySelector('.ms-tick-now');
    if (tickNow) tickNow.style.left = `${livePct.toFixed(2)}%`;
    const barForecast = document.getElementById('ms-bar-forecast');
    if (barForecast) {
      barForecast.style.left = `${livePct.toFixed(2)}%`;
      barForecast.style.width = `${Math.max(0, 100 - livePct).toFixed(2)}%`;
    }
    positionMeteoSwissAxisTicks(frames, liveIdx);
  }
}

export function positionMeteoSwissAxisTicks(frames, liveIdx) {
  if (!frames || frames.length === 0) return;
  const maxIdx = Math.max(1, frames.length - 1);
  const liveIndex = (liveIdx !== undefined)
    ? liveIdx
    : ((state.map && state.map.liveRadarIndex !== undefined) ? state.map.liveRadarIndex : 4);
  const livePct = (liveIndex / maxIdx) * 100;

  const tickNow = document.querySelector('.ms-tick-now');
  if (tickNow) tickNow.style.left = `${livePct.toFixed(2)}%`;

  const findClosestFrameIdx = (matchFn) => {
    for (let i = 0; i < frames.length; i++) {
      if (matchFn(frames[i])) return i;
    }
    return -1;
  };

  const idx1h = findClosestFrameIdx(f => Math.abs((f.minuteOffset ?? 999) - 60) < 10 || Math.round(f.hoursFromNow) === 1);
  const idx3h = findClosestFrameIdx(f => Math.abs((f.minuteOffset ?? 999) - 180) < 15 || Math.round(f.hoursFromNow) === 3);
  const idx12h = findClosestFrameIdx(f => Math.round(f.hoursFromNow) === 12);
  const idx24h = findClosestFrameIdx(f => Math.round(f.hoursFromNow) === 24);

  const tick1h = document.querySelector('.ms-tick-1h');
  if (tick1h && idx1h >= 0) tick1h.style.left = `${((idx1h / maxIdx) * 100).toFixed(2)}%`;
  const tick3h = document.querySelector('.ms-tick-3h');
  if (tick3h && idx3h >= 0) tick3h.style.left = `${((idx3h / maxIdx) * 100).toFixed(2)}%`;
  const tick12h = document.querySelector('.ms-tick-12h');
  if (tick12h && idx12h >= 0) tick12h.style.left = `${((idx12h / maxIdx) * 100).toFixed(2)}%`;
  const tick24h = document.querySelector('.ms-tick-24h');
  if (tick24h && idx24h >= 0) tick24h.style.left = `${((idx24h / maxIdx) * 100).toFixed(2)}%`;
}

export function showUnifiedRadarFrame(idx, renderOpts = {}) {
  const frames = state.map.unifiedRadarFrames;
  if (!frames || frames.length === 0) return;

  const spec = getInterpolatedRadarSpec(idx);
  if (!spec) return;

  state.map.radarFloatIndex = spec.floatIdx;
  state.map.radarIndex = spec.nearestIdx;

  const slider = document.getElementById('radar-time-slider');
  if (slider && !renderOpts.skipSliderUpdate) {
    if (slider.step !== 'any') slider.step = 'any';
    slider.value = spec.floatIdx;
  }

  updateJumpButtonsActive(spec.nearestIdx);
  updateMeteoSwissTimelineUI(spec.frame, spec.floatIdx, frames.length, renderOpts);
  updateMapSolarTransition(spec.frame.timestampMs);

  const activeOverlay = state.map.activeOverlay || 'precip';
  if (state.map.instance) {
    ViewportForecastGridStore.scheduleFetchForMap(state.map.instance, 120);
  }
  _helpers.renderActiveWeatherOverlayForFrame(spec.frame, activeOverlay, {
    rvFrameA: spec.frameA,
    rvFrameB: spec.frameB,
    morphAlpha: spec.morphAlpha,
    stationsPreInterpolated: spec.morphAlpha > 0,
    ...renderOpts
  });
}

export function getFrameWeatherSummary(frame) {
  if (!frame) return null;
  if (frame._cachedSummary) return frame._cachedSummary;

  const t = new Date(frame.timestampMs || Date.now());
  const now = new Date();
  const isToday = t.toDateString() === now.toDateString();
  const tmrw = new Date(now.getTime() + 86400000);
  const isTomorrow = t.toDateString() === tmrw.toDateString();
  const dayStr = isToday ? 'Heute' : (isTomorrow ? 'Morgen' : t.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }));
  const timeStr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  const rawMo = frame.minuteOffset !== undefined ? Number(frame.minuteOffset) : undefined;
  const dispMin = rawMo !== undefined ? Math.round(rawMo) : undefined;
  const isLive = !!(frame.isLive || dispMin === 0);

  let relStr = 'Live';
  if (isLive) relStr = 'Live';
  else if (dispMin !== undefined) {
    if (dispMin < 0) relStr = `vor ${Math.abs(dispMin)}m`;
    else if (dispMin < 60) relStr = `+${dispMin}m`;
    else if (dispMin % 60 === 0) relStr = `+${dispMin / 60}h`;
    else relStr = `+${Math.floor(dispMin / 60)}h ${dispMin % 60}m`;
  } else if (frame.hoursFromNow) {
    relStr = `+${Math.round(frame.hoursFromNow)}h`;
  }

  const locWeather = _helpers.getLocationWeatherForFrame(frame);
  const codeInfo = (typeof WMO_CODES !== 'undefined' && locWeather && WMO_CODES[locWeather.weatherCode])
    ? WMO_CODES[locWeather.weatherCode]
    : { label: 'Heiter', icon: '☀️' };

  let precipText = '0 mm/h';
  if (locWeather && locWeather.precip >= 0.04) {
    if (locWeather.precipPhase === 'snow' || (locWeather.snow && locWeather.snow >= 0.02)) {
      precipText = `❄️ ${locWeather.precip.toFixed(1)} mm/h`;
    } else if (locWeather.precipPhase === 'sleet') {
      precipText = `🌨️ ${locWeather.precip.toFixed(1)} mm/h`;
    } else {
      precipText = `🌧️ ${locWeather.precip.toFixed(1)} mm/h`;
    }
  }

  const summary = {
    dayStr,
    timeStr,
    relStr,
    isLive,
    tempText: locWeather ? `${locWeather.temp > 0 ? '+' : ''}${locWeather.temp.toFixed(1)}°` : '--°',
    icon: codeInfo.icon || '☀️',
    label: codeInfo.label || 'Klar',
    precipText,
    windText: locWeather ? `${locWeather.windSpeed} km/h` : '0 km/h'
  };
  frame._cachedSummary = summary;
  return summary;
}

let _hudRefs = null;
function getHudRefs() {
  if (!_hudRefs || !_hudRefs.hud || !document.body.contains(_hudRefs.hud)) {
    const hud = document.getElementById('radar-floating-scrubber-hud');
    const needle = document.getElementById('ms-scrubber-needle');
    const slider = document.getElementById('radar-time-slider');
    _hudRefs = {
      hud,
      needle,
      slider,
      arrow: document.getElementById('rfh-arrow'),
      timeLabel: document.getElementById('rfh-time-label'),
      relBadge: document.getElementById('rfh-rel-badge'),
      weatherIcon: document.getElementById('rfh-weather-icon'),
      weatherTemp: document.getElementById('rfh-weather-temp'),
      weatherPrecip: document.getElementById('rfh-weather-precip'),
      weatherWind: document.getElementById('rfh-weather-wind'),
      trackWrap: slider ? slider.parentElement : null
    };
  }
  return _hudRefs;
}

let _lastHapticMilestone = null;
let _lastHapticIdx = null;

export function updateScrubberHud(val, frames) {
  const refs = getHudRefs();
  if (!refs.hud || !frames || frames.length === 0) return;

  const count = frames.length;
  const maxIdx = Math.max(1, count - 1);
  const clampedVal = Math.max(0, Math.min(maxIdx, val));
  const pct = (clampedVal / maxIdx) * 100;
  const nearestIdx = Math.round(clampedVal);
  const frame = frames[nearestIdx];

  if (refs.needle) refs.needle.style.left = `${pct.toFixed(2)}%`;

  const summary = getFrameWeatherSummary(frame);
  if (summary) {
    if (refs.timeLabel) refs.timeLabel.textContent = `${summary.dayStr}, ${summary.timeStr}`;
    if (refs.relBadge) {
      refs.relBadge.textContent = summary.relStr;
      refs.relBadge.classList.toggle('is-live', summary.isLive);
    }
    if (refs.weatherIcon) refs.weatherIcon.textContent = summary.icon;
    if (refs.weatherTemp) refs.weatherTemp.textContent = summary.tempText;
    if (refs.weatherPrecip) refs.weatherPrecip.textContent = summary.precipText;
    if (refs.weatherWind) refs.weatherWind.textContent = summary.windText;
  }

  const trackWrap = refs.trackWrap || (refs.slider ? refs.slider.parentElement : null);
  const trackWidth = trackWrap ? trackWrap.clientWidth : 320;
  const needlePx = (pct / 100) * trackWidth;
  const hudWidth = refs.hud.offsetWidth || 195;

  const clampedHudX = Math.max(0, Math.min(Math.max(0, trackWidth - hudWidth), needlePx - (hudWidth / 2)));
  const arrowX = Math.max(12, Math.min(hudWidth - 12, needlePx - clampedHudX));

  refs.hud.style.transform = `translate3d(${clampedHudX.toFixed(1)}px, 0, 0)`;
  if (refs.arrow) {
    refs.arrow.style.transform = `translate3d(${arrowX.toFixed(1)}px, 0, 0) translateX(-50%)`;
  }

  const liveIdx = (state.map && state.map.liveRadarIndex !== undefined) ? state.map.liveRadarIndex : 4;
  if (_lastHapticIdx !== nearestIdx) {
    let milestone = null;
    if (nearestIdx === liveIdx) milestone = 'now';
    else if (frame && frame.minuteOffset && Math.abs(frame.minuteOffset - 1440) < 20) milestone = '24h';
    else if (frame && frame.minuteOffset && Math.abs(frame.minuteOffset - 2880) < 20) milestone = '48h';

    if (milestone && milestone !== _lastHapticMilestone) {
      _lastHapticMilestone = milestone;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(8); } catch (_) {}
      }
    } else if (!milestone) {
      _lastHapticMilestone = null;
    }
    _lastHapticIdx = nearestIdx;
  }
}

export function showScrubberHud(val) {
  const refs = getHudRefs();
  if (!refs.hud) return;
  refs.hud.classList.add('is-active');
  if (refs.needle) refs.needle.classList.add('is-active');
  const frames = state.map && state.map.unifiedRadarFrames;
  if (frames && frames.length) {
    updateScrubberHud(val !== undefined ? val : (parseFloat(refs.slider && refs.slider.value) || 0), frames);
  }
}

export function hideScrubberHud() {
  const refs = getHudRefs();
  if (refs.hud) refs.hud.classList.remove('is-active');
  if (refs.needle) refs.needle.classList.remove('is-active');
  _lastHapticMilestone = null;
}

let _scrubRafId = null;
let _pendingScrubVal = null;

function scheduleScrubbedFrameRender(val) {
  _pendingScrubVal = val;
  if (_scrubRafId) return;
  _scrubRafId = requestAnimationFrame(() => {
    _scrubRafId = null;
    const target = _pendingScrubVal;
    if (Number.isFinite(target)) {
      showUnifiedRadarFrame(target, { isScrubOrPlay: true, skipNeedleUpdate: true, skipSliderUpdate: true });
    }
  });
}

let _radarControlsBound = false;
export function setupUnifiedRadarControls() {
  if (_radarControlsBound) return;
  _radarControlsBound = true;

  const slider = document.getElementById('radar-time-slider');
  if (slider) {
    slider.step = 'any';

    const onStartScrub = () => {
      stopRadarAnimation();
      showScrubberHud(parseFloat(slider.value));
    };

    const onMoveScrub = () => {
      stopRadarAnimation();
      const val = parseFloat(slider.value);
      if (Number.isFinite(val)) {
        const frames = state.map && state.map.unifiedRadarFrames;
        if (frames && frames.length) {
          const nearest = Math.max(0, Math.min(frames.length - 1, Math.round(val)));
          state.map._currentScrubbedMinuteOffset = frames[nearest] && frames[nearest].minuteOffset;
          updateScrubberHud(val, frames);
        }
        scheduleScrubbedFrameRender(val);
      }
    };

    const onEndScrub = () => {
      hideScrubberHud();
      const val = parseFloat(slider.value);
      if (Number.isFinite(val)) {
        const frames = state.map && state.map.unifiedRadarFrames;
        if (frames && frames.length) {
          const nearest = Math.max(0, Math.min(frames.length - 1, Math.round(val)));
          state.map._currentScrubbedMinuteOffset = frames[nearest] && frames[nearest].minuteOffset;
        }
        showUnifiedRadarFrame(val, { isScrubOrPlay: false, skipNeedleUpdate: false });
      }
    };

    slider.addEventListener('pointerdown', onStartScrub, { passive: true });
    slider.addEventListener('touchstart', onStartScrub, { passive: true });
    slider.addEventListener('input', onMoveScrub);
    slider.addEventListener('pointerup', onEndScrub, { passive: true });
    slider.addEventListener('touchend', onEndScrub, { passive: true });
    slider.addEventListener('pointercancel', onEndScrub, { passive: true });
    slider.addEventListener('touchcancel', onEndScrub, { passive: true });
    slider.addEventListener('change', onEndScrub);

    if (typeof window !== 'undefined' && !window._msAxisResizeBound) {
      window._msAxisResizeBound = true;
      window.addEventListener('resize', () => {
        if (state.map && state.map.unifiedRadarFrames) {
          positionMeteoSwissAxisTicks(state.map.unifiedRadarFrames);
        }
      }, { passive: true });
    }
  }

  const toggleBtn = document.getElementById('radar-player-toggle-btn');
  const player = document.getElementById('radar-floating-controls');
  if (toggleBtn && player) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCol = player.classList.toggle('is-collapsed');
      toggleBtn.innerText = isCol ? '▴' : '▾';
      toggleBtn.title = isCol ? 'Player vergrößern' : 'Player minimieren';
    });

    player.addEventListener('click', (e) => {
      if (player.classList.contains('is-collapsed') && !e.target.closest('#radar-player-toggle-btn')) {
        player.classList.remove('is-collapsed');
        toggleBtn.innerText = '▾';
        toggleBtn.title = 'Player minimieren';
      }
    });
  }

  const playBtn = document.getElementById('radar-play-btn');
  if (playBtn) {
    playBtn.onclick = null;
    playBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleRadarPlay();
    });
  }

  const prevBtn = document.getElementById('radar-prev-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopRadarAnimation();
      stepRadar(-1);
    });
  }

  const nextBtn = document.getElementById('radar-next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      stopRadarAnimation();
      stepRadar(1);
    });
  }

  const speedBtn = document.getElementById('radar-speed-btn');
  if (speedBtn) {
    const formatSpeedLabel = (spd) => (spd === 1.5 ? '1,5x' : `${spd}x`);
    const updateSpeedUI = (spd) => {
      const label = formatSpeedLabel(spd);
      speedBtn.innerText = label;
      speedBtn.title = `Geschwindigkeit: ${label} (Tippen für 1x → 1,5x → 2x)`;
      speedBtn.setAttribute('aria-label', `Wiedergabegeschwindigkeit ${label}`);
      speedBtn.classList.remove('speed-1x', 'speed-1-5x', 'speed-2x', 'speed-4x');
      speedBtn.classList.add(spd === 1.5 ? 'speed-1-5x' : `speed-${spd}x`);
    };

    updateSpeedUI(state.map.radarPlaybackSpeed || 1);
    speedBtn.onclick = null;
    speedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const speeds = [1, 1.5, 2];
      const cur = state.map.radarPlaybackSpeed || 1;
      const curIdx = speeds.indexOf(cur);
      const nextSpeed = speeds[(curIdx >= 0 ? curIdx + 1 : 0) % speeds.length];
      state.map.radarPlaybackSpeed = nextSpeed;
      updateSpeedUI(nextSpeed);
      try { localStorage.setItem('best_weather_radar_speed', String(nextSpeed)); } catch (_) {}
    });
  }

  document.querySelectorAll('.radar-jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stopRadarAnimation();
      const targetIdx = findFrameIndexForTarget(btn.dataset.target);
      showUnifiedRadarFrame(targetIdx, { isScrubOrPlay: false });
    });
  });
}

export function findFrameIndexForTarget(target) {
  const frames = state.map.unifiedRadarFrames;
  if (!frames || frames.length === 0) return 0;

  if (target === 'past') {
    for (let i = 0; i < frames.length; i++) if (frames[i].minuteOffset === -60) return i;
    return 0;
  }
  if (target === 'now') {
    return state.map.liveRadarIndex !== undefined ? state.map.liveRadarIndex : 0;
  }

  const str = String(target).trim();
  if (str.includes('m') || str.startsWith('-')) {
    const targetMin = parseInt(str.replace(/[^0-9\-]/g, ''), 10);
    if (!isNaN(targetMin)) {
      let bestIdx = 0, minDiff = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const mo = frames[i].minuteOffset !== undefined ? frames[i].minuteOffset : (frames[i].hoursFromNow ? frames[i].hoursFromNow * 60 : 0);
        const diff = Math.abs(mo - targetMin);
        if (diff < minDiff) { minDiff = diff; bestIdx = i; }
      }
      return bestIdx;
    }
  }

  const targetHour = parseInt(str.replace(/[^0-9]/g, ''), 10);
  if (!isNaN(targetHour)) {
    if (!str.includes('h') && [15, 30, 45, 60, 90, 120].includes(targetHour)) {
      let bestIdx = 0, minDiff = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const mo = frames[i].minuteOffset !== undefined ? frames[i].minuteOffset : (frames[i].hoursFromNow ? frames[i].hoursFromNow * 60 : 0);
        const diff = Math.abs(mo - targetHour);
        if (diff < minDiff) { minDiff = diff; bestIdx = i; }
      }
      return bestIdx;
    }
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].type === 'future' && (frames[i].hoursFromNow >= targetHour || (frames[i].minuteOffset && frames[i].minuteOffset >= targetHour * 60))) {
        return i;
      }
    }
  }
  return frames.length - 1;
}

export function findFrameIndexForHourOffset(offsetHours) {
  return findFrameIndexForTarget(offsetHours);
}

export function updateJumpButtonsActive(idx) {
  const frame = state.map.unifiedRadarFrames ? state.map.unifiedRadarFrames[idx] : null;
  if (!frame) return;

  const curMinute = frame.minuteOffset !== undefined
    ? frame.minuteOffset
    : (frame.hoursFromNow !== undefined ? Math.round(frame.hoursFromNow * 60) : 0);

  document.querySelectorAll('.radar-jump-btn').forEach(btn => {
    btn.classList.remove('active');
    const target = btn.dataset.target;
    if (!target) return;

    if (target === 'past' && (idx === 0 || curMinute === -60)) btn.classList.add('active');
    else if (target === 'now' && (idx === state.map.liveRadarIndex || curMinute === 0)) btn.classList.add('active');
    else if (target.includes('m') || target.startsWith('-')) {
      if (curMinute === parseInt(target.replace(/[^0-9\-]/g, ''), 10)) btn.classList.add('active');
    } else if (target.includes('h')) {
      const h = parseInt(target.replace(/[^0-9]/g, ''), 10);
      if (curMinute === h * 60 || Math.round(frame.hoursFromNow) === h) btn.classList.add('active');
    } else {
      const num = parseInt(target, 10);
      if (!isNaN(num)) {
        if ([15, 30, 45, 60, 90, 120].includes(num) && btn.innerText.includes('m')) {
          if (curMinute === num) btn.classList.add('active');
        } else if (Math.round(frame.hoursFromNow) === num || curMinute === num * 60) {
          btn.classList.add('active');
        }
      }
    }
  });
}

/**
 * Zeitproportionale 60-FPS Wiedergabe (konstante Wetter-Minuten/Sekunde über 5m, 15m & 60m Abschnitte -> KEIN 12x Sprung ab +4h!).
 */
export function startRadarAnimation() {
  stopRadarAnimation();
  state.map.radarPlaying = true;
  const playBtn = document.getElementById('radar-play-btn');
  if (playBtn) {
    playBtn.innerText = '⏸';
    playBtn.title = 'Animation pausieren';
    playBtn.setAttribute('aria-label', 'Radar-Animation pausieren');
  }

  // Wetter-Minuten pro Sekunde (1x: 75 Min/s, 1.5x: 112.5 Min/s, 2x: 150 Min/s)
  const minPerSecBySpeed = { 1: 75, 1.5: 112.5, 2: 150 };
  let lastTickTime = performance.now();
  let lastCanvasDraw = 0;

  function radarLoop(currentTime) {
    if (!state.map.radarPlaying) return;
    const frames = state.map.unifiedRadarFrames;
    if (frames && frames.length > 0) {
      const dtSec = Math.min(0.08, Math.max(0, (currentTime - lastTickTime) / 1000));
      lastTickTime = currentTime;

      const currentSpeed = state.map.radarPlaybackSpeed || 1;
      const weatherMinPerSec = minPerSecBySpeed[currentSpeed] || 75;

      const maxIdx = Math.max(1, frames.length - 1);
      const curFloat = (state.map.radarFloatIndex !== undefined)
        ? state.map.radarFloatIndex
        : (state.map.radarIndex || 0);

      // Lokale Intervalldauer in Minuten für gleichförmigen Echtzeitfluss bestimmen
      const i0 = Math.min(maxIdx - 1, Math.max(0, Math.floor(curFloat)));
      const i1 = Math.min(maxIdx, i0 + 1);
      const m0 = frames[i0] && frames[i0].minuteOffset !== undefined ? frames[i0].minuteOffset : i0 * 15;
      const m1 = frames[i1] && frames[i1].minuteOffset !== undefined ? frames[i1].minuteOffset : m0 + 15;
      const spanMin = Math.max(5, Math.abs(m1 - m0));

      // Sanfte Index-Schrittweite: dFloat = (Wetter-Minuten/Sekunde * dtSec) / Intervall-Minuten
      const dFloat = (weatherMinPerSec * dtSec) / spanMin;
      let nextFloat = curFloat + dFloat;
      if (nextFloat > maxIdx) nextFloat = 0;

      const spec = getInterpolatedRadarSpec(nextFloat);
      if (spec) {
        state.map.radarFloatIndex = spec.floatIdx;
        state.map.radarIndex = spec.nearestIdx;

        const slider = document.getElementById('radar-time-slider');
        if (slider) {
          if (slider.step !== 'any') slider.step = 'any';
          slider.value = spec.floatIdx;
        }

        updateJumpButtonsActive(spec.nearestIdx);
        updateMeteoSwissTimelineUI(spec.frame, spec.floatIdx, frames.length);
        updateMapSolarTransition(spec.frame.timestampMs);

        const activeOverlay = state.map.activeOverlay || 'precip';
        if (lastCanvasDraw === 0 || (currentTime - lastCanvasDraw >= 32)) {
          lastCanvasDraw = currentTime;
          _helpers.renderActiveWeatherOverlayForFrame(spec.frame, activeOverlay, {
            rvFrameA: spec.frameA,
            rvFrameB: spec.frameB,
            morphAlpha: spec.morphAlpha,
            stationsPreInterpolated: spec.morphAlpha > 0,
            isScrubOrPlay: true
          });
        }
      }
    }
    state.map.radarRafId = requestAnimationFrame(radarLoop);
  }

  state.map.radarRafId = requestAnimationFrame(radarLoop);
}

export function stopRadarAnimation() {
  if (state.map.radarRafId) {
    cancelAnimationFrame(state.map.radarRafId);
    state.map.radarRafId = null;
  }
  if (state.map.radarInterval) {
    clearInterval(state.map.radarInterval);
    state.map.radarInterval = null;
  }
  state.map.radarPlaying = false;
  const playBtn = document.getElementById('radar-play-btn');
  if (playBtn) {
    playBtn.innerText = '▶';
    playBtn.title = 'Animation abspielen';
    playBtn.setAttribute('aria-label', 'Radar-Animation abspielen');
  }
}

export function toggleRadarPlay() {
  if (state.map.radarPlaying) {
    stopRadarAnimation();
    const settledIdx = (state.map.radarFloatIndex !== undefined)
      ? state.map.radarFloatIndex
      : (state.map.radarIndex || 0);
    showUnifiedRadarFrame(settledIdx, { isScrubOrPlay: false });
  } else {
    startRadarAnimation();
  }
}

export function stepRadar(delta) {
  if (!state.map.unifiedRadarFrames || state.map.unifiedRadarFrames.length === 0) return;
  const baseIdx = Math.round((state.map.radarFloatIndex !== undefined) ? state.map.radarFloatIndex : (state.map.radarIndex || 0));
  let next = baseIdx + delta;
  if (next < 0) next = state.map.unifiedRadarFrames.length - 1;
  if (next >= state.map.unifiedRadarFrames.length) next = 0;
  showUnifiedRadarFrame(next, { isScrubOrPlay: false });
}
