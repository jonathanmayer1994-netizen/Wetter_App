/**
 * BEST WEATHER — Reactive State Store (Task 8b)
 */

import { dispatcher, ACTIONS } from './dispatcher.js';
import { OFFICIAL_KNOWN_ELEVATIONS } from './constants.js';
import { AlpineStorage } from '../storage.js';

const LAST_GPS_KEY = 'best_weather_last_gps';
const cachedGpsLocation = AlpineStorage.safeGetItem(LAST_GPS_KEY, null);

export const state = {
  currentLocation: cachedGpsLocation || {
    name: 'Mein Standort',
    lat: 48.1374,
    lon: 11.5755,
    elevation: 520,
    country: 'Deutschland',
    isMountain: false,
    isGps: true
  },
  weatherData: null,
  microData: null,
  multiModel: null,
  actualVerification: null,
  airQuality: null,
  unit: 'celsius',
  activeTab: 'tab-overview',
  activeAspect: { tilt: 45, azimuth: 0, isAuto: false },
  selectedAltitudeHour: 0,
  favorites: [],
  overviewHourlyMode: 'highres',
  daily10DayExpanded: false,
  map: {
    instance: null,
    marker: null,
    activeLayer: 'radar',
    activeOverlay: 'precip',
    activeBase: 'osm-dark',
    radarTileLayer: null,
    baseTileLayer: null,
    hillshadeTileLayer: null,
    topReliefLayer: null,
    satelliteLabelsLayer: null,
    precipPhaseEnabled: true,
    showStratusOverlay: true,
    showLightningOverlay: false,
    legendVisible: false,
    futureRadarLayerGroup: null,
    weatherLayerGroup: null,
    radarFrames: [],
    unifiedRadarFrames: [],
    radarIndex: 0,
    radarFloatIndex: 0,
    liveRadarIndex: 0,
    radarInterval: null,
    radarRafId: null,
    radarImageBuffer: new Map(),
    radarPlaying: false,
    radarPlaybackSpeed: (() => {
      try {
        const s = parseFloat(localStorage.getItem('best_weather_radar_speed'));
        return (s === 1 || s === 1.5 || s === 2) ? s : 1;
      } catch (e) {
        return 1;
      }
    })(),
    solarTransitionEnabled: (() => {
      try {
        return localStorage.getItem('best_weather_solar_transition') !== 'false';
      } catch (e) {
        return true;
      }
    })(),
    solarTerminatorLayer: null,
    solarAmbientOverlay: null,
    radarHost: '',
    regionalStationsData: []
  },
  mountain3D: {},
  canvasEngine: null,
  sports: {
    initialized: false,
    category: 'mountain', // 'bike', 'mountain' oder 'skitour'
    sportType: 'hiking',
    fitnessLevel: 'normal',
    bikeSpeedKmH: 26.0,
    mountainSpeedKmH: 4.0,
    mountainAscentHmH: 400,
    skitourAscentHmH: 400,
    skitourSpeedKmH: 3.5,
    skitourDescentKmH: 25.0,
    startDateStr: new Date().toISOString().slice(0, 10),
    startTimeStr: '08:00',
    waypointFilter: 'all',
    activeTour: 'nebelhorn-oberstdorf',
    startTimeMs: Date.now(),
    trackingActive: false,
    watchId: null,
    currentProgressKm: 0,
    currentPointIndex: 0,
    observedPaceFactor: 1.0,
    timeDeltaMinutes: 0,
    actualStartTimeMs: null,
    gpxText: null,
    gpxName: 'Nebelhorn Rundtour (2.224 m)',
    parsedGPX: null,
    timeline: null,
    hazards: null,
    scrubberKm: 0,
    requestSeq: 0,
    munterSmallGroup: true,
    slopeOverlayEnabled: false,
    demSamples: null,
    slopeLayerGroup: null,
    map: null,
    routeLine: null,
    routeBgLine: null,
    startMarker: null,
    endMarker: null,
    milestoneMarkers: [],
    scrubberMarker: null,
    cachedForecasts: {},
    cachedForecast: null
  }
};

// Initialize favorites from device-scoped storage (Isoliert pro Gerät, update-sicher)
state.favorites = [];
try {
  const deviceUuid = AlpineStorage.getDeviceUuid();
  const deviceKey = AlpineStorage.getDeviceFavoritesKey(deviceUuid);
  let saved = AlpineStorage.safeGetItem(deviceKey, null);

  // Migration: Wenn noch kein gerätespezifischer Key existiert, aus Legacy-Key migrieren
  if (!Array.isArray(saved) || saved.length === 0) {
    const legacy = AlpineStorage.safeGetItem('best_weather_favorites_v4', null);
    if (Array.isArray(legacy) && legacy.length > 0) {
      saved = legacy;
      AlpineStorage.safeSetItem(deviceKey, saved);
      AlpineStorage.saveDeviceFavorites(deviceUuid, saved).catch(() => {});
    }
  }

  if (Array.isArray(saved) && saved.length > 0) {
    state.favorites = saved.map(fav => {
      const lower = (fav.name || '').toLowerCase();
      if (OFFICIAL_KNOWN_ELEVATIONS[lower]) {
        return {
          ...fav,
          elevation: OFFICIAL_KNOWN_ELEVATIONS[lower].elevation,
          isMountain: OFFICIAL_KNOWN_ELEVATIONS[lower].isMountain,
          country: fav.country || OFFICIAL_KNOWN_ELEVATIONS[lower].country
        };
      }
      return fav;
    });
  } else {
    state.favorites = [];
  }
} catch (e) {
  state.favorites = [];
}
