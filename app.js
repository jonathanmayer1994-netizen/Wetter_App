/**
 * BEST WEATHER — Dynamic Responsive Alpine Weather System
 * Powered by Open-Meteo, 10m DEM MicroEngine, RainViewer & Alpine Networks
 */

import { MicroEngine } from './microEngine.js';

// =============================================================================
// GLOBAL STATE & PERSISTENCE
// =============================================================================
const state = {
  currentLocation: {
    name: 'München',
    lat: 48.1371,
    lon: 11.5754,
    elevation: 519,
    country: 'Deutschland',
    isMountain: false
  },
  weatherData: null,
  microData: null,
  unit: 'celsius',
  activeTab: 'tab-overview',
  activeAspect: { tilt: 45, azimuth: 0, isAuto: false },
  selectedAltitudeHour: 0,
  favorites: JSON.parse(localStorage.getItem('best_weather_favorites_v2') || '[]'),
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

// Default initial favorites if none saved
if (state.favorites.length === 0) {
  state.favorites = [
    { name: 'München', lat: 48.1371, lon: 11.5754, elevation: 519, country: 'Deutschland' },
    { name: 'Zugspitze', lat: 47.421, lon: 10.985, elevation: 2962, country: 'Deutschland' },
    { name: 'Matterhorn / Zermatt', lat: 45.976, lon: 7.658, elevation: 4478, country: 'Schweiz' },
    { name: 'Bozen / Dolomiten', lat: 46.498, lon: 11.354, elevation: 262, country: 'Italien' }
  ];
}

// WMO Codes Definition
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
// ATMOSPHERIC BACKGROUND CANVAS ENGINE
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
    for (let i = 0; i < 75; i++) {
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
      const count = Math.min(80, Math.floor(this.width / 12));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          len: 14 + Math.random() * 14,
          speed: 14 + Math.random() * 8
        });
      }
    } else if (theme === 'snow') {
      const count = Math.min(60, Math.floor(this.width / 16));
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

    // Stars
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

    // Rain
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

    // Snow
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
// MAIN INITIALIZATION & CONTROLLER
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  state.canvasEngine = new BackgroundCanvasEngine('weather-canvas');

  setupTabs();
  setupSearch();
  setupWallSelector();
  setupAltitudeSlider();
  setupFavorites();
  initLeafletMap();

  // Load initial location
  loadLocation(state.currentLocation);
});

// =============================================================================
// TAB SWITCHING
// =============================================================================
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      switchTab(targetTab);
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

  // If map tab activated, trigger Leaflet resize
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
// LOCATION LOADING & HIGH-PRECISION WEATHER FETCH
// =============================================================================
async function loadLocation(loc) {
  state.currentLocation = loc;
  updateLocationHeaderUI();
  updateGeoRoutingNetworks();

  try {
    // 1. Fetch via MicroEngine with custom tilt & azimuth
    const customTilt = state.activeAspect.isAuto ? null : state.activeAspect.tilt;
    const customAzimuth = state.activeAspect.isAuto ? null : state.activeAspect.azimuth;

    const microResult = await MicroEngine.getMicroScaleAlpineWeather(
      loc.lat,
      loc.lon,
      14,
      customTilt,
      customAzimuth
    );

    state.microData = microResult;
    state.weatherData = microResult.weatherRaw;

    // Actual DEM elevation from terrain
    if (microResult.terrain10m && microResult.terrain10m.elevation) {
      state.currentLocation.elevation = Math.round(microResult.terrain10m.elevation);
    }

    // Adaptive Mountain Detection (> 900m or rugged TPI)
    state.currentLocation.isMountain = state.currentLocation.elevation >= 900;

    // Render all UI components
    renderOverviewTab();
    renderMountainTab();
    renderAltitudeChart();
    renderFavoritesTab();
    updateMapLocation();

  } catch (err) {
    console.error('Fehler beim Laden des Mikrowetters:', err);
  }
}

function updateLocationHeaderUI() {
  const loc = state.currentLocation;
  document.getElementById('hero-location-name').innerText = loc.name;
  document.getElementById('hero-elevation-pill').innerText = `🏔️ ${loc.elevation.toLocaleString('de-DE')} m`;
  document.getElementById('hero-geo-coords').innerText = `Lat: ${loc.lat.toFixed(4)}, Lon: ${loc.lon.toFixed(4)}`;
  document.getElementById('hero-update-time').innerText = `Aktualisiert: ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

  const badge = document.getElementById('location-type-badge');
  if (loc.isMountain || loc.elevation >= 900) {
    badge.innerText = '🏔️ Hochalpiner Berg';
    badge.style.color = '#ffd166';
  } else {
    badge.innerText = '🏙️ Stadt / Flachland';
    badge.style.color = '#64d2ff';
  }

  // Update favorite star
  updateFavStarUI();
}

// =============================================================================
// TAB 1: RENDER OVERVIEW
// =============================================================================
function renderOverviewTab() {
  const w = state.weatherData;
  const m = state.microData;
  if (!w || !w.current) return;

  const cur = w.current;
  const daily = w.daily;
  const isDay = cur.is_day === 1;
  const code = WMO_CODES[cur.weather_code] || WMO_CODES[0];
  const theme = isDay ? code.theme : code.themeNight;

  // Background Theme
  document.body.className = `weather-${theme}`;
  if (state.canvasEngine) state.canvasEngine.setMode(theme, isDay);

  // Hero Display: Use 10m MicroPhysics temperature!
  const finalTemp = m ? m.microWeather.temperature10m : cur.temperature_2m;
  document.getElementById('hero-current-temp').innerText = Math.round(convertTemp(finalTemp));
  document.getElementById('hero-condition-text').innerText = code.label;

  if (daily && daily.temperature_2m_max) {
    document.getElementById('hero-temp-max').innerText = `${Math.round(convertTemp(daily.temperature_2m_max[0]))}°`;
    document.getElementById('hero-temp-min').innerText = `${Math.round(convertTemp(daily.temperature_2m_min[0]))}°`;
  }
  document.getElementById('hero-temp-apparent').innerText = `${Math.round(convertTemp(cur.apparent_temperature))}°`;

  // 24h Hourly Forecast
  renderHourlySlider(w.hourly);

  // 10-Day Forecast with Click Interaction
  render10DayForecast(w.daily, w.hourly);

  // Bento Grid
  renderBentoGrid(cur, daily, w.hourly);
}

function renderHourlySlider(hourly) {
  const container = document.getElementById('hourly-forecast-list');
  if (!hourly || !hourly.time) return;

  container.innerHTML = '';
  const now = new Date();
  const curHour = now.getHours();

  let startIdx = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const d = new Date(hourly.time[i]);
    if (d.getDate() === now.getDate() && d.getHours() === curHour) {
      startIdx = i;
      break;
    }
  }

  for (let i = startIdx; i < startIdx + 25 && i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    const isFirst = i === startIdx;
    const label = isFirst ? 'Jetzt' : `${t.getHours()}:00`;
    const temp = Math.round(convertTemp(hourly.temperature_2m[i]));
    const pop = hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0;
    const code = hourly.weather_code[i];
    const isDay = t.getHours() >= 6 && t.getHours() <= 20;
    const info = WMO_CODES[code] || WMO_CODES[0];
    const icon = isDay ? info.icon : info.iconNight;
    const wind = Math.round(hourly.wind_speed_10m[i]);

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
  if (!daily || !daily.time) return;

  container.innerHTML = '';
  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  // Global Min & Max for bar normalization
  let gMin = Infinity, gMax = -Infinity;
  const count = Math.min(10, daily.time.length);
  for (let i = 0; i < count; i++) {
    if (daily.temperature_2m_min[i] < gMin) gMin = daily.temperature_2m_min[i];
    if (daily.temperature_2m_max[i] > gMax) gMax = daily.temperature_2m_max[i];
  }
  const totalRange = (gMax - gMin) || 1;

  for (let i = 0; i < count; i++) {
    const d = new Date(daily.time[i]);
    const dayName = i === 0 ? 'Heute' : weekdays[d.getDay()];
    const code = daily.weather_code[i];
    const info = WMO_CODES[code] || WMO_CODES[0];
    const pop = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : 0;
    const minVal = daily.temperature_2m_min[i];
    const maxVal = daily.temperature_2m_max[i];

    const leftPct = Math.max(0, ((minVal - gMin) / totalRange) * 100);
    const widthPct = Math.max(12, (((maxVal - minVal) / totalRange) * 100));

    const row = document.createElement('div');
    row.className = 'daily-interactive-row';
    row.title = 'Klicken für detaillierte Tagesabschnitte, Wind & Niederschlag';
    row.innerHTML = `
      <div class="daily-day-label">${dayName}</div>
      <div class="daily-icon-box">${info.icon}</div>
      <div class="daily-pop-label">${pop > 15 ? `${pop}%` : ''}</div>
      <div class="daily-min-label">${Math.round(convertTemp(minVal))}°</div>
      <div class="daily-bar-container">
        <div class="daily-bar-fill" style="left:${leftPct}%; width:${widthPct}%;"></div>
      </div>
      <div class="daily-max-label">${Math.round(convertTemp(maxVal))}°</div>
      <div class="daily-chevron">›</div>
    `;

    // Click handler to open detailed modal!
    row.addEventListener('click', () => {
      openDayDetailModal(i, daily, hourly);
    });

    container.appendChild(row);
  }
}

// Detailed Day Modal
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

  // 4 Day Parts Breakdown (Morgens, Mittags, Abends, Nachts)
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
  // UV
  const uv = cur.uv_index !== undefined ? Math.round(cur.uv_index) : 0;
  document.getElementById('uv-index-val').innerText = uv;
  document.getElementById('uv-gauge-pointer').style.left = `${Math.min(100, (uv / 11) * 100)}%`;

  // Wind & Compass
  const windSpd = Math.round(cur.wind_speed_10m || 0);
  const windDir = cur.wind_direction_10m || 0;
  const windGusts = Math.round(cur.wind_gusts_10m || windSpd * 1.4);
  document.getElementById('wind-speed-val').innerHTML = `${windSpd} <small>km/h</small>`;
  document.getElementById('compass-arrow').style.transform = `rotate(${windDir}deg)`;
  document.getElementById('wind-direction-text').innerText = `${windDir}°`;
  document.getElementById('wind-gusts-text').innerText = `Böenspitzen bis ${windGusts} km/h`;

  // Sun
  if (daily && daily.sunrise && daily.sunset) {
    const sunrise = new Date(daily.sunrise[0]);
    const sunset = new Date(daily.sunset[0]);
    document.getElementById('sunrise-time-val').innerText = sunrise.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('sunset-time-val').innerText = sunset.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const diffHours = ((sunset - sunrise) / (1000 * 60 * 60)).toFixed(1);
    document.getElementById('daylight-hours-val').innerText = `${diffHours} h Licht`;
  }

  // Precipitation
  const pSum = (daily && daily.precipitation_sum) ? daily.precipitation_sum[0] : 0;
  document.getElementById('precip-total-val').innerHTML = `${pSum.toFixed(1)} <small>mm</small>`;

  // Humidity & Dew
  const rh = Math.round(cur.relative_humidity_2m || 0);
  const dew = (cur.temperature_2m - ((100 - rh) / 5)).toFixed(1);
  document.getElementById('humidity-val').innerText = `${rh}%`;
  document.getElementById('dew-point-sub').innerText = `Taupunkt: ${dew}°C`;

  // Pressure
  const pQNH = Math.round(cur.pressure_msl || 1013);
  const pQFE = Math.round(cur.surface_pressure || pQNH);
  document.getElementById('pressure-val').innerHTML = `${pQNH} <small>hPa</small>`;
  document.getElementById('pressure-qfe').innerText = `Stationsdruck (QFE): ${pQFE} hPa`;
}

// =============================================================================
// TAB 2: BERG & HÖHE (Höhenprofil Tal vs Berg & Wand-Exposition)
// =============================================================================
function renderMountainTab() {
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

  // Update Wall Aspect Info
  updateActiveWallUI(m);
}

function updateActiveWallUI(m) {
  const w = m.microWeather;
  const t = m.terrain10m;

  const wallName = state.activeAspect.isAuto ? `${t.aspectName} (Auto-10m)` : getSelectedWallLabel();
  document.getElementById('active-wall-name').innerText = `${wallName} (${t.tilt}° Neigung)`;
  document.getElementById('active-wall-radiation').innerText = `Sonneneinstrahlung: ${w.slopeSolarIrradianceW_m2} W/m² (GTI)`;
  document.getElementById('active-wall-temp').innerText = `${Math.round(convertTemp(w.temperature10m))}°C`;
  document.getElementById('active-wall-temp-sub').innerText = `Gefühlt: ${Math.round(convertTemp(w.feltTemp))}°C (Modell: ${Math.round(convertTemp(w.modelStandardTemp2m))}°C)`;
  document.getElementById('active-wall-snow').innerText = w.snowCondition;
  document.getElementById('active-wall-wind').innerText = w.slopeWindExposure;
  document.getElementById('active-wall-wind-sub').innerText = `Effektiver Gratwind: ${w.windSpeedKmH} km/h (Böen: ${w.windGustsKmH} km/h)`;
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

      // Reload with new wall geometry
      loadLocation(state.currentLocation);
    });
  });
}

// Vertical Altitude Profile (Tal vs. Berg)
function renderAltitudeChart() {
  const container = document.getElementById('altitude-levels-container');
  if (!state.microData || !state.microData.altitudeProfile) return;

  const profiles = state.microData.altitudeProfile;
  const currentProfile = profiles[state.selectedAltitudeHour] || profiles[0];

  container.innerHTML = '';

  currentProfile.levels.forEach(level => {
    const card = document.createElement('div');
    card.className = 'altitude-tier-card';

    // Temp color calculation
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
  const label = document.getElementById('profile-time-label');

  slider.addEventListener('input', (e) => {
    state.selectedAltitudeHour = parseInt(e.target.value);
    const h = state.selectedAltitudeHour;
    label.innerText = h === 0 ? 'Jetzt' : `In ${h} Stunden`;
    renderAltitudeChart();
  });
}

// =============================================================================
// TAB 3: INTERACTIVE LEAFLET MAP & LIVE RADAR
// =============================================================================
function initLeafletMap() {
  const mapElem = document.getElementById('interactive-map');
  if (!mapElem) return;

  // Initialize Map
  state.map.instance = L.map('interactive-map', {
    zoomControl: true,
    attributionControl: false
  }).setView([state.currentLocation.lat, state.currentLocation.lon], 9);

  // Dark Base Layer
  state.map.baseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 16
  }).addTo(state.map.instance);

  // Location Marker
  state.map.marker = L.marker([state.currentLocation.lat, state.currentLocation.lon])
    .addTo(state.map.instance)
    .bindPopup(`<b>${state.currentLocation.name}</b><br>${state.currentLocation.elevation} m`)
    .openPopup();

  // Map Click to inspect any coordinate!
  state.map.instance.on('click', async (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    selectExactLocation({
      name: `Punkt (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
      lat: lat,
      lon: lon,
      elevation: 1000
    });
  });

  // Layer buttons
  document.querySelectorAll('.map-layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setMapLayer(btn.dataset.layer);
    });
  });

  // Load RainViewer Radar frames
  loadRainViewerRadar();
}

async function loadRainViewerRadar() {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    state.map.radarFrames = [...(data.radar.past || []), ...(data.radar.nowcast || [])];
    state.map.radarHost = data.host;

    const slider = document.getElementById('radar-time-slider');
    slider.max = state.map.radarFrames.length - 1;
    slider.value = (data.radar.past || []).length - 1;
    state.map.radarIndex = parseInt(slider.value);

    showRadarTileFrame(state.map.radarIndex);

    slider.addEventListener('input', (e) => {
      stopRadarAnimation();
      showRadarTileFrame(parseInt(e.target.value));
    });

    document.getElementById('radar-play-btn').addEventListener('click', toggleRadarPlay);
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
  document.getElementById('radar-time-display').innerText = `${t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Radarscan`;
  document.getElementById('radar-time-slider').value = idx;
}

function toggleRadarPlay() {
  const btn = document.getElementById('radar-play-btn');
  if (state.map.radarPlaying) {
    stopRadarAnimation();
  } else {
    state.map.radarPlaying = true;
    btn.innerText = '⏸';
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
  document.getElementById('radar-play-btn').innerText = '▶';
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
    // Default Radar mode
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
// TAB 4: FAVORITEN & SUCHE
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
      country: loc.country
    });
  }

  localStorage.setItem('best_weather_favorites_v2', JSON.stringify(state.favorites));
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
    card.innerHTML = `
      <div class="fav-info">
        <div class="fav-name">${fav.name}</div>
        <div class="fav-meta">🏔️ ${fav.elevation} m • ${fav.country || ''}</div>
      </div>
      <div class="fav-actions">
        <button class="fav-del-btn" title="Aus Favoriten entfernen">✕</button>
      </div>
    `;

    // Click to load
    card.addEventListener('click', (e) => {
      if (!e.target.classList.contains('fav-del-btn')) {
        selectExactLocation(fav);
        switchTab('tab-overview');
      }
    });

    // Delete button
    card.querySelector('.fav-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      state.favorites.splice(i, 1);
      localStorage.setItem('best_weather_favorites_v2', JSON.stringify(state.favorites));
      renderFavoritesTab();
      updateFavStarUI();
    });

    grid.appendChild(card);
  });
}

// =============================================================================
// SEARCH AUTOCOMPLETE & GPS (EXACT COORDINATES & ELEVATION)
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
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=de&format=json`;
        const res = await fetch(url);
        const data = await res.json();

        dropdown.innerHTML = '';
        if (data.results && data.results.length > 0) {
          data.results.forEach(item => {
            const row = document.createElement('div');
            row.className = 'dropdown-item';
            const elevText = item.elevation ? `${Math.round(item.elevation)} m` : '';
            const admin = [item.admin1, item.country].filter(Boolean).join(', ');

            row.innerHTML = `
              <div>
                <div class="dropdown-city">${item.name}</div>
                <div class="dropdown-region">${admin}</div>
              </div>
              ${elevText ? `<div class="dropdown-elevation">🏔️ ${elevText}</div>` : ''}
            `;

            row.addEventListener('click', () => {
              selectExactLocation({
                name: item.name,
                lat: item.latitude,
                lon: item.longitude,
                elevation: Math.round(item.elevation || 500),
                country: item.country || ''
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
            selectExactLocation({
              name: 'Mein Standort',
              lat: lat,
              lon: lon,
              elevation: 500
            });
          },
          (err) => {
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
      renderMountainTab();
      renderAltitudeChart();
    });
  }
}

function selectExactLocation(loc) {
  loadLocation(loc);
}

// =============================================================================
// TAB 5: ALPEN-MESSNETZE GEO-ROUTING HIGHLIGHT
// =============================================================================
function updateGeoRoutingNetworks() {
  const lat = state.currentLocation.lat;
  const lon = state.currentLocation.lon;

  const netDwd = document.getElementById('net-dwd');
  const netLawis = document.getElementById('net-lawis');
  const netSuedtirol = document.getElementById('net-suedtirol');
  const netSlf = document.getElementById('net-slf');
  const routingBadge = document.getElementById('active-routing-badge');

  // Reset highlights
  [netDwd, netLawis, netSuedtirol, netSlf].forEach(n => {
    if (n) n.style.borderColor = 'rgba(255, 255, 255, 0.08)';
  });

  if (lat >= 47.05 && lat <= 48.0 && lon >= 9.5 && lon <= 13.5) {
    // Bayerischer Alpenrand & Nordtirol -> LAWIS & DWD
    if (netLawis) netLawis.style.borderColor = 'var(--ios-cyan)';
    if (netDwd) netDwd.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: LAWIS Bayern / Tirol + DWD aktiv';
  } else if (lat < 47.05 && lat >= 45.8 && lon >= 10.4 && lon <= 12.6) {
    // Südtirol & Dolomiten -> Open Data Hub Südtirol
    if (netSuedtirol) netSuedtirol.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: Open Data Hub Südtirol aktiv';
  } else if (lon < 10.2 && lat >= 45.5 && lat <= 47.8) {
    // Schweiz & Westalpen -> SLF IMIS + Météo-France
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
