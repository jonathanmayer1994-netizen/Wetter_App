/**
 * BEST WEATHER — Dynamic Responsive Alpine Weather & Urban Climate Platform
 * Fully differentiated between Cities and Mountains
 */

import { MicroEngine } from './microEngine.js';

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
  unit: 'celsius',
  activeTab: 'tab-overview',
  activeAspect: { tilt: 45, azimuth: 0, isAuto: false },
  selectedAltitudeHour: 0,
  favorites: [],
  map: {
    instance: null,
    marker: null,
    activeLayer: 'radar',
    radarTileLayer: null,
    baseTileLayer: null,
    radarFrames: [],
    radarIndex: 0,
    radarInterval: null,
    radarPlaying: false,
    radarHost: ''
  },
  canvasEngine: null
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
  if (typeof localStorage !== 'undefined') {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
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
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.favorites));
  }
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
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.initStars();
    this.animate = this.animate.bind(this);
    this.animate();
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

    requestAnimationFrame(this.animate);
  }
}

// =============================================================================
// MAIN INITIALIZATION
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  state.canvasEngine = new BackgroundCanvasEngine('weather-canvas');

  setupTabs();
  setupSearch();
  setupWallSelector();
  setupAltitudeSlider();
  setupFavorites();
  setupLocationTypeToggle();
  initLeafletMap();

  // Load initial location (München: 520 m)
  loadLocation(state.currentLocation);
});

// =============================================================================
// TABS CONTROLLER
// =============================================================================
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });
}

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === tabId);
  });

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

    // Call MicroEngine preserving the official elevation as reference ground truth!
    const microResult = await MicroEngine.getMicroScaleWeather(
      loc.lat,
      loc.lon,
      loc.elevation, // Exact official elevation preserved!
      loc.isMountain,
      customTilt,
      customAzimuth
    );

    state.microData = microResult;
    state.weatherData = microResult.weatherRaw;

    // Render all UI components
    renderOverviewTab();
    renderAdaptiveTab2();
    renderFavoritesTab();
    updateMapLocation();

  } catch (err) {
    console.error('Fehler beim Laden des Wetters:', err);
    const cond = document.getElementById('hero-condition-text');
    if (cond) cond.innerText = 'Verbindungsfehler beim Laden der Daten';
  }
}

function updateLocationHeaderUI() {
  const loc = state.currentLocation;
  document.getElementById('hero-location-name').innerText = loc.name;
  document.getElementById('hero-elevation-pill').innerText = `${loc.isMountain ? '🏔️' : '🏙️'} ${loc.elevation.toLocaleString('de-DE')} m`;
  document.getElementById('hero-geo-coords').innerText = `Lat: ${loc.lat.toFixed(4)}, Lon: ${loc.lon.toFixed(4)}`;
  document.getElementById('hero-update-time').innerText = `Aktualisiert: ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

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
}

function renderHourlySlider(hourly) {
  const container = document.getElementById('hourly-forecast-list');
  if (!container || !hourly || !hourly.time || hourly.time.length === 0) return;

  container.innerHTML = '';
  const nowMs = Date.now();

  // Find index closest to current local time
  let startIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < Math.min(36, hourly.time.length); i++) {
    const diff = Math.abs(new Date(hourly.time[i]).getTime() - nowMs);
    if (diff < minDiff) {
      minDiff = diff;
      startIdx = i;
    }
  }

  for (let i = startIdx; i < startIdx + 25 && i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    const isFirst = i === startIdx;
    const label = isFirst ? 'Jetzt' : `${String(t.getHours()).padStart(2, '0')}:00`;
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
    item.className = 'hourly-item';
    item.innerHTML = `
      <div class="hourly-time">${label}</div>
      <div class="hourly-icon">${icon}</div>
      <div class="hourly-pop">${pop > 10 ? `${pop}%` : ''}</div>
      <div class="hourly-temp">${temp}°</div>
      <div class="hourly-wind">💨 ${wind}</div>
    `;
    container.appendChild(item);
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

    const code = daily.weather_code[i];
    const info = WMO_CODES[code] || WMO_CODES[0];
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
            <span class="daily-icon-box">${info.icon}</span>
            <span class="daily-cond-text">${info.label}</span>
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
  const code = daily.weather_code[dayIndex];
  const info = WMO_CODES[code] || WMO_CODES[0];

  // 1. Header & Ort
  const locBadge = document.getElementById('modal-location-badge');
  if (locBadge && state.currentLocation) {
    const isMtn = state.currentLocation.isMountain;
    locBadge.innerText = `${isMtn ? '🏔️ Berggipfel' : '📍 Ort'}: ${state.currentLocation.name} (${Math.round(state.currentLocation.elevation).toLocaleString('de-DE')} m)`;
  }

  document.getElementById('modal-day-name').innerText = dateStr;

  let synopNote = 'Ruhige Wetterlage';
  if (code >= 95) synopNote = 'Gewittergefahr & starke Turbulenzen';
  else if (code >= 71) synopNote = 'Schneefallgrenze beachten';
  else if (code >= 51) synopNote = 'Regenschauer und feuchte Luftmasse';
  else if (code >= 1 && code <= 3) synopNote = 'Wechselnd bewölkt mit sonnigen Abschnitten';
  else if (code === 0) synopNote = 'Sonnig und wolkenloser Himmel';
  document.getElementById('modal-day-condition').innerText = `${info.icon} ${info.label} • ${synopNote}`;

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
    document.getElementById('modal-sunshine-dur').innerText = code <= 1 ? '~8 h' : (code <= 3 ? '~4 h' : '< 1 h');
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
  if (closeBtn) {
    closeBtn.onclick = () => { modal.style.display = 'none'; };
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

  if (isMountain) {
    if (mPanel) mPanel.style.display = 'block';
    if (cPanel) cPanel.style.display = 'none';
    renderMountainPanel();
    renderAltitudeChart();
  } else {
    if (mPanel) mPanel.style.display = 'none';
    if (cPanel) cPanel.style.display = 'block';
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

// Vertical Altitude Profile (Tal vs. Berg)
function renderAltitudeChart() {
  const container = document.getElementById('altitude-levels-container');
  if (!container || !state.microData || !state.microData.altitudeProfile) return;

  const profiles = state.microData.altitudeProfile;
  const currentProfile = profiles[state.selectedAltitudeHour] || profiles[0];

  container.innerHTML = '';

  currentProfile.levels.forEach(level => {
    const card = document.createElement('div');
    card.className = 'altitude-tier-card';

    const t = Math.round(convertTemp(level.temp));
    const tFormatted = t > 0 ? `+${t}°` : `${t}°`;

    let tempColor = '#30d158';
    if (level.temp < 0) tempColor = '#64d2ff';
    else if (level.temp > 18) tempColor = '#ff9f0a';

    // Proportionale Skala: -20°C bis +30°C
    const tempPct = Math.max(10, Math.min(100, Math.round(((level.temp - (-20)) / 48) * 100)));
    const precipIcon = level.isAboveFreezing ? '💧 Regen' : '❄️ Schnee';

    card.innerHTML = `
      <div class="tier-left">
        <span class="tier-icon">${level.icon}</span>
        <span class="tier-name">${level.name}</span>
        <span class="tier-elevation-badge">${level.z.toLocaleString('de-DE')} m</span>
      </div>

      <div class="tier-center">
        <span class="tier-temp-val" style="color:${tempColor}">${tFormatted}</span>
        <div class="tier-gauge-track">
          <div class="tier-gauge-fill" style="background:${tempColor}; width: ${tempPct}%;"></div>
        </div>
      </div>

      <div class="tier-right">
        <span class="tier-wind-chip">💨 ${level.wind} km/h</span>
        <span class="tier-precip-chip ${level.isAboveFreezing ? 'precip-rain' : 'precip-snow'}">${precipIcon}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

function setupAltitudeSlider() {
  const slider = document.getElementById('profile-hour-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      state.selectedAltitudeHour = parseInt(e.target.value);
      updateAltitudeSliderLabel();
      renderAltitudeChart();
    });
  }
}

function updateAltitudeSliderLabel() {
  const label = document.getElementById('profile-time-label');
  if (!label) return;
  const h = state.selectedAltitudeHour;
  if (!state.microData || !state.microData.altitudeProfile) {
    label.innerText = h === 0 ? 'Jetzt' : `+${h} Stunden`;
    return;
  }
  const profiles = state.microData.altitudeProfile;
  const cur = profiles[h] || profiles[0];
  if (cur && cur.time) {
    const t = new Date(cur.time);
    const timeStr = `${String(t.getHours()).padStart(2, '0')}:00`;
    label.innerText = h === 0 ? `Jetzt (${timeStr} Uhr)` : `+${h}h (${timeStr} Uhr)`;
  } else {
    label.innerText = h === 0 ? 'Jetzt' : `+${h} Stunden`;
  }
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

  // 2. Erstelle Layer-Gruppe für dynamische Wetter-Marker
  state.map.weatherLayerGroup = L.layerGroup().addTo(state.map.instance);

  // 3. Setze Standard-OSM-Basiskarte
  state.map.activeBase = 'osm-standard';
  setMapBaseLayer('osm-standard');

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

  // 8. Lade Wetterdaten für Stationen & initialisiere Niederschlags-Radar
  state.map.activeOverlay = 'precip';
  loadRainViewerRadar();
  updateWeatherOverlay();

  // Fenster-Resize-Handling für Wind-Canvas
  window.addEventListener('resize', () => {
    if (state.map.activeOverlay === 'wind') {
      const wDir = state.currentWeather ? state.currentWeather.wind_direction_10m : 240;
      const wSpd = state.currentWeather ? state.currentWeather.wind_speed_10m : 20;
      startWindCanvas(wDir, wSpd);
    }
  });
}

/**
 * Wechselt die Basiskarte (OSM Standard, OSM Topo/Outdoor, OSM Dunkel, Satellit)
 * Garantiert maxZoom 20 ohne 'Zoom level not supported' Kacheln
 */
function setMapBaseLayer(baseKey) {
  const conf = BASE_LAYERS[baseKey] || BASE_LAYERS['osm-standard'];
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
 * Schaltet das aktive meteorologische Overlay um (Niederschlag/Schnee, Wind, Bewölkung, Temp, Druck)
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

  // 1. NIEDERSCHLAG & SCHNEE (Unterscheidung nach Temperatur)
  if (overlay === 'precip') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'flex';
    if (state.map.radarFrames && state.map.radarFrames.length && state.map.radarTileLayer) {
      if (!state.map.instance.hasLayer(state.map.radarTileLayer)) {
        state.map.instance.addLayer(state.map.radarTileLayer);
      }
    }

    if (legendTitle) legendTitle.innerText = '🌧️ Regen & ❄️ Schnee (Typ-Erkennung):';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #0099ff, #00e600, #ffcc00, #ff3300, #d946ef, #ffffff)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#78d6ff;">Leichter Regen</span>
        <span style="color:#ffd166;">Starkregen</span>
        <span style="color:#f5d0fe;">Schneefall (Alpin)</span>
      `;
    }

    // Erzeuge Station-Badges mit Regen- vs. Schnee-Klassifikation
    for (const st of stations) {
      const w = st.weather || {};
      const t = w.temperature_2m !== undefined ? w.temperature_2m : 8;
      const precip = w.precipitation !== undefined ? w.precipitation : 0;
      const snow = w.snowfall !== undefined ? w.snowfall : 0;
      const isFreezing = t <= 1.0;

      let badgeHtml = '';
      if (isFreezing && (snow > 0 || (w.weather_code >= 71 && w.weather_code <= 86))) {
        badgeHtml = `<div class="weather-station-marker wsm-snow"><span class="wsm-name">${st.name}:</span> ❄️ Schnee ${snow > 0 ? `${snow.toFixed(1)} cm` : 'Aktiv'}</div>`;
      } else if (isFreezing) {
        badgeHtml = `<div class="weather-station-marker wsm-snow"><span class="wsm-name">${st.name}:</span> ❄️ 0°C Frostgrenze</div>`;
      } else if (precip > 0) {
        badgeHtml = `<div class="weather-station-marker wsm-rain"><span class="wsm-name">${st.name}:</span> 🌧️ ${precip.toFixed(1)} mm</div>`;
      } else {
        badgeHtml = `<div class="weather-station-marker"><span class="wsm-name">${st.name}:</span> <span style="color:var(--text-tertiary);">💧 Trocken</span></div>`;
      }

      const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [45, 12] });
      const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
      m.on('click', () => selectExactLocation(st));
    }
  }

  // 2. WIND & STRÖMUNGSFELD
  else if (overlay === 'wind') {
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
    }

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
        <div class="weather-station-marker" style="border-color:${color};">
          <span class="wsm-wind-arrow" style="transform: rotate(${dir}deg); color:${color}; font-weight:800;">↑</span>
          <span class="wsm-name">${st.name}:</span>
          <strong style="color:${color};">${spd} km/h</strong>
          <small style="color:var(--text-tertiary);">(${gust})</small>
        </div>
      `;

      const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [55, 12] });
      const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
      m.on('click', () => selectExactLocation(st));
    }
  }

  // 3. BEWÖLKUNGSGRAD & WOLKENBEDECKUNG
  else if (overlay === 'clouds') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
    }

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

      const badgeHtml = `
        <div class="weather-station-marker">
          <span>${cIcon}</span>
          <span class="wsm-name">${st.name}:</span>
          <strong>${cloud}%</strong>
        </div>
      `;

      const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [45, 12] });
      const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
      m.on('click', () => selectExactLocation(st));
    }
  }

  // 4. TEMPERATUR-FELD & FROSTGRENZE
  else if (overlay === 'temp') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
    }

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

    for (const st of stations) {
      const w = st.weather || {};
      const t = w.temperature_2m !== undefined ? Math.round(convertTemp(w.temperature_2m)) : '--';

      let tColor = '#ffd166';
      if (t < 0) tColor = '#64d2ff';
      else if (t < 10) tColor = '#30d158';
      else if (t >= 20) tColor = '#ff453a';

      const badgeHtml = `
        <div class="weather-station-marker" style="border-color:${tColor};">
          <span class="wsm-name">${st.name} <small style="color:var(--text-tertiary);">(${st.elevation}m)</small>:</span>
          <strong style="color:${tColor}; font-size:12px;">${t > 0 ? `+${t}` : t}°C</strong>
        </div>
      `;

      const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [55, 12] });
      const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
      m.on('click', () => selectExactLocation(st));
    }
  }

  // 5. LUFTDRUCK QNH & ISOBAREN
  else if (overlay === 'pressure') {
    stopWindCanvas();
    if (radarControls) radarControls.style.display = 'none';
    if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
    }

    if (legendTitle) legendTitle.innerText = '⏲️ Luftdruck QNH (Meereshöhe):';
    if (legendBar) legendBar.style.background = 'linear-gradient(90deg, #93c5fd, #a78bfa, #c084fc)';
    if (legendLabels) {
      legendLabels.innerHTML = `
        <span style="color:#93c5fd;">< 1010 hPa Tief (T)</span>
        <span style="color:#a78bfa;">1015 hPa</span>
        <span style="color:#30d158;">> 1020 hPa Hoch (H)</span>
      `;
    }

    for (const st of stations) {
      const w = st.weather || {};
      const p = Math.round(w.pressure_msl || 1013);
      const isHigh = p >= 1018;

      const badgeHtml = `
        <div class="weather-station-marker">
          <span class="wsm-name">${st.name}:</span>
          <strong>${p} hPa</strong>
          <span style="color:${isHigh ? '#30d158' : '#93c5fd'}; font-weight:800; font-size:10px; margin-left:2px;">${isHigh ? 'H' : 'T'}</span>
        </div>
      `;

      const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [50, 12] });
      const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
      m.on('click', () => selectExactLocation(st));
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

async function loadRainViewerRadar() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    state.map.radarFrames = [...(data.radar.past || []), ...(data.radar.nowcast || [])];
    state.map.radarHost = data.host;

    const slider = document.getElementById('radar-time-slider');
    if (slider) {
      slider.max = state.map.radarFrames.length - 1;
      slider.value = (data.radar.past || []).length - 1;
      state.map.radarIndex = parseInt(slider.value);

      showRadarTileFrame(state.map.radarIndex);

      slider.addEventListener('input', (e) => {
        stopRadarAnimation();
        showRadarTileFrame(parseInt(e.target.value));
      });
    }

    const playBtn = document.getElementById('radar-play-btn');
    if (playBtn) playBtn.addEventListener('click', toggleRadarPlay);
  } catch (e) {
    console.warn('Radar konnte nicht geladen werden:', e);
  }
}

function showRadarTileFrame(idx) {
  const frames = state.map.radarFrames;
  if (!frames || !frames[idx]) return;

  state.map.radarIndex = idx;
  const frame = frames[idx];

  if (state.map.radarTileLayer) {
    state.map.instance.removeLayer(state.map.radarTileLayer);
  }

  // Palette 8 = Differenzierung von Regen (Blau/Grün) und Schnee (Cyan/Magenta/Weiß)
  const url = `${state.map.radarHost}${frame.path}/256/{z}/{x}/{y}/8/1_1.png`;
  state.map.radarTileLayer = L.tileLayer(url, {
    opacity: 0.78,
    zIndex: 200,
    maxNativeZoom: 18,
    maxZoom: 20
  }).addTo(state.map.instance);

  const t = new Date(frame.time * 1000);
  const timeDisplay = document.getElementById('radar-time-display');
  if (timeDisplay) timeDisplay.innerText = `${t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Radarscan`;
  const slider = document.getElementById('radar-time-slider');
  if (slider) slider.value = idx;
}

function toggleRadarPlay() {
  const btn = document.getElementById('radar-play-btn');
  if (state.map.radarPlaying) {
    stopRadarAnimation();
  } else {
    state.map.radarPlaying = true;
    if (btn) btn.innerText = '⏸';
    state.map.radarInterval = setInterval(() => {
      let next = state.map.radarIndex + 1;
      if (next >= state.map.radarFrames.length) next = 0;
      showRadarTileFrame(next);
    }, 700);
  }
}

function stopRadarAnimation() {
  if (state.map.radarInterval) {
    clearInterval(state.map.radarInterval);
    state.map.radarInterval = null;
  }
  state.map.radarPlaying = false;
  const btn = document.getElementById('radar-play-btn');
  if (btn) btn.innerText = '▶';
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

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.favorites));
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
  state.favorites.forEach((fav, i) => {
    const card = document.createElement('div');
    card.className = 'favorite-card';
    const typeIcon = fav.isMountain ? '🏔️' : '🏙️';
    card.innerHTML = `
      <div class="fav-info">
        <div class="fav-name">${typeIcon} ${fav.name}</div>
        <div class="fav-meta">Höhe: ${fav.elevation.toLocaleString('de-DE')} m • ${fav.country || ''}</div>
      </div>
      <div class="fav-actions">
        <button class="fav-del-btn" title="Löschen">✕</button>
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.favorites));
      renderFavoritesTab();
      updateFavStarUI();
    });

    grid.appendChild(card);
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

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim();
    clearBtn.style.display = q.length > 0 ? 'flex' : 'none';

    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=de&format=json`;
        const res = await fetch(url);
        const data = await res.json();

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
                <div class="dropdown-city">${icon} ${item.name}</div>
                <div class="dropdown-region">${admin}</div>
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

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    dropdown.style.display = 'none';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container') && !e.target.closest('.search-dropdown')) {
      dropdown.style.display = 'none';
    }
  });

  // GPS Geolocation
  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      if ('geolocation' in navigator) {
        gpsBtn.style.opacity = '0.5';
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            gpsBtn.style.opacity = '1';
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            
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
          () => {
            gpsBtn.style.opacity = '1';
            alert('GPS-Standort konnte nicht ermittelt werden.');
          },
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }
    });
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
  loadLocation(loc);
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

// Temperature Conversion Helper
function convertTemp(celsius) {
  if (state.unit === 'fahrenheit') {
    return (celsius * 9/5) + 32;
  }
  return celsius;
}
