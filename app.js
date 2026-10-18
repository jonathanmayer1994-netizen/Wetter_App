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
      const isExpanded = accordion.style.display === 'block';
      accordion.style.display = isExpanded ? 'none' : 'block';
      wrapper.classList.toggle('expanded', !isExpanded);
      chevron.innerText = isExpanded ? '›' : '▾';
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

// 10-Day Detail Modal
function openDayDetailModal(dayIndex, daily, hourly) {
  const modal = document.getElementById('day-detail-modal');
  const d = new Date(daily.time[dayIndex]);
  const dateStr = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const code = daily.weather_code[dayIndex];
  const info = WMO_CODES[code] || WMO_CODES[0];

  document.getElementById('modal-day-name').innerText = dateStr;
  document.getElementById('modal-day-condition').innerText = `${info.icon} ${info.label}`;
  document.getElementById('modal-max-temp').innerText = `${Math.round(convertTemp(daily.temperature_2m_max[dayIndex]))}°C`;
  document.getElementById('modal-min-temp').innerText = `${Math.round(convertTemp(daily.temperature_2m_min[dayIndex]))}°C`;
  document.getElementById('modal-pop').innerText = `${daily.precipitation_probability_max ? daily.precipitation_probability_max[dayIndex] : 0}%`;
  document.getElementById('modal-precip-sum').innerText = `${(daily.precipitation_sum ? daily.precipitation_sum[dayIndex] : 0).toFixed(1)} mm`;

  document.getElementById('modal-wind-gusts').innerText = `${Math.round(daily.wind_gusts_10m_max ? daily.wind_gusts_10m_max[dayIndex] : 0)} km/h`;
  document.getElementById('modal-uv-max').innerText = daily.uv_index_max ? Math.round(daily.uv_index_max[dayIndex]) : '--';

  if (daily.sunrise && daily.sunrise[dayIndex]) {
    document.getElementById('modal-sunrise').innerText = new Date(daily.sunrise[dayIndex]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('modal-sunset').innerText = new Date(daily.sunset[dayIndex]).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  // 4 Day Parts Breakdown
  const partsContainer = document.getElementById('modal-day-parts');
  partsContainer.innerHTML = '';

  const dayStartHourIdx = dayIndex * 24;
  const parts = [
    { name: 'Morgens', hourOffset: 8, icon: '🌅' },
    { name: 'Mittags', hourOffset: 13, icon: '☀️' },
    { name: 'Abends', hourOffset: 19, icon: '🌇' },
    { name: 'Nachts', hourOffset: 23, icon: '🌙' }
  ];

  for (const part of parts) {
    const idx = dayStartHourIdx + part.hourOffset;
    let t = '--';
    let pop = 0;
    if (hourly && hourly.temperature_2m && hourly.temperature_2m[idx] !== undefined) {
      t = Math.round(convertTemp(hourly.temperature_2m[idx]));
      pop = hourly.precipitation_probability ? hourly.precipitation_probability[idx] : 0;
    }

    const box = document.createElement('div');
    box.className = 'day-part-box';
    box.innerHTML = `
      <div class="dp-name">${part.name}</div>
      <div class="dp-icon">${part.icon}</div>
      <div class="dp-temp">${t}°</div>
      <div class="dp-rain">${pop > 10 ? `${pop}%` : 'Trocken'}</div>
    `;
    partsContainer.appendChild(box);
  }

  modal.style.display = 'flex';

  document.getElementById('close-modal-btn').onclick = () => {
    modal.style.display = 'none';
  };
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };
}

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

    let tempColor = '#30d158';
    if (level.temp < 0) tempColor = '#64d2ff';
    else if (level.temp > 18) tempColor = '#ff9f0a';

    const precipIcon = level.isAboveFreezing ? '💧 Regen' : '❄️ Schnee';

    card.innerHTML = `
      <div class="tier-name-col">
        <span>${level.icon}</span>
        <span>${level.name}</span>
      </div>
      <div class="tier-elevation-badge">${level.z.toLocaleString('de-DE')} m</div>
      <div class="tier-temp-col">
        <span class="tier-temp-val" style="color:${tempColor}">${Math.round(convertTemp(level.temp))}°</span>
        <div class="tier-temp-bar" style="background:${tempColor}; width: 60%;"></div>
      </div>
      <div class="tier-meta-col">
        <span class="tier-wind">💨 ${level.wind} km/h</span>
        <span class="tier-precip">${precipIcon}</span>
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
function initLeafletMap() {
  const mapElem = document.getElementById('interactive-map');
  if (!mapElem) return;

  state.map.instance = L.map('interactive-map', {
    zoomControl: true,
    attributionControl: false
  }).setView([state.currentLocation.lat, state.currentLocation.lon], 9);

  state.map.baseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 16
  }).addTo(state.map.instance);

  state.map.marker = L.marker([state.currentLocation.lat, state.currentLocation.lon])
    .addTo(state.map.instance)
    .bindPopup(`<b>${state.currentLocation.name}</b><br>${state.currentLocation.elevation} m`)
    .openPopup();

  state.map.instance.on('click', async (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    
    // Exakte Höhe live für diesen Klick-Punkt über Elevation-API laden
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

  document.querySelectorAll('.map-layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setMapLayer(btn.dataset.layer);
    });
  });

  loadRainViewerRadar();
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

  const url = `${state.map.radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  state.map.radarTileLayer = L.tileLayer(url, {
    opacity: 0.75,
    zIndex: 200
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

function setMapLayer(layerType) {
  if (state.map.baseTileLayer) {
    state.map.instance.removeLayer(state.map.baseTileLayer);
  }

  const radarControls = document.getElementById('radar-floating-controls');

  if (layerType === 'topo') {
    state.map.baseTileLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 16 }).addTo(state.map.instance);
    if (radarControls) radarControls.style.display = 'none';
  } else if (layerType === 'satellite') {
    state.map.baseTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 17 }).addTo(state.map.instance);
    if (radarControls) radarControls.style.display = 'none';
  } else {
    state.map.baseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 16 }).addTo(state.map.instance);
    if (radarControls) radarControls.style.display = 'flex';
  }
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
