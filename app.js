/**
 * BEST WEATHER — Dynamic Responsive Alpine Weather & Urban Climate Platform
 * Fully differentiated between Cities and Mountains
 */

import { MicroEngine } from './microEngine.js';
import { AlpineStorage } from './storage.js';
import { resilientFetch, escapeHtml } from './httpClient.js';

// =============================================================================
// GLOBAL STATE & PERSISTENCE
// =============================================================================
const state = {
  currentLocation: {
    name: 'München',
    lat: 48.1374,
    lon: 11.5755,
    elevation: 520, // Offizielle Höhe der Stadt München: 520 m
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
    showStations: false
  },
  mountain3D: {
    canvas: null,
    ctx: null,
    viewMode: 'massif', // 'massif', 'crossSection', 'wind'
    showFrostLine: true,
    showClouds: true,
    showWind: true,
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
    sportType: 'hiking',
    fitnessLevel: 'normal',
    waypointFilter: 'all',
    activeTour: 'grossglockner-bike',
    startTimeMs: Date.now(),
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

// =============================================================================
// AMTLICHE GROUND-TRUTH REFERENZTABELLE (EXAKTE VERMESSUNGSHÖHEN)
// =============================================================================
export const OFFICIAL_KNOWN_ELEVATIONS = {
  // Hochalpine Berggipfel (Exakte amtliche Gipfelhöhe)
  'matterhorn': { elevation: 4478, isMountain: true, country: 'Schweiz' },
  'zugspitze': { elevation: 2962, isMountain: true, country: 'Deutschland' },
  'mont blanc': { elevation: 4808, isMountain: true, country: 'Frankreich' },
  'großglockner': { elevation: 3798, isMountain: true, country: 'Österreich' },
  'grossglockner': { elevation: 3798, isMountain: true, country: 'Österreich' },
  'ortler': { elevation: 3905, isMountain: true, country: 'Italien' },
  'wildspitze': { elevation: 3768, isMountain: true, country: 'Österreich' },
  'watzmann': { elevation: 2713, isMountain: true, country: 'Deutschland' },
  'feldberg': { elevation: 1493, isMountain: true, country: 'Deutschland' },
  'brocken': { elevation: 1141, isMountain: true, country: 'Deutschland' },
  'nebelhorn': { elevation: 2224, isMountain: true, country: 'Deutschland' },

  // Städte & Flachland (STADT-Modus: keine Bergwand, keine Höhendifferenz)
  'münchen': { elevation: 520, isMountain: false, country: 'Deutschland' },
  'munich': { elevation: 520, isMountain: false, country: 'Deutschland' },
  'berlin': { elevation: 34, isMountain: false, country: 'Deutschland' },
  'hamburg': { elevation: 6, isMountain: false, country: 'Deutschland' },
  'köln': { elevation: 53, isMountain: false, country: 'Deutschland' },
  'frankfurt am main': { elevation: 112, isMountain: false, country: 'Deutschland' },
  'frankfurt': { elevation: 112, isMountain: false, country: 'Deutschland' },
  'stuttgart': { elevation: 247, isMountain: false, country: 'Deutschland' },
  'düsseldorf': { elevation: 38, isMountain: false, country: 'Deutschland' },
  'leipzig': { elevation: 113, isMountain: false, country: 'Deutschland' },
  'dresden': { elevation: 113, isMountain: false, country: 'Deutschland' },
  'nürnberg': { elevation: 309, isMountain: false, country: 'Deutschland' },
  'wien': { elevation: 171, isMountain: false, country: 'Österreich' },
  'vienna': { elevation: 171, isMountain: false, country: 'Österreich' },
  'salzburg': { elevation: 424, isMountain: false, country: 'Österreich' },
  'innsbruck': { elevation: 574, isMountain: false, country: 'Österreich' },
  'graz': { elevation: 353, isMountain: false, country: 'Österreich' },
  'linz': { elevation: 266, isMountain: false, country: 'Österreich' },
  'klagenfurt': { elevation: 446, isMountain: false, country: 'Österreich' },
  'zürich': { elevation: 408, isMountain: false, country: 'Schweiz' },
  'zurich': { elevation: 408, isMountain: false, country: 'Schweiz' },
  'genf': { elevation: 375, isMountain: false, country: 'Schweiz' },
  'geneva': { elevation: 375, isMountain: false, country: 'Schweiz' },
  'bern': { elevation: 542, isMountain: false, country: 'Schweiz' },
  'basel': { elevation: 260, isMountain: false, country: 'Schweiz' },
  'luzern': { elevation: 436, isMountain: false, country: 'Schweiz' },
  'bozen': { elevation: 262, isMountain: false, country: 'Italien' },
  'meran': { elevation: 325, isMountain: false, country: 'Italien' },
  'trient': { elevation: 194, isMountain: false, country: 'Italien' },
  'brixen': { elevation: 560, isMountain: false, country: 'Italien' },
  'garmisch-partenkirchen': { elevation: 708, isMountain: false, country: 'Deutschland' },
  'zermatt': { elevation: 1608, isMountain: false, country: 'Schweiz' },
  'oberstdorf': { elevation: 813, isMountain: false, country: 'Deutschland' },
  'chamonix': { elevation: 1035, isMountain: false, country: 'Frankreich' }
};

// Initialisierung der Favoriten mit sauberer v4-Migration
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
} catch(e) {
  state.favorites = [];
}

if (state.favorites.length === 0) {
  state.favorites = [
    { name: 'München', lat: 48.1374, lon: 11.5755, elevation: 520, country: 'Deutschland', isMountain: false },
    { name: 'Zugspitze', lat: 47.4212, lon: 10.9864, elevation: 2962, country: 'Deutschland', isMountain: true },
    { name: 'Matterhorn', lat: 45.9764, lon: 7.6586, elevation: 4478, country: 'Schweiz', isMountain: true },
    { name: 'Berlin', lat: 52.5200, lon: 13.4050, elevation: 34, country: 'Deutschland', isMountain: false },
    { name: 'Bozen', lat: 46.4983, lon: 11.3548, elevation: 262, country: 'Italien', isMountain: false }
  ];
  AlpineStorage.safeSetItem(STORAGE_KEY, state.favorites);
}

// WMO Codes
const WMO_CODES = {
  0: { label: 'Klar / Wolkenlos', icon: '☀️', iconNight: '🌙', theme: 'clear-day', themeNight: 'clear-night' },
  1: { label: 'Überwiegend klar', icon: '🌤️', iconNight: '🌤️', theme: 'clear-day', themeNight: 'clear-night' },
  2: { label: 'Teilweise bewölkt', icon: '⛅', iconNight: '☁️', theme: 'cloudy', themeNight: 'cloudy' },
  3: { label: 'Bedeckt', icon: '☁️', iconNight: '☁️', theme: 'cloudy', themeNight: 'cloudy' },
  45: { label: 'Nebel', icon: '🌫️', iconNight: '🌫️', theme: 'fog', themeNight: 'fog' },
  48: { label: 'Raureifnebel', icon: '🌫️', iconNight: '🌫️', theme: 'fog', themeNight: 'fog' },
  51: { label: 'Leichter Nieselregen', icon: '🌦️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  53: { label: 'Mäßiger Nieselregen', icon: '🌦️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  55: { label: 'Dichter Nieselregen', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  56: { label: 'Gefrierender Nieselregen', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  57: { label: 'Starker gefrierender Niesel', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  61: { label: 'Leichter Regen', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  63: { label: 'Mäßiger Regen', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  65: { label: 'Kräftiger Regen', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  66: { label: 'Gefrierender Regen', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  67: { label: 'Starker gefrierender Regen', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  71: { label: 'Leichter Schneefall', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  73: { label: 'Mäßiger Schneefall', icon: '❄️', iconNight: '❄️', theme: 'snow', themeNight: 'snow' },
  75: { label: 'Starker Schneefall', icon: '❄️', iconNight: '❄️', theme: 'snow', themeNight: 'snow' },
  77: { label: 'Schneegriesel', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  80: { label: 'Leichte Regenschauer', icon: '🌦️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  81: { label: 'Mäßige Regenschauer', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  82: { label: 'Heftige Regenschauer', icon: '⛈️', iconNight: '⛈️', theme: 'rain', themeNight: 'rain' },
  85: { label: 'Leichte Schneeschauer', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  86: { label: 'Starke Schneeschauer', icon: '❄️', iconNight: '❄️', theme: 'snow', themeNight: 'snow' },
  95: { label: 'Gewitter', icon: '⛈️', iconNight: '⛈️', theme: 'thunder', themeNight: 'thunder' },
  96: { label: 'Gewitter mit Hagel', icon: '⛈️', iconNight: '⛈️', theme: 'thunder', themeNight: 'thunder' },
  99: { label: 'Schweres Hagelgewitter', icon: '⛈️', iconNight: '⛈️', theme: 'thunder', themeNight: 'thunder' }
};

// =============================================================================
// ATMOSPHERIC BACKGROUND CANVAS
// =============================================================================
class BackgroundCanvasEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.stars = [];
    this.currentMode = 'clear-day';
    this.isDay = true;
    this.isPaused = false;
    this.rafId = null;
    this.reducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.initStars();
    this.animate = this.animate.bind(this);
    if (!this.reducedMotion) {
      this.animate();
    } else {
      this.renderStaticFrame();
    }
  }

  pause() {
    this.isPaused = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume() {
    if (this.isPaused && !this.reducedMotion) {
      this.isPaused = false;
      this.animate();
    }
  }

  renderStaticFrame() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (!this.isDay || this.currentMode === 'clear-night') {
      for (const star of this.stars) {
        this.ctx.fillStyle = `rgba(255, 255, 255, 0.65)`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  resize() {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
  }

  initStars() {
    this.stars = [];
    for (let i = 0; i < 65; i++) {
      this.stars.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * (window.innerHeight * 0.6),
        radius: 0.8 + Math.random() * 1.5,
        alpha: Math.random(),
        speed: 0.01 + Math.random() * 0.02
      });
    }
  }

  setMode(theme, isDay) {
    this.currentMode = theme;
    this.isDay = isDay;
    this.particles = [];

    if (theme === 'rain' || theme === 'thunder') {
      const count = Math.min(70, Math.floor(this.width / 14));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          len: 14 + Math.random() * 14,
          speed: 14 + Math.random() * 8
        });
      }
    } else if (theme === 'snow') {
      const count = Math.min(50, Math.floor(this.width / 18));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          r: 1.5 + Math.random() * 2.5,
          speed: 1 + Math.random() * 1.5,
          sway: Math.random() * Math.PI * 2
        });
      }
    }
  }

  animate() {
    if (this.isPaused || this.reducedMotion) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (!this.isDay || this.currentMode === 'clear-night') {
      for (const star of this.stars) {
        star.alpha += star.speed;
        const op = (Math.sin(star.alpha) + 1) / 2 * 0.7 + 0.1;
        this.ctx.fillStyle = `rgba(255, 255, 255, ${op})`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    if (this.currentMode === 'rain' || this.currentMode === 'thunder') {
      this.ctx.strokeStyle = 'rgba(180, 225, 255, 0.55)';
      this.ctx.lineWidth = 1.2;
      for (const p of this.particles) {
        p.y += p.speed;
        p.x -= 2;
        if (p.y > this.height) {
          p.y = -p.len;
          p.x = Math.random() * (this.width + 100);
        }
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
        this.ctx.lineTo(p.x - 2, p.y + p.len);
        this.ctx.stroke();
      }
    }

    if (this.currentMode === 'snow') {
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      for (const s of this.particles) {
        s.sway += 0.02;
        s.y += s.speed;
        s.x += Math.sin(s.sway) * 1;
        if (s.y > this.height) {
          s.y = -5;
          s.x = Math.random() * this.width;
        }
        this.ctx.beginPath();
        this.ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    this.rafId = requestAnimationFrame(this.animate);
  }
}

// =============================================================================
// MAIN INITIALIZATION
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  state.canvasEngine = new BackgroundCanvasEngine('weather-canvas');

  setupTabs();
  setupSearch();
  setupSpotlightAndQuickGps();
  setupWallSelector();
  setupAltitudeSlider();
  setupMountain3DControls();
  setupFavorites();
  setupLocationTypeToggle();
  setupMeteogramControls();
  setupGPXInspector();
  setupWebcamModal();
  setupSportsTab();
  initLeafletMap();
  setupSourcesQuickNav();
  setupExpertModeToggle();

  // Load initial location (München: 520 m)
  loadLocation(state.currentLocation);
});

// =============================================================================
// TABS CONTROLLER (DESKTOP TOP BAR & NATIVE MOBILE BOTTOM NAV)
// =============================================================================
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn, .mbn-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Page Visibility API: Akku- und Ressourcenschonung bei minimiertem Tab / gesperrtem Bildschirm
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.canvasEngine) state.canvasEngine.pause();
      if (state.map && state.map.radarPlaying) stopRadarAnimation();
    } else {
      if (state.canvasEngine) state.canvasEngine.resume();
    }
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-btn, .mbn-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === tabId);
  });

  // Radar-Animation sofort stoppen, wenn der Nutzer den Map-Tab verlässt!
  if (tabId !== 'tab-map' && state.map && state.map.radarPlaying) {
    stopRadarAnimation();
  }

  if (tabId === 'tab-mountain') {
    setTimeout(() => {
      renderMountain3DModel();
    }, 80);
  }

  if (tabId === 'tab-sports') {
    setTimeout(() => {
      if (!state.sports.initialized) {
        initSportsTour();
      } else {
        if (state.sports.map) {
          state.sports.map.invalidateSize();
          if (state.sports.routeLine) {
            state.sports.map.fitBounds(state.sports.routeLine.getBounds(), { padding: [30, 30] });
          }
        }
      }
    }, 100);
  }

  if (tabId === 'tab-map' && state.map.instance) {
    setTimeout(() => {
      state.map.instance.invalidateSize();
      if (state.currentLocation) {
        state.map.instance.setView([state.currentLocation.lat, state.currentLocation.lon], 9);
      }
    }, 150);
  }
}

// =============================================================================
// LOCATION TYPE TOGGLE (STADT VS. BERG)
// =============================================================================
function setupLocationTypeToggle() {
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

// =============================================================================
// FEATURE 3B: OFFLINE CACHING FÜR WETTERDATEN & GPX-TOUREN (INDEXEDDB & SAFESTORAGE)
// =============================================================================
const WeatherTourCache = {
  LOCATION_KEY: 'alpine_offline_last_location',
  WEATHER_KEY: 'alpine_offline_weather_data',
  SPORTS_TOUR_KEY: 'alpine_offline_sports_tour',

  async saveLocationAndWeather(loc, weatherData, microData) {
    if (!loc) return;
    AlpineStorage.safeSetItem(this.LOCATION_KEY, loc);
    if (weatherData) {
      await AlpineStorage.saveWeatherCache(loc, weatherData, microData);
    }
  },

  getCachedLocation() {
    return AlpineStorage.safeGetItem(this.LOCATION_KEY, null);
  },

  async getCachedWeather() {
    return await AlpineStorage.getCachedWeather();
  },

  async saveTour(tourName, gpxXml, parsedGPX, timeline, stats) {
    const payload = {
      id: 'current_tour',
      timestamp: Date.now(),
      tourName,
      gpxXml,
      parsedGPX,
      timeline,
      stats
    };
    await AlpineStorage.saveTour(payload);
  },

  async getCachedTour() {
    return await AlpineStorage.getTour('current_tour');
  }
};

// =============================================================================
// LOCATION LOADING & HIGH-PRECISION WEATHER FETCH
// =============================================================================
async function loadLocation(loc) {
  state.currentLocation = loc;
  
  // Set UI Header values immediately with official exact elevation!
  updateLocationHeaderUI();
  updateGeoRoutingNetworks();

  try {
    const customTilt = state.activeAspect.isAuto ? null : state.activeAspect.tilt;
    const customAzimuth = state.activeAspect.isAuto ? null : state.activeAspect.azimuth;

    // Call MicroEngine, Multi-Model Ensemble, and Air Quality APIs in parallel
    const [microResult, multiModel, airQuality] = await Promise.all([
      MicroEngine.getMicroScaleWeather(
        loc.lat,
        loc.lon,
        loc.elevation, // Exact official elevation preserved!
        loc.isMountain,
        customTilt,
        customAzimuth
      ),
      MicroEngine.fetchMultiModelComparison(loc.lat, loc.lon),
      MicroEngine.fetchAirQualityAndUV(loc.lat, loc.lon, loc.elevation)
    ]);

    state.microData = microResult;
    state.weatherData = microResult.weatherRaw;
    state.multiModel = multiModel;
    state.airQuality = airQuality;

    // Feature 3B: Offline-Cache abspeichern
    WeatherTourCache.saveLocationAndWeather(loc, state.weatherData, state.microData);

    // Render all UI components
    renderOverviewTab();
    renderMultiModelComparison();
    renderAirQualityAndUV();
    renderAdaptiveTab2();
    renderFavoritesTab();
    updateMapLocation();
    updateNavigationWarningBadges();

  } catch (err) {
    console.error('Fehler beim Laden des Wetters:', err);
    // Feature 3B: Offline-Fallback ausführen falls vorhanden
    const cached = await WeatherTourCache.getCachedWeather();
    if (cached && cached.weatherData) {
      console.info('Offline-Modus: Stelle gespeicherte Wetterdaten für', cached.locName, 'wieder her');
      state.weatherData = cached.weatherData;
      if (cached.microData) state.microData = { ...cached.microData, weatherRaw: cached.weatherData };
      renderOverviewTab();
      renderAdaptiveTab2();
      renderFavoritesTab();
      updateNavigationWarningBadges();
      const heroTime = document.getElementById('hero-update-time');
      if (heroTime) heroTime.innerText = `Offline-Modus (Gespeichert: ${new Date(cached.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})`;
    } else {
      const cond = document.getElementById('hero-condition-text');
      if (cond) cond.innerText = 'Verbindungsfehler beim Laden der Daten';
    }
  }
}

function updateLocationHeaderUI() {
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

// =============================================================================
// FEATURE 10B: DYNAMISCHE HIMMELSFARBEN & ALPENGLÜHEN NACH SONNENSTAND
// =============================================================================
function updateAlpineSkyIllumination(weatherData, elevation) {
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
function renderOverviewTab() {
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
  document.getElementById('hero-condition-text').innerText = code.label;

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
function updateHeroHazardAlert(cur, daily, hourly, microData) {
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
function setupExpertModeToggle() {
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

function renderHourlySlider(hourly) {
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

  // Zeige Kontext (auch frühere Stunden des heutigen Tages)
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
    container.appendChild(item);
  }

  // Feature 7A: Auto-Scroll sanft zur aktuellen Stunde
  const activeNowItem = container.querySelector('.hourly-item.current-now');
  if (activeNowItem) {
    setTimeout(() => {
      activeNowItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 80);
  }
}

function render10DayForecast(daily, hourly) {
  const container = document.getElementById('daily-forecast-list');
  if (!container || !daily || !daily.time || daily.time.length === 0) return;

  container.innerHTML = '';
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
        </div>

        <div class="daily-row-mobile-bottom">
          <!-- 2. Condition & Icon -->
          <div class="daily-condition-cell">
            <span class="daily-icon-box" title="${condLabel}">${condIcon}</span>
            <span class="daily-cond-text" title="${condLabel}">${condLabel}</span>
          </div>

          <!-- 3. Precipitation & Rain Sum -->
          <div class="daily-precip-cell">
            ${pop > 10 || rainSum > 0 ? `
              <span class="daily-precip-chip ${rainSum >= 5 ? 'heavy-rain' : ''}">
                <span class="precip-pop">💧 ${pop}%</span>
                <span class="precip-sum">${rainSum.toFixed(1)} mm</span>
              </span>
            ` : `
              <span class="daily-precip-dry">💧 0% • Trocken</span>
            `}
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

          <!-- 7. Expand Chevron -->
          <div class="daily-action-cell">
            <span class="daily-expand-chevron">›</span>
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

    container.appendChild(wrapper);
  }
}

// =============================================================================
// MULTI-MODELL-ENSEMBLE (ECMWF IFS 0.25° VS. GFS SEAMLESS)
// =============================================================================
function renderMultiModelComparison() {
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

function setupMeteogramControls() {
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

function renderEnsembleMeteogram(metric = activeMeteogramMetric) {
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
function renderAirQualityAndUV() {
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
function getCompassDirectionName(deg) {
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
function calculateMoonPhase(date) {
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
function openDayDetailModal(dayIndex, daily, hourly) {
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
function generateOutdoorRecommendations(daily, hourly, dayIndex, loc) {
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
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('day-detail-modal');
    if (modal && modal.style.display !== 'none') {
      modal.style.display = 'none';
    }
  }
});

function renderBentoGrid(cur, daily, hourly) {
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

// =============================================================================
// TAB 2: ADAPTIVE CITY VS. MOUNTAIN RENDERING
// =============================================================================
function renderAdaptiveTab2() {
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
function renderMountainPanel() {
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
function renderAvalancheReport() {
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
function renderMountainWebcams() {
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

function openWebcamModal(cam) {
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

function setupWebcamModal() {
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
function renderCityPanel() {
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

function getSelectedWallLabel() {
  if (state.activeAspect.azimuth === 0) return 'Südwand (45°)';
  if (state.activeAspect.azimuth === 180) return 'Nordwand (75°)';
  if (state.activeAspect.azimuth === -90) return 'Ostwand (50°)';
  if (state.activeAspect.azimuth === 90) return 'Westwand (50°)';
  return 'Benutzerdefinierte Wand';
}

function setupWallSelector() {
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

function renderAltitudeChart() {
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
function renderMountain3DModel() {
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
function updateMountain3DHUD() {
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

  if (peakZElem) peakZElem.innerText = `${peakL.z.toLocaleString('de-DE')} m`;
  if (peakTempElem) {
    const t = Math.round(convertTemp(peakL.temp));
    peakTempElem.innerText = `${t > 0 ? `+${t}` : t}°C`;
  }
  if (peakCondElem) peakCondElem.innerText = peakL.precipType === 'Schnee' ? '❄️ Schneefall' : (precip > 0 ? '🌧️ Regen' : '☀️ Klar');
  if (peakWindElem) peakWindElem.innerText = `${peakL.wind} km/h`;
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
  if (midWindElem) midWindElem.innerText = `${midL.wind} km/h`;

  if (valZElem) valZElem.innerText = `${valL.z.toLocaleString('de-DE')} m`;
  if (valTempElem) {
    const t = Math.round(convertTemp(valL.temp));
    valTempElem.innerText = `${t > 0 ? `+${t}` : t}°C`;
  }
  if (valCondElem) valCondElem.innerText = precip > 0 ? `💧 ${precip.toFixed(1)} mm` : 'Trocken';
  if (valWindElem) valWindElem.innerText = `${valL.wind} km/h`;

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
      badgeFrost.style.display = state.mountain3D.showFrostLine ? 'flex' : 'none';
    }
  }
}

/**
 * Zeichnet das 3D-Bergrelief & meteorologische Schichten auf das Canvas
 */
function drawMountain3DCanvas() {
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
function render3DMassifMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, precip) {
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

  // 8. WOLKENSCHICHT / NEBELMEER (INVERSION)
  if (state.mountain3D.showClouds) {
    const yCloud = getYForZ(Math.min(peakL.z - 200, Math.max(valL.z + 100, freezingLevel * 0.85)));
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.filter = 'blur(6px)';

    const drift = (state.mountain3D.cloudDrift || 0);
    for (let c = 0; c < 7; c++) {
      const cxPos = ((c * 130 + drift) % (w + 160)) - 80;
      ctx.beginPath();
      ctx.ellipse(cxPos, yCloud, 75, 24, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 9. DYNAMISCHE 3D-WINDSTRÖMUNG
  if (state.mountain3D.showWind) {
    renderWindStreamlines(ctx, w, h, px, py, lx, ly, rx, ry, cy);
  }

  // 10. DYNAMISCHER NIEDERSCHLAG: PHASENWECHSEL SCHNEE (OBEN) VS. REGEN (UNTEN)
  renderElevationPrecipitationParticles(ctx, w, h, yFrost, precip);
}

/**
 * Zeichnet dynamische Partikel mit Schneefall über der 0°C-Grenze und Regen darunter
 */
function renderElevationPrecipitationParticles(ctx, w, h, yFrost, precip) {
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
    } else {
      // REGEN: Transparente blaue Fallstreifen unterhalb der 0°C-Frostgrenze
      ctx.strokeStyle = 'rgba(147, 197, 253, 0.7)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 1, p.y + 6);
      ctx.stroke();
    }
  });
}

/**
 * 3D VERTIKALER HÖHENSCHNITT-MODUS: Exakte Skala in Metern mit thermischer Zonierung
 */
function render3DCrossSectionMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, precip) {
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
 * 3D WIND- & STRÖMUNGSMODUS: Düseneffekt & Grat-Beschleunigung
 */
function render3DWindMode(ctx, w, h, valL, midL, peakL, freezingLevel, yValley, yPeak, getYForZ, yFrost, peakWind) {
  // Zeige Bergmassiv abgedunkelt als Silhouette
  const px = w * 0.48;
  const py = yPeak;
  const lx = w * 0.12;
  const ly = yValley;
  const rx = w * 0.88;
  const ry = yValley;

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.closePath();
  ctx.fill();

  // Dichte aerodynamische Windvektoren über dem Berg
  const windCount = 38;
  const time = Date.now() * 0.002;

  for (let i = 0; i < windCount; i++) {
    const yOffset = ((i * 12 + time * 40) % (h * 0.85)) + h * 0.08;
    const progress = ((time * (peakWind / 25) + i * 0.15) % 1);

    // Bezier-Stromlinie von links nach rechts über den Berg
    const startX = 20;
    const endX = w - 20;
    const curX = startX + progress * (endX - startX);

    // Wind wird am Gipfel angehoben und komprimiert
    const distToPeak = Math.abs(curX - px);
    const lift = Math.max(0, 1 - distToPeak / (w * 0.42)) * 65;
    const curY = yOffset - lift;

    // Geschwindigkeits-Farbgradient (Tal grün, Gipfel rot/orange)
    let color = '#22c55e';
    if (lift > 45) color = '#ef4444';
    else if (lift > 20) color = '#f59e0b';

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(curX, curY, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lee-Verwirbelungen auf der rechten Seite
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.ellipse(w * 0.72, yPeak + 75, 45, 20, 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#f87171';
  ctx.font = '600 11px system-ui';
  ctx.fillText('💨 Lee-Verwirbelungen & Abwinde', w * 0.65, yPeak + 115);
}

/**
 * Zeichnet animierte 3D-Windstromlinien
 */
function renderWindStreamlines(ctx, w, h, px, py, lx, ly, rx, ry, cy) {
  ctx.save();
  ctx.lineWidth = 1.8;
  const streamCount = 14;
  const t = Date.now() * 0.0018;

  for (let i = 0; i < streamCount; i++) {
    const p = (t + i / streamCount) % 1;
    const sx = lx - 40 + p * (rx - lx + 80);
    const distToPeak = Math.abs(sx - px);
    const lift = Math.max(0, 1 - distToPeak / (w * 0.45)) * 55;
    const sy = ly - (p * (ly - py) * 0.9) - lift;

    ctx.strokeStyle = `rgba(100, 210, 255, ${Math.sin(p * Math.PI) * 0.6})`;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 16, sy + 3);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Kontinuierliche Animationsschleife für Schneefall, Regen & Wolkendrift
 */
function startMountain3DAnimation() {
  function loop() {
    state.mountain3D.cloudDrift = ((state.mountain3D.cloudDrift || 0) + 0.35);

    // Rendere Frame nur wenn der Berg-Tab aktiv ist und Bergmodus gewählt ist
    const tabMountain = document.getElementById('tab-mountain');
    if (tabMountain && tabMountain.classList.contains('active') && state.currentLocation && state.currentLocation.isMountain) {
      drawMountain3DCanvas();
    }

    state.mountain3D.animFrame = requestAnimationFrame(loop);
  }

  if (state.mountain3D.animFrame) cancelAnimationFrame(state.mountain3D.animFrame);
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
function setupMountain3DControls() {
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
function renderAltitudeHoursScroller() {
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
function selectAltitudeHour(hourIndex, shouldScroll = true) {
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
function setupAltitudeTimeControls() {
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
function setupAltitudeSlider() {
  setupAltitudeTimeControls();
}

function updateAltitudeSliderLabel() {
  selectAltitudeHour(state.selectedAltitudeHour, false);
}

// =============================================================================
// TAB 3: LIVE-MAP & RADAR
// =============================================================================
// =============================================================================
// TAB 3: LIVE-MAP & RADAR (OSM BASISKARTE & METEOROLOGISCHE OVERLAYS)
// =============================================================================

const BASE_LAYERS = {
  'osm-standard': {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '© OpenStreetMap contributors'
    },
    isDark: false
  },
  'osm-outdoor': {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    options: {
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '© OpenStreetMap contributors, Humanitarian Relief Style'
    },
    isDark: false
  },
  'osm-dark': {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '© OpenStreetMap contributors'
    },
    isDark: true
  },
  'satellite': {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxNativeZoom: 18,
      maxZoom: 20,
      attribution: '© Esri World Imagery'
    },
    isDark: false
  }
};

const REGIONAL_STATIONS = [
  { name: 'München', lat: 48.137, lon: 11.581, elevation: 520, isMountain: false },
  { name: 'Zugspitze', lat: 47.421, lon: 10.985, elevation: 2962, isMountain: true },
  { name: 'Garmisch-Partenk.', lat: 47.491, lon: 11.095, elevation: 708, isMountain: false },
  { name: 'Innsbruck', lat: 47.269, lon: 11.404, elevation: 574, isMountain: false },
  { name: 'Kitzbühel', lat: 47.446, lon: 12.392, elevation: 762, isMountain: false },
  { name: 'Großglockner', lat: 47.074, lon: 12.694, elevation: 3798, isMountain: true },
  { name: 'Salzburg', lat: 47.809, lon: 13.055, elevation: 424, isMountain: false },
  { name: 'Nebelhorn', lat: 47.421, lon: 10.345, elevation: 2224, isMountain: true },
  { name: 'Oberstdorf', lat: 47.408, lon: 10.279, elevation: 813, isMountain: false },
  { name: 'Matterhorn', lat: 45.976, lon: 7.749, elevation: 4478, isMountain: true },
  { name: 'Zermatt', lat: 46.020, lon: 7.749, elevation: 1620, isMountain: false },
  { name: 'Mont Blanc', lat: 45.832, lon: 6.865, elevation: 4808, isMountain: true },
  { name: 'Feldberg', lat: 47.874, lon: 8.004, elevation: 1493, isMountain: true },
  { name: 'Zürich', lat: 47.376, lon: 8.541, elevation: 408, isMountain: false },
  { name: 'St. Moritz', lat: 46.498, lon: 9.839, elevation: 1822, isMountain: true },
  { name: 'Bozen', lat: 46.498, lon: 11.354, elevation: 262, isMountain: false },
  { name: 'Watzmann', lat: 47.554, lon: 12.921, elevation: 2713, isMountain: true },
  { name: 'Stuttgart', lat: 48.775, lon: 9.182, elevation: 245, isMountain: false },
  { name: 'Nürnberg', lat: 49.452, lon: 11.076, elevation: 309, isMountain: false },
  { name: 'Frankfurt', lat: 50.110, lon: 8.682, elevation: 112, isMountain: false },
  { name: 'Wien', lat: 48.208, lon: 16.373, elevation: 171, isMountain: false }
];

function initLeafletMap() {
  const mapElem = document.getElementById('interactive-map');
  if (!mapElem) return;

  // 1. Initialisiere Leaflet mit voller Zoomunterstützung (bis Stufe 20)
  state.map.instance = L.map('interactive-map', {
    zoomControl: true,
    attributionControl: false,
    maxZoom: 20
  }).setView([state.currentLocation.lat, state.currentLocation.lon], 9);

  // 2. Erstelle Layer-Gruppen für Zukunftsradar & Marker
  state.map.futureRadarLayerGroup = L.layerGroup().addTo(state.map.instance);
  state.map.weatherLayerGroup = L.layerGroup().addTo(state.map.instance);

  // 3. Setze Standard-Basiskarte (Topo / Outdoor für perfekten Alpen- & Landschaftskontrast)
  state.map.activeBase = 'osm-outdoor';
  setMapBaseLayer('osm-outdoor');

  // 4. Eigener Standort-Marker (blau/hervorgehoben)
  state.map.marker = L.marker([state.currentLocation.lat, state.currentLocation.lon], { zIndexOffset: 2000 })
    .addTo(state.map.instance)
    .bindPopup(`<b>${state.currentLocation.name}</b><br>${state.currentLocation.elevation} m`)
    .openPopup();

  // 5. Klick auf beliebigen Punkt auf der Karte berechnet exakte Geländehöhe & lädt Standort
  state.map.instance.on('click', async (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    
    let elev = 500;
    try {
      const elRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`);
      const elData = await elRes.json();
      if (elData.elevation && elData.elevation[0] !== undefined) {
        elev = Math.round(elData.elevation[0]);
      }
    } catch(err) {
      console.warn('Elevation fetch failed for map click', err);
    }

    const isMtn = elev >= 1100;
    selectExactLocation({
      name: `${isMtn ? 'Bergpunkt' : 'Kartenpunkt'} (${elev} m)`,
      lat: lat,
      lon: lon,
      elevation: elev,
      country: '',
      isMountain: isMtn
    });
  });

  // 6. Event-Listener für Basiskarten-Buttons (OSM)
  document.querySelectorAll('.map-base-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-base-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setMapBaseLayer(btn.dataset.base);
    });
  });

  // 7. Event-Listener für Wetter-Overlay-Buttons
  document.querySelectorAll('.map-overlay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-overlay-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setMapOverlay(btn.dataset.overlay);
    });
  });

  // 8. Stationen Ein-/Ausblenden Toggle
  const stationsToggleBtn = document.getElementById('stations-toggle-btn');
  if (stationsToggleBtn) {
    stationsToggleBtn.addEventListener('click', () => {
      state.map.showStations = !state.map.showStations;
      stationsToggleBtn.innerText = state.map.showStations ? '🏷️ Stationen: An' : '🏷️ Stationen: Aus';
      stationsToggleBtn.classList.toggle('active', state.map.showStations);
      updateWeatherOverlay();
    });
  }

  // 9. Initialisiere Zukunfts-Radar Steuerungs-Elemente (Slider, Play, Jump, Speed)
  setupUnifiedRadarControls();

  // 10. Lade 24h-Radar Engine & Wetterdaten für Stationen
  state.map.activeOverlay = 'precip';
  loadUnifiedRadarEngine();
  updateWeatherOverlay();

  // Fenster-Resize-Handling für responsive Anpassung (Canvas, Map, 3D-Mountain)
  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    if (state.map.activeOverlay === 'wind') {
      const wDir = state.currentWeather ? state.currentWeather.wind_direction_10m : 240;
      const wSpd = state.currentWeather ? state.currentWeather.wind_speed_10m : 20;
      startWindCanvas(wDir, wSpd);
    }
    if (resizeDebounce) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (state.activeTab === 'tab-mountain') {
        drawMountain3DCanvas();
      } else if (state.activeTab === 'tab-map' && state.map.instance) {
        state.map.instance.invalidateSize();
      }
    }, 100);
  });
}

/**
 * Wechselt die Basiskarte (OSM Standard, OSM Topo/Outdoor, OSM Dunkel, Satellit)
 * Garantiert maxZoom 20 ohne 'Zoom level not supported' Kacheln
 */
function setMapBaseLayer(baseKey) {
  const conf = BASE_LAYERS[baseKey] || BASE_LAYERS['osm-outdoor'];
  state.map.activeBase = baseKey;

  if (state.map.baseTileLayer) {
    state.map.instance.removeLayer(state.map.baseTileLayer);
  }

  const mapElem = document.getElementById('interactive-map');
  if (mapElem) {
    if (conf.isDark) {
      mapElem.classList.add('osm-dark-tiles');
    } else {
      mapElem.classList.remove('osm-dark-tiles');
    }
  }

  state.map.baseTileLayer = L.tileLayer(conf.url, conf.options).addTo(state.map.instance);
}

/**
 * Schaltet das aktive meteorologische Overlay um (24h Radar, Wind, Blitze, Bewölkung, Temp, Druck)
 */
function setMapOverlay(overlayKey) {
  state.map.activeOverlay = overlayKey;
  updateWeatherOverlay();
}

/**
 * Lädt regionale Wetterstationen in einem einzigen Batch-Aufruf von Open-Meteo
 */
async function loadRegionalStationWeather() {
  if (state.map.regionalStationsData) return state.map.regionalStationsData;

  const lats = REGIONAL_STATIONS.map(s => s.lat.toFixed(3)).join(',');
  const lons = REGIONAL_STATIONS.map(s => s.lon.toFixed(3)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const stationResults = Array.isArray(data) ? data : [data];

    state.map.regionalStationsData = REGIONAL_STATIONS.map((station, i) => {
      const weather = stationResults[i] ? (stationResults[i].current || {}) : {};
      return {
        ...station,
        weather
      };
    });
    return state.map.regionalStationsData;
  } catch (err) {
    console.warn('Regional weather batch fetch failed:', err);
    return [];
  }
}

/**
 * Rendert das aktive Wetter-Overlay über der OSM-Karte
 */
async function updateWeatherOverlay() {
  if (!state.map.instance || !state.map.weatherLayerGroup) return;

  const overlay = state.map.activeOverlay;
  const stations = await loadRegionalStationWeather();
  state.map.weatherLayerGroup.clearLayers();

  const radarControls = document.getElementById('radar-floating-controls');
  const legendTitle = document.getElementById('map-legend-title');
  const legendBar = document.getElementById('map-legend-bar');
  const legendLabels = document.getElementById('map-legend-labels');
  const thunderAlert = document.getElementById('thunderstorm-alert-box');

  if (thunderAlert && overlay !== 'lightning') {
    thunderAlert.style.display = 'none';
  }

  // 1. NIEDERSCHLAG & SCHNEE / 24H RADAR & DOPPLER LIVE-FILM
  if (overlay === 'precip' || overlay === 'rainviewer-radar') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'flex';
    if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
      showUnifiedRadarFrame(state.map.radarIndex);
    }

    if (legendTitle) legendTitle.innerText = '📡 48h Niederschlags- & Schneefilm (Radar & Prognose):';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #38bdf8, #22c55e, #eab308, #ef4444, #c084fc, #ffffff)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#78d6ff;">Leichter Regen</span>
        <span style="color:#ffd166;">Starkregen</span>
        <span style="color:#f5d0fe;">Schneefall (Alpin)</span>
      `;
    }

    // Nur bei eingeschaltetem Stationen-Toggle rendern, damit die Karte 100% frei bleibt!
    if (state.map.showStations) {
      for (const st of stations) {
        const w = st.weather || {};
        const t = w.temperature_2m !== undefined ? w.temperature_2m : 8;
        const precip = w.precipitation !== undefined ? w.precipitation : 0;
        const snow = w.snowfall !== undefined ? w.snowfall : 0;
        const isFreezing = t <= 1.0;

        let iconTag = '💧';
        let valText = 'Trocken';
        if (isFreezing && (snow > 0 || (w.weather_code >= 71 && w.weather_code <= 86))) {
          iconTag = '❄️';
          valText = snow > 0 ? `${snow.toFixed(1)}cm` : 'Schnee';
        } else if (isFreezing) {
          iconTag = '❄️';
          valText = `${t.toFixed(0)}°C`;
        } else if (precip > 0) {
          iconTag = '🌧️';
          valText = `${precip.toFixed(1)}mm`;
        }

        const badgeHtml = `
          <div class="station-mini-chip">
            <span>${iconTag}</span>
            <span class="smc-name">${st.name}</span>
            <span class="smc-val">${valText}</span>
          </div>
        `;
        const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [35, 10] });
        const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
        m.on('click', () => selectExactLocation(st));
      }
    }
  }

  // 1b. INFRAROT SATELLITEN-FILM
  else if (overlay === 'rainviewer-sat') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'flex';
    if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();

    if (legendTitle) legendTitle.innerText = '🛰️ RainViewer Infrarot Satellitenfilm (Wolken & Konvektion):';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #1e293b, #475569, #94a3b8, #ffffff, #64d2ff)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#94a3b8;">Wolkenlos / Warm</span>
        <span style="color:#ffffff;">Dichte Bewölkung</span>
        <span style="color:#64d2ff;">Hohe Eiswolken / Cb</span>
      `;
    }
  }

  // 1c. ECHTZEIT-BLITZORTUNG & GEWITTER-FRÜHWARNSYSTEM
  else if (overlay === 'lightning') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
      state.map.radarTileLayer = null;
    }
    if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();

    if (legendTitle) legendTitle.innerText = '⚡ Live-Blitzortung & Gewitter-Tracker (Alpenraum):';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #ff3b30, #ff9500, #ffd166, #64d2ff)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#ff3b30;">🚨 < 5 Min. (Frisch)</span>
        <span style="color:#ff9500;">⚡ 5–15 Min.</span>
        <span style="color:#ffd166;">⚡ 15–30 Min.</span>
        <span style="color:#64d2ff;">⚡ > 30 Min.</span>
      `;
    }

    const storm = MicroEngine.computeLightningActivity(
      state.currentLocation.lat,
      state.currentLocation.lon,
      state.weatherData
    );

    // Aktualisiere Floating Alert Box
    if (thunderAlert) {
      const threatElem = document.getElementById('tab-threat-level');
      const distElem = document.getElementById('tab-dist-val');
      const delayElem = document.getElementById('tab-delay-val');
      const etaElem = document.getElementById('tab-eta-val');
      const adviceElem = document.getElementById('tab-advice');
      const closeBtn = document.getElementById('tab-close-btn');

      if (threatElem) threatElem.innerText = storm.threatLevel;
      if (distElem) distElem.innerText = `${storm.closestStrikeKm} km`;
      if (delayElem) delayElem.innerText = `${storm.soundDelaySeconds} Sek. (${Math.round(storm.soundDelaySeconds / 3)} km)`;
      if (etaElem) etaElem.innerText = `ca. ${storm.estimatedArrivalMin} Min.`;
      if (adviceElem) {
        adviceElem.innerText = storm.closestStrikeKm < 15
          ? '⚠️ Grate, Gipfelkreuze, Klettersteige und freie Flächen SOFORT verlassen!'
          : `ℹ️ Gewitter-Zugbahn: ${storm.stormTracking}. Schutzhütten anvisieren.`;
      }
      if (closeBtn) {
        closeBtn.onclick = () => {
          thunderAlert.style.display = 'none';
        };
      }
      thunderAlert.style.display = 'block';
    }

    // Zeichne Warnradius um den aktuellen Standort
    L.circle([state.currentLocation.lat, state.currentLocation.lon], {
      radius: 12000,
      color: '#ff453a',
      fillColor: '#ff453a',
      fillOpacity: 0.08,
      weight: 1.5,
      dashArray: '4, 4'
    }).addTo(state.map.weatherLayerGroup);

    // Zeichne Live-Blitze mit pulsierendem Marker
    for (const s of storm.strikes) {
      let color = '#64d2ff';
      if (s.ageMinutes < 5) color = '#ff3b30';
      else if (s.ageMinutes < 15) color = '#ff9500';
      else if (s.ageMinutes < 30) color = '#ffd166';

      const icon = L.divIcon({
        className: 'custom-lightning-icon',
        html: `<div class="lightning-marker" style="background:${color}; box-shadow:0 0 12px ${color};">⚡</div>`,
        iconAnchor: [12, 12]
      });

      const m = L.marker([s.lat, s.lon], { icon }).addTo(state.map.weatherLayerGroup);
      m.bindPopup(`
        <div style="font-family:sans-serif; color:#0f172a; padding:4px;">
          <strong style="color:${color}; font-size:13px;">⚡ Blitzentladung</strong><br>
          <b>Typ:</b> ${s.type}<br>
          <b>Stromstärke:</b> ${s.intensityKa} kA<br>
          <b>Alter:</b> vor ${s.ageMinutes} Min.<br>
          <b>Distanz zum Standort:</b> ${s.distKm} km
        </div>
      `);
    }
  }

  // 2. WIND & STRÖMUNGSFELD
  else if (overlay === 'wind') {
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
      state.map.radarTileLayer = null;
    }
    if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();

    if (legendTitle) legendTitle.innerText = '💨 Windströmung & Spitzenböen:';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #30d158, #ffd166, #ff9f0a, #ff453a, #bf5af2)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#30d158;">< 15 km/h</span>
        <span style="color:#ffd166;">30 km/h</span>
        <span style="color:#ff9f0a;">55 km/h</span>
        <span style="color:#ff453a;">> 75 km/h Sturm</span>
      `;
    }

    // Starte Canvas-Strömungsanimation basierend auf aktuellem Wind
    const curWDir = state.currentWeather ? (state.currentWeather.wind_direction_10m || 240) : 240;
    const curWSpd = state.currentWeather ? (state.currentWeather.wind_speed_10m || 20) : 20;
    startWindCanvas(curWDir, curWSpd);

    if (state.map.showStations) {
      for (const st of stations) {
        const w = st.weather || {};
        const spd = Math.round(w.wind_speed_10m || 0);
        const gust = Math.round(w.wind_gusts_10m || spd * 1.35);
        const dir = Math.round(w.wind_direction_10m || 0);

        let color = '#30d158';
        if (gust >= 65) color = '#ff453a';
        else if (gust >= 45) color = '#ff9f0a';
        else if (gust >= 25) color = '#ffd166';

        const badgeHtml = `
          <div class="station-mini-chip" style="border-color:${color};">
            <span style="transform: rotate(${dir}deg); display:inline-block; color:${color}; font-weight:800;">↑</span>
            <span class="smc-name">${st.name}</span>
            <span class="smc-val" style="color:${color};">${spd} <small>(${gust})</small></span>
          </div>
        `;

        const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [45, 10] });
        const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
        m.on('click', () => selectExactLocation(st));
      }
    }
  }

  // 3. BEWÖLKUNGSGRAD & WOLKENBEDECKUNG
  else if (overlay === 'clouds') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
      state.map.radarTileLayer = null;
    }
    if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();

    if (legendTitle) legendTitle.innerText = '☁️ Bewölkungsgrad (Wolkenbedeckung):';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #ffd166, #94a3b8, #475569, #1e293b)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#ffd166;">0% Wolkenlos</span>
        <span style="color:#cbd5e1;">50% Heiter</span>
        <span style="color:#94a3b8;">100% Bedeckt</span>
      `;
    }

    for (const st of stations) {
      const w = st.weather || {};
      const cloud = w.cloud_cover !== undefined ? Math.round(w.cloud_cover) : 50;
      const cIcon = cloud <= 15 ? '☀️' : (cloud <= 65 ? '⛅' : '☁️');

      // Zeichne weiche Wolkenschatten-Zonen
      L.circle([st.lat, st.lon], {
        radius: 35000,
        fillColor: '#ffffff',
        fillOpacity: (cloud / 100) * 0.35,
        stroke: false
      }).addTo(state.map.weatherLayerGroup);

      if (state.map.showStations) {
        const badgeHtml = `
          <div class="station-mini-chip">
            <span>${cIcon}</span>
            <span class="smc-name">${st.name}</span>
            <span class="smc-val">${cloud}%</span>
          </div>
        `;
        const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [35, 10] });
        const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
        m.on('click', () => selectExactLocation(st));
      }
    }
  }

  // 4. TEMPERATUR-FELD & FROSTGRENZE
  else if (overlay === 'temp') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
      state.map.radarTileLayer = null;
    }
    if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();

    if (legendTitle) legendTitle.innerText = '🌡️ Temperatur-Feld (Höhe vs. Tal):';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #64d2ff, #30d158, #ffd166, #ff9f0a, #ff453a)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#64d2ff;">< 0°C Frost</span>
        <span style="color:#30d158;">8°C</span>
        <span style="color:#ffd166;">15°C</span>
        <span style="color:#ff453a;">> 20°C Warm</span>
      `;
    }

    if (state.map.showStations) {
      for (const st of stations) {
        const w = st.weather || {};
        const t = w.temperature_2m !== undefined ? Math.round(convertTemp(w.temperature_2m)) : '--';

        let tColor = '#ffd166';
        if (t < 0) tColor = '#64d2ff';
        else if (t < 10) tColor = '#30d158';
        else if (t >= 20) tColor = '#ff453a';

        const badgeHtml = `
          <div class="station-mini-chip" style="border-color:${tColor};">
            <span class="smc-name">${st.name} <small style="color:var(--text-tertiary);">(${st.elevation}m)</small></span>
            <span class="smc-val" style="color:${tColor};">${t > 0 ? `+${t}` : t}°C</span>
          </div>
        `;

        const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [45, 10] });
        const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
        m.on('click', () => selectExactLocation(st));
      }
    }
  }

  // 5. LUFTDRUCK QNH & ISOBAREN
  else if (overlay === 'pressure') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
      state.map.radarTileLayer = null;
    }
    if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();

    if (legendTitle) legendTitle.innerText = '⏲️ Luftdruck QNH (Meereshöhe):';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #93c5fd, #a78bfa, #c084fc)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#93c5fd;">< 1010 hPa Tief (T)</span>
        <span style="color:#a78bfa;">1015 hPa</span>
        <span style="color:#30d158;">> 1020 hPa Hoch (H)</span>
      `;
    }

    if (state.map.showStations) {
      for (const st of stations) {
        const w = st.weather || {};
        const p = Math.round(w.pressure_msl || 1013);
        const isHigh = p >= 1018;

        const badgeHtml = `
          <div class="station-mini-chip">
            <span class="smc-name">${st.name}</span>
            <span class="smc-val">${p} hPa <b style="color:${isHigh ? '#30d158' : '#93c5fd'};">${isHigh ? 'H' : 'T'}</b></span>
          </div>
        `;

        const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [40, 10] });
        const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
        m.on('click', () => selectExactLocation(st));
      }
    }
  }
}

/**
 * Animiertes Windströmungs-Canvas für die Leaflet-Karte
 */
function startWindCanvas(windDirDeg, windSpeedKm) {
  const canvas = document.getElementById('wind-flow-canvas');
  if (!canvas) return;
  canvas.style.display = 'block';

  const mapElem = document.getElementById('interactive-map');
  const width = mapElem.clientWidth || 800;
  const height = mapElem.clientHeight || 580;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  
  // Windrichtung: Richtung, in die der Wind bläst
  const angleRad = ((windDirDeg + 180) % 360) * (Math.PI / 180);
  const speed = Math.max(1.2, Math.min(7.0, (windSpeedKm || 20) / 10));
  const vx = Math.cos(angleRad) * speed;
  const vy = Math.sin(angleRad) * speed;

  const numParticles = 65;
  const particles = [];
  for (let i = 0; i < numParticles; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      len: 14 + Math.random() * 20,
      age: Math.random() * 80,
      maxAge: 60 + Math.random() * 60,
      opacity: 0.15 + Math.random() * 0.45
    });
  }

  function renderWind() {
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2.2;

    for (let p of particles) {
      p.x += vx;
      p.y += vy;
      p.age++;

      if (p.x < -30) p.x = width + 30;
      if (p.x > width + 30) p.x = -30;
      if (p.y < -30) p.y = height + 30;
      if (p.y > height + 30) p.y = -30;
      if (p.age > p.maxAge) {
        p.x = Math.random() * width;
        p.y = Math.random() * height;
        p.age = 0;
      }

      const lifeRatio = p.age / p.maxAge;
      const alpha = Math.sin(lifeRatio * Math.PI) * p.opacity;

      ctx.beginPath();
      ctx.strokeStyle = `rgba(100, 210, 255, ${Math.max(0, alpha).toFixed(2)})`;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - vx * (p.len / speed), p.y - vy * (p.len / speed));
      ctx.stroke();
    }

    state.map.windAnimFrame = requestAnimationFrame(renderWind);
  }

  if (state.map.windAnimFrame) cancelAnimationFrame(state.map.windAnimFrame);
  renderWind();
}

function stopWindCanvas() {
  if (state.map.windAnimFrame) {
    cancelAnimationFrame(state.map.windAnimFrame);
    state.map.windAnimFrame = null;
  }
  const canvas = document.getElementById('wind-flow-canvas');
  if (canvas) {
    canvas.style.display = 'none';
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

/**
 * ============================================================================
 * 24H HOCHAUFLÖSENDE ZUKUNFTS- & DOPPLER-RADAR ENGINE
 * ============================================================================
 * Verschmilzt hochauflösendes RainViewer Doppler-Radar (-2h bis jetzt)
 * mit 24h-36h ICON & ECMWF Multi-Location Niederschlags- & Schneeprognose.
 */
async function loadUnifiedRadarEngine() {
  try {
    // 1. RainViewer Doppler-Radar (Vergangenheit bis jetzt)
    const rvPromise = fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(res => res.json())
      .catch(e => {
        console.warn('RainViewer API nicht erreichbar:', e);
        return null;
      });

    // 2. 48h Open-Meteo Niederschlags- & Schneeprognose für 21 alpine Stationen (DWD ICON & ECMWF)
    const forecastPromise = MicroEngine.fetch48hRadarForecast
      ? MicroEngine.fetch48hRadarForecast(REGIONAL_STATIONS)
      : MicroEngine.fetch24hRadarForecast(REGIONAL_STATIONS);

    const [rvData, forecastFrames] = await Promise.all([rvPromise, forecastPromise]);

    const unifiedFrames = [];

    // Baue Vergangenheits-Frames von RainViewer auf (-2h bis 0m)
    if (rvData && rvData.radar) {
      state.map.radarHost = rvData.host || 'https://tilecache.rainviewer.com';
      const pastList = rvData.radar.past || [];
      const nowcastList = rvData.radar.nowcast || [];

      pastList.forEach((f, i) => {
        const diffM = Math.round((Date.now() - f.time * 1000) / 60000);
        unifiedFrames.push({
          type: 'past',
          time: f.time,
          path: f.path,
          timestampMs: f.time * 1000,
          label: i === pastList.length - 1 ? '🔴 Live-Scan' : `Vor ${diffM} Min.`,
          isLive: i === pastList.length - 1 && nowcastList.length === 0
        });
      });

      if (nowcastList.length > 0) {
        const liveF = nowcastList[0];
        unifiedFrames.push({
          type: 'past',
          time: liveF.time,
          path: liveF.path,
          timestampMs: liveF.time * 1000,
          label: '🔴 Live-Scan',
          isLive: true
        });
      }
    }

    // Fallback falls RainViewer kurzzeitig nicht antwortet
    if (unifiedFrames.length === 0) {
      unifiedFrames.push({
        type: 'past',
        time: Math.floor(Date.now() / 1000),
        path: '',
        timestampMs: Date.now(),
        label: '🔴 Live-Scan',
        isLive: true
      });
    }

    const liveIdx = unifiedFrames.length - 1;
    unifiedFrames[liveIdx].isLive = true;

    // Baue 48h Zukunfts-Frames auf (+1h bis +48h mit Zwischenschritten)
    if (forecastFrames && Array.isArray(forecastFrames)) {
      forecastFrames.forEach(ff => {
        if (ff.hoursFromNow > 0 && ff.hoursFromNow <= 48) {
          unifiedFrames.push({
            type: 'future',
            hoursFromNow: ff.hoursFromNow,
            timestampMs: ff.timestampMs,
            timeStr: ff.time,
            label: `+${ff.hoursFromNow} Std. Prognose`,
            hasPrecipitation: ff.hasPrecipitation,
            maxPrecipMm: ff.maxPrecipMm,
            cells: ff.cells || []
          });
        }
      });
    }

    state.map.unifiedRadarFrames = unifiedFrames;
    state.map.liveRadarIndex = liveIdx;

    // Konfiguriere Timeline-Slider
    const slider = document.getElementById('radar-time-slider');
    if (slider) {
      slider.min = 0;
      slider.max = Math.max(0, unifiedFrames.length - 1);
      slider.value = liveIdx;
    }

    // Starte standardmäßig auf Live-Scan
    showUnifiedRadarFrame(liveIdx);

    // Feature 4A: Preload Radar-Frames in Frame-Buffer für verzögerungsfreie 60-FPS Wiedergabe
    preloadRadarFrames(unifiedFrames, state.map.radarHost);

  } catch (err) {
    console.error('Fehler beim Initialisieren der 24h-Radar-Engine:', err);
  }
}

/**
 * FEATURE 4A: Hardware-beschleunigter Frame-Buffer (Image Preloader)
 */
function preloadRadarFrames(frames, host) {
  if (!frames || !host) return;
  frames.forEach(f => {
    if (f.type === 'past' && f.path) {
      const colorScheme = 8;
      const zoom = Math.min(7, (state.map.instance && state.map.instance.getZoom()) || 7);
      const lat = state.currentLocation.lat;
      const lon = state.currentLocation.lon;
      const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
      const latRad = lat * Math.PI / 180;
      const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));
      
      const img = new Image();
      img.src = `${host}${f.path}/256/${zoom}/${x}/${y}/${colorScheme}/1_1.png`;
      if (state.map.radarImageBuffer) {
        state.map.radarImageBuffer.set(f.path, img);
      }
    }
  });
}

/**
 * Rendert hochauflösende Zukunfts-Niederschlags- & Schneezellen über den Alpen
 */
function renderFutureRadarCells(frame) {
  if (!state.map.futureRadarLayerGroup) return;
  state.map.futureRadarLayerGroup.clearLayers();

  if (!frame || !frame.cells || frame.cells.length === 0) {
    return;
  }

  frame.cells.forEach(cell => {
    const lat = cell.lat;
    const lon = cell.lon;
    const isSnow = cell.isSnow;
    const p = cell.precipMm || 0;
    const s = cell.snowCm || 0;

    if (isSnow) {
      // SCHNEE-ECHO (Alpin violett / eisblau / schneeweiß)
      // 1. Großes weiches Niederschlagsfeld
      L.circle([lat, lon], {
        radius: 38000,
        fillColor: '#c084fc',
        fillOpacity: 0.32,
        stroke: false
      }).addTo(state.map.futureRadarLayerGroup);

      // 2. Mittlerer Schneekern
      L.circle([lat, lon], {
        radius: 20000,
        fillColor: '#e879f9',
        fillOpacity: 0.52,
        stroke: false
      }).addTo(state.map.futureRadarLayerGroup);

      // 3. Intensives Schneezentrum
      if (s >= 1.5 || p >= 2.0) {
        L.circle([lat, lon], {
          radius: 10000,
          fillColor: '#ffffff',
          fillOpacity: 0.75,
          stroke: false
        }).addTo(state.map.futureRadarLayerGroup);
      }
    } else {
      // REGEN-ECHO (Farbskala: Cyan -> Grün -> Gelb -> Rot je nach mm/h)
      if (p >= 5.0) {
        // Starkregen / Konvektion
        L.circle([lat, lon], { radius: 46000, fillColor: '#22c55e', fillOpacity: 0.35, stroke: false }).addTo(state.map.futureRadarLayerGroup);
        L.circle([lat, lon], { radius: 26000, fillColor: '#eab308', fillOpacity: 0.55, stroke: false }).addTo(state.map.futureRadarLayerGroup);
        L.circle([lat, lon], { radius: 12000, fillColor: '#ef4444', fillOpacity: 0.75, stroke: false }).addTo(state.map.futureRadarLayerGroup);
      } else if (p >= 1.5) {
        // Mäßiger Regen
        L.circle([lat, lon], { radius: 40000, fillColor: '#38bdf8', fillOpacity: 0.38, stroke: false }).addTo(state.map.futureRadarLayerGroup);
        L.circle([lat, lon], { radius: 20000, fillColor: '#22c55e', fillOpacity: 0.55, stroke: false }).addTo(state.map.futureRadarLayerGroup);
      } else {
        // Leichter Regen / Schauer
        L.circle([lat, lon], { radius: 32000, fillColor: '#38bdf8', fillOpacity: 0.40, stroke: false }).addTo(state.map.futureRadarLayerGroup);
      }
    }

    // Interaktiver Echo-Marker mit Tooltip
    const dot = L.circleMarker([lat, lon], {
      radius: 5,
      fillColor: isSnow ? '#f5d0fe' : '#7dd3fc',
      color: '#ffffff',
      weight: 1.5,
      fillOpacity: 0.95
    }).addTo(state.map.futureRadarLayerGroup);

    const infoText = isSnow
      ? `❄️ <strong>${cell.name} (+${frame.hoursFromNow}h)</strong><br>Schneefall: <b>${s > 0 ? s : (p * 0.9).toFixed(1)} cm/h</b> (${cell.temperature}°C)`
      : `🌧️ <strong>${cell.name} (+${frame.hoursFromNow}h)</strong><br>Regen: <b>${p} mm/h</b> (${cell.temperature}°C)`;

    dot.bindTooltip(infoText, { direction: 'top', offset: [0, -6], className: 'radar-cell-tooltip' });
  });
}

/**
 * Zeigt einen bestimmten Frame aus der kombinierten Timeline an
 */
function showUnifiedRadarFrame(idx) {
  const frames = state.map.unifiedRadarFrames;
  if (!frames || frames.length === 0) return;

  // Clamping
  if (idx < 0) idx = 0;
  if (idx >= frames.length) idx = frames.length - 1;
  state.map.radarIndex = idx;

  const frame = frames[idx];
  const slider = document.getElementById('radar-time-slider');
  if (slider) slider.value = idx;

  updateJumpButtonsActive(idx);

  // Feature 4B: Kontrast-Modus der Basiskarte bei Niederschlag / Doppler-Aktivität
  const mapElem = document.getElementById('interactive-map');
  if (mapElem) {
    const isPrecipActive = (frame.type === 'future' && (frame.hasPrecipitation || frame.maxPrecipMm > 0.4)) ||
                           (frame.type === 'past' && !!frame.path);
    mapElem.classList.toggle('radar-contrast-mode', isPrecipActive);
  }

  const modeChip = document.getElementById('radar-mode-chip');
  const timeDisplay = document.getElementById('radar-time-display');

  if (frame.type === 'past') {
    // 1. RainViewer Doppler Radar Tile Frame
    if (state.map.futureRadarLayerGroup) {
      state.map.futureRadarLayerGroup.clearLayers();
    }

    if (state.map.radarTileLayer) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
    }

    if (frame.path && state.map.radarHost) {
      const colorScheme = 8; // HD Doppler (Regen & Schnee)
      const url = `${state.map.radarHost}${frame.path}/256/{z}/{x}/{y}/${colorScheme}/1_1.png`;
      state.map.radarTileLayer = L.tileLayer(url, {
        opacity: 0.82,
        zIndex: 250,
        maxNativeZoom: 7, // RainViewer Free API Zoom Cap: Leaflet skaliert Stufe 7 verlustfrei hoch und verhindert "Zoom Level Not Supported"
        maxZoom: 20,
        tileSize: 256,
        errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      }).addTo(state.map.instance);
    }

    const t = new Date(frame.timestampMs);
    const diffMinutes = Math.round((Date.now() - t.getTime()) / 60000);
    const relStr = frame.isLive || Math.abs(diffMinutes) <= 4 ? '🔴 Live-Scan' : `Vor ${diffMinutes} Min.`;

    if (modeChip) {
      modeChip.innerText = frame.isLive ? '🔴 Live Doppler-Radar' : '⏪ Radar-Historie';
      modeChip.style.background = frame.isLive ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.2)';
      modeChip.style.borderColor = frame.isLive ? '#ef4444' : '#38bdf8';
    }

    if (timeDisplay) {
      timeDisplay.innerText = `${t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr (${relStr}) • RainViewer HD Radar`;
    }

  } else if (frame.type === 'future') {
    // 2. Future 24h Forecast Radar (DWD ICON & ECMWF)
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
      state.map.radarTileLayer = null;
    }

    renderFutureRadarCells(frame);

    const t = new Date(frame.timestampMs);
    const dayStr = t.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const timeStr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    if (modeChip) {
      modeChip.innerText = `🔮 +${frame.hoursFromNow}h Prognose-Radar`;
      modeChip.style.background = 'rgba(168, 85, 247, 0.25)';
      modeChip.style.borderColor = '#c084fc';
    }

    if (timeDisplay) {
      const cellCount = frame.cells ? frame.cells.length : 0;
      const precipSummary = cellCount > 0
        ? `Niederschlag in ${cellCount} Regionen (max ${frame.maxPrecipMm} mm/h)`
        : 'Großräumig trocken';
      timeDisplay.innerText = `${dayStr}, ${timeStr} Uhr (+${frame.hoursFromNow}h) • ${precipSummary}`;
    }
  }
}

/**
 * Richtet alle Transport- & Schnellsprung-Buttons für das 24h-Radar ein
 */
function setupUnifiedRadarControls() {
  const slider = document.getElementById('radar-time-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      stopRadarAnimation();
      showUnifiedRadarFrame(parseInt(e.target.value, 10));
    });
  }

  const toggleBtn = document.getElementById('radar-player-toggle-btn');
  const player = document.getElementById('radar-floating-controls');
  if (toggleBtn && player) {
    toggleBtn.addEventListener('click', () => {
      const isCol = player.classList.toggle('is-collapsed');
      toggleBtn.innerText = isCol ? '▴' : '▾';
      toggleBtn.title = isCol ? 'Player vergrößern' : 'Player minimieren';
    });
  }

  const playBtn = document.getElementById('radar-play-btn');
  if (playBtn) {
    playBtn.onclick = () => toggleRadarPlay();
  }

  const prevBtn = document.getElementById('radar-prev-btn');
  if (prevBtn) {
    prevBtn.onclick = () => {
      stopRadarAnimation();
      stepRadar(-1);
    };
  }

  const nextBtn = document.getElementById('radar-next-btn');
  if (nextBtn) {
    nextBtn.onclick = () => {
      stopRadarAnimation();
      stepRadar(1);
    };
  }

  const speedBtn = document.getElementById('radar-speed-btn');
  if (speedBtn) {
    speedBtn.onclick = () => {
      const speeds = [1, 2, 3];
      const curIdx = speeds.indexOf(state.map.radarPlaybackSpeed || 1);
      const nextSpeed = speeds[(curIdx + 1) % speeds.length];
      state.map.radarPlaybackSpeed = nextSpeed;
      speedBtn.innerText = `${nextSpeed}x`;
      if (state.map.radarPlaying) {
        stopRadarAnimation();
        startRadarAnimation();
      }
    };
  }

  // Quick Jump Buttons: past, now, +3h, +6h, +12h, +24h
  document.querySelectorAll('.radar-jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stopRadarAnimation();
      const target = btn.dataset.target;
      let targetIdx = state.map.liveRadarIndex;
      if (target === 'past') {
        targetIdx = 0;
      } else if (target === 'now') {
        targetIdx = state.map.liveRadarIndex;
      } else {
        const offset = parseInt(target, 10);
        if (!isNaN(offset)) {
          targetIdx = findFrameIndexForHourOffset(offset);
        }
      }

      showUnifiedRadarFrame(targetIdx);
    });
  });
}

function findFrameIndexForHourOffset(offsetHours) {
  const frames = state.map.unifiedRadarFrames;
  if (!frames || frames.length === 0) return 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].type === 'future' && frames[i].hoursFromNow >= offsetHours) {
      return i;
    }
  }
  return frames.length - 1;
}

function updateJumpButtonsActive(idx) {
  const frame = state.map.unifiedRadarFrames ? state.map.unifiedRadarFrames[idx] : null;
  if (!frame) return;

  document.querySelectorAll('.radar-jump-btn').forEach(btn => {
    btn.classList.remove('active');
    const target = btn.dataset.target;
    if (target === 'past' && idx === 0) {
      btn.classList.add('active');
    } else if (target === 'now' && idx === state.map.liveRadarIndex) {
      btn.classList.add('active');
    } else if (frame.type === 'future' && parseInt(target, 10) === frame.hoursFromNow) {
      btn.classList.add('active');
    }
  });
}

function startRadarAnimation() {
  stopRadarAnimation();
  state.map.radarPlaying = true;
  const playBtn = document.getElementById('radar-play-btn');
  if (playBtn) playBtn.innerText = '⏸';

  const delays = { 1: 750, 2: 400, 3: 200 };
  const intervalMs = delays[state.map.radarPlaybackSpeed || 1] || 750;
  let lastTick = performance.now();

  function radarLoop(currentTime) {
    if (!state.map.radarPlaying) return;
    const delta = currentTime - lastTick;
    if (delta >= intervalMs) {
      lastTick = currentTime - (delta % intervalMs);
      if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length > 0) {
        let next = state.map.radarIndex + 1;
        if (next >= state.map.unifiedRadarFrames.length) {
          next = 0;
        }
        showUnifiedRadarFrame(next);
      }
    }
    state.map.radarRafId = requestAnimationFrame(radarLoop);
  }

  state.map.radarRafId = requestAnimationFrame(radarLoop);
}

function stopRadarAnimation() {
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
  if (playBtn) playBtn.innerText = '▶';
}

function toggleRadarPlay() {
  if (state.map.radarPlaying) {
    stopRadarAnimation();
  } else {
    startRadarAnimation();
  }
}

function stepRadar(delta) {
  if (!state.map.unifiedRadarFrames || state.map.unifiedRadarFrames.length === 0) return;
  let next = state.map.radarIndex + delta;
  if (next < 0) next = state.map.unifiedRadarFrames.length - 1;
  if (next >= state.map.unifiedRadarFrames.length) next = 0;
  showUnifiedRadarFrame(next);
}

function updateMapLocation() {
  if (!state.map.instance) return;
  const loc = state.currentLocation;
  state.map.instance.setView([loc.lat, loc.lon], 9);
  if (state.map.marker) {
    state.map.marker.setLatLng([loc.lat, loc.lon]);
    state.map.marker.getPopup().setContent(`<b>${loc.name}</b><br>${loc.elevation} m`).update();
  }
  const chip = document.getElementById('map-location-chip');
  if (chip) chip.innerHTML = `<span>📍 ${loc.name}</span>`;
  updateWeatherOverlay();
}

// =============================================================================
// TAB 4: FAVORITES
// =============================================================================
function setupFavorites() {
  const addBtn = document.getElementById('add-current-favorite-btn');
  const favToggle = document.getElementById('fav-toggle-btn');

  if (addBtn) addBtn.addEventListener('click', toggleFavoriteCurrent);
  if (favToggle) favToggle.addEventListener('click', toggleFavoriteCurrent);

  renderFavoritesTab();
}

function toggleFavoriteCurrent() {
  const loc = state.currentLocation;
  const idx = state.favorites.findIndex(f => f.name.toLowerCase() === loc.name.toLowerCase());

  if (idx >= 0) {
    state.favorites.splice(idx, 1);
  } else {
    state.favorites.push({
      name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      elevation: loc.elevation,
      country: loc.country,
      isMountain: loc.isMountain
    });
  }

  AlpineStorage.safeSetItem(STORAGE_KEY, state.favorites);
  updateFavStarUI();
  renderFavoritesTab();
}

function updateFavStarUI() {
  const btn = document.getElementById('fav-toggle-btn');
  const isFav = state.favorites.some(f => f.name.toLowerCase() === state.currentLocation.name.toLowerCase());
  if (btn) {
    btn.innerText = isFav ? '★' : '☆';
    btn.classList.toggle('favorited', isFav);
  }
}

function renderFavoritesTab() {
  const grid = document.getElementById('favorites-grid');
  if (!grid) return;

  grid.innerHTML = '';
  if (!state.favorites || state.favorites.length === 0) {
    grid.innerHTML = `
      <div class="empty-favorites-box">
        <span class="empty-fav-icon">⭐</span>
        <div class="empty-fav-title">Noch keine Favoriten gespeichert</div>
        <p class="empty-fav-desc">Speichere deine Lieblings-Alpengipfel oder Heimatorte per Klick auf den Stern oben rechts oder wähle einen alpinen Klassiker:</p>
        <div class="empty-fav-presets">
          <button class="preset-fav-chip" type="button" onclick="window.loadNamedMountain('Zugspitze')">🏔️ Zugspitze (2.962 m)</button>
          <button class="preset-fav-chip" type="button" onclick="window.loadNamedMountain('Matterhorn')">🏔️ Matterhorn (4.478 m)</button>
          <button class="preset-fav-chip" type="button" onclick="window.loadNamedMountain('Großglockner')">🏔️ Großglockner (3.798 m)</button>
          <button class="preset-fav-chip" type="button" onclick="window.loadNamedMountain('Nebelhorn')">🏔️ Nebelhorn (2.224 m)</button>
        </div>
      </div>
    `;
    return;
  }

  state.favorites.forEach((fav, i) => {
    const card = document.createElement('div');
    card.className = 'favorite-card';
    const typeIcon = fav.isMountain ? '🏔️' : '🏙️';
    card.innerHTML = `
      <div class="fav-info">
        <div class="fav-name">${typeIcon} ${escapeHtml(fav.name)}</div>
        <div class="fav-meta">Höhe: ${fav.elevation.toLocaleString('de-DE')} m • ${escapeHtml(fav.country || '')}</div>
      </div>
      <div class="fav-actions">
        <button class="fav-del-btn" title="Löschen" aria-label="Favorit löschen">✕</button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('fav-del-btn')) {
        selectExactLocation(fav);
        switchTab('tab-overview');
      }
    });

    card.querySelector('.fav-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      state.favorites.splice(i, 1);
      AlpineStorage.safeSetItem(STORAGE_KEY, state.favorites);
      renderFavoritesTab();
      updateFavStarUI();
    });

    grid.appendChild(card);
  });
}

// =============================================================================
// ZULETZT GESUCHT & SCHNELL-PRESETS DROPDOWN
// =============================================================================
function renderSearchRecentsAndPresetsDropdown() {
  const dropdown = document.getElementById('search-results-dropdown');
  const input = document.getElementById('location-search-input');
  if (!dropdown) return;

  const recents = getSpotlightRecents();
  const presets = [
    { name: 'Zugspitze', lat: 47.421, lon: 10.985, elevation: 2962, isMountain: true, country: 'Deutschland' },
    { name: 'Matterhorn', lat: 45.976, lon: 7.658, elevation: 4478, isMountain: true, country: 'Schweiz' },
    { name: 'Großglockner', lat: 47.074, lon: 12.695, elevation: 3798, isMountain: true, country: 'Österreich' },
    { name: 'Nebelhorn', lat: 47.422, lon: 10.342, elevation: 2224, isMountain: true, country: 'Deutschland' },
    { name: 'München', lat: 48.137, lon: 11.575, elevation: 519, isMountain: false, country: 'Deutschland' }
  ];

  let html = `<div class="recent-searches-box">`;

  if (recents && recents.length > 0) {
    html += `
      <div class="recent-header-row">
        <span>⏱️ Zuletzt gesucht</span>
        <button type="button" class="recent-clear-btn" id="search-clear-recents-btn">Verlauf löschen</button>
      </div>
      <div class="recent-list-container">
    `;
    recents.forEach((item, idx) => {
      const icon = item.isMountain ? '🏔️' : '🏙️';
      html += `
        <div class="dropdown-item recent-search-item" data-idx="${idx}">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:16px;">${icon}</span>
            <div>
              <div class="dropdown-city">${escapeHtml(item.name)}</div>
              <div class="dropdown-region">${escapeHtml(item.country || (item.isMountain ? 'Berg / Gipfel' : 'Ort'))}</div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="dropdown-elevation">${item.elevation ? item.elevation.toLocaleString('de-DE') + ' m' : ''}</span>
            <button type="button" class="recent-item-del" data-del-name="${escapeHtml(item.name)}" title="Aus Verlauf entfernen">✕</button>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  html += `
    <div class="recent-header-row" style="margin-top:4px;">
      <span>🏔️ Beliebte Gipfel & Orte</span>
    </div>
    <div class="recent-presets-row">
  `;

  presets.forEach((p, idx) => {
    html += `
      <button type="button" class="recent-preset-chip" data-preset-idx="${idx}">
        ${p.isMountain ? '🏔️' : '🏙️'} ${escapeHtml(p.name)} <span style="opacity:0.65; font-size:10px;">${p.elevation}m</span>
      </button>
    `;
  });

  html += `</div></div>`;

  dropdown.innerHTML = html;
  dropdown.style.display = 'block';

  // Event handlers for recents
  if (recents && recents.length > 0) {
    const clearRecentsBtn = dropdown.querySelector('#search-clear-recents-btn');
    if (clearRecentsBtn) {
      clearRecentsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        AlpineStorage.safeSetItem('alpine_recent_searches', []);
        renderSearchRecentsAndPresetsDropdown();
        renderSpotlightRecentsUI();
      });
    }

    dropdown.querySelectorAll('.recent-search-item').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.recent-item-del')) return;
        const idx = parseInt(row.dataset.idx, 10);
        const item = recents[idx];
        if (item) {
          selectExactLocation(item);
          dropdown.style.display = 'none';
          if (input) input.value = '';
        }
      });
    });

    dropdown.querySelectorAll('.recent-item-del').forEach(delBtn => {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nameToDel = delBtn.dataset.delName;
        let list = getSpotlightRecents();
        list = list.filter(r => r.name !== nameToDel);
        AlpineStorage.safeSetItem('alpine_recent_searches', list);
        renderSearchRecentsAndPresetsDropdown();
        renderSpotlightRecentsUI();
      });
    });
  }

  // Event handlers for presets
  dropdown.querySelectorAll('.recent-preset-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(chip.dataset.presetIdx, 10);
      const p = presets[idx];
      if (p) {
        selectExactLocation(p);
        dropdown.style.display = 'none';
        if (input) input.value = '';
      }
    });
  });
}

// =============================================================================
// SEARCH AUTOCOMPLETE & GPS (EXACT COORDINATES & OFFICIAL ELEVATION)
// =============================================================================
function setupSearch() {
  const input = document.getElementById('location-search-input');
  const dropdown = document.getElementById('search-results-dropdown');
  const clearBtn = document.getElementById('clear-search-btn');
  const gpsBtn = document.getElementById('gps-btn');
  const unitBtn = document.getElementById('unit-toggle-btn');

  let debounceTimer = null;

  input.addEventListener('focus', () => {
    if (input.value.trim().length < 2) {
      renderSearchRecentsAndPresetsDropdown();
    }
  });

  input.addEventListener('click', () => {
    if (input.value.trim().length < 2) {
      renderSearchRecentsAndPresetsDropdown();
    }
  });

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearBtn.style.display = q.length > 0 ? 'flex' : 'none';

    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.length < 2) {
      renderSearchRecentsAndPresetsDropdown();
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=de&format=json`;
        const data = await resilientFetch(url, { cancelCategory: 'main_search', ttlMs: 60000 });

        dropdown.innerHTML = '';
        if (data.results && data.results.length > 0) {
          // Alpine & European Priority Ranking
          const scored = data.results.map(item => {
            let score = 0;
            const country = (item.country || '').toLowerCase();
            if (['schweiz', 'österreich', 'deutschland', 'italien', 'liechtenstein', 'frankreich'].includes(country)) {
              score += 100;
            }
            const fc = item.feature_code || '';
            if (['MT', 'PK'].includes(fc)) score += 30;
            if (['PPLA', 'PPLC'].includes(fc)) score += 20;
            if (item.name.toLowerCase() === q.toLowerCase()) score += 50;
            const pop = item.population || 0;
            score += Math.min(50, pop / 10000);
            return { item, score };
          });
          scored.sort((a, b) => b.score - a.score);

          scored.forEach(({ item }) => {
            const row = document.createElement('div');
            row.className = 'dropdown-item';

            // Check if known landmark in our official ground-truth database
            const nLower = item.name.toLowerCase();
            let officialElev = Math.round(item.elevation || 500);
            let isMtn = determineIfMountain(item.name, item.feature_code, officialElev);

            if (OFFICIAL_KNOWN_ELEVATIONS[nLower]) {
              officialElev = OFFICIAL_KNOWN_ELEVATIONS[nLower].elevation;
              isMtn = OFFICIAL_KNOWN_ELEVATIONS[nLower].isMountain;
            }

            const icon = isMtn ? '🏔️' : '🏙️';
            const admin = [item.admin1, item.country].filter(Boolean).join(', ');

            row.innerHTML = `
              <div>
                <div class="dropdown-city">${icon} ${escapeHtml(item.name)}</div>
                <div class="dropdown-region">${escapeHtml(admin)}</div>
              </div>
              <div class="dropdown-elevation">${officialElev.toLocaleString('de-DE')} m</div>
            `;

            row.addEventListener('click', () => {
              selectExactLocation({
                name: item.name,
                lat: item.latitude,
                lon: item.longitude,
                elevation: officialElev, // EXACT OFFICIAL ELEVATION!
                country: item.country || '',
                isMountain: isMtn
              });
              dropdown.style.display = 'none';
              input.value = '';
              clearBtn.style.display = 'none';
            });

            dropdown.appendChild(row);
          });
          dropdown.style.display = 'block';
        } else {
          dropdown.innerHTML = '<div style="padding:14px; text-align:center; color:rgba(255,255,255,0.6); font-size:13px;">Kein Ort gefunden</div>';
          dropdown.style.display = 'block';
        }
      } catch (err) {
        console.error('Suche fehlgeschlagen:', err);
      }
    }, 250);
  });

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;

      const firstItem = dropdown.querySelector('.dropdown-item');
      if (firstItem) {
        firstItem.click();
        return;
      }

      const coordMatch = q.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);
        if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          let elev = 500;
          try {
            const elRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`);
            const elData = await elRes.json();
            if (elData.elevation && elData.elevation[0] !== undefined) elev = Math.round(elData.elevation[0]);
          } catch(err) {}
          selectExactLocation({
            name: `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
            lat,
            lon,
            elevation: elev,
            isMountain: elev >= 1000
          });
          dropdown.style.display = 'none';
          input.value = '';
          clearBtn.style.display = 'none';
          return;
        }
      }

      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=de&format=json`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const item = data.results[0];
          const nLower = item.name.toLowerCase();
          let officialElev = Math.round(item.elevation || 500);
          let isMtn = determineIfMountain(item.name, item.feature_code, officialElev);
          if (OFFICIAL_KNOWN_ELEVATIONS[nLower]) {
            officialElev = OFFICIAL_KNOWN_ELEVATIONS[nLower].elevation;
            isMtn = OFFICIAL_KNOWN_ELEVATIONS[nLower].isMountain;
          }
          selectExactLocation({
            name: item.name,
            lat: item.latitude,
            lon: item.longitude,
            elevation: officialElev,
            country: item.country || '',
            isMountain: isMtn
          });
          dropdown.style.display = 'none';
          input.value = '';
          clearBtn.style.display = 'none';
        }
      } catch(err) {}
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    renderSearchRecentsAndPresetsDropdown();
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container') && !e.target.closest('.search-dropdown')) {
      dropdown.style.display = 'none';
    }
  });

  // GPS Geolocation
  if (gpsBtn) {
    gpsBtn.addEventListener('click', triggerExactGps);
  }

  // Unit switch
  if (unitBtn) {
    unitBtn.addEventListener('click', () => {
      state.unit = state.unit === 'celsius' ? 'fahrenheit' : 'celsius';
      unitBtn.innerText = state.unit === 'celsius' ? '°C' : '°F';
      renderOverviewTab();
      renderAdaptiveTab2();
    });
  }
}

// =============================================================================
// FEATURE 2A: 1-KLICK GPS-STANDORT & HÖHENERMITTLUNG
// =============================================================================
function triggerExactGps() {
  const quickGpsBtn = document.getElementById('quick-gps-btn');
  const gpsBtn = document.getElementById('gps-btn');

  if (!('geolocation' in navigator)) {
    alert('Geolocation wird von diesem Browser nicht unterstützt.');
    return;
  }

  if (quickGpsBtn) {
    quickGpsBtn.style.opacity = '0.6';
    const txt = quickGpsBtn.querySelector('.hgp-text');
    if (txt) txt.innerText = 'Ermittle Standort... 🛰️';
  }
  if (gpsBtn) gpsBtn.style.opacity = '0.5';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      if (quickGpsBtn) {
        quickGpsBtn.style.opacity = '1';
        const txt = quickGpsBtn.querySelector('.hgp-text');
        if (txt) txt.innerText = 'Mein Standort';
      }
      if (gpsBtn) gpsBtn.style.opacity = '1';

      // Get exact elevation for GPS coordinate
      let gpsElev = 500;
      try {
        const elRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`);
        const elData = await elRes.json();
        if (elData.elevation && elData.elevation[0] !== undefined) {
          gpsElev = Math.round(elData.elevation[0]);
        }
      } catch(e) {}

      selectExactLocation({
        name: 'Mein Standort',
        lat: lat,
        lon: lon,
        elevation: gpsElev,
        isMountain: gpsElev >= 1000
      });
    },
    (err) => {
      if (quickGpsBtn) {
        quickGpsBtn.style.opacity = '1';
        const txt = quickGpsBtn.querySelector('.hgp-text');
        if (txt) txt.innerText = 'Mein Standort';
      }
      if (gpsBtn) gpsBtn.style.opacity = '1';
      console.warn('GPS location error:', err);
      alert('GPS-Standort konnte nicht ermittelt werden. Bitte Standortfreigabe prüfen.');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

// =============================================================================
// FEATURE 8A: ZULETZT GESUCHTE ORTE (RECENT SEARCHES IN LOCALSTORAGE)
// =============================================================================
function getSpotlightRecents() {
  return AlpineStorage.safeGetItem('alpine_recent_searches', []);
}

function addSpotlightRecent(loc) {
  if (!loc || !loc.name) return;
  try {
    let list = getSpotlightRecents();
    if (!Array.isArray(list)) list = [];
    list = list.filter(item => item.name.toLowerCase() !== loc.name.toLowerCase());
    list.unshift({
      name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      elevation: loc.elevation,
      isMountain: !!loc.isMountain,
      country: loc.country || ''
    });
    AlpineStorage.safeSetItem('alpine_recent_searches', list.slice(0, 5));
  } catch (e) {}
}

function renderSpotlightRecentsUI() {
  const box = document.getElementById('spotlight-recent-chips');
  const listElem = document.getElementById('spotlight-recent-list');
  if (!box || !listElem) return;
  const recents = getSpotlightRecents();
  if (recents.length === 0) {
    box.style.display = 'none';
    return;
  }
  listElem.innerHTML = recents.map(r => `
    <button type="button" class="recent-chip" data-recent="${escapeHtml(r.name)}">
      <span>${r.isMountain ? '🏔️' : '🏙️'}</span>
      <span>${escapeHtml(r.name)}</span>
      <span style="opacity:0.65; font-size:10px;">${r.elevation.toLocaleString('de-DE')}m</span>
    </button>
  `).join('');
  box.style.display = 'flex';

  listElem.querySelectorAll('.recent-chip').forEach((btn, idx) => {
    btn.onclick = () => {
      const targetLoc = recents[idx];
      if (targetLoc) {
        selectExactLocation(targetLoc);
        const modal = document.getElementById('spotlight-modal-overlay');
        if (modal) modal.style.display = 'none';
      }
    };
  });
}

// =============================================================================
// FEATURE 2A: APPLE SPOTLIGHT SCHNELLSUCHE (CMD+K / STRG+K & SCHNELLWAHL)
// =============================================================================
function setupSpotlightAndQuickGps() {
  const triggerBtn = document.getElementById('spotlight-trigger-btn');
  const quickGpsBtn = document.getElementById('quick-gps-btn');
  const modal = document.getElementById('spotlight-modal-overlay');
  const closeBtn = document.getElementById('spotlight-modal-close');
  const input = document.getElementById('spotlight-search-input');
  const resultsContainer = document.getElementById('spotlight-results-list');
  const quickChips = document.querySelectorAll('.spotlight-quick-chips .sq-chip');

  if (!modal || !input) return;

  let selectedIndex = -1;
  let debounceTimer = null;

  function trapModalFocus(e) {
    if (e.key !== 'Tab') return;
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function openSpotlight() {
    modal.style.display = 'flex';
    input.value = '';
    selectedIndex = -1;
    renderSpotlightRecentsUI();
    renderSpotlightInitial();
    modal.addEventListener('keydown', trapModalFocus);
    setTimeout(() => input.focus(), 60);
  }

  function closeSpotlight() {
    modal.style.display = 'none';
    modal.removeEventListener('keydown', trapModalFocus);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (triggerBtn) triggerBtn.focus();
  }

  function renderSpotlightInitial() {
    resultsContainer.innerHTML = `
      <div style="padding: 22px 14px; text-align: center; color: var(--text-secondary); font-size: 13px;">
        💡 Tippe Stadt, Berggipfel oder Koordinaten ein oder klicke oben eine Schnellwahl.
      </div>
    `;
  }

  if (triggerBtn) {
    triggerBtn.addEventListener('click', openSpotlight);
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSpotlight);
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeSpotlight();
    }
  });

  // Global Keyboard Shortcuts (Cmd+K, Ctrl+K, Escape)
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal.style.display === 'flex') {
        closeSpotlight();
      } else {
        openSpotlight();
      }
    } else if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeSpotlight();
    }
  });

  // Quick Chips
  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.quick;
      closeSpotlight();
      if (q === 'gps') {
        triggerExactGps();
      } else if (q === 'matterhorn') {
        selectExactLocation({ name: 'Matterhorn', lat: 45.9765, lon: 7.6586, elevation: 4478, country: 'Schweiz', isMountain: true });
      } else if (q === 'zugspitze') {
        selectExactLocation({ name: 'Zugspitze', lat: 47.4211, lon: 10.9853, elevation: 2962, country: 'Deutschland', isMountain: true });
      } else if (q === 'grossglockner') {
        selectExactLocation({ name: 'Großglockner', lat: 47.0742, lon: 12.6947, elevation: 3798, country: 'Österreich', isMountain: true });
      } else if (q === 'watzmann') {
        selectExactLocation({ name: 'Watzmann-Mittelspitze', lat: 47.5539, lon: 12.9217, elevation: 2713, country: 'Deutschland', isMountain: true });
      } else if (q === 'muenchen') {
        selectExactLocation({ name: 'München', lat: 48.1371, lon: 11.5754, elevation: 519, country: 'Deutschland', isMountain: false });
      } else if (q === 'innsbruck') {
        selectExactLocation({ name: 'Innsbruck', lat: 47.2692, lon: 11.4041, elevation: 574, country: 'Österreich', isMountain: false });
      } else if (q === 'zuerich') {
        selectExactLocation({ name: 'Zürich', lat: 47.3769, lon: 8.5417, elevation: 408, country: 'Schweiz', isMountain: false });
      }
    });
  });

  // 1-Click GPS button in Header
  if (quickGpsBtn) {
    quickGpsBtn.addEventListener('click', triggerExactGps);
  }

  // Live Search in Spotlight
  input.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    selectedIndex = -1;

    if (q.length < 2) {
      renderSpotlightInitial();
      return;
    }

    debounceTimer = setTimeout(async () => {
      // Check coordinate input e.g. 47.42, 10.98
      const coordMatch = q.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lon = parseFloat(coordMatch[2]);
        if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          let elev = 500;
          try {
            const elRes = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`);
            const elData = await elRes.json();
            if (elData.elevation && elData.elevation[0] !== undefined) elev = Math.round(elData.elevation[0]);
          } catch(err) {}

          resultsContainer.innerHTML = '';
          const row = document.createElement('div');
          row.className = 'spotlight-item selected';
          row.innerHTML = `
            <div class="si-left">
              <span class="si-icon">📍</span>
              <div>
                <span class="si-name">${lat.toFixed(4)}°, ${lon.toFixed(4)}°</span>
                <span class="si-sub">Koordinaten-Punkt</span>
              </div>
            </div>
            <div class="si-right">${elev.toLocaleString('de-DE')} m</div>
          `;
          row.addEventListener('click', () => {
            selectExactLocation({
              name: `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
              lat,
              lon,
              elevation: elev,
              isMountain: elev >= 1000
            });
            closeSpotlight();
          });
          resultsContainer.appendChild(row);
          selectedIndex = 0;
          return;
        }
      }

      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=de&format=json`;
        const data = await resilientFetch(url, { cancelCategory: 'spotlight_search', ttlMs: 60000 });

        if (data.results && data.results.length > 0) {
          const scored = data.results.map(item => {
            let score = 0;
            const country = (item.country || '').toLowerCase();
            if (['schweiz', 'österreich', 'deutschland', 'italien', 'liechtenstein', 'frankreich'].includes(country)) {
              score += 100;
            }
            const fc = item.feature_code || '';
            if (['MT', 'PK'].includes(fc)) score += 35;
            if (['PPLA', 'PPLC'].includes(fc)) score += 20;
            if (item.name.toLowerCase() === q.toLowerCase()) score += 50;
            const pop = item.population || 0;
            score += Math.min(50, pop / 10000);
            return { item, score };
          });
          scored.sort((a, b) => b.score - a.score);

          resultsContainer.innerHTML = '';
          scored.forEach(({ item }, idx) => {
            const nLower = item.name.toLowerCase();
            let officialElev = Math.round(item.elevation || 500);
            let isMtn = determineIfMountain(item.name, item.feature_code, officialElev);
            if (OFFICIAL_KNOWN_ELEVATIONS[nLower]) {
              officialElev = OFFICIAL_KNOWN_ELEVATIONS[nLower].elevation;
              isMtn = OFFICIAL_KNOWN_ELEVATIONS[nLower].isMountain;
            }
            const icon = isMtn ? '🏔️' : '🏙️';
            const admin = [item.admin1, item.country].filter(Boolean).join(', ');

            const row = document.createElement('div');
            row.className = `spotlight-item ${idx === 0 ? 'selected' : ''}`;
            row.innerHTML = `
              <div class="si-left">
                <span class="si-icon">${icon}</span>
                <div>
                  <span class="si-name">${escapeHtml(item.name)}</span>
                  <span class="si-sub">${escapeHtml(admin)}</span>
                </div>
              </div>
              <div class="si-right">${officialElev.toLocaleString('de-DE')} m</div>
            `;

            row.addEventListener('click', () => {
              selectExactLocation({
                name: item.name,
                lat: item.latitude,
                lon: item.longitude,
                elevation: officialElev,
                country: item.country || '',
                isMountain: isMtn
              });
              closeSpotlight();
            });

            resultsContainer.appendChild(row);
          });
          selectedIndex = 0;
        } else {
          resultsContainer.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">
              Kein Ort oder Berggipfel gefunden für "${escapeHtml(q)}"
            </div>
          `;
          selectedIndex = -1;
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Spotlight Suche fehlgeschlagen:', err);
        }
      }
    }, 200);
  });

  // Keyboard navigation inside input (Arrow Up, Arrow Down, Enter)
  input.addEventListener('keydown', (e) => {
    const items = resultsContainer.querySelectorAll('.spotlight-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedIndex));
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('selected', i === selectedIndex));
      items[selectedIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const targetItem = selectedIndex >= 0 ? items[selectedIndex] : items[0];
      if (targetItem) {
        targetItem.click();
      }
    }
  });
}

function determineIfMountain(name, featureCode, elevation) {
  const n = name.toLowerCase();
  if (OFFICIAL_KNOWN_ELEVATIONS[n] && OFFICIAL_KNOWN_ELEVATIONS[n].isMountain !== undefined) {
    return OFFICIAL_KNOWN_ELEVATIONS[n].isMountain;
  }
  // Städte, Dörfer und Gemeinden (PPL*) sind immer STÄDTE / Siedlungen
  if (featureCode && featureCode.startsWith('PPL')) {
    return false;
  }
  if (featureCode === 'MT' || featureCode === 'PK' || featureCode === 'PASS' || featureCode === 'MTS' || featureCode === 'HLL' || featureCode === 'RDGE') {
    return true;
  }
  if (n.includes('spitze') || n.includes('horn') || n.includes('kogel') || n.includes('gipfel') || n.includes('wand') || n.includes('grat') || n.includes('massiv') || n.includes('berg')) {
    return true;
  }
  if (elevation >= 1300 && (!featureCode || !featureCode.startsWith('PPL'))) {
    return true;
  }
  return false;
}

function selectExactLocation(loc) {
  addSpotlightRecent(loc);
  loadLocation(loc);
}

// =============================================================================
// FEATURE 9A: STATUS-BADGES AUF TABS (MOBILE BOTTOM BAR & DESKTOP)
// =============================================================================
function updateNavigationWarningBadges() {
  const mtnDotMobile = document.getElementById('mbn-dot-mountain');
  const mtnDotDesktop = document.getElementById('tab-dot-mountain');
  const sportsDotMobile = document.getElementById('mbn-dot-sports');
  const sportsDotDesktop = document.getElementById('tab-dot-sports');

  // 1. Berg & Lawinen-Status (Warn-Badge ab EAWS Stufe 3 Erheblich/Groß)
  const loc = state.currentLocation;
  const av = (loc && state.weatherData)
    ? MicroEngine.computeAvalancheReport(loc.lat, loc.lon, loc.elevation, state.weatherData, state.microData ? state.microData.terrain10m : null)
    : null;

  const hasMountainWarning = av && av.dangerLevel >= 3;
  [mtnDotMobile, mtnDotDesktop].forEach(dot => {
    if (dot) {
      dot.style.display = hasMountainWarning ? 'block' : 'none';
      dot.classList.toggle('dot-orange', !!(av && av.dangerLevel === 3));
    }
  });

  // 2. Sport & GPX-Status (Warn-Badge bei Sturm/Gewitter auf Route)
  const hasSportsWarning = state.sports.hazards && (state.sports.hazards.level === 'yellow' || state.sports.hazards.level === 'red');
  const isSportsRed = state.sports.hazards && state.sports.hazards.level === 'red';
  [sportsDotMobile, sportsDotDesktop].forEach(dot => {
    if (dot) {
      dot.style.display = hasSportsWarning ? 'block' : 'none';
      dot.classList.toggle('dot-orange', !isSportsRed);
    }
  });
}

// =============================================================================
// TAB 5: GEO-ROUTING HIGHLIGHT
// =============================================================================
function updateGeoRoutingNetworks() {
  const lat = state.currentLocation.lat;
  const lon = state.currentLocation.lon;

  const netDwd = document.getElementById('net-dwd');
  const netLawis = document.getElementById('net-lawis');
  const netSuedtirol = document.getElementById('net-suedtirol');
  const netSlf = document.getElementById('net-slf');
  const routingBadge = document.getElementById('active-routing-badge');

  [netDwd, netLawis, netSuedtirol, netSlf].forEach(n => {
    if (n) n.style.borderColor = 'rgba(255, 255, 255, 0.08)';
  });

  if (lat >= 47.05 && lat <= 48.0 && lon >= 9.5 && lon <= 13.5) {
    if (netLawis) netLawis.style.borderColor = 'var(--ios-cyan)';
    if (netDwd) netDwd.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: LAWIS Bayern / Tirol + DWD aktiv';
  } else if (lat < 47.05 && lat >= 45.8 && lon >= 10.4 && lon <= 12.6) {
    if (netSuedtirol) netSuedtirol.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: Open Data Hub Südtirol aktiv';
  } else if (lon < 10.2 && lat >= 45.5 && lat <= 47.8) {
    if (netSlf) netSlf.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: SLF IMIS Schweiz aktiv';
  } else {
    if (netDwd) netDwd.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: DWD MOSMIX & Open-Meteo aktiv';
  }
}

/**
 * Sanftes Scrollen und Aktiv-Highlighting der Quellen-Kategorien in Tab 5
 */
function setupSourcesQuickNav() {
  document.querySelectorAll('.sources-nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('href')?.replace('#', '');
      if (!targetId) return;
      const targetElem = document.getElementById(targetId);
      if (targetElem) {
        document.querySelectorAll('.sources-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        targetElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// Temperature Conversion Helper
function convertTemp(celsius) {
  if (state.unit === 'fahrenheit') {
    return (celsius * 9/5) + 32;
  }
  return celsius;
}

// =============================================================================
// GPX-ROUTEN-INSPEKTOR & HÖHENPROFIL-MIKROWETTER
// =============================================================================
let activeGPXData = null;
let gpxMapPolyline = null;
let gpxMapPolylineOutline = null;
let gpxStartMarker = null;
let gpxEndMarker = null;

function clearGPXFromMap() {
  if (gpxMapPolyline && state.map.instance) state.map.instance.removeLayer(gpxMapPolyline);
  if (gpxMapPolylineOutline && state.map.instance) state.map.instance.removeLayer(gpxMapPolylineOutline);
  if (gpxStartMarker && state.map.instance) state.map.instance.removeLayer(gpxStartMarker);
  if (gpxEndMarker && state.map.instance) state.map.instance.removeLayer(gpxEndMarker);
  gpxMapPolyline = null;
  gpxMapPolylineOutline = null;
  gpxStartMarker = null;
  gpxEndMarker = null;

  const tourBanner = document.getElementById('gpx-active-tour-banner');
  if (tourBanner) tourBanner.style.display = 'none';

  // Standort-Marker wieder einblenden
  if (state.map.marker && state.map.instance) {
    state.map.marker.addTo(state.map.instance);
  }
  updateWeatherOverlay();
}

function setupGPXInspector() {
  const openBtn = document.getElementById('gpx-open-btn');
  const modal = document.getElementById('gpx-modal-overlay');
  const closeBtn = document.getElementById('gpx-modal-close');
  const browseBtn = document.getElementById('gpx-browse-btn');
  const fileInput = document.getElementById('gpx-file-input');
  const dropZone = document.getElementById('gpx-drop-zone');
  const showOnMapBtn = document.getElementById('gpx-show-on-map-btn');

  // Floating Banner Close Button
  const gatbCloseBtn = document.getElementById('gatb-close-btn');
  if (gatbCloseBtn) {
    gatbCloseBtn.addEventListener('click', clearGPXFromMap);
  }

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
      // Standardmäßig sofort Tour laden, falls noch keine geladen ist
      if (!activeGPXData) {
        const sample = MicroEngine.getSampleGPXTrack('matterhorn-hoernli');
        processGPXTrack(sample.xml, sample.name);
      }
    });
  }

  const closeActionBtn = document.getElementById('gpx-modal-close-action');
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    if (closeActionBtn) {
      closeActionBtn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  // Presets
  const presetBtns = document.querySelectorAll('.gpx-preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tourId = btn.dataset.tour;
      const sample = MicroEngine.getSampleGPXTrack(tourId);
      processGPXTrack(sample.xml, sample.name);
    });
  });

  // Browse Button & File Input
  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          processGPXTrack(ev.target.result, file.name.replace(/\.gpx$/i, ''));
        };
        reader.readAsText(file);
      }
    });
  }

  // Drag and Drop
  if (dropZone) {
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          processGPXTrack(ev.target.result, file.name.replace(/\.gpx$/i, ''));
        };
        reader.readAsText(file);
      }
    });
  }

  // Button: Auf Karte anzeigen
  if (showOnMapBtn) {
    showOnMapBtn.addEventListener('click', () => {
      if (!activeGPXData || !activeGPXData.points || !state.map.instance) return;
      if (modal) modal.style.display = 'none';

      // Wechsle auf Tab 3 (Karte)
      switchTab('tab-map');

      // Zeichne Polyline auf Karte
      const latLngs = activeGPXData.points.map(p => [p.lat, p.lon]);

      if (gpxMapPolyline) state.map.instance.removeLayer(gpxMapPolyline);
      if (gpxMapPolylineOutline) state.map.instance.removeLayer(gpxMapPolylineOutline);
      if (gpxStartMarker) state.map.instance.removeLayer(gpxStartMarker);
      if (gpxEndMarker) state.map.instance.removeLayer(gpxEndMarker);

      // Verberge Standort-Marker und sonstige Stationen: NUR Start, Ziel und GPX-Strecke anzeigen!
      if (state.map.marker) {
        state.map.marker.closePopup();
        state.map.instance.removeLayer(state.map.marker);
      }
      if (state.map.weatherLayerGroup) {
        state.map.weatherLayerGroup.clearLayers();
      }

      // 1. Kontrast-Randlinie
      gpxMapPolylineOutline = L.polyline(latLngs, {
        color: '#020617',
        weight: 8,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(state.map.instance);

      // 2. Haupt-GPX-Strecke (Leuchtendes Cyan)
      gpxMapPolyline = L.polyline(latLngs, {
        color: '#00e5ff',
        weight: 5,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(state.map.instance);

      // 3. Startpunkt & Endpunkt (Ziel) Marker
      const pStart = activeGPXData.points[0];
      const pEnd = activeGPXData.points[activeGPXData.points.length - 1];

      const startIcon = L.divIcon({
        className: 'gpx-leaflet-icon',
        html: `<div class="gpx-endpoint-badge gpx-start-badge"><span class="gpx-pin-icon">🟢</span><span class="gpx-pin-text">Start:</span><span class="gpx-pin-ele">${pStart.ele} m</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });
      gpxStartMarker = L.marker([pStart.lat, pStart.lon], { icon: startIcon, zIndexOffset: 3000 }).addTo(state.map.instance);

      // Das Ziel ist das ZIEL und nicht der Gipfel!
      const endIcon = L.divIcon({
        className: 'gpx-leaflet-icon',
        html: `<div class="gpx-endpoint-badge gpx-end-badge"><span class="gpx-pin-icon">🏁</span><span class="gpx-pin-text">Ziel:</span><span class="gpx-pin-ele">${pEnd.ele} m</span></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      });
      gpxEndMarker = L.marker([pEnd.lat, pEnd.lon], { icon: endIcon, zIndexOffset: 3000 }).addTo(state.map.instance);

      // 4. Interaktives Tooltip entlang der Strecke beim Bewegen über den Track
      gpxMapPolyline.on('mousemove', (e) => {
        let closest = activeGPXData.points[0];
        let minDist = Infinity;
        for (const pt of activeGPXData.points) {
          const d = Math.hypot(pt.lat - e.latlng.lat, pt.lon - e.latlng.lng);
          if (d < minDist) {
            minDist = d;
            closest = pt;
          }
        }
        gpxMapPolyline.bindTooltip(`📍 ${closest.ele} m • Distanz: ${closest.distFromStartKm ? closest.distFromStartKm.toFixed(1) + ' km' : ''}`, {
          sticky: true,
          className: 'gpx-track-tooltip'
        }).openTooltip();
      });

      // 5. Aktives Tour-Banner auf der Karte einblenden
      const tourBanner = document.getElementById('gpx-active-tour-banner');
      const gatbName = document.getElementById('gatb-name');
      const gatbStats = document.getElementById('gatb-stats');
      if (tourBanner) {
        tourBanner.style.display = 'flex';
        if (gatbName) gatbName.innerText = activeGPXData.name;
        if (gatbStats) gatbStats.innerText = `(${activeGPXData.totalDistanceKm} km, +${activeGPXData.totalAscentM} Hm) • 🟢 Start: ${pStart.ele} m ➔ 🏁 Ziel: ${pEnd.ele} m`;
      }

      // 6. Zoome auf die gesamte Tour mit sauberem Padding
      setTimeout(() => {
        state.map.instance.fitBounds(gpxMapPolyline.getBounds(), { padding: [60, 60] });
      }, 200);
    });
  }
}

function processGPXTrack(xmlText, tourName) {
  const parsed = MicroEngine.parseGPXData(xmlText);
  if (!parsed.success) {
    alert('GPX-Datei konnte nicht verarbeitet werden: ' + (parsed.error || 'Ungültiges Format'));
    return;
  }

  activeGPXData = { ...parsed, name: tourName };

  // Stats Grid anzeigen
  const statsGrid = document.getElementById('gpx-stats-grid');
  const chartWrapper = document.getElementById('gpx-chart-wrapper');
  const actionsRow = document.getElementById('gpx-actions-row');

  if (statsGrid) statsGrid.style.display = 'grid';
  if (chartWrapper) chartWrapper.style.display = 'block';
  if (actionsRow) actionsRow.style.display = 'flex';

  document.getElementById('gpx-dist-val').innerText = `${parsed.totalDistanceKm} km`;
  document.getElementById('gpx-ascent-val').innerText = `+${parsed.totalAscentM} Hm (-${parsed.totalDescentM} Hm)`;
  document.getElementById('gpx-maxele-val').innerText = `${parsed.maxElevationM} m (Min ${parsed.minElevationM} m)`;
  document.getElementById('gpx-time-val').innerText = `${parsed.estimatedDuration}`;

  renderGPXElevationSVG(parsed);
}

function renderGPXElevationSVG(parsed) {
  const svg = document.getElementById('gpx-elevation-svg');
  if (!svg || !parsed.points || parsed.points.length === 0) return;

  const pts = parsed.points;
  const count = pts.length;
  const W = 800;
  const H = 200;
  const padL = 50;
  const padR = 30;
  const padT = 30;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minZ = Math.max(0, parsed.minElevationM - 100);
  const maxZ = parsed.maxElevationM + 100;
  const rangeZ = Math.max(10, maxZ - minZ);
  const totalDist = Math.max(0.1, parsed.totalDistanceKm);

  // Basis-Temperatur aus aktuellem Wetter (oder 12°C auf 500m)
  const baseT = state.weatherData ? (state.weatherData.current ? state.weatherData.current.temperature_2m : 12) : 12;
  const baseElev = state.currentLocation.elevation || 500;

  const getX = dKm => padL + (dKm / totalDist) * plotW;
  const getY = ele => padT + plotH - ((ele - minZ) / rangeZ) * plotH;

  const lineCoords = [];

  for (let i = 0; i < count; i++) {
    const x = getX(pts[i].distFromStartKm);
    const y = getY(pts[i].ele);
    lineCoords.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  const polyBottomLeft = `${padL},${padT + plotH}`;
  const polyBottomRight = `${(padL + plotW).toFixed(1)},${padT + plotH}`;
  const fillPoly = `${polyBottomLeft} ${lineCoords.join(' ')} ${polyBottomRight}`;

  // Start-, Gipfel- und Zieltemperaturen berechnen (0.65°C pro 100m)
  const pStart = pts[0];
  const pMax = pts.reduce((prev, cur) => cur.ele > prev.ele ? cur : prev, pts[0]);
  const pEnd = pts[pts.length - 1];

  const tStart = Math.round(baseT - ((pStart.ele - baseElev) * 0.0065));
  const tMax = Math.round(baseT - ((pMax.ele - baseElev) * 0.0065));
  const tEnd = Math.round(baseT - ((pEnd.ele - baseElev) * 0.0065));

  const xStart = getX(pStart.distFromStartKm);
  const yStart = getY(pStart.ele);
  const xMax = getX(pMax.distFromStartKm);
  const yMax = getY(pMax.ele);
  const xEnd = getX(pEnd.distFromStartKm);
  const yEnd = getY(pEnd.ele);

  svg.innerHTML = `
    <defs>
      <linearGradient id="gpx-poly-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.4" />
        <stop offset="100%" stop-color="#00e5ff" stop-opacity="0.05" />
      </linearGradient>
    </defs>

    <!-- Achsen & Horizontale Linien -->
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.2)" />
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.2)" />
    <text x="${padL - 8}" y="${padT + 8}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="end" font-family="monospace">${maxZ}m</text>
    <text x="${padL - 8}" y="${padT + plotH}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="end" font-family="monospace">${minZ}m</text>
    <text x="${padL}" y="${H - 12}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="start">0 km</text>
    <text x="${W - padR}" y="${H - 12}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="end">${totalDist.toFixed(1)} km</text>

    <!-- Flächen- und Linienverlauf -->
    <polygon points="${fillPoly}" fill="url(#gpx-poly-grad)" />
    <polyline points="${lineCoords.join(' ')}" fill="none" stroke="#00e5ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Startpunkt -->
    <circle cx="${xStart}" cy="${yStart}" r="4" fill="#30d158" stroke="#fff" stroke-width="1.5" />
    <text x="${xStart + 6}" y="${yStart - 6}" fill="#30d158" font-size="11" font-weight="700">Start: ${pStart.ele}m (${tStart}°C)</text>

    <!-- Höchster Punkt / Gipfel -->
    <circle cx="${xMax}" cy="${yMax}" r="5" fill="#ffd166" stroke="#fff" stroke-width="1.5" />
    <text x="${xMax}" y="${Math.max(14, yMax - 10)}" fill="#ffd166" font-size="11" font-weight="800" text-anchor="middle">🏔️ ${pMax.ele}m (${tMax}°C)</text>

    <!-- Zielpunkt -->
    <circle cx="${xEnd}" cy="${yEnd}" r="4" fill="#64d2ff" stroke="#fff" stroke-width="1.5" />
    <text x="${xEnd - 6}" y="${yEnd - 6}" fill="#64d2ff" font-size="11" font-weight="700" text-anchor="end">Ziel: ${pEnd.ele}m (${tEnd}°C)</text>
  `;
}

// =============================================================================
// SPORT & TOUREN-WETTER CONTROLLER (GPX ROUTEN-WETTER ÜBER DIE GESAMTE DAUER)
// =============================================================================

function formatLocalDatetime(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

function setupSportsTab() {
  const startTimeInput = document.getElementById('sports-start-time');
  if (startTimeInput) {
    startTimeInput.value = formatLocalDatetime(new Date());
    startTimeInput.addEventListener('change', () => {
      if (startTimeInput.value) {
        state.sports.startTimeMs = new Date(startTimeInput.value).getTime();
        document.querySelectorAll('.sport-time-btn').forEach(b => b.classList.remove('active'));
        recomputeSportsTimeline();
      }
    });
  }

  // Quick Time Presets
  const timePresets = document.querySelectorAll('.sport-time-btn');
  timePresets.forEach(btn => {
    btn.addEventListener('click', () => {
      timePresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const preset = btn.dataset.preset;
      const targetDate = new Date();

      if (preset === 'now') {
        // Jetzt
      } else if (preset === 'today-early') {
        targetDate.setHours(7, 0, 0, 0);
      } else if (preset === 'today-noon') {
        targetDate.setHours(12, 0, 0, 0);
      } else if (preset === 'tomorrow-early') {
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(8, 0, 0, 0);
      }

      state.sports.startTimeMs = targetDate.getTime();
      if (startTimeInput) {
        startTimeInput.value = formatLocalDatetime(targetDate);
      }
      recomputeSportsTimeline();
    });
  });

  // Sportarten-Pills (Wandern, Rennrad, Gravel/MTB, Trailrunning)
  const sportButtons = document.querySelectorAll('.sport-pill, .sport-type-btn');
  sportButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      sportButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sports.sportType = btn.dataset.sport;
      updateSportPaceBadges();
      recomputeSportsTimeline();
    });
  });

  // 4-stufiger Fitness-Level-Wähler (Gemütlich, Normal, Sportlich, Profi)
  const fitnessPills = document.querySelectorAll('.fitness-pill');
  fitnessPills.forEach(btn => {
    btn.addEventListener('click', () => {
      fitnessPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sports.fitnessLevel = btn.dataset.fitness;
      updateSportPaceBadges();
      recomputeSportsTimeline();
    });
  });

  // Meilenstein / Wegpunkt Filter (Alle, Warnungen, Pässe & Gipfel)
  const wptFilterPills = document.querySelectorAll('.swt-filter-pill');
  wptFilterPills.forEach(btn => {
    btn.addEventListener('click', () => {
      wptFilterPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sports.waypointFilter = btn.dataset.wptFilter;
      if (state.sports.timeline) {
        renderSportsWaypointsTable(state.sports.timeline);
      }
    });
  });

  // Initialisiere Pace-Badges auf den Pills
  updateSportPaceBadges();

  // Alpine Referenz-Routen (Presets)
  const routePresets = document.querySelectorAll('.sports-route-preset');
  routePresets.forEach(btn => {
    btn.addEventListener('click', () => {
      routePresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSportsPresetTour(btn.dataset.tour);
    });
  });

  // GPX File Upload & Drag'n'Drop
  const browseBtn = document.getElementById('sports-browse-btn');
  const fileInput = document.getElementById('sports-file-input');
  const dropZone = document.getElementById('sports-drop-zone');

  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          routePresets.forEach(b => b.classList.remove('active'));
          loadSportsCustomGPX(ev.target.result, file.name);
        };
        reader.readAsText(file);
      }
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          routePresets.forEach(b => b.classList.remove('active'));
          loadSportsCustomGPX(ev.target.result, file.name);
        };
        reader.readAsText(file);
      }
    });
  }

  // Interaktiver Strecken-Slider (Scrubber)
  const routeSlider = document.getElementById('sports-route-slider');
  if (routeSlider) {
    routeSlider.addEventListener('input', () => {
      const pct = parseFloat(routeSlider.value) || 0;
      const totalDist = state.sports.timeline ? state.sports.timeline.totalDistanceKm : 0;
      const km = (pct / 100) * totalDist;
      updateSportsScrubber(km);
    });
  }

  // Interaktiver Klick auf SVG-Höhenprofil
  const chartWrapper = document.getElementById('sports-chart-wrapper');
  if (chartWrapper) {
    chartWrapper.addEventListener('click', e => {
      if (!state.sports.timeline) return;
      const rect = chartWrapper.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const km = pct * state.sports.timeline.totalDistanceKm;
      if (routeSlider) {
        routeSlider.value = Math.round(pct * 100);
      }
      updateSportsScrubber(km);
    });
  }
}

async function initSportsTour() {
  state.sports.initialized = true;
  // Feature 3B: Prüfe offline zwischengespeicherte Tour
  const cachedTour = await WeatherTourCache.getCachedTour();
  if (cachedTour && cachedTour.gpxXml && cachedTour.tourName) {
    loadAndComputeSportsTour(cachedTour.gpxXml, cachedTour.tourName);
  } else {
    // Standard-Tour: Großglockner Hochalpenstraße (optimal für Rad & Bergsteiger)
    const defaultTour = 'grossglockner-bike';
    loadSportsPresetTour(defaultTour);
  }
}

async function loadSportsPresetTour(tourId) {
  const sample = MicroEngine.getSampleGPXTrack(tourId);
  if (!sample) return;
  state.sports.activeTour = tourId;
  state.sports.gpxName = sample.name;
  await loadAndComputeSportsTour(sample.xml, sample.name);
}

async function loadSportsCustomGPX(gpxXml, fileName) {
  state.sports.activeTour = null;
  state.sports.gpxName = fileName ? fileName.replace(/\.gpx$/i, '') : 'Eigene GPX-Route';
  await loadAndComputeSportsTour(gpxXml, state.sports.gpxName);
}

async function fetchHourlyForRoute(lat, lon) {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (state.sports.cachedForecasts[cacheKey]) {
    return state.sports.cachedForecasts[cacheKey];
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,freezing_level_height&forecast_days=7&timezone=auto`;
    const data = await resilientFetch(url, { ttlMs: 5 * 60 * 1000 });
    if (data && data.hourly && data.hourly.time && data.hourly.time.length > 0) {
      state.sports.cachedForecasts[cacheKey] = data.hourly;
      return data.hourly;
    }
  } catch (err) {
    console.warn('Live route forecast fetch failed, using state fallback:', err);
  }

  if (state.weatherData && state.weatherData.hourly) {
    return state.weatherData.hourly;
  }

  return generateSyntheticSportsHourly();
}

function generateSyntheticSportsHourly() {
  const times = [];
  const temps = [];
  const precips = [];
  const pops = [];
  const codes = [];
  const winds = [];
  const gusts = [];
  const freezing = [];
  const now = new Date();
  now.setMinutes(0, 0, 0);

  for (let i = 0; i < 168; i++) {
    const t = new Date(now.getTime() + i * 3600000);
    times.push(t.toISOString());
    const hr = t.getHours();
    const temp = 14 + Math.sin((hr - 8) / 24 * Math.PI * 2) * 6;
    temps.push(Math.round(temp * 10) / 10);
    precips.push(hr >= 14 && hr <= 17 ? 0.8 : 0);
    pops.push(hr >= 14 && hr <= 17 ? 40 : 10);
    codes.push(hr >= 14 && hr <= 17 ? 80 : 1);
    winds.push(12 + Math.random() * 8);
    gusts.push(22 + Math.random() * 15);
    freezing.push(2800);
  }

  return {
    time: times,
    temperature_2m: temps,
    precipitation: precips,
    precipitation_probability: pops,
    weather_code: codes,
    wind_speed_10m: winds,
    wind_gusts_10m: gusts,
    freezing_level_height: freezing
  };
}

async function parseGPXAsync(gpxXml) {
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise((resolve) => {
        const worker = new Worker('./gpx.worker.js');
        const timeout = setTimeout(() => {
          worker.terminate();
          resolve(MicroEngine.parseGPXData(gpxXml));
        }, 2500);

        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          if (e.data && e.data.status === 'success') {
            resolve(e.data.data);
          } else {
            resolve(MicroEngine.parseGPXData(gpxXml));
          }
        };

        worker.onerror = () => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(MicroEngine.parseGPXData(gpxXml));
        };

        worker.postMessage({ action: 'parseGPX', payload: { xmlString: gpxXml } });
      });
    } catch (e) {}
  }
  return MicroEngine.parseGPXData(gpxXml);
}

async function loadAndComputeSportsTour(gpxXml, tourName) {
  state.sports.gpxText = gpxXml;
  const parsed = await parseGPXAsync(gpxXml);
  if (!parsed || !parsed.points || parsed.points.length === 0) {
    const bannerTitle = document.getElementById('hsb-title');
    const bannerDesc = document.getElementById('hsb-desc');
    if (bannerTitle) bannerTitle.innerText = 'GPX-Fehler: Ungültiger Track';
    if (bannerDesc) bannerDesc.innerText = 'Die hochgeladene GPX-Datei enthält keine verwertbaren GPS-Trackpunkte.';
    return;
  }

  state.sports.parsedGPX = parsed;
  const startPt = parsed.points[0];
  const hourly = await fetchHourlyForRoute(startPt.lat, startPt.lon);
  state.sports.cachedForecast = hourly;

  recomputeSportsTimeline();
}

function updateSportPaceBadges() {
  const sports = ['hiking', 'road_bike', 'gravel_mtb', 'trailrun'];
  sports.forEach(sp => {
    const badge = document.getElementById(`sp-pace-${sp}`);
    if (badge) {
      const info = MicroEngine.getSportSpeedInfo(sp, state.sports.fitnessLevel);
      badge.innerText = info.paceLabel;
    }
  });
}

function recomputeSportsTimeline() {
  if (!state.sports.parsedGPX || !state.sports.cachedForecast) return;
  const parsed = state.sports.parsedGPX;
  const startPt = parsed.points[0];
  const hourly = state.sports.cachedForecast;

  const timeline = MicroEngine.computeRouteWeatherTimeline(
    parsed,
    state.sports.startTimeMs,
    state.sports.sportType,
    hourly,
    startPt.ele,
    state.sports.fitnessLevel
  );

  state.sports.timeline = timeline;
  state.sports.hazards = timeline.hazards;

  updateSportPaceBadges();
  renderSportsMetrics(timeline);
  renderSportsHazards(timeline.hazards);
  updateNavigationWarningBadges();
  renderSportsElevationProfile(timeline);
  renderSportsWaypointsTable(timeline);
  renderSportsMap(timeline);

  const slider = document.getElementById('sports-route-slider');
  const pct = slider ? parseFloat(slider.value) || 0 : 0;
  const targetKm = (pct / 100) * timeline.totalDistanceKm;
  updateSportsScrubber(targetKm);

  // Feature 3B: Offline-Cache abspeichern
  WeatherTourCache.saveTour(
    state.sports.gpxName || 'Tour',
    state.sports.gpxText,
    parsed,
    timeline,
    { totalDist: timeline.totalDistanceKm, totalAsc: timeline.totalAscentM, duration: timeline.totalDurationStr }
  );
}

function renderSportsMetrics(timeline) {
  const dDist = document.getElementById('sm-val-dist');
  const dAsc = document.getElementById('sm-val-ascent');
  const dDur = document.getElementById('sm-val-dur');
  const dFin = document.getElementById('sm-val-finish');

  if (dDist) dDist.innerText = `${timeline.totalDistanceKm.toFixed(1)} km`;
  if (dAsc) dAsc.innerText = `+${Math.round(timeline.totalAscentM)} m / -${Math.round(timeline.totalDescentM)} m`;
  if (dDur) dDur.innerText = timeline.totalDurationStr;
  if (dFin) {
    const finishDate = new Date(timeline.endTimeMs);
    const dayName = finishDate.toLocaleDateString('de-DE', { weekday: 'short' });
    dFin.innerText = `${timeline.endTimeStr} Uhr (${dayName})`;
  }
}

function renderSportsHazards(hazards) {
  const statusTag = document.getElementById('sports-hazard-status-tag');
  const banner = document.getElementById('hazard-summary-banner');
  const iconElem = document.getElementById('hsb-icon');
  const titleElem = document.getElementById('hsb-title');
  const descElem = document.getElementById('hsb-desc');
  const listElem = document.getElementById('hazard-alerts-list');

  if (!banner || !hazards) return;

  banner.classList.remove('hsb-green', 'hsb-yellow', 'hsb-red');
  banner.classList.add(`hsb-${hazards.level}`);

  if (statusTag) {
    statusTag.className = 'card-tag';
    if (hazards.level === 'red') {
      statusTag.innerText = '🔴 Hohe Alpine Gefahr';
      statusTag.style.color = 'var(--ios-red)';
      statusTag.style.borderColor = 'rgba(255, 69, 58, 0.4)';
    } else if (hazards.level === 'yellow') {
      statusTag.innerText = '🟡 Wetterwarnungen aktiv';
      statusTag.style.color = 'var(--ios-yellow)';
      statusTag.style.borderColor = 'rgba(255, 209, 102, 0.4)';
    } else {
      statusTag.innerText = '🟢 Optimale Bedingungen';
      statusTag.style.color = 'var(--ios-green)';
      statusTag.style.borderColor = 'rgba(48, 209, 88, 0.4)';
    }
  }

  if (iconElem) {
    iconElem.innerText = hazards.level === 'red' ? '⚡' : (hazards.level === 'yellow' ? '⚠️' : '✅');
  }

  if (titleElem) {
    if (hazards.level === 'red') {
      titleElem.innerText = 'Kritische Wettergefahren auf deiner Route erkannt!';
    } else if (hazards.level === 'yellow') {
      titleElem.innerText = 'Wetterwarnungen für exponierte Streckenabschnitte';
    } else {
      titleElem.innerText = 'Sichere Verhältnisse für deine gewählte Route';
    }
  }

  if (descElem) {
    descElem.innerText = hazards.advice || 'Wetterlage auf allen Wegpunkten im grünen Bereich.';
  }

  if (listElem) {
    listElem.innerHTML = '';
    if (!hazards.alerts || hazards.alerts.length === 0) {
      listElem.innerHTML = `
        <div class="hazard-alert-item alert-green">
          <div class="hai-icon">🌤️</div>
          <div class="hai-body">
            <div class="hai-top">
              <strong>Keine Wetterwarnungen entlang der Route</strong>
              <span class="hai-meta">Gesamte Streckenlänge</span>
            </div>
            <p>Für deine berechnete Durchgangszeit sind weder Gewitter, Sturmböen noch Kälteeinbrüche prognostiziert. Ideale Bedingungen für deine Tour!</p>
          </div>
        </div>
      `;
    } else {
      hazards.alerts.forEach(a => {
        const item = document.createElement('div');
        item.className = `hazard-alert-item alert-${a.severity}`;
        item.innerHTML = `
          <div class="hai-icon">${a.icon}</div>
          <div class="hai-body">
            <div class="hai-top">
              <strong>${a.title}</strong>
              <span class="hai-meta">${a.time} • km ${a.km.toFixed(1)} (${Math.round(a.ele)} m)</span>
            </div>
            <p>${a.desc}</p>
          </div>
        `;
        listElem.appendChild(item);
      });
    }
  }
}

function renderSportsElevationProfile(timeline) {
  const svg = document.getElementById('sports-elevation-svg');
  if (!svg || !timeline) return;

  const W = 900;
  const H = 240;
  const padL = 50;
  const padR = 35;
  const padT = 35;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minZ = Math.max(0, timeline.minElevationM - 80);
  const maxZ = timeline.maxElevationM + 80;
  const rangeZ = Math.max(20, maxZ - minZ);
  const totalDist = Math.max(0.1, timeline.totalDistanceKm);

  const pts = timeline.timedPoints;
  const count = pts.length;
  const getX = dKm => padL + (dKm / totalDist) * plotW;
  const getY = ele => padT + plotH - ((ele - minZ) / rangeZ) * plotH;

  const lineCoords = [];
  for (let i = 0; i < count; i++) {
    const x = getX(pts[i].distFromStartKm);
    const y = getY(pts[i].ele);
    lineCoords.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  const polyBottomLeft = `${padL},${padT + plotH}`;
  const polyBottomRight = `${(padL + plotW).toFixed(1)},${padT + plotH}`;
  const fillPoly = `${polyBottomLeft} ${lineCoords.join(' ')} ${polyBottomRight}`;

  // Milestone Markers on SVG Profile
  let milestoneSVGElements = '';
  timeline.milestones.forEach((m, idx) => {
    const mx = getX(m.distFromStartKm);
    const my = getY(m.ele);
    const isPeak = m.ele === timeline.maxElevationM;

    milestoneSVGElements += `
      <g class="svg-milestone-pin" data-km="${m.distFromStartKm}">
        <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="${isPeak ? 5.5 : 4}" fill="${isPeak ? '#ffd166' : '#00e5ff'}" stroke="#ffffff" stroke-width="1.8" />
        <text x="${mx.toFixed(1)}" y="${(my - 12).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.8))">
          ${m.weatherIcon} ${m.tempC}°
        </text>
      </g>
    `;
  });

  svg.innerHTML = `
    <defs>
      <linearGradient id="sports-profile-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#00e5ff" stop-opacity="0.45" />
        <stop offset="65%" stop-color="#0a84ff" stop-opacity="0.20" />
        <stop offset="100%" stop-color="#051525" stop-opacity="0.05" />
      </linearGradient>
    </defs>

    <!-- Achsenlinien & Höhenraster -->
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
    <line x1="${padL}" y1="${padT + plotH / 2}" x2="${W - padR}" y2="${padT + plotH / 2}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4 4" />

    <!-- Höhen-Achsenbeschriftung -->
    <text x="${padL - 8}" y="${padT + 5}" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="end" font-family="monospace">${maxZ}m</text>
    <text x="${padL - 8}" y="${padT + plotH / 2 + 3}" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="end" font-family="monospace">${Math.round((maxZ + minZ) / 2)}m</text>
    <text x="${padL - 8}" y="${padT + plotH}" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="end" font-family="monospace">${minZ}m</text>

    <!-- Distanz-Achsenbeschriftung -->
    <text x="${padL}" y="${H - 12}" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="start">0 km (Start)</text>
    <text x="${W - padR}" y="${H - 12}" fill="rgba(255,255,255,0.6)" font-size="10" text-anchor="end">${totalDist.toFixed(1)} km (Ziel)</text>

    <!-- Gefülltes Höhenprofil -->
    <polygon points="${fillPoly}" fill="url(#sports-profile-grad)" />
    <polyline points="${lineCoords.join(' ')}" fill="none" stroke="#00e5ff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Meilensteine & Wetter-Symbole -->
    ${milestoneSVGElements}

    <!-- Dynamischer Scrubber-Positionsstrich & Cursor-Punkt -->
    <line id="svg-scrubber-line" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#ffd166" stroke-width="2" stroke-dasharray="3 3" opacity="0.9" />
    <circle id="svg-scrubber-dot" cx="${padL}" cy="${getY(pts[0].ele)}" r="6" fill="#ffd166" stroke="#ffffff" stroke-width="2" />
  `;
}

function renderSportsWaypointsTable(timeline) {
  const container = document.getElementById('sports-waypoints-list');
  if (!container || !timeline) return;

  container.innerHTML = '';

  const filter = state.sports.waypointFilter || 'all';
  let visibleMilestones = timeline.milestones;
  if (filter === 'hazards') {
    visibleMilestones = timeline.milestones.filter((m, idx) => {
      return (
        m.precipMm >= 0.5 ||
        m.gustsKmH >= 45 ||
        m.weatherCode >= 95 ||
        m.isSnow ||
        (m.weatherCondition && m.weatherCondition.includes('Gewitter'))
      );
    });
  } else if (filter === 'peaks') {
    visibleMilestones = timeline.milestones.filter((m, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === timeline.milestones.length - 1;
      const isPeak = m.ele === timeline.maxElevationM;
      return isStart || isEnd || isPeak;
    });
  }

  if (visibleMilestones.length === 0) {
    container.innerHTML = `
      <div class="swt-empty-notice">
        <span>✅</span>
        <div>
          <strong>Keine Streckenabschnitte mit Warnungen</strong>
          <p>Für deine geplante Tour sind bei aktuellem Wetter keine Gefahren auf den Wegpunkten aktiv.</p>
        </div>
      </div>
    `;
    return;
  }

  visibleMilestones.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'swt-row';
    row.dataset.idx = m.index !== undefined ? m.index : idx;
    row.dataset.km = m.distFromStartKm;

    const isPeak = m.ele === timeline.maxElevationM;
    let typeTag = '📍 Wegpunkt';
    if (m.distFromStartKm === 0) typeTag = '🚩 Tourstart';
    else if (m.distFromStartKm >= timeline.totalDistanceKm - 0.05) typeTag = '🏁 Zielankunft';
    else if (isPeak) typeTag = '🏔️ Scheitelpunkt';

    row.innerHTML = `
      <div class="swt-cell swt-milestone">
        <span class="swt-type-tag">${escapeHtml(typeTag)}</span>
        <span class="swt-m-name">${escapeHtml(m.label)}</span>
        <span class="swt-m-coords">${m.lat.toFixed(4)}°, ${m.lon.toFixed(4)}°</span>
      </div>
      <div class="swt-cell swt-dist-ele">
        <strong class="swt-dist">${m.distFromStartKm.toFixed(1)} km</strong>
        <span class="swt-ele text-cyan">${Math.round(m.ele)} m</span>
      </div>
      <div class="swt-cell swt-time">
        <strong class="swt-arr-time">${escapeHtml(m.arrivalTimeStr)}</strong>
        <span class="swt-arr-date">${escapeHtml(m.arrivalDateStr)}</span>
      </div>
      <div class="swt-cell swt-weather">
        <div class="swt-w-top">
          <span class="swt-icon">${m.weatherIcon}</span>
          <strong class="swt-temp">${m.tempC}°C</strong>
        </div>
        <span class="swt-cond">${escapeHtml(m.weatherCondition)}</span>
      </div>
      <div class="swt-cell swt-wind">
        <strong>${m.windKmH} km/h</strong>
        <span class="swt-gusts text-orange">Böen ${m.gustsKmH}</span>
      </div>
      <div class="swt-cell swt-precip">
        <strong class="${m.popPercent >= 50 ? 'text-red' : (m.popPercent >= 25 ? 'text-yellow' : '')}">${m.popPercent}%</strong>
        <span class="swt-precip-mm">${m.precipMm > 0 ? `${m.precipMm.toFixed(1)} mm` : '0 mm'}</span>
        ${m.isSnow ? '<span class="swt-snow-badge">❄️ Frost</span>' : ''}
      </div>
    `;

    row.addEventListener('click', () => {
      const slider = document.getElementById('sports-route-slider');
      if (slider) {
        const pct = (m.distFromStartKm / timeline.totalDistanceKm) * 100;
        slider.value = Math.round(pct);
      }
      updateSportsScrubber(m.distFromStartKm);
    });

    container.appendChild(row);
  });
}

function renderSportsMap(timeline) {
  const container = document.getElementById('sports-map-container');
  if (!container || !timeline || !timeline.timedPoints || timeline.timedPoints.length === 0) return;

  if (!state.sports.map) {
    state.sports.map = L.map('sports-map-container', {
      zoomControl: true,
      attributionControl: false,
      maxZoom: 19
    }).setView([timeline.timedPoints[0].lat, timeline.timedPoints[0].lon], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors, HOT'
    }).addTo(state.sports.map);
  }

  // Bestehende Schichten entfernen
  if (state.sports.routeBgLine) state.sports.map.removeLayer(state.sports.routeBgLine);
  if (state.sports.routeLine) state.sports.map.removeLayer(state.sports.routeLine);
  if (state.sports.startMarker) state.sports.map.removeLayer(state.sports.startMarker);
  if (state.sports.endMarker) state.sports.map.removeLayer(state.sports.endMarker);
  if (state.sports.scrubberMarker) state.sports.map.removeLayer(state.sports.scrubberMarker);
  if (state.sports.milestoneMarkers) {
    state.sports.milestoneMarkers.forEach(m => state.sports.map.removeLayer(m));
  }
  state.sports.milestoneMarkers = [];

  const latLngs = timeline.timedPoints.map(p => [p.lat, p.lon]);

  // Route Hintergrund-Casing (Glow-Effekt)
  state.sports.routeBgLine = L.polyline(latLngs, {
    color: '#005577',
    weight: 8,
    opacity: 0.7,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.sports.map);

  // Vordergrund-Route (Leuchtendes Cyan)
  state.sports.routeLine = L.polyline(latLngs, {
    color: '#00e5ff',
    weight: 4.5,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.sports.map);

  // Start & Ziel Marker
  const startPt = timeline.timedPoints[0];
  const endPt = timeline.timedPoints[timeline.timedPoints.length - 1];

  const startIcon = L.divIcon({
    className: 'sports-custom-pin start-pin',
    html: '<div class="pin-inner pin-start">🚩 <span>START</span></div>',
    iconSize: [72, 28],
    iconAnchor: [36, 14]
  });

  const endIcon = L.divIcon({
    className: 'sports-custom-pin end-pin',
    html: '<div class="pin-inner pin-end">🏁 <span>ZIEL</span></div>',
    iconSize: [68, 28],
    iconAnchor: [34, 14]
  });

  state.sports.startMarker = L.marker([startPt.lat, startPt.lon], { icon: startIcon }).addTo(state.sports.map);
  state.sports.startMarker.bindPopup(`<b>🚩 Tourstart</b><br>Höhe: ${Math.round(startPt.ele)} m<br>Startzeit: ${timeline.startTimeStr} Uhr`);

  state.sports.endMarker = L.marker([endPt.lat, endPt.lon], { icon: endIcon }).addTo(state.sports.map);
  state.sports.endMarker.bindPopup(`<b>🏁 Zielankunft</b><br>Strecke: ${timeline.totalDistanceKm.toFixed(1)} km<br>Ankunft: ${timeline.endTimeStr} Uhr`);

  // Zwischen-Meilensteine mit Wetter-Bubbles
  timeline.milestones.forEach((m, idx) => {
    if (idx === 0 || idx === timeline.milestones.length - 1) return;
    const mIcon = L.divIcon({
      className: 'sports-milestone-marker',
      html: `<div class="ms-marker-bubble"><span class="ms-icon">${m.weatherIcon}</span> <span class="ms-temp">${m.tempC}°</span></div>`,
      iconSize: [54, 24],
      iconAnchor: [27, 12]
    });

    const marker = L.marker([m.lat, m.lon], { icon: mIcon }).addTo(state.sports.map);
    marker.bindPopup(`
      <div style="font-family: -apple-system, sans-serif; min-width: 170px;">
        <strong style="color: #00e5ff; font-size: 13px;">${m.label} (${m.distFromStartKm.toFixed(1)} km)</strong><br>
        <span style="font-size: 11px; color: #8e8e93;">⏱️ Durchgang: ${m.arrivalTimeStr} (${m.arrivalDateStr})</span>
        <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.15); margin: 6px 0;">
        <div>${m.weatherIcon} <b>${m.weatherCondition}</b></div>
        <div>🌡️ Temperatur: <b>${m.tempC}°C</b> (Gefühlt ${m.feltTempC}°C)</div>
        <div>💨 Wind: <b>${m.windKmH} km/h</b> (Böen ${m.gustsKmH} km/h)</div>
        <div>💧 Niederschlag: <b>${m.precipMm.toFixed(1)} mm</b> (${m.popPercent}%)</div>
        ${m.isSnow ? '<div style="color: #64d2ff; font-weight: bold;">❄️ Frost / Schneelage möglich</div>' : ''}
      </div>
    `);
    state.sports.milestoneMarkers.push(marker);
  });

  // Interaktiver Scrubber-Marker (Athleten-Pin)
  const athleteIcon = timeline.sportType === 'road_bike' ? '🚴' : (timeline.sportType === 'gravel_mtb' ? '🚵' : (timeline.sportType === 'trailrun' ? '🏃' : '🥾'));
  const scrubberIcon = L.divIcon({
    className: 'sports-scrubber-map-marker',
    html: `<div class="scrubber-pin-pulse">${athleteIcon}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  state.sports.scrubberMarker = L.marker([startPt.lat, startPt.lon], { icon: scrubberIcon, zIndexOffset: 3000 }).addTo(state.sports.map);

  setTimeout(() => {
    state.sports.map.invalidateSize();
    state.sports.map.fitBounds(state.sports.routeLine.getBounds(), { padding: [30, 30] });
  }, 100);
}

function updateSportsScrubber(km) {
  const timeline = state.sports.timeline;
  if (!timeline || !timeline.timedPoints || timeline.timedPoints.length === 0) return;

  const totalDist = Math.max(0.1, timeline.totalDistanceKm);
  const clampedKm = Math.max(0, Math.min(totalDist, km));
  state.sports.scrubberKm = clampedKm;

  // Finde nächsten berechneten Punkt
  let closestPt = timeline.timedPoints[0];
  let minDiff = Infinity;
  for (let i = 0; i < timeline.timedPoints.length; i++) {
    const diff = Math.abs(timeline.timedPoints[i].distFromStartKm - clampedKm);
    if (diff < minDiff) {
      minDiff = diff;
      closestPt = timeline.timedPoints[i];
    }
  }

  // Finde nächsten Meilenstein für Wetter-Werte
  let closestMs = timeline.milestones[0];
  let minMsDiff = Infinity;
  let closestMsIdx = 0;
  for (let i = 0; i < timeline.milestones.length; i++) {
    const diff = Math.abs(timeline.milestones[i].distFromStartKm - clampedKm);
    if (diff < minMsDiff) {
      minMsDiff = diff;
      closestMs = timeline.milestones[i];
      closestMsIdx = i;
    }
  }

  // Scrubber Label & Badge
  const pointLabel = document.getElementById('ss-current-point-label');
  const timeBadge = document.getElementById('ss-current-time-badge');
  if (pointLabel) {
    pointLabel.innerText = `📍 km ${closestPt.distFromStartKm.toFixed(1)} • ${Math.round(closestPt.ele)} m`;
  }
  if (timeBadge) {
    const arrStr = closestPt.arrivalDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    timeBadge.innerText = `⏱️ ${arrStr} Uhr`;
  }

  // HUD-Badge über SVG
  const hud = document.getElementById('sports-hud-badge');
  if (hud) {
    hud.style.display = 'block';
    const hIcon = document.getElementById('shb-icon');
    const hTitle = document.getElementById('shb-title');
    const hTime = document.getElementById('shb-time');
    const hTemp = document.getElementById('shb-temp');
    const hWind = document.getElementById('shb-wind');
    const hCond = document.getElementById('shb-cond');
    const hEle = document.getElementById('shb-ele');

    if (hIcon) hIcon.innerText = closestMs.weatherIcon;
    if (hTitle) hTitle.innerText = `km ${closestPt.distFromStartKm.toFixed(1)}`;
    if (hTime) hTime.innerText = closestPt.arrivalDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (hTemp) hTemp.innerText = `${closestMs.tempC}°C (Gefühlt ${closestMs.feltTempC}°C)`;
    if (hWind) hWind.innerText = `${closestMs.windKmH} km/h (Böen ${closestMs.gustsKmH})`;
    if (hCond) hCond.innerText = closestMs.weatherCondition;
    if (hEle) hEle.innerText = `Höhe: ${Math.round(closestPt.ele)} m • Niederschlag: ${closestMs.precipMm} mm (${closestMs.popPercent}%)`;

    // Positionierung entlang des Charts
    const pct = clampedKm / totalDist;
    const padL = 50;
    const plotW = 900 - 50 - 35;
    const targetSvgX = padL + pct * plotW;
    const hudPercent = Math.max(4, Math.min(76, (targetSvgX / 900) * 100));
    hud.style.left = `${hudPercent.toFixed(1)}%`;
  }

  // SVG Scrubber Strich & Punkt bewegen
  const svgLine = document.getElementById('svg-scrubber-line');
  const svgDot = document.getElementById('svg-scrubber-dot');
  if (svgLine && svgDot) {
    const padL = 50;
    const padT = 35;
    const padB = 40;
    const plotW = 900 - padL - 35;
    const plotH = 240 - padT - padB;
    const minZ = Math.max(0, timeline.minElevationM - 80);
    const maxZ = timeline.maxElevationM + 80;
    const rangeZ = Math.max(20, maxZ - minZ);

    const x = padL + (clampedKm / totalDist) * plotW;
    const y = padT + plotH - ((closestPt.ele - minZ) / rangeZ) * plotH;

    svgLine.setAttribute('x1', x.toFixed(1));
    svgLine.setAttribute('x2', x.toFixed(1));
    svgDot.setAttribute('cx', x.toFixed(1));
    svgDot.setAttribute('cy', y.toFixed(1));
  }

  // Map Marker synchronisieren
  if (state.sports.scrubberMarker) {
    state.sports.scrubberMarker.setLatLng([closestPt.lat, closestPt.lon]);
  }

  // Wegpunkt-Zeile in Tabelle hervorheben
  document.querySelectorAll('.swt-row').forEach(row => {
    const rIdx = parseInt(row.dataset.idx, 10);
    row.classList.toggle('active-waypoint', rIdx === closestMsIdx);
  });
}


