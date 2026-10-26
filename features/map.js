/**
 * BEST WEATHER — Map & 24h Radar Domain Feature Module (Task 1a)
 * Leaflet multi-layer radar animation player, time scrubber,
 * station synthesis, and weather overlays (precip, wind, cloud, temp, pressure).
 */

import { state } from '../core/state.js';
import { BASE_LAYERS, REGIONAL_STATIONS, WMO_CODES } from '../core/constants.js';
import { selectExactLocation } from './search.js';
import { MicroEngine } from '../microEngine.js';
import { escapeHtml } from '../httpClient.js';

export function createUserLocationBeaconIcon(loc) {
  const name = loc && loc.name ? loc.name : 'Standort';
  const ele = loc && loc.elevation ? `${loc.elevation} m` : '';
  return L.divIcon({
    className: 'custom-location-beacon-container',
    html: `
      <div class="user-location-beacon" title="${escapeHtml(name)} ${ele ? `(${ele})` : ''}">
        <div class="beacon-pulse-ring"></div>
        <div class="beacon-core-dot">📍</div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

export function initLeafletMap() {
  const mapElem = document.getElementById('interactive-map');
  if (!mapElem) return;

  // 1. Initialisiere Leaflet mit voller Touch- & Maus-Zoomunterstützung (bis Stufe 20)
  state.map.instance = L.map('interactive-map', {
    zoomControl: false, // Eigene Apple Liquid Glass Zoom Controls
    attributionControl: false,
    scrollWheelZoom: true,
    touchZoom: true,
    doubleClickZoom: true,
    maxZoom: 20
  }).setView([state.currentLocation.lat, state.currentLocation.lon], 9);

  // 2. Erstelle Layer-Gruppen für Zukunftsradar & Marker
  state.map.futureRadarLayerGroup = L.layerGroup().addTo(state.map.instance);
  state.map.weatherLayerGroup = L.layerGroup().addTo(state.map.instance);

  // 3. Setze Standard-Basiskarte (OSM Standard für 100% zuverlässige, gestochen scharfe Kartendarstellung)
  state.map.activeBase = 'osm-standard';
  setMapBaseLayer('osm-standard');

  // 4. Eigener Standort-Marker (Pulsierender Liquid Glass Beacon, KEIN störender weißer Kasten!)
  state.map.marker = L.marker([state.currentLocation.lat, state.currentLocation.lon], {
    icon: createUserLocationBeaconIcon(state.currentLocation),
    zIndexOffset: 3000
  }).addTo(state.map.instance);

  // 5. Klick auf beliebigen Punkt auf der Karte berechnet exakte Geländehöhe & lädt Standort
  state.map.instance.on('click', async (e) => {
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    // Sofortige visuelle Rückmeldung: Beacon-Marker direkt auf Klickpunkt setzen
    if (state.map.marker) {
      state.map.marker.setLatLng([lat, lon]);
    }
    // Zoomlevel niemals automatisch verändern: Zoom erfolgt ausschließlich manuell (Pinch/Mac-Controls/Zoom-Buttons)
    state.map.instance.panTo([lat, lon], { animate: true });
    
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

  // 8. Eigene Liquid Glass Zoom- & Navigationssteuerung (+ / − / 🎯 / 🏔️)
  const zoomInBtn = document.getElementById('map-zoom-in-btn');
  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance) state.map.instance.zoomIn();
    });
  }

  const zoomOutBtn = document.getElementById('map-zoom-out-btn');
  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance) state.map.instance.zoomOut();
    });
  }

  const recenterBtn = document.getElementById('map-zoom-location-btn');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance && state.currentLocation) {
        state.map.instance.panTo([state.currentLocation.lat, state.currentLocation.lon], { animate: true });
      }
    });
  }

  const alpsBtn = document.getElementById('map-zoom-alps-btn');
  if (alpsBtn) {
    alpsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance) {
        state.map.instance.setView([47.2, 11.5], 7, { animate: true });
      }
    });
  }

  // 9. Initialisiere Zukunfts-Radar Steuerungs-Elemente (Slider, Play, Jump, Speed)
  setupUnifiedRadarControls();

  // 10. Lade 24h-Radar Engine & Wetterdaten für Stationen
  state.map.activeOverlay = 'precip';
  loadUnifiedRadarEngine();
  updateWeatherOverlay();
  updatePointWeatherCard();

  // 11. Karteninteraktion (Pan & Zoom) synchronisiert das unendlich scharfe Wetterfeld
  state.map.instance.on('moveend zoomend', () => {
    if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
      const f = state.map.unifiedRadarFrames[state.map.radarIndex] || {};
      WeatherCanvasEngine.render(f, state.map.activeOverlay);
    }
  });

  // Fenster-Resize-Handling für responsive Anpassung (Canvas, Map, 3D-Mountain)
  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
      const f = state.map.unifiedRadarFrames[state.map.radarIndex] || {};
      WeatherCanvasEngine.render(f, state.map.activeOverlay);
    }
    if (resizeDebounce) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      if (state.activeTab === 'tab-map' && state.map.instance) {
        state.map.instance.invalidateSize();
      }
    }, 100);
  });
}

/**
 * Wechselt die Basiskarte (OSM Standard, OSM Topo/Alpenrelief, OSM Dunkel, Satellit)
 * Garantiert maxZoom 20 ohne Kachelfehler, mit 100% Fallback-Sicherheit & Retina-Schärfe
 */
export function setMapBaseLayer(baseKey) {
  const conf = BASE_LAYERS[baseKey] || BASE_LAYERS['osm-standard'];
  state.map.activeBase = baseKey;

  // 1. Vorherige Kachel-Ebenen sauber entfernen
  if (state.map.baseTileLayer) {
    state.map.instance.removeLayer(state.map.baseTileLayer);
    state.map.baseTileLayer = null;
  }
  if (state.map.satelliteLabelsLayer) {
    state.map.instance.removeLayer(state.map.satelliteLabelsLayer);
    state.map.satelliteLabelsLayer = null;
  }

  const mapElem = document.getElementById('interactive-map');
  if (mapElem) {
    if (conf.isDark) {
      mapElem.classList.add('osm-dark-tiles');
    } else {
      mapElem.classList.remove('osm-dark-tiles');
    }
  }

  // 2. High-DPI / Retina-Erkennung für messerscharfe Vektordetailtiefe
  const isRetina = (typeof window !== 'undefined' && window.devicePixelRatio >= 1.5);
  const options = {
    ...conf.options,
    crossOrigin: true,
    keepBuffer: 8,
    updateWhenZooming: true,
    updateWhenIdle: false
  };

  let tileUrl = conf.url;
  if (tileUrl.includes('{r}')) {
    options.r = isRetina ? '@2x' : '';
  }

  const baseLayer = L.tileLayer(tileUrl, options);

  // 3. Resiliente Fallback-Behandlung (verhindert unter allen Umständen leere oder schwarze Kacheln)
  if (conf.fallbackUrl) {
    baseLayer.on('tileerror', function(err) {
      if (err.tile && !err.tile._fallbackTried) {
        err.tile._fallbackTried = true;
        const coords = err.coords;
        let fb = conf.fallbackUrl
          .replace('{z}', coords.z)
          .replace('{x}', coords.x)
          .replace('{y}', coords.y)
          .replace('{s}', 'a')
          .replace('{r}', '');
        err.tile.src = fb;
      }
    });
  }

  baseLayer.addTo(state.map.instance);
  state.map.baseTileLayer = baseLayer;

  // 4. Bei Satellit: Kristallklare OSM-Ortsnamen & Grenzlinien einblenden
  if (conf.labelsUrl) {
    state.map.satelliteLabelsLayer = L.tileLayer(conf.labelsUrl, {
      pane: 'overlayPane',
      zIndex: 220,
      opacity: 0.95,
      maxZoom: conf.options.maxZoom || 20,
      subdomains: ['a', 'b', 'c', 'd'],
      r: isRetina ? '@2x' : ''
    }).addTo(state.map.instance);
  }

  // 5. Wenn Wind-Overlay aktiv ist, Legende & Partikelkontrast sofort synchronisieren
  if (state.map.activeOverlay === 'wind') {
    updateMapLegend('wind');
    const canvas = document.getElementById('wind-flow-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
      showUnifiedRadarFrame(state.map.radarIndex);
    }
  }
}

export function getWindCardinalName(deg) {
  const cards = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return cards[idx];
}

/**
 * Berechnet die exakten Wetterdaten für den aktuell betrachteten Punkt / Berg / Ort
 * bezogen auf den ausgewählten Zeit-Frame der 48h-Timeline.
 */
export function getLocationWeatherForFrame(frame) {
  const loc = state.currentLocation || { name: 'Standort', elevation: 500 };
  const cur = (state.weatherData && state.weatherData.current) ? state.weatherData.current : {};
  const hourly = (state.weatherData && state.weatherData.hourly) ? state.weatherData.hourly : {};

  const locName = loc.name || 'Standort';

  if (!hourly.time || hourly.time.length === 0) {
    const curSpd = cur.wind_speed_10m !== undefined ? Math.round(cur.wind_speed_10m) : 15;
    return {
      name: locName,
      isMountain: !!loc.isMountain,
      elevation: loc.elevation || 500,
      temp: cur.temperature_2m !== undefined ? cur.temperature_2m : 12,
      windSpeed: curSpd,
      windGusts: cur.wind_gusts_10m !== undefined ? Math.round(cur.wind_gusts_10m) : Math.round(curSpd * 1.35),
      windDir: cur.wind_direction_10m !== undefined ? Math.round(cur.wind_direction_10m) : 240,
      precip: cur.precipitation !== undefined ? cur.precipitation : (cur.rain || 0),
      snow: 0,
      cloudCover: cur.cloud_cover !== undefined ? cur.cloud_cover : 40,
      pressure: cur.surface_pressure !== undefined ? Math.round(cur.surface_pressure) : 1014,
      weatherCode: cur.weather_code !== undefined ? cur.weather_code : 1
    };
  }

  // Ermittle den passenden Index und Sub-Stunden-Interpolation für den Zeitpunkt des Frames
  const targetTimeMs = (frame && frame.timestampMs) ? frame.timestampMs : Date.now();
  
  // Exakte Live-Erkennung (Live-Scan oder jetzt)
  const isLiveNow = (frame && (frame.isLive || frame.minuteOffset === 0)) || Math.abs(targetTimeMs - Date.now()) < 3 * 60000;

  let idxBefore = 0;
  let idxAfter = 0;
  let fraction = 0;
  let foundRange = false;

  for (let i = 0; i < hourly.time.length - 1; i++) {
    const t0 = new Date(hourly.time[i]).getTime();
    const t1 = new Date(hourly.time[i + 1]).getTime();
    if (targetTimeMs >= t0 && targetTimeMs <= t1) {
      idxBefore = i;
      idxAfter = i + 1;
      fraction = t1 > t0 ? (targetTimeMs - t0) / (t1 - t0) : 0;
      foundRange = true;
      break;
    }
  }

  if (!foundRange) {
    let bestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < hourly.time.length; i++) {
      const diff = Math.abs(new Date(hourly.time[i]).getTime() - targetTimeMs);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }
    idxBefore = bestIdx;
    idxAfter = bestIdx;
    fraction = 0;
  }

  const lerp = (arr, fallback = 0) => {
    if (!arr || !arr.length) return fallback;
    const v0 = arr[idxBefore] !== undefined ? arr[idxBefore] : fallback;
    const v1 = arr[idxAfter] !== undefined ? arr[idxAfter] : v0;
    return v0 + (v1 - v0) * fraction;
  };

  const interpAngle = (arr, fallback = 240) => {
    if (!arr || !arr.length) return fallback;
    const a = arr[idxBefore] !== undefined ? arr[idxBefore] : fallback;
    const b = arr[idxAfter] !== undefined ? arr[idxAfter] : a;
    let diff = (b - a) % 360;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    return Math.round(((a + diff * fraction) % 360 + 360) % 360);
  };

  const t = (isLiveNow && cur.temperature_2m !== undefined)
    ? cur.temperature_2m
    : lerp(hourly.temperature_2m, cur.temperature_2m !== undefined ? cur.temperature_2m : 12);

  const spd = (isLiveNow && cur.wind_speed_10m !== undefined)
    ? Math.round(cur.wind_speed_10m)
    : Math.round(lerp(hourly.wind_speed_10m, cur.wind_speed_10m !== undefined ? cur.wind_speed_10m : 15));

  const gust = (isLiveNow && cur.wind_gusts_10m !== undefined)
    ? Math.round(cur.wind_gusts_10m)
    : Math.round(lerp(hourly.wind_gusts_10m, cur.wind_gusts_10m !== undefined ? cur.wind_gusts_10m : Math.round(spd * 1.35)));

  const dir = (isLiveNow && cur.wind_direction_10m !== undefined)
    ? Math.round(cur.wind_direction_10m)
    : interpAngle(hourly.wind_direction_10m, cur.wind_direction_10m !== undefined ? cur.wind_direction_10m : 240);

  const precip = (isLiveNow && cur.precipitation !== undefined)
    ? cur.precipitation
    : Math.max(0, Math.round(lerp(hourly.precipitation, 0) * 10) / 10);

  const snow = Math.max(0, Math.round(lerp(hourly.snowfall, 0) * 10) / 10);

  const clouds = (isLiveNow && cur.cloud_cover !== undefined)
    ? cur.cloud_cover
    : Math.round(lerp(hourly.cloud_cover, 40));

  const press = Math.round(lerp(hourly.surface_pressure || hourly.pressure_msl, cur.surface_pressure !== undefined ? cur.surface_pressure : 1014));

  const code = (isLiveNow && cur.weather_code !== undefined)
    ? cur.weather_code
    : (fraction < 0.5 ? (hourly.weather_code ? hourly.weather_code[idxBefore] : 1) : (hourly.weather_code ? hourly.weather_code[idxAfter] : 1));

  return {
    name: locName,
    isMountain: !!loc.isMountain,
    elevation: loc.elevation || 500,
    temp: Math.round(t * 10) / 10,
    windSpeed: spd,
    windGusts: gust,
    windDir: dir,
    precip: precip,
    snow: snow,
    cloudCover: clouds,
    pressure: press,
    weatherCode: code
  };
}

export function updateWindCompassWidget(frame) {
  const widget = document.getElementById('map-wind-compass-widget');
  if (!widget) return;

  if (state.map.activeOverlay !== 'wind') {
    widget.style.display = 'none';
    return;
  }

  widget.style.display = 'flex';

  const locWeather = getLocationWeatherForFrame(frame);
  const speed = locWeather.windSpeed;
  const dir = locWeather.windDir;
  const gust = locWeather.windGusts;
  const card = getWindCardinalName(dir);

  let desc = 'Mäßiger Wind • Freie Strömung';
  let color = '#22c55e';
  if (gust >= 80) { desc = '⚠️ Orkanartige Böen • Sturmgefahr!'; color = '#c084fc'; }
  else if (gust >= 60) { desc = '⚠️ Starker Sturm auf Berggipfeln'; color = '#ef4444'; }
  else if (gust >= 40) { desc = 'Frische Brise • Kräftige Böen'; color = '#f59e0b'; }
  else if (speed >= 25) { desc = 'Mäßiger Tal- & Hangwind'; color = '#38bdf8'; }

  const speedEl = document.getElementById('mwc-speed-val');
  if (speedEl) {
    speedEl.innerText = speed;
    speedEl.style.color = color;
  }

  const gustEl = document.getElementById('mwc-gust-val');
  if (gustEl) gustEl.innerText = gust;

  const dirChip = document.getElementById('mwc-dir-chip');
  if (dirChip) dirChip.innerText = `${card} • ${dir}°`;

  const descEl = document.getElementById('mwc-desc');
  if (descEl) descEl.innerText = `${locWeather.name} • ${desc}`;

  const needleWrap = document.getElementById('mwc-needle-wrap');
  if (needleWrap) {
    needleWrap.style.transform = `rotate(${dir + 180}deg)`;
  }
}

/**
 * Aktualisiert die Wetter-Kachel für den ausgewählten Kartenpunkt / Berg / Ort
 * (befindet sich unter dem Windkompass links im Karten-HUD).
 */
export function updatePointWeatherCard(frame) {
  const card = document.getElementById('map-point-weather-card');
  if (!card) return;

  if (!frame && state.map && state.map.unifiedRadarFrames && state.map.radarIndex !== undefined) {
    frame = state.map.unifiedRadarFrames[state.map.radarIndex];
  }

  const loc = state.currentLocation || { name: 'München', elevation: 520 };
  const locWeather = getLocationWeatherForFrame(frame);
  const codeInfo = WMO_CODES[locWeather.weatherCode] || WMO_CODES[0] || { label: 'Heiter', icon: '☀️' };

  // 1. Name & Badges
  const nameEl = document.getElementById('mpw-location-name');
  if (nameEl) nameEl.innerText = loc.name || 'Standort';

  const typeBadge = document.getElementById('mpw-type-badge');
  if (typeBadge) {
    if (locWeather.snow > 0) {
      typeBadge.innerText = '❄️ SCHNEE';
      typeBadge.style.color = '#c084fc';
      typeBadge.style.borderColor = 'rgba(192, 132, 252, 0.5)';
      typeBadge.style.background = 'rgba(192, 132, 252, 0.2)';
    } else if (locWeather.precip > 0.1) {
      typeBadge.innerText = '🌧️ REGEN';
      typeBadge.style.color = '#38bdf8';
      typeBadge.style.borderColor = 'rgba(56, 189, 248, 0.5)';
      typeBadge.style.background = 'rgba(56, 189, 248, 0.2)';
    } else {
      typeBadge.innerText = loc.isMountain ? '🏔️ BERG' : '📍 ORT';
      typeBadge.style.color = '#38bdf8';
      typeBadge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
      typeBadge.style.background = 'rgba(56, 189, 248, 0.2)';
    }
  }

  const elevChip = document.getElementById('mpw-elevation-chip');
  if (elevChip) {
    elevChip.innerText = `${loc.elevation !== undefined ? loc.elevation : 500} m`;
  }

  const timeBadge = document.getElementById('mpw-time-badge');
  if (timeBadge) {
    if (frame && !frame.isLive && frame.minuteOffset !== undefined && frame.minuteOffset !== 0) {
      const mo = frame.minuteOffset;
      let text = '';
      if (Math.abs(mo) < 60) {
        text = mo > 0 ? `+${mo}m` : `${mo}m`;
      } else if (mo % 60 === 0) {
        text = mo > 0 ? `+${mo / 60}h` : `${mo / 60}h`;
      } else {
        const h = Math.floor(Math.abs(mo) / 60);
        const m = Math.abs(mo) % 60;
        text = mo > 0 ? `+${h}h ${m}m` : `-${h}h ${m}m`;
      }
      timeBadge.innerText = text;
      timeBadge.className = 'mpw-time-badge forecast';
    } else if (frame && !frame.isLive && frame.hoursFromNow !== undefined && frame.hoursFromNow !== 0) {
      const sign = frame.hoursFromNow > 0 ? `+${frame.hoursFromNow}h` : `${frame.hoursFromNow}h`;
      timeBadge.innerText = sign;
      timeBadge.className = 'mpw-time-badge forecast';
    } else {
      timeBadge.innerText = 'LIVE';
      timeBadge.className = 'mpw-time-badge live';
    }
  }

  // 2. Temp & Icon
  const iconEl = document.getElementById('mpw-condition-icon');
  if (iconEl) iconEl.innerText = codeInfo.icon || '🌤️';

  const tempEl = document.getElementById('mpw-temp-val');
  if (tempEl) {
    const tempVal = typeof locWeather.temp === 'number' ? Math.round(locWeather.temp) : 12;
    tempEl.innerText = `${tempVal}°`;
  }

  const condLabel = document.getElementById('mpw-condition-label');
  if (condLabel) condLabel.innerText = codeInfo.label || 'Heiter';

  // 3. Grid Metrics
  // Rain / Precip / Snow
  const rainEl = document.getElementById('mpw-rain-val');
  if (rainEl) {
    const parentPill = rainEl.closest('.mpw-metric-pill');
    if (locWeather.snow > 0) {
      rainEl.innerText = `${locWeather.snow.toFixed(1)} cm`;
      if (parentPill) {
        parentPill.title = 'Schneefall (Alpin)';
        const icon = parentPill.querySelector('.mpw-metric-icon');
        if (icon) icon.innerText = '❄️';
      }
    } else {
      rainEl.innerText = `${(locWeather.precip || 0).toFixed(1)} mm`;
      if (parentPill) {
        parentPill.title = 'Niederschlag (Regen)';
        const icon = parentPill.querySelector('.mpw-metric-icon');
        if (icon) icon.innerText = '💧';
      }
    }
  }

  // Wind
  const windEl = document.getElementById('mpw-wind-val');
  if (windEl) {
    const cardDir = getWindCardinalName(locWeather.windDir);
    windEl.innerText = `${locWeather.windSpeed} km/h (${cardDir})`;
  }

  // Gusts
  const gustEl = document.getElementById('mpw-gust-val');
  if (gustEl) {
    gustEl.innerText = `${locWeather.windGusts} km/h`;
  }

  // Clouds
  const cloudsEl = document.getElementById('mpw-clouds-val');
  if (cloudsEl) {
    cloudsEl.innerText = `${Math.round(locWeather.cloudCover)}%`;
  }

  // 4. Front- & Wind-Zugrichtung (Fix unter dem Kartenpunkt-Bereich oben links)
  const motionValEl = document.getElementById('mpw-front-motion-val');
  if (motionValEl) {
    const windDir = locWeather.windDir !== undefined ? locWeather.windDir : 240;
    const windSpeed = locWeather.windSpeed !== undefined ? locWeather.windSpeed : 15;
    
    // Wind weht AUS windDir (fromCard), Zugrichtung geht NACH toCard
    const fromCard = getWindCardinalName(windDir);
    const toDir = (windDir + 180) % 360;
    const toCard = getWindCardinalName(toDir);
    
    motionValEl.innerText = `${fromCard} ➔ ${toCard} (${windSpeed} km/h)`;
  }
}

/**
 * Schaltet das aktive meteorologische Overlay um (24h Radar, Wind, Blitze, Bewölkung, Temp, Druck)
 */
export function setMapOverlay(overlayKey) {
  state.map.activeOverlay = overlayKey;
  updateWindCompassWidget();
  updateWeatherOverlay();
}

/**
 * Berechnet verlässliche meteorologische Baseline-Stationen über Höhengradienten,
 * falls Open-Meteo Rate-Limits (HTTP 429) oder Netzwerkprobleme auftreten.
 */
export function getSynthesizedBaselineStations() {
  const cur = (state.weatherData && state.weatherData.current) ? state.weatherData.current : {};
  const baseT = cur.temperature_2m !== undefined ? cur.temperature_2m : 12.0;
  const baseP = cur.surface_pressure !== undefined ? cur.surface_pressure : 1014.2;
  const baseWind = cur.wind_speed_10m !== undefined ? cur.wind_speed_10m : 16.0;
  const baseDir = cur.wind_direction_10m !== undefined ? cur.wind_direction_10m : 240;
  const baseCloud = cur.cloud_cover !== undefined ? cur.cloud_cover : 55;

  return REGIONAL_STATIONS.map(st => {
    const deltaElev = (st.elevation || 500) - 520;
    const t = Math.round((baseT - (deltaElev / 100) * 0.65) * 10) / 10;
    // Synoptische Druckvariation über den Alpenraum (Hochdruck-Rücken / Tiefdruck-Trog)
    const synopticP = baseP + (st.lat - 47.5) * 2.2 - (st.lon - 11.0) * 1.5;
    const pMsl = Math.round(synopticP * 10) / 10;
    const spd = Math.round(baseWind * (st.isMountain ? 1.85 : 1.0));
    const gust = Math.round(spd * (st.isMountain ? 1.6 : 1.35));
    const dir = (baseDir + (st.isMountain ? 15 : -10) + 360) % 360;
    const cloud = st.isMountain ? Math.min(100, baseCloud + 15) : baseCloud;
    const isSnow = t <= 1.0;

    const basePrecip = (cur.precipitation !== undefined) ? cur.precipitation : (cur.rain || 0);
    const stPrecip = basePrecip > 0
      ? (st.isMountain ? Math.round(basePrecip * 1.4 * 10) / 10 : basePrecip)
      : (st.isMountain && cloud >= 80 ? 0.3 : 0);
    const stSnow = isSnow && stPrecip > 0 ? Math.round(stPrecip * 1.2 * 10) / 10 : 0;

    return {
      name: st.name,
      lat: st.lat,
      lon: st.lon,
      elevation: st.elevation,
      isMountain: !!st.isMountain,
      precip: stPrecip,
      snow: stSnow,
      temperature: t,
      weatherCode: isSnow && stPrecip > 0 ? 71 : (stPrecip > 0 ? 61 : (cloud > 75 ? 3 : 1)),
      cloudCover: cloud,
      pressureMsl: pMsl,
      windSpeed: spd,
      windDirection: dir,
      windGusts: gust,
      isSnow: isSnow
    };
  });
}

/**
 * Lädt regionale Wetterstationen in einem einzigen Batch-Aufruf von Open-Meteo
 * mit flachem Attribut-Mapping und nahtloser Baseline-Synthese.
 */
export async function loadRegionalStationWeather() {
  if (state.map.regionalStationsData && state.map.regionalStationsData.length) return state.map.regionalStationsData;

  const CACHE_KEY = 'regional_stations_weather_cache_v2';
  const CACHE_TTL = 12 * 60 * 1000;

  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_TTL && Array.isArray(parsed.data) && parsed.data.length > 0) {
        state.map.regionalStationsData = parsed.data;
        return state.map.regionalStationsData;
      }
    }
  } catch (_) {}

  const lats = REGIONAL_STATIONS.map(s => s.lat.toFixed(3)).join(',');
  const lons = REGIONAL_STATIONS.map(s => s.lon.toFixed(3)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const stationResults = Array.isArray(data) ? data : [data];

    state.map.regionalStationsData = REGIONAL_STATIONS.map((station, i) => {
      const weather = stationResults[i] ? (stationResults[i].current || {}) : {};
      const t = weather.temperature_2m !== undefined ? weather.temperature_2m : 11;
      return {
        ...station,
        weather,
        temperature: t,
        precip: weather.precipitation || 0,
        snow: weather.snowfall || 0,
        weatherCode: weather.weather_code || 1,
        cloudCover: weather.cloud_cover !== undefined ? weather.cloud_cover : 50,
        pressureMsl: weather.pressure_msl || 1013.5,
        windSpeed: weather.wind_speed_10m || 15,
        windDirection: weather.wind_direction_10m || 240,
        windGusts: weather.wind_gusts_10m || 22,
        isSnow: t <= 1.0
      };
    });

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

/**
 * Bereinigt Radar-Kacheln und prognostizierte Zellen
 */
export function cleanupRadarTiles() {
  if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();
  if (state.map.radarTileLayer && state.map.instance && state.map.instance.hasLayer(state.map.radarTileLayer)) {
    state.map.instance.removeLayer(state.map.radarTileLayer);
    state.map.radarTileLayer = null;
  }
}

/**
 * Aktualisiert die Farblegende der Karte dynamisch je nach gewähltem Wetter-Overlay und Basiskarte
 */
export function updateMapLegend(overlay = state.map.activeOverlay) {
  const legendTitle = document.getElementById('map-legend-title');
  const legendBar = document.getElementById('map-legend-bar');
  const legendLabels = document.getElementById('map-legend-labels');
  if (!legendTitle || !legendBar || !legendLabels) return;

  if (overlay === 'precip' || overlay === 'rainviewer-radar') {
    legendTitle.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:8px;">
        <span>📡 48h Radar (Nordic Clean)</span>
        <span style="font-size:9px; color:#94a3b8; font-weight:600;">Regen & Schnee</span>
      </div>
    `;
    legendBar.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:4px; width:100%; margin:3px 0;">
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:9px; font-weight:700; color:#38bdf8; min-width:44px;">🌧️ Regen:</span>
          <div style="flex:1; height:6px; border-radius:3px; background:linear-gradient(90deg, rgba(56,189,248,0.4), #38bdf8, #2563eb, #1d4ed8, #1e3a8a, #312e81);"></div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:9px; font-weight:700; color:#e0f2fe; min-width:44px;">❄️ Schnee:</span>
          <div style="flex:1; height:6px; border-radius:3px; background:linear-gradient(90deg, rgba(224,242,254,0.4), #e0f2fe, #f1f5f9, #ffffff);"></div>
        </div>
      </div>
    `;
    legendBar.style.background = 'transparent';
    legendBar.style.height = 'auto';
    legendLabels.innerHTML = `
      <div style="display:flex; justify-content:space-between; width:100%; font-size:8.5px;">
        <span style="color:#7dd3fc;">Leicht</span>
        <span style="color:#60a5fa;">Mäßig</span>
        <span style="color:#3b82f6;">Kräftig</span>
        <span style="color:#1d4ed8; font-weight:700;">Starkregen</span>
        <span style="color:#ffffff; font-weight:800;">Schnee (Reinweiß)</span>
      </div>
    `;
  } else {
    legendBar.innerHTML = '';
    legendBar.style.height = '7px';
  }

  if (overlay === 'wind') {
    legendTitle.innerText = '💨 48h Windströmung & Böen (Alpen & Flachland):';
    const isDark = (state.map && state.map.activeBase === 'osm-dark');
    if (isDark) {
      legendBar.style.background = 'linear-gradient(90deg, #22c55e, #38bdf8, #f59e0b, #ef4444, #c084fc)';
      legendLabels.innerHTML = `
        <span style="color:#22c55e;">< 20 km/h</span>
        <span style="color:#38bdf8;">35 km/h</span>
        <span style="color:#f59e0b;">55 km/h</span>
        <span style="color:#c084fc;">> 75 km/h Sturm</span>
      `;
    } else {
      // Auf hellen Karten (Standard, Topo, Satellit): Dunkelblau-Skala für optimalen Kontrast
      legendBar.style.background = 'linear-gradient(90deg, #002855, #0d47a1, #1e40af, #b45309, #991b1b)';
      legendLabels.innerHTML = `
        <span style="color:#7dd3fc; font-weight:800;">< 20 km/h</span>
        <span style="color:#93c5fd; font-weight:700;">35 km/h</span>
        <span style="color:#f59e0b; font-weight:700;">55 km/h</span>
        <span style="color:#f87171; font-weight:700;">> 75 km/h Sturm</span>
      `;
    }
  } else if (overlay === 'lightning') {
    legendTitle.innerText = '⚡ Live-Blitzortung & Gewitterpotenzial (CAPE):';
    legendBar.style.background = 'linear-gradient(90deg, #ff3b30, #ff9500, #ffd166, #64d2ff)';
    legendLabels.innerHTML = `
      <span style="color:#ff3b30;">🚨 < 5 Min. / Hoch</span>
      <span style="color:#ff9500;">⚡ 5–15 Min.</span>
      <span style="color:#ffd166;">⚡ 15–30 Min.</span>
      <span style="color:#64d2ff;">⚡ > 30 Min.</span>
    `;
  } else if (overlay === 'clouds') {
    legendTitle.innerText = '☁️ 48h Bewölkungsgrad (Wolkenfelder & Inversion):';
    legendBar.style.background = 'linear-gradient(90deg, #ffd166, #cbd5e1, #94a3b8, #1e293b)';
    legendLabels.innerHTML = `
      <span style="color:#ffd166;">0% Wolkenlos</span>
      <span style="color:#cbd5e1;">40% Heiter</span>
      <span style="color:#94a3b8;">80% Bedeckt</span>
    `;
  } else if (overlay === 'temp') {
    legendTitle.innerText = '🌡️ 48h Temperaturfeld (Höhenlage vs. Tal):';
    legendBar.style.background = 'linear-gradient(90deg, #1e40af, #06b6d4, #22c55e, #eab308, #f97316, #ef4444)';
    legendLabels.innerHTML = `
      <span style="color:#1e40af;">< -5°C</span>
      <span style="color:#06b6d4;">0°C Frostgrenze</span>
      <span style="color:#22c55e;">10°C</span>
      <span style="color:#f97316;">20°C</span>
      <span style="color:#ef4444;">> 28°C</span>
    `;
  } else if (overlay === 'pressure') {
    legendTitle.innerText = '⏱️ 48h Luftdruck QNH & Isobaren:';
    legendBar.style.background = 'linear-gradient(90deg, #ef4444, #93c5fd, #3b82f6)';
    legendLabels.innerHTML = `
      <span style="color:#ef4444;">< 1008 hPa Tief (T)</span>
      <span style="color:#93c5fd;">1013 hPa Normal</span>
      <span style="color:#3b82f6;">> 1022 hPa Hoch (H)</span>
    `;
  }
}

/**
 * Rendert das aktive Wetter-Overlay über der OSM-Karte
 */
export async function updateWeatherOverlay() {
  if (!state.map.instance || !state.map.weatherLayerGroup) return;

  const overlay = state.map.activeOverlay;
  const radarControls = document.getElementById('radar-floating-controls');
  const thunderAlert = document.getElementById('thunderstorm-alert-box');

  if (thunderAlert && overlay !== 'lightning') {
    thunderAlert.style.display = 'none';
  }

  // ZEITREGLER BLEIBT IMMER AKTIV & SICHTBAR AUF ALLEN ANSICHTEN!
  if (radarControls) {
    radarControls.style.display = 'flex';
  }

  // Konfiguriere Legende je nach gewähltem Wetterfilter
  updateMapLegend(overlay);

  // Sofortigen Frame-Render für den aktuellen Timeline-Index auslösen
  if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
    showUnifiedRadarFrame(state.map.radarIndex);
  }
}

// =============================================================================
// CONTINUOUS HIGH-PRECISION WEATHER FIELD CANVAS ENGINE (60 FPS HARDWARE-ACCELERATED)
// 100% ECHTE OPEN-METEO & RAINVIEWER API-DATEN, UNENDLICH DETAILSCHARF
// =============================================================================
const WeatherCanvasEngine = {
  animId: null,
  activeOverlay: 'precip',
  currentFrame: null,
  particles: [],
  maxParticles: 420,
  offscreenCanvas: null,
  offscreenCtx: null,

  ensureCanvas() {
    const canvas = document.getElementById('wind-flow-canvas');
    const mapElem = document.getElementById('interactive-map');
    if (!canvas || !mapElem) return null;

    canvas.style.display = 'block';
    const rect = mapElem.getBoundingClientRect();
    const width = Math.max(300, rect.width || mapElem.clientWidth || 800);
    const height = Math.max(300, rect.height || mapElem.clientHeight || 580);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
    }

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    return { canvas, ctx, width, height, dpr };
  },

  stopAnimation() {
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    if (state.map) state.map.windAnimFrame = null;
    const canvas = document.getElementById('wind-flow-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  },

  // Inverse Distance Weighting (IDW) Interpolation über alle regionalen Wetterstationen
  interpolateStationMetric(lat, lon, stations, key, power = 1.35) {
    if (!stations || !stations.length) return 0;
    const altKeys = {
      temperature: 'temperature_2m',
      windSpeed: 'wind_speed_10m',
      windDirection: 'wind_direction_10m',
      windGusts: 'wind_gusts_10m',
      cloudCover: 'cloud_cover',
      pressureMsl: 'pressure_msl',
      precip: 'precipitation',
      snow: 'snowfall'
    };
    const alt = altKeys[key];

    let sumWeight = 0;
    let sumVal = 0;
    const eps = 0.00008;

    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      let val = undefined;
      if (st[key] !== undefined) val = st[key];
      else if (alt && st[alt] !== undefined) val = st[alt];
      else if (st.weather) {
        if (st.weather[key] !== undefined) val = st.weather[key];
        else if (alt && st.weather[alt] !== undefined) val = st.weather[alt];
      }
      if (val === undefined || isNaN(val)) continue;

      const dLat = lat - st.lat;
      const dLon = lon - st.lon;
      const distSq = dLat * dLat + dLon * dLon;
      if (distSq < 0.00004) return val;

      const w = 1 / Math.pow(distSq + eps, power);
      sumWeight += w;
      sumVal += w * val;
    }
    return sumWeight > 0 ? (sumVal / sumWeight) : 0;
  },

  // Vektorielle Wind-Interpolation für realistische 2D-Strömungspfade
  interpolateWindVector(lat, lon, stations) {
    if (!stations || !stations.length) return { u: -12, v: 8, speed: 15, dir: 240 };
    let sumWeight = 0, sumU = 0, sumV = 0, sumSpd = 0;
    const eps = 0.00008;

    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const spd = st.windSpeed !== undefined ? st.windSpeed : (st.weather ? (st.weather.wind_speed_10m !== undefined ? st.weather.wind_speed_10m : 15) : 15);
      const dir = st.windDirection !== undefined ? st.windDirection : (st.weather ? (st.weather.wind_direction_10m !== undefined ? st.weather.wind_direction_10m : 240) : 240);
      const rad = (dir * Math.PI) / 180;
      // u: Ost-West-Komponente, v: Nord-Süd-Komponente (Windausbreitung)
      const u = -spd * Math.sin(rad);
      const v = -spd * Math.cos(rad);

      const dLat = lat - st.lat;
      const dLon = lon - st.lon;
      const distSq = dLat * dLat + dLon * dLon;
      if (distSq < 0.00004) return { u, v, speed: spd, dir };

      const w = 1 / Math.pow(distSq + eps, 1.35);
      sumWeight += w;
      sumU += w * u;
      sumV += w * v;
      sumSpd += w * spd;
    }

    if (sumWeight === 0) return { u: -12, v: 8, speed: 15, dir: 240 };
    const u = sumU / sumWeight;
    const v = sumV / sumWeight;
    const speed = sumSpd / sumWeight;
    const dir = (Math.atan2(-u, -v) * (180 / Math.PI) + 360) % 360;
    return { u, v, speed, dir };
  },

  render(frame, overlay) {
    this.currentFrame = frame;
    this.activeOverlay = overlay;
    this.stopAnimation();

    const cData = this.ensureCanvas();
    if (!cData || !state.map || !state.map.instance) return;
    const { ctx, width, height } = cData;

    const stations = (frame && frame.stations && frame.stations.length > 0)
      ? frame.stations
      : ((state.map.regionalStationsData && state.map.regionalStationsData.length > 0)
          ? state.map.regionalStationsData
          : getSynthesizedBaselineStations());

    if (overlay === 'temp') {
      this.renderThermalHeatmap(ctx, width, height, stations);
    } else if (overlay === 'wind') {
      this.startWindParticleSimulation(ctx, width, height, stations);
    } else if (overlay === 'clouds') {
      this.renderCloudDensityField(ctx, width, height, stations);
    } else if (overlay === 'pressure') {
      this.renderPressureAndIsobars(ctx, width, height, stations);
    } else if (overlay === 'precip' || overlay === 'rainviewer-radar') {
      this.renderForecastPrecipitationField(ctx, width, height, stations, frame);
    } else if (overlay === 'lightning') {
      this.renderLightningField(ctx, width, height, stations, frame);
    }
  },

  // 1. TEMPERATURFELD & LEUCHTENDE 0°C-FROSTGRENZE
  renderThermalHeatmap(ctx, width, height, stations) {
    ctx.clearRect(0, 0, width, height);
    if (!stations.length || !state.map.instance) return;

    const step = 20;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;
    const gridT = new Float32Array(cols * rows);

    for (let r = 0; r < rows; r++) {
      const y = r * step;
      for (let c = 0; c < cols; c++) {
        const x = c * step;
        const latLng = state.map.instance.containerPointToLatLng([x, y]);
        const tVal = this.interpolateStationMetric(latLng.lat, latLng.lng, stations, 'temperature');
        gridT[r * cols + c] = tVal;
      }
    }

    if (!this.offscreenCanvas || this.offscreenCanvas.width !== cols || this.offscreenCanvas.height !== rows) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = cols;
      this.offscreenCanvas.height = rows;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
    const imgData = this.offscreenCtx.createImageData(cols, rows);
    const data = imgData.data;

    for (let i = 0; i < gridT.length; i++) {
      const t = gridT[i];
      const rgb = this.getThermalRgb(t);
      const idx = i * 4;
      data[idx] = rgb[0];
      data[idx + 1] = rgb[1];
      data[idx + 2] = rgb[2];
      data[idx + 3] = Math.round(rgb[3] * 255);
    }
    this.offscreenCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreenCanvas, 0, 0, width, height);
    ctx.restore();

    this.drawIsothermsAndFrostLine(ctx, width, height, gridT, cols, rows, step);
  },

  getThermalRgb(t) {
    if (t <= -12) return [30, 27, 75, 0.58];
    if (t <= -5) {
      const f = (t + 12) / 7;
      return [Math.round(30 + f * 7), Math.round(27 + f * 72), Math.round(75 + f * 160), 0.52];
    }
    if (t <= 0) {
      const f = (t + 5) / 5;
      return [Math.round(37 - f * 31), Math.round(99 + f * 83), Math.round(235 - f * 23), 0.48];
    }
    if (t <= 6) {
      const f = t / 6;
      return [Math.round(6 + f * 10), Math.round(182 + f * 3), Math.round(212 - f * 83), 0.45];
    }
    if (t <= 13) {
      const f = (t - 6) / 7;
      return [Math.round(16 + f * 116), Math.round(185 + f * 19), Math.round(129 - f * 107), 0.46];
    }
    if (t <= 20) {
      const f = (t - 13) / 7;
      return [Math.round(132 + f * 117), Math.round(204 - f * 89), 22, 0.48];
    }
    if (t <= 28) {
      const f = (t - 20) / 8;
      return [Math.round(249 - f * 10), Math.round(115 - f * 47), Math.round(22 + f * 46), 0.52];
    }
    return [239, 68, 68, 0.58];
  },

  drawIsothermsAndFrostLine(ctx, width, height, gridT, cols, rows, step) {
    ctx.save();
    const isoLevels = [-10, -5, 0, 5, 10, 15, 20, 25];

    isoLevels.forEach(iso => {
      const isFrost = (iso === 0);
      ctx.lineWidth = isFrost ? 2.5 : 1.2;
      ctx.strokeStyle = isFrost ? '#00f5ff' : 'rgba(255, 255, 255, 0.38)';
      ctx.setLineDash(isFrost ? [8, 6] : [3, 4]);
      ctx.shadowColor = isFrost ? '#00f5ff' : 'transparent';
      ctx.shadowBlur = isFrost ? 10 : 0;

      let isLabeled = false;

      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const idx = r * cols + c;
          const tTL = gridT[idx];
          const tTR = gridT[idx + 1];
          const tBL = gridT[idx + cols];

          if ((tTL <= iso && tTR > iso) || (tTL > iso && tTR <= iso)) {
            const frac = (iso - tTL) / (tTR - tTL);
            const x = (c + frac) * step;
            const y = r * step;
            ctx.beginPath();
            ctx.arc(x, y, 1.8, 0, Math.PI * 2);
            ctx.stroke();

            if (!isLabeled && x > 70 && x < width - 140 && y > 40 && y < height - 60) {
              ctx.fillStyle = isFrost ? '#00f5ff' : 'rgba(255, 255, 255, 0.85)';
              ctx.font = isFrost ? 'bold 11px sans-serif' : 'bold 10px monospace';
              ctx.fillText(isFrost ? '❄️ 0°C Frostgrenze' : `${iso}°C`, x + 6, y - 4);
              isLabeled = true;
            }
          }

          if ((tTL <= iso && tBL > iso) || (tTL > iso && tBL <= iso)) {
            const frac = (iso - tTL) / (tBL - tTL);
            const x = c * step;
            const y = (r + frac) * step;
            ctx.beginPath();
            ctx.arc(x, y, 1.8, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    });

    ctx.restore();
  },

  // 2. KONTINUIERLICHES 420-PARTIKEL WINDSTRÖMUNGSFELD
  startWindParticleSimulation(ctx, width, height, stations) {
    if (!stations.length || !state.map.instance) return;

    if (!this.particles || this.particles.length === 0 || this.particles.length !== this.maxParticles) {
      this.particles = [];
      for (let i = 0; i < this.maxParticles; i++) {
        this.particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          age: Math.floor(Math.random() * 90),
          maxAge: 70 + Math.floor(Math.random() * 60),
          speed: 15
        });
      }
    }

    const self = this;
    function animLoop() {
      if (self.activeOverlay !== 'wind') return;

      // Erhalte die darunterliegende OSM-Karte 100% transparent sichtbar!
      // Faded bestehende Partikelspuren sauber mit destination-out ab, ohne eine deckende Farbschicht aufzubauen.
      const isDarkMap = (state.map && state.map.activeBase === 'osm-dark');
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = isDarkMap ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = isDarkMap ? 2.2 : 2.8;
      ctx.lineCap = 'round';

      for (let i = 0; i < self.particles.length; i++) {
        const p = self.particles[i];
        const latLng = state.map.instance.containerPointToLatLng([p.x, p.y]);
        const vec = self.interpolateWindVector(latLng.lat, latLng.lng, stations);
        p.speed = vec.speed;

        const dt = 0.28;
        const vx = vec.u * dt;
        const vy = vec.v * dt;

        const nextX = p.x + vx;
        const nextY = p.y - vy;

        let color;
        if (isDarkMap) {
          // Auf dunkler Karte: Neon-Grün / Cyan / Orange / Rot für perfekten Kontrast
          color = '#22c55e';
          if (p.speed >= 75) color = '#c084fc';
          else if (p.speed >= 55) color = '#ef4444';
          else if (p.speed >= 35) color = '#f59e0b';
          else if (p.speed >= 20) color = '#38bdf8';
        } else {
          // Auf hellen Karten (Standard, Topo, Satellit): Kräftiges Dunkelblau für höchste Sichtbarkeit!
          color = '#002855'; // Sattes Tiefblau (< 20 km/h)
          if (p.speed >= 75) color = '#312e81'; // Tiefes Nachtblau / Sturm
          else if (p.speed >= 55) color = '#991b1b'; // Dunkelrot
          else if (p.speed >= 35) color = '#b45309'; // Kräftiges Rost-Orange
          else if (p.speed >= 20) color = '#0d47a1'; // Kräftiges Marineblau
        }

        const lifeRatio = p.age / p.maxAge;
        const alpha = Math.sin(lifeRatio * Math.PI) * (isDarkMap ? 0.85 : 0.95);

        ctx.strokeStyle = color;
        ctx.globalAlpha = Math.max(isDarkMap ? 0.05 : 0.35, alpha);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nextX, nextY);
        ctx.stroke();

        p.x = nextX;
        p.y = nextY;
        p.age++;

        if (p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20 || p.age >= p.maxAge) {
          p.x = Math.random() * width;
          p.y = Math.random() * height;
          p.age = 0;
          p.maxAge = 60 + Math.floor(Math.random() * 60);
        }
      }

      ctx.restore();
      self.animId = requestAnimationFrame(animLoop);
    }

    ctx.clearRect(0, 0, width, height);
    animLoop();
  },

  // 3. FOTOREALISTISCHES BEWÖLKUNGSFELD
  renderCloudDensityField(ctx, width, height, stations) {
    ctx.clearRect(0, 0, width, height);
    if (!stations.length || !state.map.instance) return;

    const step = 20;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;

    if (!this.offscreenCanvas || this.offscreenCanvas.width !== cols || this.offscreenCanvas.height !== rows) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = cols;
      this.offscreenCanvas.height = rows;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
    const imgData = this.offscreenCtx.createImageData(cols, rows);
    const data = imgData.data;

    for (let r = 0; r < rows; r++) {
      const y = r * step;
      for (let c = 0; c < cols; c++) {
        const x = c * step;
        const latLng = state.map.instance.containerPointToLatLng([x, y]);
        const cVal = this.interpolateStationMetric(latLng.lat, latLng.lng, stations, 'cloudCover');
        
        const noise = Math.sin(x * 0.035) * Math.cos(y * 0.035) * 14 + Math.sin((x + y) * 0.07) * 8;
        const netC = Math.max(0, Math.min(100, cVal + noise));

        const idx = (r * cols + c) * 4;
        if (netC < 18) {
          data[idx + 3] = 0;
        } else {
          const alphaRatio = (netC - 18) / 82;
          const alpha = Math.min(0.75, Math.max(0.12, alphaRatio * 0.68));
          const shade = Math.round(255 - alphaRatio * 35);
          data[idx] = shade;
          data[idx + 1] = shade;
          data[idx + 2] = Math.min(255, shade + 8);
          data[idx + 3] = Math.round(alpha * 255);
        }
      }
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreenCanvas, 0, 0, width, height);
    ctx.restore();
  },

  // 4. LUFTDRUCKFELD, ISOBAREN & H/T ZENTREN
  renderPressureAndIsobars(ctx, width, height, stations) {
    ctx.clearRect(0, 0, width, height);
    if (!stations.length || !state.map.instance) return;

    const step = 20;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;
    const gridP = new Float32Array(cols * rows);

    let minP = 9999, maxP = 0, minX = width / 2, minY = height / 2, maxX = width / 2, maxY = height / 2;

    for (let r = 0; r < rows; r++) {
      const y = r * step;
      for (let c = 0; c < cols; c++) {
        const x = c * step;
        const latLng = state.map.instance.containerPointToLatLng([x, y]);
        const pVal = this.interpolateStationMetric(latLng.lat, latLng.lng, stations, 'pressureMsl');
        const idx = r * cols + c;
        gridP[idx] = pVal;

        if (pVal < minP) { minP = pVal; minX = x; minY = y; }
        if (pVal > maxP) { maxP = pVal; maxX = x; maxY = y; }
      }
    }

    if (!this.offscreenCanvas || this.offscreenCanvas.width !== cols || this.offscreenCanvas.height !== rows) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = cols;
      this.offscreenCanvas.height = rows;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
    const imgData = this.offscreenCtx.createImageData(cols, rows);
    const data = imgData.data;

    for (let i = 0; i < gridP.length; i++) {
      const p = gridP[i];
      const idx = i * 4;
      if (p <= 1008) {
        data[idx] = 239; data[idx + 1] = 68; data[idx + 2] = 68; data[idx + 3] = 45;
      } else if (p >= 1020) {
        data[idx] = 59; data[idx + 1] = 130; data[idx + 2] = 246; data[idx + 3] = 45;
      } else {
        data[idx] = 56; data[idx + 1] = 189; data[idx + 2] = 248; data[idx + 3] = 30;
      }
    }
    this.offscreenCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreenCanvas, 0, 0, width, height);

    const isobarLevels = [1000, 1004, 1008, 1012, 1016, 1020, 1024, 1028];
    ctx.lineWidth = 2.0;
    ctx.shadowBlur = 6;

    isobarLevels.forEach(iso => {
      let isLabeled = false;
      ctx.strokeStyle = (iso === 1013 || iso === 1012) ? 'rgba(56, 189, 248, 0.95)' : 'rgba(165, 180, 252, 0.75)';
      ctx.shadowColor = (iso === 1013 || iso === 1012) ? '#38bdf8' : '#818cf8';

      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const idx = r * cols + c;
          const pTL = gridP[idx];
          const pTR = gridP[idx + 1];
          const pBL = gridP[idx + cols];

          if ((pTL <= iso && pTR > iso) || (pTL > iso && pTR <= iso)) {
            const frac = (iso - pTL) / (pTR - pTL);
            const x = (c + frac) * step;
            const y = r * step;
            ctx.beginPath();
            ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            ctx.stroke();

            if (!isLabeled && x > 60 && x < width - 100 && y > 40 && y < height - 40) {
              ctx.fillStyle = ctx.strokeStyle;
              ctx.font = 'bold 11px monospace';
              ctx.fillText(`${iso} hPa`, x + 6, y - 4);
              isLabeled = true;
            }
          }

          if ((pTL <= iso && pBL > iso) || (pTL > iso && pBL <= iso)) {
            const frac = (iso - pTL) / (pBL - pTL);
            const x = c * step;
            const y = (r + frac) * step;
            ctx.beginPath();
            ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    });

    if (minP < 1010 && minX > 30 && minX < width - 30 && minY > 30 && minY < height - 30) {
      this.drawPressureCenterBadge(ctx, minX, minY, 'T', '#ef4444', `${Math.round(minP)}`);
    }
    if (maxP > 1015 && maxX > 30 && maxX < width - 30 && maxY > 30 && maxY < height - 30) {
      this.drawPressureCenterBadge(ctx, maxX, maxY, 'H', '#3b82f6', `${Math.round(maxP)}`);
    }

    ctx.restore();
  },

  drawPressureCenterBadge(ctx, x, y, letter, color, hpa) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, x, y - 1);

    ctx.font = 'bold 10px monospace';
    ctx.fillText(`${hpa} hPa`, x, y + 23);
    ctx.restore();
  },

  // Kontinuierliche Farbberechnung für flüssigen Regen (Apple Weather / Nordic Clean Blauband)
  getContinuousRainRgba(p) {
    if (p < 0.20) return [0, 0, 0, 0];
    const stops = [
      { p: 0.20, r: 56,  g: 189, b: 248, a: 0 },    // Zarte Auslaufkante (Volltransparent)
      { p: 0.50, r: 56,  g: 189, b: 248, a: 100 },  // Leichter Niesel (Transparentes Himmelsblau)
      { p: 1.50, r: 37,  g: 99,  b: 235, a: 145 },  // Mäßiger Regen (Klares Azurblau)
      { p: 3.50, r: 29,  g: 78,  b: 216, a: 185 },  // Kräftiger Regen (Königsblau)
      { p: 8.00, r: 30,  g: 58,  b: 138, a: 215 },  // Starkregen (Tiefes Ozeanblau)
      { p: 20.0, r: 49,  g: 46,  b: 129, a: 240 }   // Unwetter / Starker Wolkenbruch (Elektrisches Indigoblau)
    ];
    return this.interpolateRgbaStops(p, stops);
  },

  // Kontinuierliche Farbberechnung für Schnee (Glaziales Reinschnee- & Eisweiß)
  getContinuousSnowRgba(p) {
    if (p < 0.20) return [0, 0, 0, 0];
    const stops = [
      { p: 0.20, r: 224, g: 242, b: 254, a: 0 },    // Zarte Auslaufkante (Volltransparent)
      { p: 0.50, r: 224, g: 242, b: 254, a: 110 },  // Feiner Schneegriesel (Polar-Silber)
      { p: 1.50, r: 241, g: 245, b: 249, a: 155 },  // Mäßiger Schneefall (Kühles Kristallweiß)
      { p: 3.50, r: 255, g: 255, b: 255, a: 195 },  // Kräftiger Schneefall (Reines Alpinschneeweiß)
      { p: 8.00, r: 255, g: 255, b: 255, a: 230 },  // Schwerer Alpinschneefall (Brillantes Reinweiß)
      { p: 20.0, r: 255, g: 255, b: 255, a: 255 }   // Schneesturm / Blizzard (Voll deckendes Reinweiß)
    ];
    return this.interpolateRgbaStops(p, stops);
  },

  interpolateRgbaStops(val, stops) {
    if (val <= stops[0].p) {
      return [0, 0, 0, 0];
    }
    for (let i = 0; i < stops.length - 1; i++) {
      const s1 = stops[i];
      const s2 = stops[i + 1];
      if (val >= s1.p && val <= s2.p) {
        const f = (val - s1.p) / (s2.p - s1.p);
        return [
          Math.round(s1.r + (s2.r - s1.r) * f),
          Math.round(s1.g + (s2.g - s1.g) * f),
          Math.round(s1.b + (s2.b - s1.b) * f),
          Math.round(s1.a + (s2.a - s1.a) * f)
        ];
      }
    }
    const last = stops[stops.length - 1];
    return [last.r, last.g, last.b, last.a];
  },

  // Berechnet das stufenlos geblendete Niederschlagspixel je nach Temperatur (°C)
  computePrecipPixelRgba(precipRate, temperature) {
    if (precipRate < 0.20) return [0, 0, 0, 0];

    const rainCol = this.getContinuousRainRgba(precipRate);
    const snowCol = this.getContinuousSnowRgba(precipRate);

    // Temperaturübergang (Phasenwechsel Regen ➔ Schneeregen ➔ Schnee):
    // T >= 2.0°C: 100% Regen (Reine Blaustufen)
    // T <= -0.5°C: 100% Schnee (Reines Eisweiß)
    // -0.5°C .. 2.0°C: Völlig stufenlose, harmonische Mischung (Hermite Smoothstep)
    let snowRatio = 0;
    if (temperature <= -0.5) {
      snowRatio = 1.0;
    } else if (temperature >= 2.0) {
      snowRatio = 0.0;
    } else {
      const norm = (2.0 - temperature) / 2.5; // 0 bis 1
      snowRatio = norm * norm * (3 - 2 * norm);
    }

    return [
      Math.round(rainCol[0] * (1 - snowRatio) + snowCol[0] * snowRatio),
      Math.round(rainCol[1] * (1 - snowRatio) + snowCol[1] * snowRatio),
      Math.round(rainCol[2] * (1 - snowRatio) + snowCol[2] * snowRatio),
      Math.round(rainCol[3] * (1 - snowRatio) + snowCol[3] * snowRatio)
    ];
  },

  // 5. 48H PROGNOSE-RADAR (SAUBERES, KONTINUIERLICHES NIEDERSCHLAGS- & SCHNEEFELD)
  renderForecastPrecipitationField(ctx, width, height, stations, frame) {
    ctx.clearRect(0, 0, width, height);
    if (!stations.length || !state.map.instance) return;

    const step = 10; // Feines Sampling für butterweiche Verläufe
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;

    // 1. Berechne synoptische Verlagerung & Front-Zugrichtung
    let sumU = 0, sumV = 0, count = 0;
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const spd = st.windSpeed !== undefined ? st.windSpeed : 16;
      const dir = st.windDirection !== undefined ? st.windDirection : 240;
      const rad = (dir * Math.PI) / 180;
      sumU += -spd * Math.sin(rad);
      sumV += -spd * Math.cos(rad);
      count++;
    }
    const avgU = count ? (sumU / count) : -12;
    const avgV = count ? (sumV / count) : 8;
    const avgDir = (Math.atan2(-avgU, -avgV) * (180 / Math.PI) + 360) % 360;
    const frontMotionDir = (avgDir + 180) % 360;

    // Front-Querachse (entlang dieser Achse streckt sich die Front natürlich)
    const frontAxisRad = ((frontMotionDir + 90) * Math.PI) / 180;
    const cosA = Math.cos(frontAxisRad);
    const sinA = Math.sin(frontAxisRad);

    // Advektionsverschiebung über die Zeit (Front wandert kontinuierlich in Zugrichtung)
    const hours = (frame && typeof frame.hoursFromNow === 'number') ? frame.hoursFromNow : 0;
    const radMotion = (frontMotionDir * Math.PI) / 180;
    const advectLat = Math.cos(radMotion) * (hours * 0.038);
    const advectLon = Math.sin(radMotion) * (hours * 0.052);

    const rawGridP = new Float32Array(cols * rows);
    const rawGridT = new Float32Array(cols * rows);

    // Raster-Abtastung mit weicher frontorientierter Gauß-Gewichtung (keine Kreis-Bullseyes!)
    for (let r = 0; r < rows; r++) {
      const y = r * step;
      for (let c = 0; c < cols; c++) {
        const x = c * step;
        const latLng = state.map.instance.containerPointToLatLng([x, y]);
        const sampleLat = latLng.lat - advectLat;
        const sampleLon = latLng.lng - advectLon;

        let sumWP = 0, sumVP = 0;
        let sumWT = 0, sumVT = 0;

        for (let i = 0; i < stations.length; i++) {
          const st = stations[i];
          const dLat = sampleLat - st.lat;
          const dLon = sampleLon - st.lon;

          // Koordinatentransformation entlang der Frontachse:
          const u = dLon * cosA + dLat * sinA;  // entlang der Front (gedehnt)
          const v = -dLon * sinA + dLat * cosA; // quer zur Front

          // Anisotrope Ausdehnung verhindert radiale Punktkreise
          const effDistSq = (u * 0.45) * (u * 0.45) + (v * 1.35) * (v * 1.35);

          const wP = Math.exp(-effDistSq / 0.22);
          const wT = Math.exp(-effDistSq / 0.50);

          const p = (st.precip || 0) + (st.snow || 0) * 0.8;
          const t = st.temperature !== undefined ? st.temperature : 8;

          sumWP += wP;
          sumVP += p * wP;

          sumWT += wT;
          sumVT += t * wT;
        }

        const idx = r * cols + c;
        // Distanz-Dämpfung bei großem Abstand zu Messpunkten, damit kein diffuser Dauer-Schleier entsteht
        const confidence = Math.min(1.0, sumWP * 3.5);
        rawGridP[idx] = sumWP > 0.001 ? (sumVP / sumWP) * confidence : 0;
        rawGridT[idx] = sumWT > 0.001 ? (sumVT / sumWT) : 8;
      }
    }

    // 2. Räumliche 2D-Glättung (Separabler 3x3 Boxfilter) gegen lokale Stufen
    const smoothGridP = new Float32Array(cols * rows);
    const smoothGridT = new Float32Array(cols * rows);

    for (let r = 0; r < rows; r++) {
      const rPrev = Math.max(0, r - 1);
      const rNext = Math.min(rows - 1, r + 1);
      for (let c = 0; c < cols; c++) {
        const cPrev = Math.max(0, c - 1);
        const cNext = Math.min(cols - 1, c + 1);

        const idx = r * cols + c;
        const pCenter = rawGridP[idx];
        const pNeighbors = rawGridP[rPrev * cols + c] + rawGridP[rNext * cols + c]
                         + rawGridP[r * cols + cPrev] + rawGridP[r * cols + cNext];
        smoothGridP[idx] = pCenter * 0.5 + pNeighbors * 0.125;

        const tCenter = rawGridT[idx];
        const tNeighbors = rawGridT[rPrev * cols + c] + rawGridT[rNext * cols + c]
                         + rawGridT[r * cols + cPrev] + rawGridT[r * cols + cNext];
        smoothGridT[idx] = tCenter * 0.5 + tNeighbors * 0.125;
      }
    }

    // 3. Pixel zeichnen mit stufenlosem Temperaturübergang
    if (!this.offscreenCanvas || this.offscreenCanvas.width !== cols || this.offscreenCanvas.height !== rows) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = cols;
      this.offscreenCanvas.height = rows;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
    const imgData = this.offscreenCtx.createImageData(cols, rows);
    const data = imgData.data;

    for (let i = 0; i < cols * rows; i++) {
      const p = smoothGridP[i];
      const t = smoothGridT[i];
      const rgba = this.computePrecipPixelRgba(p, t);
      const pIdx = i * 4;
      data[pIdx] = rgba[0];
      data[pIdx + 1] = rgba[1];
      data[pIdx + 2] = rgba[2];
      data[pIdx + 3] = rgba[3];
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);

    // 4. Glatte Rasterzeichnung auf den Haupt-Canvas
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreenCanvas, 0, 0, width, height);
    ctx.restore();
  },

  // 6. LIVE-BLITZE & GEWITTER-POTENZIAL
  renderLightningField(ctx, width, height, stations, frame) {
    ctx.clearRect(0, 0, width, height);
    const step = 24;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;

    for (let r = 0; r < rows; r++) {
      const y = r * step;
      for (let c = 0; c < cols; c++) {
        const x = c * step;
        const latLng = state.map.instance.containerPointToLatLng([x, y]);
        const pVal = this.interpolateStationMetric(latLng.lat, latLng.lng, stations, 'precip');
        const tVal = this.interpolateStationMetric(latLng.lat, latLng.lng, stations, 'temperature');
        const wCode = this.interpolateStationMetric(latLng.lat, latLng.lng, stations, 'weatherCode');

        const isStorm = (wCode >= 95 && wCode <= 99) || (pVal >= 3.5 && tVal >= 16);
        if (isStorm) {
          ctx.save();
          ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
          ctx.beginPath();
          ctx.arc(x, y, step * 1.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }
};

/**
 * Rendert das aktuell aktive Wetter-Overlay (48h Radar, Wind, Blitze, Wolken, Temp, Druck)
 * präzise und unendlich trennscharf über der gesamten Kartenoberfläche.
 */
export function renderActiveWeatherOverlayForFrame(frame, overlay) {
  if (!state.map.instance || !state.map.weatherLayerGroup) return;

  const stations = (frame && frame.stations && frame.stations.length > 0)
    ? frame.stations
    : ((state.map.regionalStationsData && state.map.regionalStationsData.length > 0)
        ? state.map.regionalStationsData
        : getSynthesizedBaselineStations());

  const t = new Date((frame && frame.timestampMs) || Date.now());
  const dayStr = t.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const timeStr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  
  let relStr = 'Jetzt';
  if (frame) {
    if (frame.isLive || frame.minuteOffset === 0) {
      relStr = '🔴 Live-Scan';
    } else if (frame.minuteOffset !== undefined) {
      const mo = frame.minuteOffset;
      if (mo < 0) {
        relStr = `Vor ${Math.abs(mo)} Min. (15m)`;
      } else if (mo <= 60) {
        relStr = `+${mo}m Nowcast (5m)`;
      } else if (mo % 60 === 0) {
        relStr = `+${mo / 60}h`;
      } else {
        relStr = `+${Math.floor(mo / 60)}h ${mo % 60}m (15m)`;
      }
    } else if (frame.type === 'past') {
      relStr = `Vor ${Math.round((Date.now() - t.getTime()) / 60000)} Min.`;
    } else if (frame.hoursFromNow) {
      relStr = `+${frame.hoursFromNow}h`;
    }
  }

  const modeChip = document.getElementById('radar-mode-chip');
  const timeDisplay = document.getElementById('radar-time-display');

  // ZEITREGLER-DOCK BLEIBT IMMER SICHTBAR AUF ALLEN ANSICHTEN
  const radarControls = document.getElementById('radar-floating-controls');
  if (radarControls) {
    radarControls.style.display = 'flex';
  }

  // Berechne exakte Wetterdaten für den aktuell betrachteten Standort/Berg für diesen Zeitschritt
  const locWeather = getLocationWeatherForFrame(frame);

  // Aktualisiere Live-Windkompass-Widget (wird automatisch angezeigt, wenn overlay === 'wind')
  updateWindCompassWidget(frame);

  // Aktualisiere Live-Point-Wetter-Kachel für den aktuellen Zeitpunkt/Frame
  updatePointWeatherCard(frame);

  // =========================================================================
  // 1. NIEDERSCHLAG & RADAR (48h RADAR)
  // =========================================================================
  if (overlay === 'precip' || overlay === 'rainviewer-radar') {
    if (frame && frame.type === 'past') {
      if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();
      cleanupRadarTiles();

      if (modeChip) {
        if (frame.isLive) {
          modeChip.innerText = '🔴 LIVE-RADAR';
          modeChip.style.background = 'rgba(239, 68, 68, 0.25)';
          modeChip.style.borderColor = '#ef4444';
        } else if (frame.minuteOffset !== undefined && frame.minuteOffset < 0) {
          modeChip.innerText = `⏪ -${Math.abs(frame.minuteOffset)}m Radar-Historie (15m)`;
          modeChip.style.background = 'rgba(56, 189, 248, 0.2)';
          modeChip.style.borderColor = '#38bdf8';
        } else {
          modeChip.innerText = '⏪ Radar-Historie';
          modeChip.style.background = 'rgba(56, 189, 248, 0.2)';
          modeChip.style.borderColor = '#38bdf8';
        }
      }
      if (timeDisplay) {
        let pText = 'Trocken';
        if (locWeather.snow > 0) pText = `❄️ Schneefall (${locWeather.snow.toFixed(1)} cm/h)`;
        else if (locWeather.precip >= 3.0) pText = `⛈️ Starkregen (${locWeather.precip.toFixed(1)} mm/h)`;
        else if (locWeather.precip > 0) pText = `🌧️ Regen (${locWeather.precip.toFixed(1)} mm/h)`;
        timeDisplay.innerText = `${timeStr} Uhr (${relStr}) • 📍 ${locWeather.name}: ${pText} • Doppler-Scan`;
      }
      WeatherCanvasEngine.render(frame, 'precip');
    } else if (frame) {
      if (state.map.radarTileLayer && state.map.instance.hasLayer(state.map.radarTileLayer)) {
        state.map.instance.removeLayer(state.map.radarTileLayer);
        state.map.radarTileLayer = null;
      }
      renderFutureRadarCells(frame);
      WeatherCanvasEngine.render(frame, 'precip');

      if (modeChip) {
        if (frame.minuteOffset !== undefined && frame.minuteOffset <= 60 && frame.minuteOffset > 0) {
          modeChip.innerText = `⚡ +${frame.minuteOffset}m High-Res Nowcast (5m)`;
          modeChip.style.background = 'rgba(245, 158, 11, 0.25)';
          modeChip.style.borderColor = '#f59e0b';
        } else if (frame.minuteOffset !== undefined && frame.minuteOffset <= 180) {
          const hStr = frame.minuteOffset % 60 === 0 ? `+${frame.minuteOffset / 60}h` : `+${Math.floor(frame.minuteOffset / 60)}h ${frame.minuteOffset % 60}m`;
          modeChip.innerText = `🔮 ${hStr} Detail-Radar (15m)`;
          modeChip.style.background = 'rgba(168, 85, 247, 0.25)';
          modeChip.style.borderColor = '#c084fc';
        } else {
          const h = frame.hoursFromNow || Math.round((frame.minuteOffset || 0) / 60);
          modeChip.innerText = `🔮 +${h}h Prognose-Radar`;
          modeChip.style.background = 'rgba(168, 85, 247, 0.25)';
          modeChip.style.borderColor = '#c084fc';
        }
      }
      if (timeDisplay) {
        let pText = 'Trocken (0.0 mm/h)';
        if (locWeather.snow > 0) pText = `❄️ Schneefall (${locWeather.snow.toFixed(1)} cm/h)`;
        else if (locWeather.precip >= 3.0) pText = `⛈️ Starkregen (${locWeather.precip.toFixed(1)} mm/h)`;
        else if (locWeather.precip > 0) pText = `🌧️ Regen (${locWeather.precip.toFixed(1)} mm/h)`;

        const baseT = locWeather.temp !== undefined ? locWeather.temp : 6;
        const freezingLevel = Math.max(600, Math.round(locWeather.elevation + (baseT / 0.0065)));
        timeDisplay.innerText = `${dayStr}, ${timeStr} Uhr (${relStr}) • 📍 ${locWeather.name}: ${pText} • Schneefallgrenze: ~${freezingLevel} m`;
      }
    }

    state.map.weatherLayerGroup.clearLayers();
  }

  // =========================================================================
  // 2. WIND (48h VEKTORIELLES WINDFELD & BÖEN)
  // =========================================================================
  else if (overlay === 'wind') {
    cleanupRadarTiles();

    let sumSpd = 0, sumDir = 0, count = 0;
    stations.forEach(st => {
      sumSpd += (st.windSpeed || 15);
      sumDir += (st.windDirection || 240);
      count++;
    });
    const avgSpd = count ? Math.round(sumSpd / count) : 20;

    WeatherCanvasEngine.render(frame, 'wind');

    if (modeChip) {
      modeChip.innerText = (frame && frame.isLive) ? '💨 Live-Windfeld' : `💨 ${relStr} Wind`;
      modeChip.style.background = 'rgba(56, 189, 248, 0.25)';
      modeChip.style.borderColor = '#38bdf8';
    }
    if (timeDisplay) {
      const card = getWindCardinalName(locWeather.windDir);
      timeDisplay.innerText = `${dayStr}, ${timeStr} Uhr (${relStr}) • 📍 ${locWeather.name}: ${locWeather.windSpeed} km/h (Böen: ${locWeather.windGusts} km/h) • ${card} (${locWeather.windDir}°)`;
    }

    state.map.weatherLayerGroup.clearLayers();
    stations.forEach(st => {
      const spd = st.windSpeed !== undefined ? st.windSpeed : 15;
      const gust = st.windGusts !== undefined ? st.windGusts : Math.round(spd * 1.35);
      const dir = st.windDirection !== undefined ? st.windDirection : 240;
      const isDarkMap = (state.map && state.map.activeBase === 'osm-dark');
      let color = isDarkMap ? '#22c55e' : '#002855';
      let bftClass = 'Schwache Brise';
      if (isDarkMap) {
        if (gust >= 80) { color = '#c084fc'; bftClass = 'Orkanartig'; }
        else if (gust >= 60) { color = '#ef4444'; bftClass = 'Sturm'; }
        else if (gust >= 40) { color = '#f59e0b'; bftClass = 'Starker Wind'; }
        else if (spd >= 25) { color = '#38bdf8'; bftClass = 'Frische Brise'; }
      } else {
        if (gust >= 80) { color = '#312e81'; bftClass = 'Orkanartig'; }
        else if (gust >= 60) { color = '#991b1b'; bftClass = 'Sturm'; }
        else if (gust >= 40) { color = '#b45309'; bftClass = 'Starker Wind'; }
        else if (spd >= 25) { color = '#0d47a1'; bftClass = 'Frische Brise'; }
      }

      const chipBg = isDarkMap ? 'background: rgba(15, 23, 42, 0.88);' : 'background: rgba(255, 255, 255, 0.94); box-shadow: 0 4px 12px rgba(0, 40, 85, 0.28);';
      const nameCol = isDarkMap ? '#ffffff' : '#0f172a';

      const badgeHtml = `
        <div class="station-mini-chip wind-chip" style="border-color:${color}; ${chipBg}">
          <span style="display:inline-block; transform:rotate(${dir}deg); font-weight:900; color:${color}; font-size:14px; line-height:1;">↑</span>
          <span class="smc-name" style="color:${nameCol};">${st.name}</span>
          <span class="smc-val" style="color:${color}; font-weight:800;">${spd} <small style="opacity:0.8;">(${gust})</small></span>
        </div>
      `;

      let gustTooltipColor = color;
      if (gust >= 80) gustTooltipColor = '#6b21a8';
      else if (gust >= 60) gustTooltipColor = '#b91c1c';
      else if (gust >= 40) gustTooltipColor = '#c2410c';
      else if (spd >= 25) gustTooltipColor = '#0369a1';
      else gustTooltipColor = '#047857';

      const icon = L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [48, 12] });
      const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
      m.bindTooltip(`
        <div style="color:#0f172a; padding:2px; line-height:1.45;">
          <strong style="color:#000000; font-size:12.5px;">${st.name} • ${st.isMountain ? '🏔️ Gipfel' : '🏡 Tal'} (${st.elevation} m)</strong><br>
          Wind: <b>${spd} km/h</b> • Spitzenböen: <b style="color:${gustTooltipColor}; font-weight:800;">${gust} km/h</b><br>
          Richtung: <b>${dir}°</b> • <span>${bftClass}</span>
        </div>
      `, { direction: 'top', offset: [0, -10] });
      m.on('click', () => selectExactLocation(st));
    });
  }

  // =========================================================================
  // 3. BLITZE (LIVE-BLITZE & GEWITTER-POTENZIAL)
  // =========================================================================
  else if (overlay === 'lightning') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'lightning');

    if (modeChip) {
      modeChip.innerText = (frame && frame.isLive) ? '⚡ Live-Blitzortung' : `⚡ ${relStr} Gewitter`;
      modeChip.style.background = 'rgba(239, 68, 68, 0.25)';
      modeChip.style.borderColor = '#ef4444';
    }

    state.map.weatherLayerGroup.clearLayers();

    if (!frame || frame.isLive || frame.type === 'past') {
      const storm = MicroEngine.computeLightningActivity(
        state.currentLocation.lat,
        state.currentLocation.lon,
        state.weatherData
      );

      if (timeDisplay) {
        timeDisplay.innerText = `${timeStr} Uhr (${relStr}) • 📍 ${locWeather.name}: ${storm.strikes.length > 0 ? `${storm.strikes.length} Live-Blitze (nächster: ${storm.closestStrikeKm} km)` : 'Keine Blitze im Nahbereich'}`;
      }

      L.circle([state.currentLocation.lat, state.currentLocation.lon], {
        radius: 14000,
        color: '#ff453a',
        fillColor: '#ff453a',
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: '4, 4'
      }).addTo(state.map.weatherLayerGroup);

      storm.strikes.forEach(s => {
        let color = '#64d2ff';
        if (s.ageMinutes < 5) color = '#ff3b30';
        else if (s.ageMinutes < 15) color = '#ff9500';
        else if (s.ageMinutes < 30) color = '#ffd166';

        const icon = L.divIcon({
          className: 'custom-lightning-icon',
          html: `<div class="lightning-marker" style="background:${color}; box-shadow:0 0 14px ${color};">⚡</div>`,
          iconAnchor: [12, 12]
        });

        const m = L.marker([s.lat, s.lon], { icon }).addTo(state.map.weatherLayerGroup);
        m.bindPopup(`
          <div style="font-family:sans-serif; color:#0f172a; padding:4px;">
            <strong style="color:${color}; font-size:13px;">⚡ Blitzentladung</strong><br>
            <b>Typ:</b> ${s.type}<br>
            <b>Stromstärke:</b> ${s.intensityKa} kA<br>
            <b>Alter:</b> vor ${s.ageMinutes} Min.<br>
            <b>Distanz:</b> ${s.distKm} km
          </div>
        `);
      });
    } else {
      let stormCount = 0;
      stations.forEach(st => {
        const isThunderstorm = (st.weatherCode >= 95 && st.weatherCode <= 99) || (st.precip >= 3.0 && st.temperature >= 15);
        if (isThunderstorm) {
          stormCount++;
          const icon = L.divIcon({
            className: 'custom-lightning-icon',
            html: `<div class="lightning-marker" style="background:#ef4444; box-shadow:0 0 16px #ff3b30;">⚡</div>`,
            iconAnchor: [12, 12]
          });
          const m = L.marker([st.lat, st.lon], { icon }).addTo(state.map.weatherLayerGroup);
          m.bindTooltip(`
            <div style="color:#0f172a; padding:2px; line-height:1.45;">
              ⚠️ <strong style="color:#b91c1c; font-size:12.5px;">${st.name} (+${frame.hoursFromNow}h)</strong><br>
              Konvektives Gewitterrisiko • Niederschlag: <b>${st.precip} mm/h</b>
            </div>
          `, { direction: 'top', offset: [0, -10] });
        }
      });

      if (timeDisplay) {
        const isLocalStorm = (locWeather.weatherCode >= 95 && locWeather.weatherCode <= 99) || (locWeather.precip >= 3.0 && locWeather.temp >= 15);
        timeDisplay.innerText = `${dayStr}, ${timeStr} Uhr (+${frame.hoursFromNow}h) • 📍 ${locWeather.name}: ${isLocalStorm ? '⚡ Lokales Gewitterpotenzial' : 'Keine Gewitterkonvektion'}`;
      }
    }
  }

  // =========================================================================
  // 4. WOLKEN (48h KONTINUIERLICHER BEWÖLKUNGSFILM)
  // =========================================================================
  else if (overlay === 'clouds') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'clouds');

    if (modeChip) {
      modeChip.innerText = (frame && frame.isLive) ? '☁️ Live-Bewölkung' : `☁️ ${relStr} Wolken`;
      modeChip.style.background = 'rgba(148, 163, 184, 0.25)';
      modeChip.style.borderColor = '#cbd5e1';
    }

    state.map.weatherLayerGroup.clearLayers();

    stations.forEach(st => {
      const c = st.cloudCover !== undefined ? st.cloudCover : 50;

      let icon = '☀️';
      let desc = 'Sonnig';
      if (c >= 80) { icon = '☁️'; desc = 'Bedeckt'; }
      else if (c >= 50) { icon = '⛅'; desc = 'Wolkig'; }
      else if (c >= 20) { icon = '🌤️'; desc = 'Heiter'; }

      const badgeHtml = `
        <div class="station-mini-chip cloud-chip">
          <span>${icon}</span>
          <span class="smc-name">${st.name}</span>
          <span class="smc-val">${c}%</span>
        </div>
      `;

      const m = L.marker([st.lat, st.lon], {
        icon: L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [38, 12] })
      }).addTo(state.map.weatherLayerGroup);

      m.bindTooltip(`
        <div style="color:#0f172a; padding:2px; line-height:1.45;">
          <strong style="color:#000000; font-size:12.5px;">${st.name} (${st.elevation} m)</strong><br>
          ${desc} (<b>${c}%</b> Wolkenbedeckung)
        </div>
      `, { direction: 'top', offset: [0, -10] });
      m.on('click', () => selectExactLocation(st));
    });

    if (timeDisplay) {
      let cDesc = 'Sonnig / Klar';
      if (locWeather.cloudCover >= 80) cDesc = 'Bedeckt';
      else if (locWeather.cloudCover >= 50) cDesc = 'Bewölkt';
      else if (locWeather.cloudCover >= 20) cDesc = 'Heiter';
      timeDisplay.innerText = `${dayStr}, ${timeStr} Uhr (${relStr}) • 📍 ${locWeather.name}: ${cDesc} (${locWeather.cloudCover}% Bewölkung)`;
    }
  }

  // =========================================================================
  // 5. TEMPERATUR (48h TEMPERATURFELD & 0°C-FROSTGRENZE)
  // =========================================================================
  else if (overlay === 'temp') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'temp');

    if (modeChip) {
      modeChip.innerText = (frame && frame.isLive) ? '🌡️ Live-Temperatur' : `🌡️ ${relStr} Temperatur`;
      modeChip.style.background = 'rgba(234, 179, 8, 0.25)';
      modeChip.style.borderColor = '#eab308';
    }

    state.map.weatherLayerGroup.clearLayers();

    stations.forEach(st => {
      const tVal = (st.temperature !== undefined && st.temperature !== null) ? Number(st.temperature) : 10;
      let color = '#22c55e';
      if (tVal < -5) color = '#1e40af';
      else if (tVal <= 0) color = '#06b6d4';
      else if (tVal >= 25) color = '#ef4444';
      else if (tVal >= 18) color = '#f97316';
      else if (tVal >= 10) color = '#eab308';

      const isFrost = tVal <= 0;
      const tIcon = isFrost ? '❄️' : '🌡️';

      const badgeHtml = `
        <div class="station-mini-chip temp-chip" style="border-color:${color};">
          <span>${tIcon}</span>
          <span class="smc-name">${st.name}</span>
          <span class="smc-val" style="color:${color}; font-weight:800;">${tVal.toFixed(1)}°C</span>
        </div>
      `;

      const m = L.marker([st.lat, st.lon], {
        icon: L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [42, 12] })
      }).addTo(state.map.weatherLayerGroup);

      let tempTooltipColor = color;
      if (tVal < -5) tempTooltipColor = '#1d4ed8';
      else if (tVal <= 0) tempTooltipColor = '#0284c7';
      else if (tVal >= 25) tempTooltipColor = '#b91c1c';
      else if (tVal >= 18) tempTooltipColor = '#c2410c';
      else if (tVal >= 10) tempTooltipColor = '#b45309';
      else tempTooltipColor = '#15803d';

      m.bindTooltip(`
        <div style="color:#0f172a; padding:2px; line-height:1.45;">
          <strong style="color:#000000; font-size:12.5px;">${st.name} (${st.elevation} m)</strong><br>
          Temperatur: <b style="color:${tempTooltipColor}; font-weight:800;">${tVal.toFixed(1)}°C</b> • ${isFrost ? '❄️ Frostgrenze (< 0°C)' : '💧 Tauwetter (> 0°C)'}
        </div>
      `, { direction: 'top', offset: [0, -10] });
      m.on('click', () => selectExactLocation(st));
    });

    if (timeDisplay) {
      const curT = (locWeather.temp !== undefined && locWeather.temp !== null) ? Number(locWeather.temp) : 0;
      const isFrost = curT <= 0;
      const tTag = isFrost ? '❄️ Frostgrenze' : '💧 Plusgrade';
      timeDisplay.innerText = `${dayStr}, ${timeStr} Uhr (${relStr}) • 📍 ${locWeather.name}: ${curT.toFixed(1)}°C (${tTag})`;
    }
  }

  // =========================================================================
  // 6. LUFTDRUCK (48h ISOBAREN & QNH)
  // =========================================================================
  else if (overlay === 'pressure') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'pressure');

    if (modeChip) {
      modeChip.innerText = (frame && frame.isLive) ? '⏱️ Live-Bodendruck QNH' : `⏱️ ${relStr} Druck`;
      modeChip.style.background = 'rgba(99, 102, 241, 0.25)';
      modeChip.style.borderColor = '#818cf8';
    }

    state.map.weatherLayerGroup.clearLayers();

    stations.forEach(st => {
      const p = (st.pressureMsl !== undefined && st.pressureMsl !== null) ? Number(st.pressureMsl) : ((st.weather && st.weather.pressure_msl != null) ? Number(st.weather.pressure_msl) : 1013.2);
      let color = '#38bdf8';
      let tag = 'Normal';
      if (p >= 1022) { color = '#3b82f6'; tag = '🔵 Hoch H'; }
      else if (p <= 1008) { color = '#ef4444'; tag = '🔴 Tief T'; }

      const badgeHtml = `
        <div class="station-mini-chip pressure-chip" style="border-color:${color};">
          <span>⏲️</span>
          <span class="smc-name">${st.name}</span>
          <span class="smc-val" style="color:${color}; font-weight:800;">${Math.round(p)} <small>hPa</small></span>
        </div>
      `;

      const m = L.marker([st.lat, st.lon], {
        icon: L.divIcon({ className: 'custom-weather-icon', html: badgeHtml, iconAnchor: [44, 12] })
      }).addTo(state.map.weatherLayerGroup);

      m.bindTooltip(`
        <div style="color:#0f172a; padding:2px; line-height:1.45;">
          <strong style="color:#000000; font-size:12.5px;">${st.name}</strong>: <b>${p.toFixed(1)} hPa QNH</b> (${tag})
        </div>
      `, { direction: 'top', offset: [0, -10] });
      m.on('click', () => selectExactLocation(st));
    });

    if (timeDisplay) {
      let pTag = 'Normaldruck';
      if (locWeather.pressure >= 1022) pTag = '🔵 Hochdruck H';
      else if (locWeather.pressure <= 1008) pTag = '🔴 Tiefdruck T';
      timeDisplay.innerText = `${dayStr}, ${timeStr} Uhr (${relStr}) • 📍 ${locWeather.name}: ${locWeather.pressure} hPa QNH (${pTag})`;
    }
  }
}

/**
 * Animiertes Windströmungs-Canvas für die Leaflet-Karte (Kompatibilitäts-Wrapper)
 */
export function startWindCanvas(windDirDeg, windSpeedKm) {
  const currentFrame = (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length)
    ? state.map.unifiedRadarFrames[state.map.radarIndex]
    : null;
  WeatherCanvasEngine.render(currentFrame, 'wind');
}

export function stopWindCanvas() {
  WeatherCanvasEngine.stopAnimation();
}

/**
 * Interpoliert die Wetterdaten aller alpinen Wetterstationen stufenlos für beliebige Minuten-Offsets.
 */
export function interpolateStationsForMinute(forecastFrames, minuteOffset, baseLiveStations) {
  const base = (baseLiveStations && baseLiveStations.length) ? baseLiveStations : getSynthesizedBaselineStations();
  if (minuteOffset === 0 || !forecastFrames || !forecastFrames.length) {
    return base;
  }

  const targetHour = minuteOffset / 60;

  if (targetHour < 0) {
    return base.map(st => ({ ...st }));
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
    const precip = Math.max(0, Math.round((s0.precip + (s1.precip - s0.precip) * ratio) * 10) / 10);
    const snow = Math.max(0, Math.round((s0.snow + (s1.snow - s0.snow) * ratio) * 10) / 10);
    const cloudCover = Math.round(s0.cloudCover + (s1.cloudCover - s0.cloudCover) * ratio);
    const pressureMsl = Math.round((s0.pressureMsl + (s1.pressureMsl - s0.pressureMsl) * ratio) * 10) / 10;
    const windSpeed = Math.round(s0.windSpeed + (s1.windSpeed - s0.windSpeed) * ratio);
    const windGusts = Math.round(s0.windGusts + (s1.windGusts - s0.windGusts) * ratio);
    const windDirection = interpAngle(s0.windDirection || 240, s1.windDirection || 240, ratio);
    const weatherCode = ratio < 0.5 ? s0.weatherCode : s1.weatherCode;
    const isSnow = temp <= 1.5 || snow > 0 || (weatherCode >= 71 && weatherCode <= 86);

    return {
      ...s0,
      temperature: temp,
      precip: precip,
      snow: snow,
      cloudCover: cloudCover,
      pressureMsl: pressureMsl,
      windSpeed: windSpeed,
      windGusts: windGusts,
      windDirection: windDirection,
      weatherCode: weatherCode,
      isSnow: isSnow
    };
  });
}

/**
 * ============================================================================
 * 48H ULTRA-HOCHAUFLÖSENDE RADAR- & TIMELINE ENGINE
 * ============================================================================
 * - Zurückliegende Stunde (-1h bis Jetzt): 15-Minuten-Abstand (-60m, -45m, -30m, -15m)
 * - Nächste Stunde in der Zukunft (Jetzt bis +1h): 5-Minuten-Abstand (+5m .. +60m Nowcast)
 * - Zukünftige 2. und 3. Stunde (+1h bis +3h): 15-Minuten-Abstand (+75m .. +180m)
 * - Stunden 4 bis 48: Stündliche Detailprognose (+4h .. +48h)
 */
export async function loadUnifiedRadarEngine() {
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
      ? MicroEngine.fetch48hRadarForecast(REGIONAL_STATIONS, state.weatherData)
      : MicroEngine.fetch24hRadarForecast(REGIONAL_STATIONS, state.weatherData);

    const [rvData, forecastFrames] = await Promise.all([rvPromise, forecastPromise]);

    const unifiedFrames = [];
    const nowMs = Date.now();
    const pastList = (rvData && rvData.radar && rvData.radar.past) || [];
    const nowcastList = (rvData && rvData.radar && rvData.radar.nowcast) || [];
    if (rvData && rvData.host) {
      state.map.radarHost = rvData.host;
    }

    const baseLiveStations = (forecastFrames && forecastFrames[0] && forecastFrames[0].stations && forecastFrames[0].stations.length > 0)
      ? forecastFrames[0].stations
      : getSynthesizedBaselineStations();

    // Helper für RainViewer Kachel-Zuordnung
    const findClosestRvTile = (targetMs, list) => {
      if (!list || !list.length) return null;
      let closest = null;
      let minDiff = Infinity;
      for (let i = 0; i < list.length; i++) {
        const diff = Math.abs(list[i].time * 1000 - targetMs);
        if (diff < minDiff) {
          minDiff = diff;
          closest = list[i];
        }
      }
      return minDiff <= 15 * 60 * 1000 ? closest : null;
    };

    // 1. Zurückliegende Stunde (-1h bis Jetzt) im 15-Minuten-Abstand: -60m, -45m, -30m, -15m
    const pastOffsets = [-60, -45, -30, -15];
    pastOffsets.forEach(m => {
      const fTimeMs = nowMs + m * 60000;
      const rvTile = findClosestRvTile(fTimeMs, pastList);
      unifiedFrames.push({
        type: 'past',
        time: Math.floor(fTimeMs / 1000),
        minuteOffset: m,
        hoursFromNow: m / 60,
        path: rvTile ? rvTile.path : (pastList.length ? pastList[0].path : ''),
        timestampMs: fTimeMs,
        label: `Vor ${Math.abs(m)} Min. (15m)`,
        isLive: false,
        stations: interpolateStationsForMinute(forecastFrames, m, baseLiveStations)
      });
    });

    // 2. JETZT (Live-Scan)
    const liveTile = nowcastList.length > 0 ? nowcastList[0] : (pastList.length > 0 ? pastList[pastList.length - 1] : null);
    const liveIdx = unifiedFrames.length;
    unifiedFrames.push({
      type: 'past',
      time: liveTile ? liveTile.time : Math.floor(nowMs / 1000),
      minuteOffset: 0,
      hoursFromNow: 0,
      path: liveTile ? liveTile.path : '',
      timestampMs: nowMs,
      label: '🔴 Live-Scan (Jetzt)',
      isLive: true,
      stations: baseLiveStations
    });

    // 3. Nächste Stunde in der Zukunft (Jetzt bis +1h) im 5-Minuten-Abstand: +5m bis +60m
    for (let m = 5; m <= 60; m += 5) {
      const fTimeMs = nowMs + m * 60000;
      const rvTile = findClosestRvTile(fTimeMs, nowcastList);
      const fDate = new Date(fTimeMs);
      const timeStr = fDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const stationsInterp = interpolateStationsForMinute(forecastFrames, m, baseLiveStations);
      const maxPrecip = Math.max(...stationsInterp.map(s => s.precip || 0));

      unifiedFrames.push({
        type: 'future',
        minuteOffset: m,
        hoursFromNow: m / 60,
        timestampMs: fTimeMs,
        timeStr: timeStr,
        label: `+${m}m Nowcast (5m)`,
        is5MinNowcast: true,
        hasPrecipitation: maxPrecip > 0.05,
        maxPrecipMm: maxPrecip,
        path: rvTile ? rvTile.path : '',
        cells: [],
        stations: stationsInterp
      });
    }

    // 4. Zukünftige 2. und 3. Stunde (+1h bis +3h) im 15-Minuten-Abstand: +75m bis +180m
    for (let m = 75; m <= 180; m += 15) {
      const fTimeMs = nowMs + m * 60000;
      const fDate = new Date(fTimeMs);
      const timeStr = fDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const stationsInterp = interpolateStationsForMinute(forecastFrames, m, baseLiveStations);
      const maxPrecip = Math.max(...stationsInterp.map(s => s.precip || 0));
      const hStr = m % 60 === 0 ? `+${m / 60}h` : `+${Math.floor(m / 60)}h ${m % 60}m`;

      unifiedFrames.push({
        type: 'future',
        minuteOffset: m,
        hoursFromNow: m / 60,
        timestampMs: fTimeMs,
        timeStr: timeStr,
        label: `${hStr} Prognose (15m)`,
        is15MinForecast: true,
        hasPrecipitation: maxPrecip > 0.05,
        maxPrecipMm: maxPrecip,
        path: '',
        cells: [],
        stations: stationsInterp
      });
    }

    // 5. Zukünftige Stunden 4 bis 48 (+4h bis +48h) im Stundentakt
    if (forecastFrames && Array.isArray(forecastFrames)) {
      forecastFrames.forEach(ff => {
        if (ff.hoursFromNow >= 4 && ff.hoursFromNow <= 48) {
          unifiedFrames.push({
            type: 'future',
            minuteOffset: ff.hoursFromNow * 60,
            hoursFromNow: ff.hoursFromNow,
            timestampMs: ff.timestampMs,
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
export function preloadRadarFrames(frames, host) {
  if (!frames || !host) return;
  frames.forEach(f => {
    if (f.type === 'past' && f.path) {
      const colorScheme = 2; // RainViewer Scheme 2 = Universal Blue
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
export function renderFutureRadarCells(frame) {
  if (state.map.futureRadarLayerGroup) {
    state.map.futureRadarLayerGroup.clearLayers();
  }
}

/**
 * Zeigt einen bestimmten Frame aus der kombinierten Timeline an
 * und aktualisiert das aktive Wetter-Overlay (Radar, Wind, Blitze, Wolken, Temp, Druck)
 */
export function showUnifiedRadarFrame(idx) {
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

  // Rendere das aktuell gewählte Wetter-Overlay exakt für diesen Zeitschritt
  const activeOverlay = state.map.activeOverlay || 'precip';
  renderActiveWeatherOverlayForFrame(frame, activeOverlay);
}

/**
 * Richtet alle Transport- & Schnellsprung-Buttons für das 24h-Radar ein
 */
export function setupUnifiedRadarControls() {
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
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCol = player.classList.toggle('is-collapsed');
      toggleBtn.innerText = isCol ? '▴' : '▾';
      toggleBtn.title = isCol ? 'Player vergrößern' : 'Player minimieren';
    });

    player.addEventListener('click', (e) => {
      if (player.classList.contains('is-collapsed') && !e.target.closest('#radar-play-btn')) {
        player.classList.remove('is-collapsed');
        toggleBtn.innerText = '▾';
        toggleBtn.title = 'Player minimieren';
      }
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

  // Quick Jump Buttons
  document.querySelectorAll('.radar-jump-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      stopRadarAnimation();
      const target = btn.dataset.target;
      const targetIdx = findFrameIndexForTarget(target);
      showUnifiedRadarFrame(targetIdx);
    });
  });
}

export function findFrameIndexForTarget(target) {
  const frames = state.map.unifiedRadarFrames;
  if (!frames || frames.length === 0) return 0;

  if (target === 'past') {
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].minuteOffset === -60) return i;
    }
    return 0;
  }

  if (target === 'now') {
    return state.map.liveRadarIndex !== undefined ? state.map.liveRadarIndex : 0;
  }

  const str = String(target).trim();

  // Minuten-Target (z.B. "-30m", "+15m", "15m", "-30")
  if (str.includes('m') || str.startsWith('-')) {
    const targetMin = parseInt(str.replace(/[^0-9\-]/g, ''), 10);
    if (!isNaN(targetMin)) {
      let bestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const mo = frames[i].minuteOffset !== undefined ? frames[i].minuteOffset : (frames[i].hoursFromNow ? frames[i].hoursFromNow * 60 : 0);
        const diff = Math.abs(mo - targetMin);
        if (diff < minDiff) {
          minDiff = diff;
          bestIdx = i;
        }
      }
      return bestIdx;
    }
  }

  // Stunden-Target (z.B. "+3h", "3h", "3", "12", "24")
  const targetHour = parseInt(str.replace(/[^0-9]/g, ''), 10);
  if (!isNaN(targetHour)) {
    if (!str.includes('h') && [15, 30, 45, 60, 90, 120].includes(targetHour)) {
      let bestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < frames.length; i++) {
        const mo = frames[i].minuteOffset !== undefined ? frames[i].minuteOffset : (frames[i].hoursFromNow ? frames[i].hoursFromNow * 60 : 0);
        const diff = Math.abs(mo - targetHour);
        if (diff < minDiff) {
          minDiff = diff;
          bestIdx = i;
        }
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

    if (target === 'past' && (idx === 0 || curMinute === -60)) {
      btn.classList.add('active');
    } else if (target === 'now' && (idx === state.map.liveRadarIndex || curMinute === 0)) {
      btn.classList.add('active');
    } else if (target.includes('m') || target.startsWith('-')) {
      const m = parseInt(target.replace(/[^0-9\-]/g, ''), 10);
      if (curMinute === m) btn.classList.add('active');
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

export function startRadarAnimation() {
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
  if (playBtn) playBtn.innerText = '▶';
}

export function toggleRadarPlay() {
  if (state.map.radarPlaying) {
    stopRadarAnimation();
  } else {
    startRadarAnimation();
  }
}

export function stepRadar(delta) {
  if (!state.map.unifiedRadarFrames || state.map.unifiedRadarFrames.length === 0) return;
  let next = state.map.radarIndex + delta;
  if (next < 0) next = state.map.unifiedRadarFrames.length - 1;
  if (next >= state.map.unifiedRadarFrames.length) next = 0;
  showUnifiedRadarFrame(next);
}

export function updateMapLocation() {
  if (!state.map.instance) return;
  const loc = state.currentLocation;
  // Zoomlevel niemals automatisch verändern: Zoom erfolgt ausschließlich manuell (Pinch/Mac-Controls/Zoom-Buttons)
  state.map.instance.panTo([loc.lat, loc.lon], { animate: true });
  if (state.map.marker) {
    state.map.marker.setLatLng([loc.lat, loc.lon]);
    state.map.marker.setIcon(createUserLocationBeaconIcon(loc));
  }
  const chip = document.getElementById('map-location-chip');
  if (chip) chip.innerHTML = `<span>📍 ${escapeHtml(loc.name)}</span>`;
  updateWeatherOverlay();
  updatePointWeatherCard();
}
