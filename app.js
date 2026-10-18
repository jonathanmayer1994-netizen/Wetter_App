/**
 * BEST WEATHER — Ultra-High Precision iPhone Weather App
 * Powered by Open-Meteo 90m DEM Downscaling & RainViewer Polarimetric Live Radar
 */

// =============================================================================
// STATE & CONFIGURATION
// =============================================================================
const state = {
  currentLocation: {
    name: 'München',
    lat: 48.1371,
    lon: 11.5754,
    elevation: 519,
    country: 'Deutschland'
  },
  weatherData: null,
  unit: 'celsius', // 'celsius' or 'fahrenheit'
  favorites: JSON.parse(localStorage.getItem('best_weather_favorites') || '[]'),
  radar: {
    map: null,
    radarLayers: [],
    currentFrameIndex: 0,
    animationInterval: null,
    isPlaying: false,
    frames: [],
    marker: null
  },
  canvasEngine: null
};

// Weather Code mapping according to WMO standard
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
  96: { label: 'Gewitter mit leichtem Hagel', icon: '⛈️', iconNight: '⛈️', theme: 'thunder', themeNight: 'thunder' },
  99: { label: 'Schweres Hagelgewitter', icon: '⛈️', iconNight: '⛈️', theme: 'thunder', themeNight: 'thunder' }
};

// =============================================================================
// ATMOSPHERIC CANVAS PARTICLE ENGINE (Rain, Snow, Stars, Clouds, Sun Rays)
// =============================================================================
class WeatherCanvasEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.clouds = [];
    this.stars = [];
    this.currentMode = 'clear-day';
    this.isDay = true;
    this.animationFrameId = null;
    this.lightningTimer = 0;
    this.lightningAlpha = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.initStars();
    this.initClouds();
    this.animate = this.animate.bind(this);
    this.animate();
  }

  resize() {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
  }

  setMode(theme, isDay) {
    this.currentMode = theme;
    this.isDay = isDay;
    this.particles = [];

    // Initialize particles based on weather
    if (theme === 'rain') {
      const count = Math.floor(this.width / 5);
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          length: 12 + Math.random() * 16,
          speed: 12 + Math.random() * 10,
          opacity: 0.3 + Math.random() * 0.4
        });
      }
    } else if (theme === 'snow') {
      const count = Math.floor(this.width / 8);
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          radius: 1.5 + Math.random() * 3,
          speed: 1 + Math.random() * 2,
          wind: -0.5 + Math.random() * 1,
          sway: Math.random() * Math.PI * 2,
          opacity: 0.4 + Math.random() * 0.5
        });
      }
    } else if (theme === 'thunder') {
      const count = Math.floor(this.width / 4);
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          length: 18 + Math.random() * 20,
          speed: 18 + Math.random() * 12,
          opacity: 0.5 + Math.random() * 0.4
        });
      }
    }
  }

  initStars() {
    this.stars = [];
    const starCount = 85;
    for (let i = 0; i < starCount; i++) {
      this.stars.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * (window.innerHeight * 0.6),
        radius: 0.8 + Math.random() * 1.5,
        alpha: Math.random(),
        twinkleSpeed: 0.01 + Math.random() * 0.02
      });
    }
  }

  initClouds() {
    this.clouds = [];
    for (let i = 0; i < 4; i++) {
      this.clouds.push({
        x: Math.random() * window.innerWidth,
        y: 60 + Math.random() * 180,
        radius: 120 + Math.random() * 100,
        speed: 0.2 + Math.random() * 0.3,
        opacity: 0.08 + Math.random() * 0.08
      });
    }
  }

  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    // 1. Stars at Night
    if (!this.isDay || this.currentMode === 'clear-night') {
      this.ctx.save();
      for (const star of this.stars) {
        star.alpha += star.twinkleSpeed;
        const opacity = (Math.sin(star.alpha) + 1) / 2 * 0.8 + 0.1;
        this.ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    // 2. Sun Rays during Clear Day
    if (this.isDay && this.currentMode === 'clear-day') {
      this.ctx.save();
      const sunGradient = this.ctx.createRadialGradient(
        this.width * 0.7, 80, 20,
        this.width * 0.7, 80, this.width * 0.6
      );
      sunGradient.addColorStop(0, 'rgba(255, 220, 100, 0.22)');
      sunGradient.addColorStop(0.5, 'rgba(255, 180, 50, 0.06)');
      sunGradient.addColorStop(1, 'transparent');
      this.ctx.fillStyle = sunGradient;
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.restore();
    }

    // 3. Clouds
    if (this.currentMode === 'cloudy' || this.currentMode === 'rain' || this.currentMode === 'thunder') {
      this.ctx.save();
      for (const cloud of this.clouds) {
        cloud.x += cloud.speed;
        if (cloud.x - cloud.radius > this.width) {
          cloud.x = -cloud.radius;
        }
        const grad = this.ctx.createRadialGradient(cloud.x, cloud.y, cloud.radius * 0.2, cloud.x, cloud.y, cloud.radius);
        grad.addColorStop(0, `rgba(255, 255, 255, ${cloud.opacity})`);
        grad.addColorStop(1, 'transparent');
        this.ctx.fillStyle = grad;
        this.ctx.beginPath();
        this.ctx.arc(cloud.x, cloud.y, cloud.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    // 4. Rain Particles
    if (this.currentMode === 'rain' || this.currentMode === 'thunder') {
      this.ctx.save();
      this.ctx.strokeStyle = 'rgba(180, 225, 255, 0.65)';
      this.ctx.lineWidth = 1.3;
      for (const p of this.particles) {
        p.y += p.speed;
        p.x -= 2; // slight wind angle
        if (p.y > this.height) {
          p.y = -p.length;
          p.x = Math.random() * (this.width + 100);
        }
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
        this.ctx.lineTo(p.x - 2, p.y + p.length);
        this.ctx.stroke();
      }
      this.ctx.restore();
    }

    // 5. Snow Particles
    if (this.currentMode === 'snow') {
      this.ctx.save();
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      for (const s of this.particles) {
        s.sway += 0.02;
        s.y += s.speed;
        s.x += Math.sin(s.sway) * 1.2 + s.wind;
        if (s.y > this.height) {
          s.y = -5;
          s.x = Math.random() * this.width;
        }
        this.ctx.beginPath();
        this.ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.restore();
    }

    // 6. Thunder Flash
    if (this.currentMode === 'thunder') {
      this.lightningTimer++;
      if (this.lightningTimer > 200 && Math.random() < 0.03) {
        this.lightningAlpha = 0.55;
        this.lightningTimer = 0;
      }
      if (this.lightningAlpha > 0) {
        this.ctx.save();
        this.ctx.fillStyle = `rgba(220, 200, 255, ${this.lightningAlpha})`;
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.restore();
        this.lightningAlpha *= 0.85;
      }
    }

    this.animationFrameId = requestAnimationFrame(this.animate);
  }
}

// =============================================================================
// API DATA FETCHING (Open-Meteo with 90m DEM NASA/Copernicus Downscaling)
// =============================================================================
async function fetchWeatherData(lat, lon) {
  try {
    // Open-Meteo with DEM-Downscaling enabled via &elevation=nan
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&elevation=nan&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,pressure_msl,surface_pressure,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,freezing_level_height&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.weatherData = data;
    
    // Exact DEM Elevation returned by Copernicus/NASA model
    if (data.elevation !== undefined) {
      state.currentLocation.elevation = Math.round(data.elevation);
    }
    
    renderApp();
    updateLiveRadarLocation(lat, lon);
  } catch (err) {
    console.error('Fehler beim Abrufen der Wetterdaten:', err);
    document.getElementById('current-condition').innerText = 'Verbindung fehlgeschlagen';
  }
}

// =============================================================================
// RENDER WEATHER UI
// =============================================================================
function renderApp() {
  const data = state.weatherData;
  if (!data || !data.current) return;

  const cur = data.current;
  const hourly = data.hourly;
  const daily = data.daily;
  const isDay = cur.is_day === 1;
  const codeInfo = WMO_CODES[cur.weather_code] || WMO_CODES[0];
  const theme = isDay ? codeInfo.theme : codeInfo.themeNight;

  // Apply Atmospheric Theme to Document Body
  document.body.className = `weather-${theme}`;
  if (state.canvasEngine) {
    state.canvasEngine.setMode(theme, isDay);
  }

  // Dynamic Island
  document.getElementById('island-icon').innerText = isDay ? codeInfo.icon : codeInfo.iconNight;
  document.getElementById('island-text').innerText = `${state.currentLocation.name} • ${formatTemp(cur.temperature_2m)}`;

  // Header / Hero
  document.getElementById('location-name').innerText = state.currentLocation.name;
  document.getElementById('dem-elevation-text').innerText = `${state.currentLocation.elevation.toLocaleString('de-DE')} m ü. M.`;
  document.getElementById('current-temp').innerText = Math.round(convertTemp(cur.temperature_2m));
  document.getElementById('display-temp-unit').innerText = state.unit === 'celsius' ? '°' : '°F';
  document.getElementById('current-condition').innerText = codeInfo.label;

  // High / Low / Apparent
  const todayMax = daily && daily.temperature_2m_max ? Math.round(convertTemp(daily.temperature_2m_max[0])) : '--';
  const todayMin = daily && daily.temperature_2m_min ? Math.round(convertTemp(daily.temperature_2m_min[0])) : '--';
  const apparent = Math.round(convertTemp(cur.apparent_temperature));
  document.getElementById('temp-max').innerText = `${todayMax}°`;
  document.getElementById('temp-min').innerText = `${todayMin}°`;
  document.getElementById('temp-apparent').innerText = `${apparent}°`;
  document.getElementById('last-updated-text').innerText = `Zuletzt aktualisiert: ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

  // Render High Precision DEM & Microclimate Downscaling Card
  renderMicroclimate(cur, hourly, daily);

  // Render 24h Hourly Forecast Slider
  renderHourlyForecast(hourly, cur);

  // Render 10-Day Forecast List with Range Bars
  renderDailyForecast(daily);

  // Render Bento Grid Details
  renderBentoGrid(cur, daily, hourly);

  // Update Favorite Star status
  updateFavoriteStarUI();
}

// =============================================================================
// HIGH-PRECISION MICROCLIMATE & DEM DOWNSCALING SECTION
// =============================================================================
function renderMicroclimate(cur, hourly, daily) {
  const elev = state.currentLocation.elevation;
  document.getElementById('micro-elevation').innerText = `${elev.toLocaleString('de-DE')} m`;

  // Freezing Level (Schneefallgrenze / 0°C Isotherme)
  let freezingLevel = 0;
  if (hourly && hourly.freezing_level_height && hourly.freezing_level_height.length > 0) {
    freezingLevel = Math.round(hourly.freezing_level_height[0]);
    document.getElementById('micro-freezing-level').innerText = `${freezingLevel.toLocaleString('de-DE')} m`;

    const diff = freezingLevel - elev;
    if (diff <= 0) {
      document.getElementById('micro-freezing-sub').innerHTML = `<span style="color:#64d2ff; font-weight:700;">❄️ Frost/Schnee auf Standort-Höhe!</span>`;
    } else {
      document.getElementById('micro-freezing-sub').innerText = `+${diff.toLocaleString('de-DE')} m über Standort`;
    }

    // Position Elevation Visual Gauge Markers
    const maxGauge = 3500;
    const currentPercent = Math.min(100, Math.max(5, (elev / maxGauge) * 100));
    const freezingPercent = Math.min(100, Math.max(5, (freezingLevel / maxGauge) * 100));
    
    document.getElementById('marker-current').style.left = `${currentPercent}%`;
    document.getElementById('marker-current-val').innerText = `${elev}m`;
    document.getElementById('marker-freezing').style.left = `${freezingPercent}%`;
    document.getElementById('marker-freezing-val').innerText = `${freezingLevel}m`;
  }

  // Dew point & condensation risk
  let dewPoint = cur.temperature_2m - ((100 - cur.relative_humidity_2m) / 5);
  if (hourly && hourly.dew_point_2m && hourly.dew_point_2m.length > 0) {
    dewPoint = hourly.dew_point_2m[0];
  }
  document.getElementById('micro-dew-point').innerText = `${dewPoint.toFixed(1)} °C`;
  
  const dewSpread = Math.abs(cur.temperature_2m - dewPoint);
  let dewRisk = 'Gering (Trockene Luft)';
  if (dewSpread < 1.8) dewRisk = '⚠️ Hoch (Nebel- & Reifbildung)';
  else if (dewSpread < 3.5) dewRisk = 'Mäßig (Tau/Kondensation)';
  document.getElementById('micro-dew-sub').innerText = `Kondensationsrisiko: ${dewRisk}`;

  // Topographical Wind-Downscaling (Venturi & Ridge Acceleration)
  let windEffect = 'Normal (Tal/Ebene)';
  let windSub = 'Standard Grenzschichtströmung';
  if (elev > 1800) {
    windEffect = 'Hochalpin / Grat-Effekt';
    windSub = 'Venturi-Böenverstärkung an Kämmen';
  } else if (elev > 800) {
    windEffect = 'Mittelgebirgs-Kompression';
    windSub = 'Hangwinde & orografische Verstärkung';
  } else if (cur.wind_speed_10m < 6) {
    windEffect = 'Geschützte Talinversion';
    windSub = 'Kaltluftseen-Bildung möglich';
  }
  document.getElementById('micro-wind-effect').innerText = windEffect;
  document.getElementById('micro-wind-sub').innerText = windSub;
}

// =============================================================================
// HOURLY FORECAST (Horizontal 24h Slider)
// =============================================================================
function renderHourlyForecast(hourly, cur) {
  const container = document.getElementById('hourly-forecast-list');
  if (!hourly || !hourly.time) return;

  container.innerHTML = '';
  const now = new Date();
  const currentHour = now.getHours();

  // Find index of current hour
  let startIndex = 0;
  for (let i = 0; i < hourly.time.length; i++) {
    const t = new Date(hourly.time[i]);
    if (t.getDate() === now.getDate() && t.getHours() === currentHour) {
      startIndex = i;
      break;
    }
  }

  // Show next 24 hours
  for (let i = startIndex; i < startIndex + 25 && i < hourly.time.length; i++) {
    const timeObj = new Date(hourly.time[i]);
    const isFirst = i === startIndex;
    const hourLabel = isFirst ? 'Jetzt' : `${timeObj.getHours()}:00`;
    const temp = Math.round(convertTemp(hourly.temperature_2m[i]));
    const pop = hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0;
    const code = hourly.weather_code[i];
    const isDayTime = timeObj.getHours() >= 6 && timeObj.getHours() <= 20;
    const info = WMO_CODES[code] || WMO_CODES[0];
    const icon = isDayTime ? info.icon : info.iconNight;
    const windSpeed = Math.round(hourly.wind_speed_10m[i]);

    const item = document.createElement('div');
    item.className = 'hourly-item';
    item.innerHTML = `
      <div class="hourly-time">${hourLabel}</div>
      <div class="hourly-icon">${icon}</div>
      <div class="hourly-pop">${pop > 10 ? `${pop}%` : ''}</div>
      <div class="hourly-temp">${temp}°</div>
      <div class="hourly-wind">💨 ${windSpeed}</div>
    `;
    container.appendChild(item);
  }
}

// =============================================================================
// 10-DAY FORECAST (Apple Weather Style with Normalized Range Bars)
// =============================================================================
function renderDailyForecast(daily) {
  const container = document.getElementById('daily-forecast-list');
  if (!daily || !daily.time) return;

  container.innerHTML = '';

  // Determine global min and max temperature across all 10 days for bar normalization
  let globalMin = Infinity;
  let globalMax = -Infinity;
  const count = Math.min(10, daily.time.length);

  for (let i = 0; i < count; i++) {
    const min = daily.temperature_2m_min[i];
    const max = daily.temperature_2m_max[i];
    if (min < globalMin) globalMin = min;
    if (max > globalMax) globalMax = max;
  }
  const totalRange = (globalMax - globalMin) || 1;

  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

  for (let i = 0; i < count; i++) {
    const dateObj = new Date(daily.time[i]);
    const isToday = i === 0;
    const dayName = isToday ? 'Heute' : weekdays[dateObj.getDay()];
    const code = daily.weather_code[i];
    const info = WMO_CODES[code] || WMO_CODES[0];
    const pop = daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : 0;
    const minVal = daily.temperature_2m_min[i];
    const maxVal = daily.temperature_2m_max[i];

    // Compute left offset and width percentage for Apple Weather Range Bar
    const leftPercent = Math.max(0, ((minVal - globalMin) / totalRange) * 100);
    const widthPercent = Math.max(10, (((maxVal - minVal) / totalRange) * 100));

    const row = document.createElement('div');
    row.className = 'daily-row';
    row.innerHTML = `
      <div class="daily-day">${dayName}</div>
      <div class="daily-icon">${info.icon}</div>
      <div class="daily-pop">${pop > 15 ? `${pop}%` : ''}</div>
      <div class="daily-temp-min">${Math.round(convertTemp(minVal))}°</div>
      <div class="daily-bar-wrapper">
        <div class="daily-bar-range" style="left: ${leftPercent}%; width: ${widthPercent}%;"></div>
      </div>
      <div class="daily-temp-max">${Math.round(convertTemp(maxVal))}°</div>
    `;
    container.appendChild(row);
  }
}

// =============================================================================
// BENTO DETAIL GRID
// =============================================================================
function renderBentoGrid(cur, daily, hourly) {
  // 1. UV-Index
  const uv = cur.uv_index !== undefined ? Math.round(cur.uv_index) : 0;
  document.getElementById('uv-index-val').innerText = uv;
  let uvDesc = 'Niedrig';
  let uvHint = 'Kein besonderer Sonnenschutz erforderlich.';
  if (uv >= 8) { uvDesc = 'Sehr hoch'; uvHint = 'Intensive Schutzmaßnahmen: Schatten & Sonnencreme!'; }
  else if (uv >= 6) { uvDesc = 'Hoch'; uvHint = 'Sonnencreme, Sonnenbrille & Kopfbedeckung ratsam.'; }
  else if (uv >= 3) { uvDesc = 'Mittel'; uvHint = 'Mittags Schatten aufsuchen.'; }
  document.getElementById('uv-index-desc').innerText = uvDesc;
  document.getElementById('uv-index-hint').innerText = uvHint;
  document.getElementById('uv-gauge-pointer').style.left = `${Math.min(100, Math.max(5, (uv / 11) * 100))}%`;

  // 2. Wind & Gusts with Compass
  const windSpd = Math.round(cur.wind_speed_10m || 0);
  const windDir = cur.wind_direction_10m || 0;
  const windGusts = Math.round(cur.wind_gusts_10m || windSpd * 1.4);
  document.getElementById('wind-speed-val').innerHTML = `${windSpd} <small>km/h</small>`;
  document.getElementById('compass-arrow').style.transform = `rotate(${windDir}deg)`;
  document.getElementById('wind-direction-text').innerText = `${getDirectionName(windDir)} (${windDir}°)`;
  document.getElementById('wind-gusts-text').innerText = `Spitzenböen bis zu ${windGusts} km/h`;

  // 3. Sunrise & Sunset
  if (daily && daily.sunrise && daily.sunset) {
    const sunrise = new Date(daily.sunrise[0]);
    const sunset = new Date(daily.sunset[0]);
    document.getElementById('sunrise-time-val').innerText = sunrise.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('sunset-time-val').innerText = sunset.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    
    const diffHours = ((sunset - sunrise) / (1000 * 60 * 60)).toFixed(1);
    document.getElementById('daylight-hours-val').innerText = `${diffHours} h Tageslicht`;
  }

  // 4. Precipitation
  let precipSum = 0;
  if (daily && daily.precipitation_sum) {
    precipSum = daily.precipitation_sum[0] || 0;
  }
  document.getElementById('precip-total-val').innerHTML = `${precipSum.toFixed(1)} <small>mm</small>`;
  if (cur.precipitation > 0) {
    document.getElementById('precip-forecast-hint').innerText = `Aktuelle Niederschlagsrate: ${cur.precipitation.toFixed(1)} mm/h.`;
  } else {
    document.getElementById('precip-forecast-hint').innerText = 'In den nächsten Stunden wird überwiegend trockene Witterung erwartet.';
  }

  // 5. Humidity & Dew Point
  const humidity = Math.round(cur.relative_humidity_2m || 0);
  document.getElementById('humidity-val').innerText = `${humidity}%`;
  const dew = (cur.temperature_2m - ((100 - humidity) / 5)).toFixed(1);
  document.getElementById('dew-point-hint').innerText = `Der Taupunkt liegt aktuell bei ${dew}°C.`;

  // 6. Air Pressure QNH & QFE
  const pressureQNH = Math.round(cur.pressure_msl || 1013);
  const pressureQFE = Math.round(cur.surface_pressure || pressureQNH);
  document.getElementById('pressure-val').innerHTML = `${pressureQNH} <small>hPa</small>`;
  document.getElementById('surface-pressure-val').innerText = `Stationsdruck (QFE): ${pressureQFE} hPa`;
  document.getElementById('pressure-trend').innerText = pressureQNH > 1015 ? 'Tendenz: Stabiles Hochdruckwetter' : (pressureQNH < 1005 ? 'Tendenz: Tiefdruckeinfluss' : 'Tendenz: Normaler Luftdruck');

  // 7. Visibility
  let visKm = 25;
  if (hourly && hourly.visibility && hourly.visibility.length > 0) {
    visKm = Math.round(hourly.visibility[0] / 1000);
  }
  document.getElementById('visibility-val').innerHTML = `${visKm} <small>km</small>`;
  document.getElementById('visibility-desc').innerText = visKm > 20 ? 'Ausgezeichnete Fernsicht' : (visKm > 10 ? 'Gute Sicht' : 'Eingeschränkte Sicht');

  // 8. Moon Phase calculation
  const moon = calculateMoonPhase(new Date());
  document.getElementById('moon-phase-name').innerText = moon.name;
  document.getElementById('moon-illumination').innerText = `Beleuchtung: ${Math.round(moon.fraction * 100)}%`;
  document.getElementById('moon-illustration').innerText = moon.icon;
  document.getElementById('moon-rise-hint').innerText = `Tage bis zum nächsten Vollmond: ${moon.daysToFull}`;
}

// Direction Name from degrees
function getDirectionName(deg) {
  const directions = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(deg / 22.5) % 16;
  return directions[idx];
}

// Moon Phase algorithm
function calculateMoonPhase(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  let c = 0, e = 0, jd = 0, b = 0;
  if (month < 3) {
    c = year - 1;
    e = month + 12;
  } else {
    c = year;
    e = month;
  }
  b = Math.floor(c / 400) - Math.floor(c / 100) + Math.floor(c / 4);
  jd = 365.25 * c + 30.6 * (e + 1) + day - 694039.09;
  jd /= 29.5305882; // Synodic month
  const phase = jd - Math.floor(jd);

  const daysToFull = Math.max(0, Math.round((0.5 - (phase > 0.5 ? phase - 1 : phase)) * 29.53));

  let name = 'Neumond';
  let icon = '🌑';
  if (phase < 0.03 || phase > 0.97) { name = 'Neumond'; icon = '🌑'; }
  else if (phase < 0.22) { name = 'Zunehmende Sichel'; icon = '🌒'; }
  else if (phase < 0.28) { name = 'Erstes Viertel'; icon = '🌓'; }
  else if (phase < 0.47) { name = 'Zunehmender Mond'; icon = '🌔'; }
  else if (phase < 0.53) { name = 'Vollmond'; icon = '🌕'; }
  else if (phase < 0.72) { name = 'Abnehmender Mond'; icon = '🌖'; }
  else if (phase < 0.78) { name = 'Letztes Viertel'; icon = '🌗'; }
  else { name = 'Abnehmende Sichel'; icon = '🌘'; }

  const fraction = 0.5 * (1 - Math.cos(phase * 2 * Math.PI));
  return { name, icon, fraction, daysToFull };
}

// =============================================================================
// POLARIMETRISCHES LIVE-RADAR (RainViewer HD API & Leaflet)
// =============================================================================
async function initLiveRadar() {
  const mapElem = document.getElementById('radar-map');
  if (!mapElem) return;

  // Initialize Leaflet Map
  state.radar.map = L.map('radar-map', {
    zoomControl: true,
    attributionControl: false
  }).setView([state.currentLocation.lat, state.currentLocation.lon], 7);

  // Dark Map Tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 14,
    subdomains: 'abcd'
  }).addTo(state.radar.map);

  // Current Location Marker
  state.radar.marker = L.circleMarker([state.currentLocation.lat, state.currentLocation.lon], {
    radius: 7,
    color: '#0a84ff',
    fillColor: '#64d2ff',
    fillOpacity: 0.9,
    weight: 2
  }).addTo(state.radar.map);

  // Fetch RainViewer Radar Frames
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!res.ok) throw new Error(`RainViewer HTTP ${res.status}`);
    const data = await res.json();
    
    // Combine past radar frames + nowcast forecast frames
    const frames = [...(data.radar.past || []), ...(data.radar.nowcast || [])];
    state.radar.frames = frames;
    state.radar.host = data.host;

    const slider = document.getElementById('radar-time-slider');
    slider.max = frames.length - 1;
    slider.value = (data.radar.past || []).length - 1; // latest live frame
    state.radar.currentFrameIndex = parseInt(slider.value);

    // Preload radar layers
    showRadarFrame(state.radar.currentFrameIndex);

    // Bind slider & play controls
    slider.addEventListener('input', (e) => {
      stopRadarAnimation();
      showRadarFrame(parseInt(e.target.value));
    });

    document.getElementById('radar-play-btn').addEventListener('click', toggleRadarPlay);

  } catch (err) {
    console.error('Fehler beim Laden des RainViewer Radars:', err);
    document.getElementById('radar-time-display').innerText = 'Radar temporär nicht verfügbar';
  }
}

function showRadarFrame(index) {
  const frames = state.radar.frames;
  if (!frames || !frames[index]) return;

  state.radar.currentFrameIndex = index;
  const frame = frames[index];

  // Remove existing radar tile layer
  if (state.radar.activeTileLayer) {
    state.radar.map.removeLayer(state.radar.activeTileLayer);
  }

  // Polarimetric RainViewer HD Tile Layer
  // Color scheme 2 = universal high-contrast weather colors
  const tileUrl = `${state.radar.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  state.radar.activeTileLayer = L.tileLayer(tileUrl, {
    opacity: 0.75,
    zIndex: 100
  }).addTo(state.radar.map);

  // Format timestamp label
  const time = new Date(frame.time * 1000);
  const timeStr = time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const isNowcast = index >= (state.radar.frames.length - 4);
  document.getElementById('radar-time-display').innerText = `${timeStr} ${isNowcast ? '(Prognose / Nowcast)' : '(Polarimetrischer Scan)'}`;
  document.getElementById('radar-time-slider').value = index;
}

function toggleRadarPlay() {
  const btn = document.getElementById('radar-play-btn');
  if (state.radar.isPlaying) {
    stopRadarAnimation();
  } else {
    state.radar.isPlaying = true;
    btn.innerText = '⏸';
    state.radar.animationInterval = setInterval(() => {
      let nextIndex = state.radar.currentFrameIndex + 1;
      if (nextIndex >= state.radar.frames.length) {
        nextIndex = 0;
      }
      showRadarFrame(nextIndex);
    }, 750);
  }
}

function stopRadarAnimation() {
  if (state.radar.animationInterval) {
    clearInterval(state.radar.animationInterval);
    state.radar.animationInterval = null;
  }
  state.radar.isPlaying = false;
  document.getElementById('radar-play-btn').innerText = '▶';
}

function updateLiveRadarLocation(lat, lon) {
  if (state.radar.map) {
    state.radar.map.setView([lat, lon], 8);
    if (state.radar.marker) {
      state.radar.marker.setLatLng([lat, lon]);
    }
  }
}

// =============================================================================
// SEARCH & GEOCODING AUTOCOMPLETE (Open-Meteo Geocoding)
// =============================================================================
let searchDebounceTimer = null;

function setupSearch() {
  const input = document.getElementById('location-search-input');
  const dropdown = document.getElementById('search-results-dropdown');
  const clearBtn = document.getElementById('clear-search-btn');

  input.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearBtn.style.display = val.length > 0 ? 'flex' : 'none';

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

    if (val.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    searchDebounceTimer = setTimeout(async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(val)}&count=8&language=de&format=json`;
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
              selectLocation({
                name: item.name,
                lat: item.latitude,
                lon: item.longitude,
                elevation: item.elevation || 500,
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
          dropdown.innerHTML = '<div style="padding:14px; text-align:center; color:rgba(255,255,255,0.6); font-size:13px;">Keine Orte gefunden</div>';
          dropdown.style.display = 'block';
        }
      } catch (err) {
        console.error('Geocoding Fehler:', err);
      }
    }, 280);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    dropdown.style.display = 'none';
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper') && !e.target.closest('.search-dropdown')) {
      dropdown.style.display = 'none';
    }
  });
}

function selectLocation(loc) {
  state.currentLocation = loc;
  
  // Highlight matching preset button if any
  document.querySelectorAll('.preset-pill').forEach(btn => {
    const lat = parseFloat(btn.dataset.lat);
    const lon = parseFloat(btn.dataset.lon);
    if (Math.abs(lat - loc.lat) < 0.05 && Math.abs(lon - loc.lon) < 0.05) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  fetchWeatherData(loc.lat, loc.lon);
}

// =============================================================================
// GPS & PRESETS & FAVORITES
// =============================================================================
function setupPresetsAndGPS() {
  // Preset buttons
  document.querySelectorAll('.preset-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectLocation({
        name: btn.dataset.name,
        lat: parseFloat(btn.dataset.lat),
        lon: parseFloat(btn.dataset.lon),
        elevation: 500
      });
    });
  });

  // GPS Button
  const gpsBtn = document.getElementById('gps-btn');
  gpsBtn.addEventListener('click', () => {
    if ('geolocation' in navigator) {
      gpsBtn.style.opacity = '0.5';
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          gpsBtn.style.opacity = '1';
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          
          // Reverse geocoding via Open-Meteo or generic name
          let placeName = 'Mein Standort';
          try {
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${lat.toFixed(2)},${lon.toFixed(2)}&count=1&language=de`);
            const geoData = await geoRes.json();
            if (geoData.results && geoData.results[0]) {
              placeName = geoData.results[0].name;
            }
          } catch(e) {}

          selectLocation({
            name: placeName,
            lat: lat,
            lon: lon,
            elevation: 400
          });
        },
        (error) => {
          gpsBtn.style.opacity = '1';
          alert('GPS-Standort konnte nicht ermittelt werden. Bitte Berechtigung in Safari erlauben.');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      alert('Geolocation wird von diesem Browser nicht unterstützt.');
    }
  });

  // Favorite Star Button
  const favBtn = document.getElementById('favorite-btn');
  favBtn.addEventListener('click', () => {
    const loc = state.currentLocation;
    const idx = state.favorites.findIndex(f => f.name === loc.name);
    if (idx >= 0) {
      state.favorites.splice(idx, 1);
    } else {
      state.favorites.push(loc);
    }
    localStorage.setItem('best_weather_favorites', JSON.stringify(state.favorites));
    updateFavoriteStarUI();
  });

  // Unit toggle (°C / °F)
  const unitBtn = document.getElementById('unit-toggle-btn');
  unitBtn.addEventListener('click', () => {
    state.unit = state.unit === 'celsius' ? 'fahrenheit' : 'celsius';
    unitBtn.innerText = state.unit === 'celsius' ? '°C' : '°F';
    renderApp();
  });

  // Desktop iPhone Frame Mode Toggle
  const toggleFrameBtn = document.getElementById('toggle-frame-btn');
  if (toggleFrameBtn) {
    toggleFrameBtn.addEventListener('click', () => {
      const container = document.getElementById('device-container');
      if (container.classList.contains('desktop-wide-active')) {
        container.classList.remove('desktop-wide-active');
        container.classList.add('iphone-frame-active');
        toggleFrameBtn.innerText = '🖥️ Vollbild-Ansicht';
      } else {
        container.classList.remove('iphone-frame-active');
        container.classList.add('desktop-wide-active');
        toggleFrameBtn.innerText = '📱 iPhone-Ansicht';
      }
    });
  }
}

function updateFavoriteStarUI() {
  const favBtn = document.getElementById('favorite-btn');
  const isFav = state.favorites.some(f => f.name === state.currentLocation.name);
  if (isFav) {
    favBtn.innerText = '★';
    favBtn.classList.add('favorited');
  } else {
    favBtn.innerText = '☆';
    favBtn.classList.remove('favorited');
  }
}

function convertTemp(celsius) {
  if (state.unit === 'fahrenheit') {
    return (celsius * 9/5) + 32;
  }
  return celsius;
}

function formatTemp(celsius) {
  const val = Math.round(convertTemp(celsius));
  return `${val}°${state.unit === 'celsius' ? 'C' : 'F'}`;
}

// =============================================================================
// INITIALIZATION
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Start Canvas Engine
  state.canvasEngine = new WeatherCanvasEngine('weather-canvas');

  // Update status bar time clock
  setInterval(() => {
    const timeElem = document.getElementById('ios-status-time');
    if (timeElem) {
      const d = new Date();
      timeElem.innerText = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
  }, 1000);

  // Setup UI event listeners
  setupSearch();
  setupPresetsAndGPS();

  // Initialize Live Radar
  initLiveRadar();

  // Initial Weather Load for default location (München)
  fetchWeatherData(state.currentLocation.lat, state.currentLocation.lon);
});
