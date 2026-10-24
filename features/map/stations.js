/**
 * BEST WEATHER — Regional Stations Module
 * Station synthesis and regional weather loading for map overlays.
 */

import { state } from '../../core/state.js';
import { REGIONAL_STATIONS } from '../../core/constants.js';
import { MicroEngine } from '../../microEngine.js';

export function getSynthesizedBaselineStations() {
  const cur = (state.weatherData && state.weatherData.current) ? state.weatherData.current : {};
  const baseT = cur.temperature_2m !== undefined ? cur.temperature_2m : 12.0;
  const baseP = cur.surface_pressure !== undefined ? cur.surface_pressure : 1014.2;
  const baseWind = cur.wind_speed_10m !== undefined ? cur.wind_speed_10m : 16.0;
  const baseDir = cur.wind_direction_10m !== undefined ? cur.wind_direction_10m : 240;
  const baseCloud = cur.cloud_cover !== undefined ? cur.cloud_cover : 55;

  return REGIONAL_STATIONS.map(st => {
    const deltaElev = (st.elevation || 500) - 520;
    const temp = baseT - (deltaElev / 100) * 0.65;
    return {
      ...st,
      temperature: temp,
      pressure: baseP - (deltaElev / 8),
      windSpeed: baseWind * (1 + Math.max(0, deltaElev) / 2000),
      windDir: baseDir,
      cloudCover: Math.min(100, baseCloud + (deltaElev > 1500 ? 15 : 0)),
      precipMm: 0,
      isSnow: temp < 1.5
    };
  });
}

export async function loadRegionalStationWeather() {
  const CACHE_KEY = 'regional_stations_cache_v1';
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < 10 * 60 * 1000) {
        state.map.regionalStationsData = parsed.data;
        return parsed.data;
      }
    }
  } catch (_) {}

  try {
    const data = await MicroEngine.fetchRegionalStationsWeather
      ? await MicroEngine.fetchRegionalStationsWeather(REGIONAL_STATIONS)
      : null;

    if (data && data.length) {
      state.map.regionalStationsData = data;
    } else {
      state.map.regionalStationsData = getSynthesizedBaselineStations();
    }

    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: state.map.regionalStationsData }));
    } catch (_) {}

    return state.map.regionalStationsData;
  } catch (err) {
    console.warn('Regional weather batch fetch fallback:', err.message);
    state.map.regionalStationsData = getSynthesizedBaselineStations();
    return state.map.regionalStationsData;
  }
}

export function cleanupRadarTiles() {
  if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();
  if (state.map.weatherLayerGroup) state.map.weatherLayerGroup.clearLayers();
  if (state.map.radarTileLayer) {
    state.map.instance.removeLayer(state.map.radarTileLayer);
    state.map.radarTileLayer = null;
  }
}
