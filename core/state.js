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
  mountain3D: {},
  canvasEngine: null,
  sports: {
    initialized: false,
    category: 'mountain', // 'bike' oder 'mountain' (Allgäuer Berg-Default)
    sportType: 'hiking',
    fitnessLevel: 'normal',
    bikeSpeedKmH: 26.0,
    mountainSpeedKmH: 4.0,
    mountainAscentHmH: 400,
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

// Initialize favorites from storage or cloud (Startet leer, synchronisiert aus Google Sheets)
const STORAGE_KEY = 'best_weather_favorites_v4';
state.favorites = [];
try {
  const saved = AlpineStorage.safeGetItem(STORAGE_KEY, []);
  if (Array.isArray(saved) && saved.length > 0) {
    // Migration: Entferne veraltete Dummy-Presets falls vorhanden
    const isOldSeed = (
      saved.length === 5 &&
      saved.some(f => f.name === 'München') &&
      saved.some(f => f.name === 'Zugspitze') &&
      saved.some(f => f.name === 'Matterhorn')
    );
    if (!isOldSeed) {
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
    } else {
      state.favorites = [];
      AlpineStorage.safeSetItem(STORAGE_KEY, []);
    }
  }
} catch (e) {
  state.favorites = [];
}
