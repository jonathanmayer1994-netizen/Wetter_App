/**
 * BEST WEATHER — Reactive State Store (Task 8b)
 */

import { dispatcher, ACTIONS } from './dispatcher.js';
import { OFFICIAL_KNOWN_ELEVATIONS } from './constants.js';
import { AlpineStorage } from '../storage.js';

export const state = {
  currentLocation: {
    name: 'München',
    lat: 48.1374,
    lon: 11.5755,
    elevation: 520,
    country: 'Deutschland',
    isMountain: false
  },
  weatherData: null,
  microData: null,
  multiModel: null,
  airQuality: null,
  unit: 'celsius',
  activeTab: 'tab-overview',
  activeAspect: { tilt: 45, azimuth: 0, isAuto: false },
  selectedAltitudeHour: 0,
  favorites: [],
  overviewHourlyMode: 'highres',
  map: {
    instance: null,
    marker: null,
    activeLayer: 'radar',
    activeOverlay: 'precip',
    activeBase: 'osm-outdoor',
    radarTileLayer: null,
    baseTileLayer: null,
    futureRadarLayerGroup: null,
    weatherLayerGroup: null,
    radarFrames: [],
    unifiedRadarFrames: [],
    radarIndex: 0,
    liveRadarIndex: 0,
    radarInterval: null,
    radarRafId: null,
    radarImageBuffer: new Map(),
    radarPlaying: false,
    radarPlaybackSpeed: 1,
    radarHost: '',
    regionalStationsData: []
  },
  mountain3D: {
    canvas: null,
    ctx: null,
    viewMode: 'massif',
    showFrostLine: true,
    showClouds: true,
    showWind: false,
    showSun: true,
    animFrame: null,
    weatherParticles: [],
    windParticles: [],
    cloudDrift: 0,
    rotationAngle: 0,
    pitchAngle: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    initialized: false
  },
  canvasEngine: null,
  sports: {
    initialized: false,
    category: 'bike', // 'bike' oder 'mountain'
    sportType: 'road_bike',
    fitnessLevel: 'normal',
    bikeSpeedKmH: 26.0,
    mountainSpeedKmH: 4.0,
    mountainAscentHmH: 400,
    startDateStr: new Date().toISOString().slice(0, 10),
    startTimeStr: '08:00',
    waypointFilter: 'all',
    activeTour: 'grossglockner-bike',
    startTimeMs: Date.now(),
    trackingActive: false,
    watchId: null,
    currentProgressKm: 0,
    currentPointIndex: 0,
    observedPaceFactor: 1.0,
    timeDeltaMinutes: 0,
    actualStartTimeMs: null,
    gpxText: null,
    gpxName: 'Großglockner Hochalpenstraße (48 km)',
    parsedGPX: null,
    timeline: null,
    hazards: null,
    scrubberKm: 0,
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

// Initialize favorites with migration
const STORAGE_KEY = 'best_weather_favorites_v4';
try {
  const saved = AlpineStorage.safeGetItem(STORAGE_KEY, []);
  if (Array.isArray(saved) && saved.length > 0) {
    state.favorites = saved.map(fav => {
      const lower = fav.name.toLowerCase();
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
  }
} catch (e) {
  state.favorites = [];
}

if (!state.favorites || state.favorites.length === 0) {
  state.favorites = [
    { name: 'München', lat: 48.1374, lon: 11.5755, elevation: 520, country: 'Deutschland', isMountain: false },
    { name: 'Zugspitze', lat: 47.4212, lon: 10.9864, elevation: 2962, country: 'Deutschland', isMountain: true },
    { name: 'Matterhorn', lat: 45.9764, lon: 7.6586, elevation: 4478, country: 'Schweiz', isMountain: true },
    { name: 'Berlin', lat: 52.5200, lon: 13.4050, elevation: 34, country: 'Deutschland', isMountain: false },
    { name: 'Bozen', lat: 46.4983, lon: 11.3548, elevation: 262, country: 'Italien', isMountain: false }
  ];
  AlpineStorage.safeSetItem(STORAGE_KEY, state.favorites);
}
