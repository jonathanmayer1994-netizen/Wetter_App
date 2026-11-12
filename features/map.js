/**
 * BEST WEATHER — Map & 24h Radar Domain Feature Module (Task 1a)
 * Leaflet multi-layer radar animation player, time scrubber,
 * station synthesis, and weather overlays (precip, wind, cloud, temp, pressure).
 */

import { state } from '../core/state.js';
import { BASE_LAYERS, REGIONAL_STATIONS, WMO_CODES } from '../core/constants.js';
import { selectExactLocation } from './search.js';
import { MicroEngine } from '../microEngine.js';
import {
  escapeHtml,
  resilientFetch,
  getApiCooldownUntil,
  setApiCooldownUntil,
  clearApiCooldown,
  tripCircuitBreakerFromResponse,
  recordExternalNetworkCall
} from '../httpClient.js';

export function formatCleanLocationName(loc) {
  const raw = loc && loc.name ? String(loc.name).trim() : 'Standort';
  // Entferne überlanges "Mein Standort (Ortsname)" -> "Ortsname" für mobile Kacheln ohne abgeschnittene "..."
  const parenMatch = raw.match(/^Mein Standort\s*\(([^)]+)\)$/i);
  if (parenMatch && parenMatch[1]) {
    return parenMatch[1].trim();
  }
  if (/^Mein Standort$/i.test(raw)) {
    return 'Standort';
  }
  return raw;
}

export function createUserLocationBeaconIcon(loc) {
  const name = formatCleanLocationName(loc);
  const ele = loc && loc.elevation ? `${loc.elevation} m` : '';
  return L.divIcon({
    className: 'custom-location-beacon-container',
    html: `
      <div class="user-location-beacon ms-beacon" title="${escapeHtml(name)} ${ele ? `(${ele})` : ''}">
        <div class="beacon-halo-disk"></div>
        <div class="beacon-pulse-ring"></div>
        <div class="beacon-core-dot"></div>
      </div>
    `,
    iconSize: [72, 72],
    iconAnchor: [36, 36]
  });
}

export function syncMeteoSwissHudControls() {
  const activeOverlay = (state.map && state.map.activeOverlay) || 'precip';
  const segOverlay = ['precip', 'wind', 'clouds', 'temp'].includes(activeOverlay) ? activeOverlay : '';

  document.querySelectorAll('.ms-seg-btn').forEach(btn => {
    const isAct = btn.dataset.overlay === segOverlay;
    btn.classList.toggle('active', isAct);
    btn.setAttribute('aria-selected', isAct ? 'true' : 'false');
  });

  const subMap = {
    'precip': state.map && state.map.precipPhaseEnabled === false ? 'Niederschlag (Intensität)' : 'Niederschlag & Niederschlagstyp',
    'rainviewer-radar': 'Niederschlag & Niederschlagstyp',
    'wind': 'Wind & Böen (Alpinfeld)',
    'clouds': 'Bewölkung & Hochnebel',
    'temp': 'Temperatur & 0°C-Grenze',
    'pressure': 'Luftdruck QNH & Isobaren',
    'lightning': 'Blitze & Konvektion'
  };
  const subEl = document.getElementById('map-overlay-subtitle');
  if (subEl) subEl.innerText = subMap[activeOverlay] || 'Niederschlag & Niederschlagstyp';

  const fabLight = document.getElementById('ms-fab-lightning');
  if (fabLight) {
    const on = activeOverlay === 'lightning' || !!(state.map && state.map.showLightningOverlay);
    fabLight.classList.toggle('is-active', on);
    fabLight.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  const fabStratus = document.getElementById('ms-fab-stratus');
  if (fabStratus) {
    const on = state.map ? state.map.showStratusOverlay !== false : true;
    fabStratus.classList.toggle('is-active', on);
    fabStratus.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  const fabPhase = document.getElementById('ms-fab-precip-type');
  if (fabPhase) {
    const on = state.map ? state.map.precipPhaseEnabled !== false : true;
    fabPhase.classList.toggle('is-phase-active', on);
    fabPhase.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  const phaseAxisLabel = document.getElementById('ms-phase-axis-label');
  if (phaseAxisLabel) {
    const on = state.map ? state.map.precipPhaseEnabled !== false : true;
    phaseAxisLabel.innerText = on ? 'Niederschlagstyp' : 'Intensität';
  }

  const legendBtn = document.getElementById('map-legend-toggle-btn');
  const legendCard = document.getElementById('map-legend-card');
  if (legendBtn && legendCard) {
    const isVis = !!(state.map && state.map.legendVisible);
    legendCard.classList.toggle('ms-legend-force-open', isVis);
    legendBtn.classList.toggle('is-active', isVis);
    legendBtn.setAttribute('aria-pressed', isVis ? 'true' : 'false');
  }
}

export function initLeafletMap() {
  const mapElem = document.getElementById('interactive-map');
  if (!mapElem) return;

  // 1. Initialisiere Leaflet mit voller Touch- & Maus-Zoomunterstützung (bis Stufe 20)
  state.map.instance = L.map('interactive-map', {
    zoomControl: false, // Eigene Apple Liquid Glass / MeteoSwiss Controls
    attributionControl: false,
    scrollWheelZoom: true,
    touchZoom: true,
    doubleClickZoom: true,
    maxZoom: 20
  }).setView([state.currentLocation.lat, state.currentLocation.lon], 9);

  // 2. Erstelle MeteoSwiss-Kartenpanes (Relief unter Wetter-Canvas, Beschriftungen & Beacon ÜBER Wetter-Canvas)
  const hillshadePane = state.map.instance.createPane('hillshadePane');
  hillshadePane.style.zIndex = 205;
  hillshadePane.style.pointerEvents = 'none';

  const labelsPane = state.map.instance.createPane('labelsOverlayPane');
  labelsPane.style.zIndex = 450;
  labelsPane.style.pointerEvents = 'none';

  // Wetter-Canvas sauber in Leaflet overlayPane (z-index 400) platzieren,
  // damit Ortsnamen (450) & Standort-Beacon (600+) IMMER über Radar & Hochnebel liegen!
  const weatherCanvas = document.getElementById('wind-flow-canvas');
  const overlayPane = state.map.instance.getPanes().overlayPane;
  if (weatherCanvas && overlayPane && weatherCanvas.parentElement !== overlayPane) {
    overlayPane.appendChild(weatherCanvas);
    L.DomUtil.setPosition(weatherCanvas, state.map.instance.containerPointToLayerPoint([0, 0]));
  }

  // 2b. Erstelle Layer-Gruppen für Zukunftsradar & Marker
  state.map.futureRadarLayerGroup = L.layerGroup().addTo(state.map.instance);
  state.map.weatherLayerGroup = L.layerGroup().addTo(state.map.instance);

  // 3. Setze Standard-Basiskarte synchron zu state & UI (MeteoSwiss Alpin-Dunkel 3D Relief)
  const initialBase = (state.map.activeBase && BASE_LAYERS[state.map.activeBase]) ? state.map.activeBase : 'osm-dark';
  state.map.activeBase = initialBase;
  setMapBaseLayer(initialBase);

  // 4. Eigener Standort-Marker (MeteoSwiss rot-weißer Puls-Beacon)
  state.map.marker = L.marker([state.currentLocation.lat, state.currentLocation.lon], {
    icon: createUserLocationBeaconIcon(state.currentLocation),
    zIndexOffset: 3000
  }).addTo(state.map.instance);

  // 5. Klick auf beliebigen Punkt auf der Karte berechnet exakte Geländehöhe & lädt Standort
  // Entprellt (200ms), damit Doppel-Tipp / Doppel-Klick zum Reinzommen nicht als Standortwahl missverstanden wird
  let mapClickTimer = null;
  state.map.instance.on('click', (e) => {
    if (mapClickTimer) {
      clearTimeout(mapClickTimer);
      mapClickTimer = null;
      return;
    }
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;

    mapClickTimer = setTimeout(async () => {
      mapClickTimer = null;

      // Sofortige visuelle Rückmeldung: Beacon-Marker direkt auf Klickpunkt setzen
      if (state.map.marker) {
        state.map.marker.setLatLng([lat, lon]);
      }
      // Zoomlevel niemals automatisch verändern: Zoom erfolgt ausschließlich manuell (Pinch/Mac-Controls/Zoom-Buttons)
      state.map.instance.panTo([lat, lon], { animate: true });
      
      let elev = 500;
      try {
        const elData = await resilientFetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`,
          { ttlMs: 30 * 24 * 60 * 60 * 1000, persist: true }
        );
        if (elData && elData.elevation && elData.elevation[0] !== undefined) {
          elev = Math.round(elData.elevation[0]);
        }
      } catch(err) {
        try {
          elev = Math.round(ViewportDemStore.getElevation(lat, lon, state.map.regionalStationsData || REGIONAL_STATIONS));
        } catch(_) {}
        console.warn('Elevation fetch failed for map click, using DEM fallback:', elev, err?.message || err);
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
    }, 200);
  });

  // Doppel-Klick / Doppel-Tipp dient ausschließlich dem Kartenzoom und schließt NIEMALS den Vollbildmodus
  state.map.instance.on('dblclick', (e) => {
    if (mapClickTimer) {
      clearTimeout(mapClickTimer);
      mapClickTimer = null;
    }
    if (e.originalEvent) {
      e.originalEvent.stopPropagation();
    }
  });

  // 6. Event-Listener für Basiskarten-Buttons (OSM)
  document.querySelectorAll('.map-base-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const base = btn.dataset.base;
      document.querySelectorAll('.map-base-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.base === base);
      });
      setMapBaseLayer(base);
    });
  });

  // 7. Event-Listener für Wetter-Overlay-Buttons
  document.querySelectorAll('.map-overlay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const overlay = btn.dataset.overlay;
      document.querySelectorAll('.map-overlay-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.overlay === overlay);
      });
      setMapOverlay(overlay);
    });
  });

  // 8. Layer & Kartenstil Drawer Controller (Apple Weather / Windy Style)
  const layerPill = document.getElementById('map-layer-pill');
  const layerDrawer = document.getElementById('map-layer-drawer');
  const layerBackdrop = document.getElementById('map-layer-backdrop');
  const layerCloseBtn = document.getElementById('map-layer-close-btn');
  const layerDoneBtn = document.getElementById('map-layer-done-btn');

  function openMapLayerDrawer() {
    if (layerDrawer) {
      layerDrawer.classList.add('is-open');
      layerDrawer.style.display = 'flex';
    }
    if (layerBackdrop) {
      layerBackdrop.classList.add('is-open');
      layerBackdrop.style.display = 'block';
    }
    if (layerPill) {
      layerPill.classList.add('active');
      layerPill.setAttribute('aria-expanded', 'true');
    }
  }

  function closeMapLayerDrawer() {
    if (layerDrawer) {
      layerDrawer.classList.remove('is-open');
      layerDrawer.style.display = 'none';
    }
    if (layerBackdrop) {
      layerBackdrop.classList.remove('is-open');
      layerBackdrop.style.display = 'none';
    }
    if (layerPill) {
      layerPill.classList.remove('active');
      layerPill.setAttribute('aria-expanded', 'false');
    }
  }

  if (layerPill) {
    layerPill.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = layerDrawer && layerDrawer.classList.contains('is-open');
      if (isOpen) closeMapLayerDrawer();
      else openMapLayerDrawer();
    });
  }
  if (layerCloseBtn) layerCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeMapLayerDrawer(); });
  if (layerDoneBtn) layerDoneBtn.addEventListener('click', (e) => { e.stopPropagation(); closeMapLayerDrawer(); });
  if (layerBackdrop) layerBackdrop.addEventListener('click', () => closeMapLayerDrawer());

  // Schnell-Aktionen im Drawer
  const mldRecenterBtn = document.getElementById('mld-recenter-btn');
  if (mldRecenterBtn) {
    mldRecenterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance && state.currentLocation) {
        state.map.instance.panTo([state.currentLocation.lat, state.currentLocation.lon], { animate: true });
      }
      closeMapLayerDrawer();
    });
  }
  const mldAlpsBtn = document.getElementById('mld-alps-btn');
  if (mldAlpsBtn) {
    mldAlpsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance) {
        state.map.instance.setView([47.2, 11.5], 7, { animate: true });
      }
      closeMapLayerDrawer();
    });
  }

  // 9. Initialisiere Zukunfts-Radar Steuerungs-Elemente (Slider, Play, Jump, Speed)
  setupUnifiedRadarControls();

  // 10. Karten-Overlay initialisieren (Radar-/stations-API erst bei Map-Aktivierung laden)
  state.map.activeOverlay = 'precip';
  if (state.activeTab === 'tab-map') {
    loadUnifiedRadarEngine();
  }
  updateWeatherOverlay();
  updatePointWeatherCard();
  updateMapLayerPill();

  // 11. Karteninteraktion (Pan & Zoom) synchronisiert das unendlich scharfe Wetterfeld
  let panRenderRaf = null;
  state.map.instance.on('move', () => {
    const wc = document.getElementById('wind-flow-canvas');
    if (wc && state.map.instance) {
      L.DomUtil.setPosition(wc, state.map.instance.containerPointToLayerPoint([0, 0]));
    }
    if (state.map.activeOverlay === 'wind') return;
    if (panRenderRaf) return;
    panRenderRaf = requestAnimationFrame(() => {
      panRenderRaf = null;
      if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
        const f = state.map.unifiedRadarFrames[state.map.radarIndex] || {};
        WeatherCanvasEngine.render(f, state.map.activeOverlay, { fastPan: true });
      }
    });
  });

  state.map.instance.on('moveend zoomend', () => {
    if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
      const f = state.map.unifiedRadarFrames[state.map.radarIndex] || {};
      WeatherCanvasEngine.render(f, state.map.activeOverlay);
    }
    if (state.map.activeOverlay === 'precip' || state.map.activeOverlay === 'rainviewer-radar') {
      ViewportDemStore.scheduleFetchForMap(state.map.instance);
      ViewportForecastGridStore.scheduleFetchForMap(state.map.instance);
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
        if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
          const f = state.map.unifiedRadarFrames[state.map.radarIndex] || {};
          WeatherCanvasEngine.render(f, state.map.activeOverlay);
        }
      }
    }, 100);
  });

  // 12. Mobile Vollbild-Karte und Ergonomie Setup (Schließen-Button, Point-Weather & MeteoSwiss FABs)
  setupMobileMapFullscreen();

  // 13. MeteoSwiss Segmented Bar, Header Collapse, Info Legend & Right FAB Stack
  document.querySelectorAll('.ms-seg-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const overlay = btn.dataset.overlay;
      if (!overlay) return;
      document.querySelectorAll('.map-overlay-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.overlay === overlay);
      });
      setMapOverlay(overlay);
    });
  });

  const headerCollapseBtn = document.getElementById('ms-header-collapse-btn');
  const headerBar = document.getElementById('ms-map-header-bar');
  if (headerCollapseBtn && headerBar) {
    headerCollapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      headerBar.classList.toggle('is-collapsed');
    });
  }

  const legendToggleBtn = document.getElementById('map-legend-toggle-btn');
  if (legendToggleBtn) {
    legendToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.map.legendVisible = !state.map.legendVisible;
      syncMeteoSwissHudControls();
    });
  }

  const fabLightning = document.getElementById('ms-fab-lightning');
  if (fabLightning) {
    fabLightning.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.activeOverlay === 'lightning') {
        state.map.showLightningOverlay = false;
        setMapOverlay('precip');
      } else if (state.map.activeOverlay === 'precip') {
        state.map.showLightningOverlay = !state.map.showLightningOverlay;
        syncMeteoSwissHudControls();
        const frames = state.map.unifiedRadarFrames;
        if (frames && frames.length) showUnifiedRadarFrame(state.map.radarIndex);
      } else {
        state.map.showLightningOverlay = true;
        setMapOverlay('lightning');
      }
    });
  }

  const fabStratus = document.getElementById('ms-fab-stratus');
  if (fabStratus) {
    fabStratus.addEventListener('click', (e) => {
      e.stopPropagation();
      state.map.showStratusOverlay = state.map.showStratusOverlay === false;
      syncMeteoSwissHudControls();
      const frames = state.map.unifiedRadarFrames;
      if (frames && frames.length) showUnifiedRadarFrame(state.map.radarIndex);
    });
  }

  const fabPrecipType = document.getElementById('ms-fab-precip-type');
  if (fabPrecipType) {
    fabPrecipType.addEventListener('click', (e) => {
      e.stopPropagation();
      state.map.precipPhaseEnabled = state.map.precipPhaseEnabled === false;
      syncMeteoSwissHudControls();
      if (state.map.activeOverlay !== 'precip') {
        setMapOverlay('precip');
      } else {
        const frames = state.map.unifiedRadarFrames;
        if (frames && frames.length) showUnifiedRadarFrame(state.map.radarIndex);
      }
    });
  }

  const fabRecenter = document.getElementById('ms-fab-recenter');
  if (fabRecenter) {
    fabRecenter.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance && state.currentLocation) {
        state.map.instance.panTo([state.currentLocation.lat, state.currentLocation.lon], { animate: true });
      }
    });
  }

  syncMeteoSwissHudControls();
}

/**
 * Aktiviert den mobilen Vollbildmodus für die Karte:
 * Versteckt die Menüleiste und Header, maximiert die Karte auf 100vw x 100dvh
 * und passt die Leaflet-Größe dynamisch an.
 */
export function enterMobileMapFullscreen() {
  document.body.classList.add('mobile-map-fullscreen-active');
  const wrapper = document.getElementById('fullscreen-map-wrapper');
  if (wrapper) wrapper.classList.add('is-fullscreen');

  const pwCard = document.getElementById('map-point-weather-card');
  const pwToggle = document.getElementById('mpw-mobile-toggle-btn');
  if (pwCard && !pwCard.classList.contains('collapsed')) {
    pwCard.classList.add('collapsed');
    if (pwToggle) pwToggle.innerText = '▴';
  }

  if (state.map?.instance) {
    state.map.instance.invalidateSize();
    setTimeout(() => {
      if (state.map?.instance) state.map.instance.invalidateSize();
    }, 80);
    setTimeout(() => {
      if (state.map?.instance) state.map.instance.invalidateSize();
    }, 250);
  }
}

/**
 * Beendet den mobilen Vollbildmodus für die Karte.
 */
export function exitMobileMapFullscreen() {
  document.body.classList.remove('mobile-map-fullscreen-active');
  const wrapper = document.getElementById('fullscreen-map-wrapper');
  if (wrapper) wrapper.classList.remove('is-fullscreen');

  if (state.map?.instance) {
    state.map.instance.invalidateSize();
    setTimeout(() => {
      if (state.map?.instance) state.map.instance.invalidateSize();
    }, 100);
  }
}

/**
 * Schließt die Vollbild-Karte und wechselt zum vorherigen Tab (oder Übersicht).
 */
export function closeMobileMapFullscreen() {
  exitMobileMapFullscreen();
  const targetTab = (state.previousTab && state.previousTab !== 'tab-map') ? state.previousTab : 'tab-overview';
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"], .mbn-btn[data-tab="${targetTab}"]`);
  if (targetBtn) {
    targetBtn.click();
  } else {
    const overviewBtn = document.querySelector('[data-tab="tab-overview"]');
    if (overviewBtn) overviewBtn.click();
  }
}

/**
 * Initialisiert Event-Listener für mobilen Vollbild-Schließen-Button und interaktive HUD-Toggles
 */
export function setupMobileMapFullscreen() {
  const closeBtn = document.getElementById('map-mobile-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMobileMapFullscreen();
    });
  }

  // Keyboard Escape listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('mobile-map-fullscreen-active')) {
      closeMobileMapFullscreen();
    }
  });

  // Verhindere jegliches Schließen oder Propagieren bei Doppeltipp/-klick auf der Karte
  const wrapper = document.getElementById('fullscreen-map-wrapper');
  if (wrapper) {
    wrapper.addEventListener('dblclick', (e) => {
      e.stopPropagation();
    });
  }

  // Mobile Point Weather Card toggle (minimieren / maximieren)
  const pwCard = document.getElementById('map-point-weather-card');
  const pwToggle = document.getElementById('mpw-mobile-toggle-btn');
  if (pwCard) {
    const header = pwCard.querySelector('.mpw-header');
    const toggleHandler = (e) => {
      if (window.innerWidth <= 768) {
        e.stopPropagation();
        pwCard.classList.toggle('collapsed');
        const isCol = pwCard.classList.contains('collapsed');
        if (pwToggle) {
          pwToggle.innerText = isCol ? '▴' : '▾';
          pwToggle.setAttribute('title', isCol ? 'Details vergrößern' : 'Details minimieren');
        }
      }
    };
    if (pwToggle) pwToggle.addEventListener('click', toggleHandler);
    if (header) header.addEventListener('click', toggleHandler);
  }

  // Mobile Wind Compass tap toggle (compact mode)
  const windWidget = document.getElementById('map-wind-compass-widget');
  if (windWidget) {
    windWidget.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        windWidget.classList.toggle('compact');
      }
    });
  }
}

/**
 * Wechselt die Basiskarte (OSM Standard, OSM Topo/Alpenrelief, OSM Dunkel, Satellit)
 * Garantiert maxZoom 20 ohne Kachelfehler, mit 100% Fallback-Sicherheit & Retina-Schärfe
 */
export function setMapBaseLayer(baseKey) {
  const resolvedKey = BASE_LAYERS[baseKey] ? baseKey : 'osm-dark';
  const conf = BASE_LAYERS[resolvedKey];
  state.map.activeBase = resolvedKey;

  document.querySelectorAll('.map-base-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.base === resolvedKey);
  });

  // 1. Vorherige Kachel-Ebenen sauber entfernen
  if (state.map.baseTileLayer) {
    state.map.instance.removeLayer(state.map.baseTileLayer);
    state.map.baseTileLayer = null;
  }
  if (state.map.hillshadeTileLayer) {
    state.map.instance.removeLayer(state.map.hillshadeTileLayer);
    state.map.hillshadeTileLayer = null;
  }
  if (state.map.satelliteLabelsLayer) {
    state.map.instance.removeLayer(state.map.satelliteLabelsLayer);
    state.map.satelliteLabelsLayer = null;
  }

  const mapElem = document.getElementById('interactive-map');
  if (mapElem) {
    if (conf.isDark || resolvedKey === 'osm-dark') {
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

  // 3b. MeteoSwiss 3D Alpin-Relief (Dark Hillshade über Dark Base)
  if (conf.hillshadeUrl) {
    const hsPane = state.map.instance.getPane('hillshadePane') ? 'hillshadePane' : 'tilePane';
    const hsLayer = L.tileLayer(conf.hillshadeUrl, {
      pane: hsPane,
      maxNativeZoom: 16,
      maxZoom: conf.options.maxZoom || 20,
      crossOrigin: true,
      keepBuffer: 6,
      className: 'ms-hillshade-tile'
    });
    hsLayer.addTo(state.map.instance);
    state.map.hillshadeTileLayer = hsLayer;
  }

  // 4. Kristallklare Ortsnamen & Landesgrenzen ÜBER dem Wetter-Canvas
  if (conf.labelsUrl) {
    const lblPane = state.map.instance.getPane('labelsOverlayPane') ? 'labelsOverlayPane' : 'overlayPane';
    const labelsLayer = L.tileLayer(conf.labelsUrl, {
      pane: lblPane,
      zIndex: 455,
      opacity: resolvedKey === 'osm-dark' ? 0.96 : 0.95,
      maxNativeZoom: resolvedKey === 'osm-dark' ? 16 : 18,
      maxZoom: conf.options.maxZoom || 20,
      crossOrigin: true,
      className: 'ms-labels-tile'
    });
    if (conf.labelsFallbackUrl) {
      labelsLayer.on('tileerror', function(err) {
        if (err.tile && !err.tile._fallbackTried) {
          err.tile._fallbackTried = true;
          const coords = err.coords;
          err.tile.src = conf.labelsFallbackUrl
            .replace('{z}', coords.z)
            .replace('{x}', coords.x)
            .replace('{y}', coords.y)
            .replace('{s}', 'a')
            .replace('{r}', '');
        }
      });
    }
    labelsLayer.addTo(state.map.instance);
    state.map.satelliteLabelsLayer = labelsLayer;
  }

  // 5. Overlay-Legende & Canvas-Kontrast sofort mit neuem Kartenstil synchronisieren
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
  } else if (state.map.activeOverlay) {
    updateMapLegend(state.map.activeOverlay);
    if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
      const f = state.map.unifiedRadarFrames[state.map.radarIndex] || {};
      WeatherCanvasEngine.render(f, state.map.activeOverlay);
    }
  }

  updateMapLayerPill();
  syncMeteoSwissHudControls();
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
    const elev = loc.elevation !== undefined ? loc.elevation : 500;
    const tVal = cur.temperature_2m !== undefined ? cur.temperature_2m : 12;
    const rhVal = cur.relative_humidity_2m !== undefined ? Math.round(cur.relative_humidity_2m) : 84;
    let pVal = cur.precipitation !== undefined ? cur.precipitation : (cur.rain || 0);
    let snowVal = cur.snowfall || 0;
    const wCodeVal = cur.weather_code !== undefined ? cur.weather_code : 1;

    let phaseInfo = MicroEngine.classifyPrecipPhase({
      tempC: tVal,
      rhPct: rhVal,
      precipMm: pVal,
      rainMm: pVal,
      snowCm: snowVal,
      elevation: elev,
      freezingLevelM: null,
      wCode: wCodeVal
    });

    let radarSample = null;
    if (loc.lat !== undefined && loc.lon !== undefined && typeof WeatherCanvasEngine !== 'undefined' && WeatherCanvasEngine.sampleAtLatLon) {
      radarSample = WeatherCanvasEngine.sampleAtLatLon(loc.lat, loc.lon, frame, { overrideElevation: elev });
      if (radarSample && (radarSample.source === 'radar' || radarSample.source === 'synthetic' || radarSample.rateMmH >= 0.14)) {
        pVal = radarSample.rateMmH >= 0.14 ? Math.round(radarSample.rateMmH * 10) / 10 : 0;
        snowVal = (pVal > 0 && radarSample.snowRatio >= 0.55) ? Math.round(pVal * radarSample.snowRatio * 10) / 10 : 0;
        phaseInfo = {
          ...phaseInfo,
          snowRatio: radarSample.snowRatio,
          phase: pVal >= 0.14 ? radarSample.phase : 'dry'
        };
      }
    }

    return {
      name: locName,
      isMountain: !!loc.isMountain,
      elevation: elev,
      temp: Math.round(tVal * 10) / 10,
      relativeHumidity: rhVal,
      wetBulbC: phaseInfo.wetBulbC,
      snowRatio: phaseInfo.snowRatio,
      precipPhase: phaseInfo.phase,
      radarDbz: radarSample ? radarSample.dbz : 0,
      radarIntensityLabel: radarSample ? radarSample.intensityLabel : '',
      windSpeed: curSpd,
      windGusts: cur.wind_gusts_10m !== undefined ? Math.round(cur.wind_gusts_10m) : Math.round(curSpd * 1.35),
      windDir: cur.wind_direction_10m !== undefined ? Math.round(cur.wind_direction_10m) : 240,
      precip: pVal,
      snow: snowVal,
      cloudCover: cur.cloud_cover !== undefined ? cur.cloud_cover : 40,
      pressure: cur.surface_pressure !== undefined ? Math.round(cur.surface_pressure) : 1014,
      weatherCode: wCodeVal
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

  const rh = (isLiveNow && cur.relative_humidity_2m !== undefined)
    ? Math.round(cur.relative_humidity_2m)
    : Math.round(lerp(hourly.relative_humidity_2m, 84));

  const spd = (isLiveNow && cur.wind_speed_10m !== undefined)
    ? Math.round(cur.wind_speed_10m)
    : Math.round(lerp(hourly.wind_speed_10m, cur.wind_speed_10m !== undefined ? cur.wind_speed_10m : 15));

  const gust = (isLiveNow && cur.wind_gusts_10m !== undefined)
    ? Math.round(cur.wind_gusts_10m)
    : Math.round(lerp(hourly.wind_gusts_10m, cur.wind_gusts_10m !== undefined ? cur.wind_gusts_10m : Math.round(spd * 1.35)));

  const dir = (isLiveNow && cur.wind_direction_10m !== undefined)
    ? Math.round(cur.wind_direction_10m)
    : interpAngle(hourly.wind_direction_10m, cur.wind_direction_10m !== undefined ? cur.wind_direction_10m : 240);

  let precip = (isLiveNow && cur.precipitation !== undefined)
    ? cur.precipitation
    : Math.max(0, Math.round(lerp(hourly.precipitation, 0) * 100) / 100);

  let snow = Math.max(0, Math.round(lerp(hourly.snowfall, 0) * 100) / 100);
  const rainVal = Math.max(0, Math.round(lerp(hourly.rain, precip) * 100) / 100);
  const freezingLvl = (hourly.freezing_level_height && hourly.freezing_level_height.length)
    ? Math.round(lerp(hourly.freezing_level_height, null))
    : null;

  const clouds = (isLiveNow && cur.cloud_cover !== undefined)
    ? cur.cloud_cover
    : Math.round(lerp(hourly.cloud_cover, 40));

  const press = Math.round(lerp(hourly.surface_pressure || hourly.pressure_msl, cur.surface_pressure !== undefined ? cur.surface_pressure : 1014));

  const code = (isLiveNow && cur.weather_code !== undefined)
    ? cur.weather_code
    : (fraction < 0.5 ? (hourly.weather_code ? hourly.weather_code[idxBefore] : 1) : (hourly.weather_code ? hourly.weather_code[idxAfter] : 1));

  // Thermodynamische Phasenberechnung am exakten Standort
  const elev = loc.elevation !== undefined ? loc.elevation : 500;
  let phaseInfo = MicroEngine.classifyPrecipPhase({
    tempC: t,
    rhPct: rh,
    precipMm: precip,
    rainMm: rainVal,
    snowCm: snow,
    elevation: elev,
    freezingLevelM: freezingLvl,
    wCode: code
  });

  // Live-/Prognose-Radar-Pixel-Abgleich direkt am Koordinatenpunkt (garantiert 100% UI <-> Kartenpixel-Sync)
  let radarSample = null;
  if (loc.lat !== undefined && loc.lon !== undefined && typeof WeatherCanvasEngine !== 'undefined' && WeatherCanvasEngine.sampleAtLatLon) {
    radarSample = WeatherCanvasEngine.sampleAtLatLon(loc.lat, loc.lon, frame, { overrideElevation: elev });
    if (radarSample && (radarSample.source === 'radar' || radarSample.source === 'synthetic')) {
      precip = radarSample.rateMmH >= 0.04 ? Math.round(radarSample.rateMmH * 100) / 100 : 0;
      snow = (precip > 0 && radarSample.snowRatio >= 0.55) ? Math.round(precip * radarSample.snowRatio * 100) / 100 : 0;
      phaseInfo = {
        ...phaseInfo,
        snowRatio: radarSample.snowRatio,
        phase: precip >= 0.04 ? radarSample.phase : 'dry'
      };
    } else if (radarSample && radarSample.rateMmH >= 0.04 && precip < 0.04) {
      precip = Math.round(radarSample.rateMmH * 100) / 100;
      snow = radarSample.snowRatio >= 0.55 ? Math.round(precip * radarSample.snowRatio * 100) / 100 : snow;
      phaseInfo.snowRatio = radarSample.snowRatio;
      phaseInfo.phase = radarSample.phase;
    }
  }

  return {
    name: locName,
    isMountain: !!loc.isMountain,
    elevation: elev,
    temp: Math.round(t * 10) / 10,
    relativeHumidity: rh,
    wetBulbC: phaseInfo.wetBulbC,
    snowRatio: phaseInfo.snowRatio,
    precipPhase: phaseInfo.phase,
    radarDbz: radarSample ? radarSample.dbz : 0,
    radarIntensityLabel: radarSample ? radarSample.intensityLabel : '',
    windSpeed: spd,
    windGusts: gust,
    windDir: dir,
    precip,
    snow,
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
  if (descEl) descEl.innerText = `${formatCleanLocationName({ name: locWeather.name })} • ${desc}`;

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

  // 1. Name & Badges (Sauber ohne abgehackte Mobile-"Mein Standort (Dur...")
  const nameEl = document.getElementById('mpw-location-name');
  if (nameEl) nameEl.innerText = formatCleanLocationName(loc);

  const typeBadge = document.getElementById('mpw-type-badge');
  const hasWet = locWeather.precip >= 0.04 || locWeather.snow >= 0.05;
  const effPhase = hasWet ? (locWeather.precipPhase || (locWeather.snow > 0 ? 'snow' : 'rain')) : 'dry';

  if (typeBadge) {
    if (effPhase === 'snow') {
      typeBadge.innerText = '❄️ SCHNEE';
      typeBadge.style.color = '#e0f4ff';
      typeBadge.style.borderColor = 'rgba(132, 218, 251, 0.65)';
      typeBadge.style.background = 'rgba(56, 189, 248, 0.20)';
    } else if (effPhase === 'sleet') {
      typeBadge.innerText = '🌨️ SCHNEEREGEN';
      typeBadge.style.color = '#6ee7b7';
      typeBadge.style.borderColor = 'rgba(20, 184, 146, 0.60)';
      typeBadge.style.background = 'rgba(16, 185, 129, 0.22)';
    } else if (effPhase === 'rain' || effPhase === 'trace') {
      typeBadge.innerText = '🌧️ REGEN';
      typeBadge.style.color = '#93c5fd';
      typeBadge.style.borderColor = 'rgba(59, 130, 246, 0.55)';
      typeBadge.style.background = 'rgba(37, 99, 235, 0.24)';
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
  const phaseIcon = effPhase === 'snow' ? '❄️' : effPhase === 'sleet' ? '🌨️' : effPhase === 'rain' ? '🌧️' : (codeInfo.icon || '🌤️');
  const iconEl = document.getElementById('mpw-condition-icon');
  if (iconEl) iconEl.innerText = phaseIcon;

  const tempEl = document.getElementById('mpw-temp-val');
  const quickTempEl = document.getElementById('mpw-quick-temp-chip');
  if (tempEl) {
    const tempVal = typeof locWeather.temp === 'number' ? Math.round(locWeather.temp) : 12;
    tempEl.innerText = `${tempVal}°`;
    if (quickTempEl) {
      quickTempEl.innerText = `${tempVal}° ${phaseIcon}`;
    }
  }

  const condLabel = document.getElementById('mpw-condition-label');
  if (condLabel) {
    if (effPhase === 'snow') {
      condLabel.innerText = locWeather.radarIntensityLabel ? `Schnee (${locWeather.radarIntensityLabel})` : 'Schneefall';
    } else if (effPhase === 'sleet') {
      condLabel.innerText = locWeather.radarIntensityLabel ? `Schneeregen (${locWeather.radarIntensityLabel})` : 'Schneeregen / Mix';
    } else if (effPhase === 'rain') {
      condLabel.innerText = locWeather.radarIntensityLabel ? `Regen (${locWeather.radarIntensityLabel})` : (codeInfo.label || 'Regen');
    } else {
      condLabel.innerText = codeInfo.label || 'Trocken';
    }
  }

  // 3. Grid Metrics
  // Rain / Precip / Snow
  const rainEl = document.getElementById('mpw-rain-val');
  if (rainEl) {
    const parentPill = rainEl.closest('.mpw-metric-pill');
    if (effPhase === 'snow') {
      const rateStr = locWeather.precip > 0 ? `${locWeather.precip.toFixed(1)} mm/h` : `${locWeather.snow.toFixed(1)} cm`;
      rainEl.innerText = rateStr;
      if (parentPill) {
        parentPill.title = 'Schneefall-Intensität';
        const icon = parentPill.querySelector('.mpw-metric-icon');
        if (icon) icon.innerText = '❄️';
      }
    } else if (effPhase === 'sleet') {
      rainEl.innerText = `${(locWeather.precip || 0).toFixed(1)} mm/h`;
      if (parentPill) {
        parentPill.title = 'Schneeregen / Mischphase';
        const icon = parentPill.querySelector('.mpw-metric-icon');
        if (icon) icon.innerText = '🌨️';
      }
    } else {
      rainEl.innerText = `${(locWeather.precip || 0).toFixed(1)} mm/h`;
      if (parentPill) {
        parentPill.title = 'Niederschlagsintensität (Regen)';
        const icon = parentPill.querySelector('.mpw-metric-icon');
        if (icon) icon.innerText = '💧';
      }
    }
  }

  // Wind
  const windEl = document.getElementById('mpw-wind-val');
  if (windEl) {
    const cardDir = getWindCardinalName(locWeather.windDir);
    windEl.innerText = `${locWeather.windSpeed} km/h · ${cardDir}`;
    if (windEl.parentElement) {
      windEl.parentElement.title = `Windgeschwindigkeit: ${locWeather.windSpeed} km/h aus ${cardDir} (${locWeather.windDir}°)`;
    }
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
  updateMapLayerPill();
  syncMeteoSwissHudControls();
}

/**
 * Aktualisiert die Layer-Trigger-Pille mit aktuellem Icon und Namen
 */
export function updateMapLayerPill() {
  const pillIcon = document.getElementById('mlp-icon');
  const pillText = document.getElementById('mlp-text');
  const pillTag = document.getElementById('mlp-tag');

  const overlayMap = {
    'precip': { icon: '🌧️', name: '48h Radar' },
    'wind': { icon: '💨', name: 'Wind' },
    'lightning': { icon: '⚡', name: 'Blitze' },
    'clouds': { icon: '☁️', name: 'Wolken' },
    'temp': { icon: '🌡️', name: 'Temperatur' },
    'pressure': { icon: '⏲️', name: 'Luftdruck' }
  };
  const baseMap = {
    'osm-dark': 'Relief',
    'osm-outdoor': 'Topo',
    'osm-standard': 'Standard',
    'satellite': 'Satellit'
  };

  const curOverlay = overlayMap[state.map.activeOverlay] || overlayMap['precip'];
  const curBase = baseMap[state.map.activeBase] || 'Relief';

  if (pillIcon) pillIcon.innerText = curOverlay.icon;
  if (pillText) pillText.innerText = curOverlay.name;
  if (pillTag) pillTag.innerText = curBase;
}

/**
 * Berechnet verlässliche meteorologische Baseline-Stationen über Höhengradienten,
 * falls Open-Meteo Rate-Limits (HTTP 429) oder Netzwerkprobleme auftreten.
 */
export function getSynthesizedBaselineStations() {
  const cur = (state.weatherData && state.weatherData.current) ? state.weatherData.current : {};
  const baseT = cur.temperature_2m !== undefined ? cur.temperature_2m : 12.0;
  const baseRh = cur.relative_humidity_2m !== undefined ? cur.relative_humidity_2m : 82;
  const baseP = cur.surface_pressure !== undefined ? cur.surface_pressure : 1014.2;
  const baseWind = cur.wind_speed_10m !== undefined ? cur.wind_speed_10m : 16.0;
  const baseDir = cur.wind_direction_10m !== undefined ? cur.wind_direction_10m : 240;
  const baseCloud = cur.cloud_cover !== undefined ? cur.cloud_cover : 55;
  const freezeLvl = Math.round(520 + (baseT / 0.65) * 100);

  return REGIONAL_STATIONS.map(st => {
    const stElev = st.elevation || 500;
    const deltaElev = stElev - 520;
    const t = Math.round((baseT - (deltaElev / 100) * 0.65) * 10) / 10;
    const rh = Math.min(99, Math.round(baseRh + (st.isMountain ? 6 : 0)));
    // Synoptische Druckvariation über den Alpenraum (Hochdruck-Rücken / Tiefdruck-Trog)
    const synopticP = baseP + (st.lat - 47.5) * 2.2 - (st.lon - 11.0) * 1.5;
    const pMsl = Math.round(synopticP * 10) / 10;
    const spd = Math.round(baseWind * (st.isMountain ? 1.85 : 1.0));
    const gust = Math.round(spd * (st.isMountain ? 1.6 : 1.35));
    const dir = (baseDir + (st.isMountain ? 15 : -10) + 360) % 360;
    const cloud = st.isMountain ? Math.min(100, baseCloud + 15) : baseCloud;
    const basePrecip = (cur.precipitation !== undefined) ? cur.precipitation : (cur.rain || 0);
    const stPrecip = basePrecip > 0
      ? (st.isMountain ? Math.round(basePrecip * 1.35 * 10) / 10 : basePrecip)
      : (st.isMountain && cloud >= 82 ? 0.2 : 0);
    const wCodeGuess = stPrecip > 0 ? 61 : (cloud > 75 ? 3 : 1);
    const cloudCoverLow = !st.isMountain && cloud >= 60 ? Math.min(98, Math.round(cloud * 0.85)) : Math.round(cloud * 0.55);

    const phaseInfo = MicroEngine.classifyPrecipPhase({
      tempC: t,
      rhPct: rh,
      precipMm: stPrecip,
      rainMm: t > 1.5 ? stPrecip : 0,
      snowCm: t <= 0.5 ? stPrecip : 0,
      elevation: stElev,
      freezingLevelM: freezeLvl,
      wCode: stPrecip > 0 ? 61 : 2
    });
    const isSnow = phaseInfo.snowRatio >= 0.55;
    const stSnow = isSnow && stPrecip > 0 ? Math.round(stPrecip * phaseInfo.snowRatio * 10) / 10 : 0;

    return {
      name: st.name,
      lat: st.lat,
      lon: st.lon,
      elevation: stElev,
      isMountain: !!st.isMountain,
      precip: stPrecip,
      rain: Math.round(stPrecip * (1 - phaseInfo.snowRatio) * 100) / 100,
      snow: stSnow,
      temperature: t,
      relativeHumidity: rh,
      wetBulbC: phaseInfo.wetBulbC,
      freezingLevelHeight: freezeLvl,
      snowRatio: phaseInfo.snowRatio,
      phase: phaseInfo.phase,
      weatherCode: isSnow && stPrecip > 0 ? 71 : wCodeGuess,
      cloudCover: cloud,
      cloudCoverLow,
      pressureMsl: pMsl,
      windSpeed: spd,
      windDirection: dir,
      windGusts: gust,
      isSnow
    };
  });
}

/**
 * Lädt regionale Wetterstationen in einem einzigen Batch-Aufruf von Open-Meteo
 * mit flachem Attribut-Mapping und nahtloser Baseline-Synthese.
 */
export async function loadRegionalStationWeather() {
  if (state.map.regionalStationsData && state.map.regionalStationsData.length) return state.map.regionalStationsData;

  const lats = REGIONAL_STATIONS.map(s => s.lat.toFixed(3)).join(',');
  const lons = REGIONAL_STATIONS.map(s => s.lon.toFixed(3)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,cloud_cover,cloud_cover_low,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m`;

  try {
    const data = await resilientFetch(url, {
      ttlMs: 30 * 60 * 1000,
      persist: true,
      staleTtlMs: 24 * 60 * 60 * 1000,
      allowStaleOnError: true
    });
    const stationResults = Array.isArray(data) ? data : [data];

    state.map.regionalStationsData = REGIONAL_STATIONS.map((station, i) => {
      const resObj = stationResults[i] || {};
      const weather = resObj.current || {};
      const modelElev = Number.isFinite(resObj.elevation) ? Math.round(resObj.elevation) : station.elevation;
      const stElev = station.elevation !== undefined ? station.elevation : modelElev;
      const rawT = weather.temperature_2m !== undefined ? weather.temperature_2m : 11;
      const elevGap = stElev - modelElev;
      const t = (station.isMountain && elevGap > 80) ? Math.round((rawT - (elevGap / 100) * 0.62) * 10) / 10 : rawT;
      const rh = weather.relative_humidity_2m !== undefined ? weather.relative_humidity_2m : 84;
      const precip = Math.max(weather.precipitation || 0, (weather.rain || 0) + (weather.showers || 0));
      const snow = weather.snowfall || 0;
      const freezeLvl = Math.round(stElev + (t / 0.65) * 100);
      const wCode = weather.weather_code || 1;

      const phaseInfo = MicroEngine.classifyPrecipPhase({
        tempC: t,
        rhPct: rh,
        precipMm: precip,
        rainMm: (weather.rain || 0) + (weather.showers || 0),
        snowCm: snow,
        elevation: stElev,
        freezingLevelM: freezeLvl,
        wCode
      });

      return {
        ...station,
        elevation: stElev,
        weather,
        temperature: t,
        relativeHumidity: rh,
        wetBulbC: phaseInfo.wetBulbC,
        freezingLevelHeight: freezeLvl,
        snowRatio: phaseInfo.snowRatio,
        phase: phaseInfo.phase,
        precip,
        rain: (weather.rain || 0) + (weather.showers || 0),
        snow,
        weatherCode: wCode,
        cloudCover: weather.cloud_cover !== undefined ? weather.cloud_cover : 50,
        cloudCoverLow: weather.cloud_cover_low !== undefined
          ? weather.cloud_cover_low
          : ((wCode === 45 || wCode === 48)
              ? 94
              : Math.round((weather.cloud_cover !== undefined ? weather.cloud_cover : 50) * (stElev < 950 ? 0.78 : 0.48))),
        pressureMsl: weather.pressure_msl || 1013.5,
        windSpeed: weather.wind_speed_10m || 15,
        windDirection: weather.wind_direction_10m || 240,
        windGusts: weather.wind_gusts_10m || 22,
        isSnow: phaseInfo.snowRatio >= 0.55
      };
    });

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
        <span>📡 48h Radar (mm/h)</span>
        <span style="font-size:9px; color:#94a3b8; font-weight:600;">MeteoSwiss Skala</span>
      </div>
    `;
    legendBar.innerHTML = `
      <div class="legend-precip-grid">
        <div class="legend-precip-row">
          <span class="legend-phase-tag rain">🌧️ Regen</span>
          <div class="legend-swatch-strip">
            <span class="legend-swatch-item" style="background:#68d4f6; color:#082f49;" title="Sehr leicht / Cyan (0.04–0.2 mm/h)">&lt;0.2</span>
            <span class="legend-swatch-item" style="background:#409cff; color:#eff6ff;" title="Leicht (0.2–0.5 mm/h)">0.2</span>
            <span class="legend-swatch-item" style="background:#1c5cf0; color:#eff6ff;" title="Mäßig (0.5–1.0 mm/h)">0.5</span>
            <span class="legend-swatch-item" style="background:#0e2acc; color:#eff6ff;" title="Kräftig (1.0–2.5 mm/h)">1.0</span>
            <span class="legend-swatch-item" style="background:#14ae3a; color:#f0fdf4;" title="Stark (2.5–5.0 mm/h)">2.5</span>
            <span class="legend-swatch-item" style="background:#a2e61c; color:#1a2e05;" title="Sehr stark (5.0–7.5 mm/h)">5</span>
            <span class="legend-swatch-item" style="background:#fad214; color:#422006;" title="Sehr stark (7.5–10 mm/h)">7.5</span>
            <span class="legend-swatch-item" style="background:#f97316; color:#fff7ed;" title="Heftig (10–20 mm/h)">10</span>
            <span class="legend-swatch-item" style="background:linear-gradient(90deg, #e02222 55%, #9e0e1a 100%); color:#fef2f2;" title="Unwetter (≥ 20 mm/h)">20+</span>
          </div>
        </div>
        <div class="legend-precip-row">
          <span class="legend-phase-tag mix">🌨️ Mix</span>
          <div class="legend-swatch-strip legend-strip-half">
            <span class="legend-swatch-item" style="background:#22b2c6; color:#042f2e;" title="Leichter Schneeregen (Blau-Grün)">Leicht</span>
            <span class="legend-swatch-item" style="background:#18ce7a; color:#022c22;" title="Kräftiger Schneeregen (Blau-Grün)">Stark</span>
          </div>
          <span class="legend-phase-tag snow">❄️ Schnee</span>
          <div class="legend-swatch-strip legend-strip-half">
            <span class="legend-swatch-item" style="background:#84dafb; color:#082f49;" title="Leichter Schneefall (Leichtes Cyan)">Leicht</span>
            <span class="legend-swatch-item" style="background:#e8f8ff; color:#0c4a6e;" title="Kräftiger Schneefall (Blau-Weiß)">Stark</span>
          </div>
        </div>
      </div>
    `;
    legendBar.style.background = 'transparent';
    legendBar.style.height = 'auto';
    legendLabels.innerHTML = `
      <div style="display:flex; justify-content:space-between; width:100%; font-size:8.5px; color:#94a3b8;">
        <span>Ohne Farbe = <strong style="color:#cbd5e1;">Trocken</strong></span>
        <span>Intensität in mm/h</span>
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

  // Lazy-Start der 48h-Radar-Engine & DEM-Topographie sobald Karten-Tab sichtbar ist
  if (state.activeTab === 'tab-map') {
    if (!state.map._radarLoaded) {
      loadUnifiedRadarEngine();
    }
    if (overlay === 'precip' || overlay === 'rainviewer-radar') {
      ViewportDemStore.scheduleFetchForMap(state.map.instance);
      ViewportForecastGridStore.scheduleFetchForMap(state.map.instance);
    }
  }

  // Sofortigen Frame-Render für den aktuellen Timeline-Index auslösen
  if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
    showUnifiedRadarFrame(state.map.radarIndex);
  }
}

// =============================================================================
// RAINVIEWER 512px RADAR TILE DECODER & MARSHALL-PALMER CACHE (SCHEME 2: 0_1.png)
// Dekodiert echte Niederschlagsintensität (dBZ -> mm/h) + Schnee-/Mix-Maske pro Tile einmalig
// =============================================================================
const RainViewerRadarStore = {
  TILE_SIZE: 512,
  MAX_CACHE: 48,
  tiles: new Map(), // key -> { status: 'loading'|'ready'|'error', dbzX10, snowMask, hasData }
  decodeCanvas: null,
  decodeCtx: null,
  _rerenderRaf: null,

  // Verifizierte RainViewer Scheme 2 (Universal Blue, smooth=0, snow=1) Regen-LUT (>= 15 dBZ + Taupe Trace)
  _rainLut: [
    { dbz: 14, r: 222, g: 208, b: 151 },
    { dbz: 15, r: 136, g: 221, b: 238 },
    { dbz: 17, r: 108, g: 209, b: 235 },
    { dbz: 19, r: 81,  g: 197, b: 232 },
    { dbz: 21, r: 54,  g: 186, b: 229 },
    { dbz: 23, r: 27,  g: 174, b: 226 },
    { dbz: 25, r: 0,   g: 163, b: 224 },
    { dbz: 26, r: 0,   g: 154, b: 213 },
    { dbz: 27, r: 0,   g: 145, b: 202 },
    { dbz: 28, r: 0,   g: 136, b: 191 },
    { dbz: 29, r: 0,   g: 127, b: 180 },
    { dbz: 30, r: 0,   g: 119, b: 170 },
    { dbz: 31, r: 0,   g: 112, b: 163 },
    { dbz: 32, r: 0,   g: 98,  b: 149 },
    { dbz: 33, r: 0,   g: 85,  b: 136 },
    { dbz: 34, r: 0,   g: 71,  b: 104 },
    { dbz: 35, r: 255, g: 238, b: 0   },
    { dbz: 36, r: 255, g: 224, b: 0   },
    { dbz: 38, r: 255, g: 211, b: 0   },
    { dbz: 40, r: 255, g: 194, b: 0   },
    { dbz: 42, r: 255, g: 155, b: 0   },
    { dbz: 44, r: 255, g: 129, b: 0   },
    { dbz: 45, r: 255, g: 68,  b: 0   },
    { dbz: 48, r: 219, g: 37,  b: 0   },
    { dbz: 50, r: 195, g: 27,  b: 0   },
    { dbz: 52, r: 144, g: 13,  b: 0   },
    { dbz: 54, r: 93,  g: 0,   b: 0   },
    { dbz: 55, r: 255, g: 170, b: 255 },
    { dbz: 60, r: 255, g: 118, b: 255 },
    { dbz: 64, r: 255, g: 78,  b: 255 },
    { dbz: 65, r: 255, g: 255, b: 255 },
    { dbz: 75, r: 0,   g: 255, b: 0   }
  ],

  latLonToNormXY(lat, lon) {
    const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
    const sinLat = Math.sin((clampedLat * Math.PI) / 180);
    const nx = (((lon + 180) / 360) % 1 + 1) % 1;
    const ny = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
    return { nx, ny: Math.max(0, Math.min(0.999999, ny)) };
  },

  dbzToMmH(dbz) {
    if (dbz < 5.2) return 0;
    // Marshall-Palmer Z = 200 * R^1.6 -> R = 10^((dBZ - 23.01) / 16)
    return Math.pow(10, (dbz - 23.01) / 16.0);
  },

  decodePixel(r, g, b, a) {
    // Bodenrauschen / Ultra-schwach unter ~5.2 dBZ ausfiltern
    if (a < 105) return { dbz: -32, snow: 0 };
    // Wasserzeichen-Schutz (graue Pixel ohne Chroma außer extreme Hagelkerne >= 242)
    if (Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2 && r < 240) return { dbz: -32, snow: 0 };

    // 1. RainViewer Schnee-Kanal (Cyan -> Polarblau in Scheme 2)
    if (b >= 244 && r <= 212 && g >= 210 && b >= g && Math.abs(Math.min(255, r + 64) - g) <= 28) {
      let dbz = 10;
      if (r >= 127) dbz = 10 + ((200 - Math.min(200, r)) / 73) * 10;
      else if (r >= 72) dbz = 20 + ((127 - r) / 55) * 8;
      else dbz = 28 + ((72 - r) / 72) * 27;

      if (a < 232) dbz *= (a / 245);
      if (dbz < 5.5) return { dbz: -32, snow: 0 };
      return { dbz, snow: 1.0 };
    }

    // 2. Pink Mix / Schneeregen-Kanal in 0_1.png
    if (r >= 242 && b > g + 5 && b < 252 && g >= 95) {
      const dbz = 10 + ((215 - Math.min(215, g)) / 105) * 32;
      if (a < 180 && dbz < 9.5) return { dbz: -32, snow: 0 };
      if (dbz < 5.5) return { dbz: -32, snow: 0 };
      return { dbz, snow: 0.48 };
    }

    // 3. Schwacher Taupe/Beige Niesel- & Spurensaum (5.5..14 dBZ in RainViewer Scheme 2 -> Transparentes Cyan 0.04–0.2 mm/h)
    if (r > b + 16 && r >= 150 && g >= 138 && b >= 110 && a >= 108 && a <= 205) {
      const dbz = 5.5 + Math.min(1, Math.max(0, (a - 108) / 84)) * 8.5;
      return { dbz, snow: 0 };
    }

    // 4. Reiner Regen-Kanal über exakte Euklidische LUT-Zuordnung
    if (a < 135) return { dbz: -32, snow: 0 };
    let bestDbz = -32;
    let bestDist = Infinity;
    const lut = this._rainLut;
    for (let i = 0; i < lut.length; i++) {
      const e = lut[i];
      const dr = r - e.r;
      const dg = g - e.g;
      const db = b - e.b;
      const dSq = dr * dr + dg * dg + db * db;
      if (dSq < bestDist) {
        bestDist = dSq;
        bestDbz = e.dbz;
      }
    }
    if (bestDist > 2600 || bestDbz < 12) return { dbz: -32, snow: 0 };
    return { dbz: bestDbz, snow: 0 };
  },

  decodeImage(img) {
    const TS = this.TILE_SIZE;
    if (!this.decodeCanvas) {
      this.decodeCanvas = document.createElement('canvas');
      this.decodeCanvas.width = TS;
      this.decodeCanvas.height = TS;
      this.decodeCtx = this.decodeCanvas.getContext('2d', { willReadFrequently: true });
    }
    const dCtx = this.decodeCtx;
    dCtx.clearRect(0, 0, TS, TS);
    dCtx.drawImage(img, 0, 0, TS, TS);
    const raw = dCtx.getImageData(0, 0, TS, TS).data;
    const len = TS * TS;
    const dbzX10 = new Int16Array(len);
    const snowMask = new Uint8Array(len);
    let hasData = false;

    for (let i = 0; i < len; i++) {
      const off = i << 2;
      const a = raw[off + 3];
      if (a < 105) {
        dbzX10[i] = -320;
        continue;
      }
      const res = this.decodePixel(raw[off], raw[off + 1], raw[off + 2], a);
      if (res.dbz >= 5.2) {
        dbzX10[i] = Math.round(res.dbz * 10);
        snowMask[i] = Math.round(res.snow * 100);
        hasData = true;
      } else {
        dbzX10[i] = -320;
      }
    }
    return { status: 'ready', dbzX10, snowMask, hasData };
  },

  getKey(rvPath, z, x, y) {
    return `${rvPath}|${z}|${x}|${y}`;
  },

  requestTile(rvPath, host, z, x, y) {
    if (!rvPath || !host) return null;
    const n = 1 << z;
    const wx = ((x % n) + n) % n;
    if (y < 0 || y >= n) return null;

    const key = this.getKey(rvPath, z, wx, y);
    const existing = this.tiles.get(key);
    if (existing) return existing;

    if (this.tiles.size >= this.MAX_CACHE) {
      const oldestKey = this.tiles.keys().next().value;
      if (oldestKey) this.tiles.delete(oldestKey);
    }

    const entry = { status: 'loading', dbzX10: null, snowMask: null, hasData: false };
    this.tiles.set(key, entry);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const decoded = this.decodeImage(img);
        entry.status = 'ready';
        entry.dbzX10 = decoded.dbzX10;
        entry.snowMask = decoded.snowMask;
        entry.hasData = decoded.hasData;
      } catch (_) {
        entry.status = 'error';
      }
      this.scheduleCanvasRerender();
    };
    img.onerror = () => {
      entry.status = 'error';
    };
    img.src = `${host}${rvPath}/${this.TILE_SIZE}/${z}/${wx}/${y}/2/0_1.png`;
    return entry;
  },

  scheduleCanvasRerender() {
    if (this._rerenderRaf) return;
    this._rerenderRaf = requestAnimationFrame(() => {
      this._rerenderRaf = null;
      if (state.map && state.map.activeOverlay && (state.map.activeOverlay === 'precip' || state.map.activeOverlay === 'rainviewer-radar')) {
        const frames = state.map.unifiedRadarFrames;
        if (frames && frames.length) {
          const curFrame = frames[state.map.radarIndex] || {};
          WeatherCanvasEngine.render(curFrame, state.map.activeOverlay);
          updatePointWeatherCard(curFrame);
        }
      }
    });
  },

  requestVisibleTiles(rvPath, host, rvZoom, latMin, latMax, lonMin, lonMax) {
    if (!rvPath || !host) return 0;
    const z = Math.min(7, Math.max(4, rvZoom));
    const n = 1 << z;
    const nw = this.latLonToNormXY(latMax, lonMin);
    const se = this.latLonToNormXY(latMin, lonMax);
    const x0 = Math.floor(nw.nx * n);
    const x1 = Math.floor(se.nx * n);
    const y0 = Math.max(0, Math.floor(nw.ny * n));
    const y1 = Math.min(n - 1, Math.floor(se.ny * n));

    let readyCount = 0;
    let totalCount = 0;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        totalCount++;
        const entry = this.requestTile(rvPath, host, z, tx, ty);
        if (entry && entry.status === 'ready') readyCount++;
      }
    }
    return totalCount > 0 ? readyCount / totalCount : 0;
  },

  sampleSinglePixel(rvPath, rvZoom, pxGlobal, pyGlobal) {
    const n = 1 << rvZoom;
    const TS = this.TILE_SIZE;
    const txRaw = Math.floor(pxGlobal / TS);
    const wx = ((txRaw % n) + n) % n;
    const ty = Math.floor(pyGlobal / TS);
    if (ty < 0 || ty >= n) return null;

    const entry = this.tiles.get(this.getKey(rvPath, rvZoom, wx, ty));
    if (!entry || entry.status !== 'ready' || !entry.dbzX10) return null;

    const lx = ((pxGlobal % TS) + TS) % TS;
    const ly = pyGlobal - ty * TS;
    const idx = ly * TS + lx;
    const dbz = entry.dbzX10[idx] * 0.1;
    if (dbz < 5.2) return { rate: 0, snow: 0 };
    return {
      rate: this.dbzToMmH(dbz),
      snow: entry.snowMask[idx] * 0.01
    };
  },

  hasTileDataAtNormXY(rvPath, rvZoom, nx, ny) {
    if (!rvPath) return false;
    const n = 1 << rvZoom;
    const wx = ((Math.floor(nx * n) % n) + n) % n;
    const ty = Math.floor(ny * n);
    if (ty < 0 || ty >= n) return false;
    const entry = this.tiles.get(this.getKey(rvPath, rvZoom, wx, ty));
    return !!(entry && entry.status === 'ready' && entry.hasData);
  },

  _cubic1D(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  },

  sampleAtNormXY(rvPath, rvZoom, nx, ny) {
    if (!rvPath) return { hasTile: false, rateMmH: 0, rvSnowMask: 0 };
    const TS = this.TILE_SIZE;
    const totalPx = (1 << rvZoom) * TS;
    const gx = nx * totalPx - 0.5;
    const gy = ny * totalPx - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;

    const p00 = this.sampleSinglePixel(rvPath, rvZoom, x0, y0);
    const p10 = this.sampleSinglePixel(rvPath, rvZoom, x0 + 1, y0);
    const p01 = this.sampleSinglePixel(rvPath, rvZoom, x0, y0 + 1);
    const p11 = this.sampleSinglePixel(rvPath, rvZoom, x0 + 1, y0 + 1);

    if (!p00 && !p10 && !p01 && !p11) {
      return { hasTile: false, rateMmH: 0, rvSnowMask: 0 };
    }

    const rCenterMax = Math.max(
      p00 ? p00.rate : 0,
      p10 ? p10.rate : 0,
      p01 ? p01.rate : 0,
      p11 ? p11.rate : 0
    );

    // Fast-path für komplett trockene 2x2-Umgebung: prüfe äußeren 4x4-Ring nur falls Zentrum nahe Schwelle
    const a00 = p00 || p10 || p01 || p11;
    const a10 = p10 || a00;
    const a01 = p01 || a00;
    const a11 = p11 || a00;

    if (rCenterMax === 0) {
      const m10 = this.sampleSinglePixel(rvPath, rvZoom, x0 - 1, y0);
      const p20 = this.sampleSinglePixel(rvPath, rvZoom, x0 + 2, y0);
      const m11 = this.sampleSinglePixel(rvPath, rvZoom, x0 - 1, y0 + 1);
      const p21 = this.sampleSinglePixel(rvPath, rvZoom, x0 + 2, y0 + 1);
      const n0m = this.sampleSinglePixel(rvPath, rvZoom, x0, y0 - 1);
      const n1m = this.sampleSinglePixel(rvPath, rvZoom, x0 + 1, y0 - 1);
      const n0p = this.sampleSinglePixel(rvPath, rvZoom, x0, y0 + 2);
      const n1p = this.sampleSinglePixel(rvPath, rvZoom, x0 + 1, y0 + 2);
      const ringMax = Math.max(
        m10 ? m10.rate : 0, p20 ? p20.rate : 0, m11 ? m11.rate : 0, p21 ? p21.rate : 0,
        n0m ? n0m.rate : 0, n1m ? n1m.rate : 0, n0p ? n0p.rate : 0, n1p ? n1p.rate : 0
      );
      if (ringMax < 0.04) {
        return { hasTile: true, rateMmH: 0, rvSnowMask: 0 };
      }
    }

    // Bikubische Catmull-Rom Interpolation (4x4 Pixel) -> organisch geschwungene Radar-Konturen ohne Zoom-Treppenstufen!
    const getR = (px, py, fb) => {
      const sp = this.sampleSinglePixel(rvPath, rvZoom, px, py);
      return sp ? sp.rate : fb.rate;
    };

    const col0 = this._cubic1D(
      getR(x0 - 1, y0 - 1, a00), getR(x0, y0 - 1, a00), getR(x0 + 1, y0 - 1, a10), getR(x0 + 2, y0 - 1, a10),
      fx
    );
    const xm1_0 = getR(x0 - 1, y0, a00);
    const xp2_0 = getR(x0 + 2, y0, a10);
    const col1 = this._cubic1D(xm1_0, a00.rate, a10.rate, xp2_0, fx);

    const xm1_1 = getR(x0 - 1, y0 + 1, a01);
    const xp2_1 = getR(x0 + 2, y0 + 1, a11);
    const col2 = this._cubic1D(xm1_1, a01.rate, a11.rate, xp2_1, fx);

    const col3 = this._cubic1D(
      getR(x0 - 1, y0 + 2, a01), getR(x0, y0 + 2, a01), getR(x0 + 1, y0 + 2, a11), getR(x0 + 2, y0 + 2, a11),
      fx
    );

    const maxLocal = Math.max(rCenterMax, xm1_0, xp2_0, xm1_1, xp2_1);
    let rateMmH = this._cubic1D(col0, col1, col2, col3, fy);
    if (rateMmH < 0) rateMmH = 0;
    else if (rateMmH > maxLocal * 1.12) rateMmH = maxLocal * 1.12;

    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    const linRate = a00.rate * w00 + a10.rate * w10 + a01.rate * w01 + a11.rate * w11;
    const snowNum = a00.rate * a00.snow * w00 + a10.rate * a10.snow * w10 + a01.rate * a01.snow * w01 + a11.rate * a11.snow * w11;
    const rvSnowMask = linRate > 0.01 ? Math.max(0, Math.min(1, snowNum / linRate)) : 0;

    return { hasTile: true, rateMmH, rvSnowMask };
  }
};

// =============================================================================
// VIEWPORT DEM ELEVATION GRID (12x12 Open-Meteo Copernicus 90m + localStorage Cache -> Alpin-Täler & Schneefallgrenze)
// =============================================================================
const ViewportDemStore = {
  GRID_N: 12,
  MAX_GRIDS: 24,
  STORAGE_KEY: 'viewport_dem_cache_v2',
  STORAGE_TTL: 30 * 24 * 60 * 60 * 1000, // 30 Tage (Topographie ist statisch)
  COOLDOWN_MS: 90 * 1000,
  _storageHydrated: false,
  __cooldownUntil: 0,
  get _cooldownUntil() {
    return Math.max(this.__cooldownUntil || 0, getApiCooldownUntil('https://api.open-meteo.com'));
  },
  set _cooldownUntil(val) {
    this.__cooldownUntil = Number(val) || 0;
    if (!val || val <= Date.now()) {
      clearApiCooldown('https://api.open-meteo.com');
    } else {
      setApiCooldownUntil('https://api.open-meteo.com', val, { reason: 'ViewportDemStore Cooldown' });
    }
  },
  grids: new Map(), // key -> { south, north, west, east, spanArea, data: Float32Array(144) }
  inFlight: new Set(),
  _debounceTimer: null,

  hydrateFromStorage() {
    if (this._storageHydrated) return;
    this._storageHydrated = true;
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries)) return;
      const now = Date.now();
      for (const item of parsed.entries) {
        if (!item || !item.key || !Array.isArray(item.data) || item.data.length !== this.GRID_N * this.GRID_N) continue;
        if (item.ts && (now - item.ts) > this.STORAGE_TTL) continue;
        this.grids.set(item.key, {
          south: item.south,
          north: item.north,
          west: item.west,
          east: item.east,
          spanArea: item.spanArea,
          ts: item.ts || now,
          data: new Float32Array(item.data)
        });
      }
    } catch (_) {}
  },

  persistToStorage() {
    try {
      const entries = [];
      for (const [key, g] of this.grids.entries()) {
        entries.push({
          key,
          south: g.south,
          north: g.north,
          west: g.west,
          east: g.east,
          spanArea: g.spanArea,
          ts: g.ts || Date.now(),
          data: Array.from(g.data, v => Math.round(v))
        });
      }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ entries: entries.slice(-this.MAX_GRIDS) }));
    } catch (_) {}
  },

  getQuantizedKey(b) {
    const q = (v) => Math.round(v / 0.35) * 0.35;
    const s = q(b.south).toFixed(2);
    const n = q(b.north).toFixed(2);
    const w = q(b.west).toFixed(2);
    const e = q(b.east).toFixed(2);
    return `${s},${n},${w},${e}`;
  },

  scheduleFetchForMap(mapInstance) {
    if (!mapInstance || state.activeTab !== 'tab-map') return;
    if (state.map && state.map.activeOverlay !== 'precip' && state.map.activeOverlay !== 'rainviewer-radar') return;
    if (mapInstance.getZoom() < 6) return;
    if (Date.now() < this._cooldownUntil) return;
    const sz = mapInstance.getSize ? mapInstance.getSize() : null;
    if (!sz || sz.x < 80 || sz.y < 80) return;

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      if (state.activeTab !== 'tab-map') return;
      this.fetchBoundsDem(mapInstance.getBounds());
    }, 280);
  },

  async fetchBoundsDem(bounds) {
    if (!bounds) return;
    if (Date.now() < this._cooldownUntil) return;
    this.hydrateFromStorage();
    const rawS = bounds.getSouth();
    const rawN = bounds.getNorth();
    const rawW = bounds.getWest();
    const rawE = bounds.getEast();
    // Verhindert degenerate 0x0 Bounding-Box-Anfragen wenn Karte noch nicht gerendert ist
    if (!Number.isFinite(rawS) || !Number.isFinite(rawN) || (rawN - rawS) < 0.05 || (rawE - rawW) < 0.05) {
      return;
    }
    const padLat = (rawN - rawS) * 0.24;
    const padLon = (rawE - rawW) * 0.24;
    const b = {
      south: Math.max(-84, rawS - padLat),
      north: Math.min(84, rawN + padLat),
      west: rawW - padLon,
      east: rawE + padLon
    };
    const spanArea = (b.north - b.south) * (b.east - b.west);

    const key = this.getQuantizedKey(b);
    if (this.grids.has(key) || this.inFlight.has(key)) return;
    for (const g of this.grids.values()) {
      const mLat = (g.north - g.south) * 0.14;
      const mLon = (g.east - g.west) * 0.14;
      if (rawS >= g.south + mLat && rawN <= g.north - mLat && rawW >= g.west + mLon && rawE <= g.east - mLon && g.spanArea <= spanArea * 2.4) {
        return;
      }
    }
    this.inFlight.add(key);

    try {
      const N = this.GRID_N;
      const lats = [];
      const lons = [];
      for (let r = 0; r < N; r++) {
        const lat = b.south + (r / (N - 1)) * (b.north - b.south);
        for (let c = 0; c < N; c++) {
          const lon = b.west + (c / (N - 1)) * (b.east - b.west);
          lats.push(lat.toFixed(4));
          lons.push(lon.toFixed(4));
        }
      }
      // Open-Meteo Elevation API erlaubt max. 100 Punkte pro GET -> 2 Chunks à 72 Punkte (bricht nach Chunk 1 ab falls 429)
      const CHUNK = 72;
      const merged = [];
      for (let start = 0; start < lats.length; start += CHUNK) {
        if (Date.now() < this._cooldownUntil) {
          throw new Error('Cooldown');
        }
        const subLats = lats.slice(start, start + CHUNK).join(',');
        const subLons = lons.slice(start, start + CHUNK).join(',');
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${subLats}&longitude=${subLons}`;
        const res = await fetch(url);
        if (res.status === 429) {
          this.__cooldownUntil = tripCircuitBreakerFromResponse('https://api.open-meteo.com', res, this.COOLDOWN_MS, 'DEM 429');
          throw new Error('HTTP 429');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        recordExternalNetworkCall(url, 1);
        const ch = await res.json();
        if (ch && Array.isArray(ch.elevation)) {
          for (let i = 0; i < ch.elevation.length; i++) merged.push(ch.elevation[i]);
        }
      }
      if (merged.length === N * N) {
        if (this.grids.size >= this.MAX_GRIDS) {
          const firstKey = this.grids.keys().next().value;
          if (firstKey) this.grids.delete(firstKey);
        }
        this.grids.set(key, {
          south: b.south,
          north: b.north,
          west: b.west,
          east: b.east,
          spanArea: (b.north - b.south) * (b.east - b.west),
          ts: Date.now(),
          data: new Float32Array(merged)
        });
        this.persistToStorage();
        if (state.map && state.map.activeOverlay && (state.map.activeOverlay === 'precip' || state.map.activeOverlay === 'rainviewer-radar')) {
          const frames = state.map.unifiedRadarFrames;
          if (frames && frames.length) {
            WeatherCanvasEngine.render(frames[state.map.radarIndex] || {}, state.map.activeOverlay);
          }
        }
      }
    } catch (_) {
      // Stiller Fallback auf Stationshöhen-IDW bei Rate-Limit / Offline
    } finally {
      this.inFlight.delete(key);
    }
  },

  findBestGrid(lat, lon) {
    this.hydrateFromStorage();
    let best = null;
    for (const g of this.grids.values()) {
      if (lat >= g.south && lat <= g.north && lon >= g.west && lon <= g.east) {
        if (!best || g.spanArea < best.spanArea) best = g;
      }
    }
    return best;
  },

  _cubicDem(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  },

  _sampleGridBicubic(grid, lat, lon) {
    const N = this.GRID_N;
    const fr = Math.max(0, Math.min(N - 1.0001, ((lat - grid.south) / (grid.north - grid.south)) * (N - 1)));
    const fc = Math.max(0, Math.min(N - 1.0001, ((lon - grid.west) / (grid.east - grid.west)) * (N - 1)));
    const r0 = Math.floor(fr);
    const c0 = Math.floor(fc);
    const df = fr - r0;
    const dc = fc - c0;
    const d = grid.data;

    const getAt = (rr, cc) => {
      const cr = rr < 0 ? 0 : (rr >= N ? N - 1 : rr);
      const ccc = cc < 0 ? 0 : (cc >= N ? N - 1 : cc);
      return d[cr * N + ccc];
    };

    const row0 = this._cubicDem(getAt(r0 - 1, c0 - 1), getAt(r0 - 1, c0), getAt(r0 - 1, c0 + 1), getAt(r0 - 1, c0 + 2), dc);
    const row1 = this._cubicDem(getAt(r0,     c0 - 1), getAt(r0,     c0), getAt(r0,     c0 + 1), getAt(r0,     c0 + 2), dc);
    const row2 = this._cubicDem(getAt(r0 + 1, c0 - 1), getAt(r0 + 1, c0), getAt(r0 + 1, c0 + 1), getAt(r0 + 1, c0 + 2), dc);
    const row3 = this._cubicDem(getAt(r0 + 2, c0 - 1), getAt(r0 + 2, c0), getAt(r0 + 2, c0 + 1), getAt(r0 + 2, c0 + 2), dc);

    return Math.max(0, this._cubicDem(row0, row1, row2, row3, df));
  },

  _feather01(u) {
    const c = u <= 0 ? 0 : (u >= 0.22 ? 1 : (u / 0.22));
    return c * c * (3 - 2 * c);
  },

  getElevation(lat, lon, stations) {
    this.hydrateFromStorage();

    // Basis-Stationshöhen-IDW (stets glatt und unbegrenzt im Raum -> nahtloser Fallback ohne harte Kastenränder)
    let fallbackElev = 600;
    if (stations && stations.length) {
      let sumW = 0, sumE = 0;
      for (let i = 0; i < stations.length; i++) {
        const st = stations[i];
        const dLat = lat - st.lat;
        const dLon = lon - st.lon;
        const d2 = dLat * dLat + dLon * dLon + 0.0009;
        const w = 1 / d2;
        sumW += w;
        sumE += w * (st.elevation || 600);
      }
      if (sumW > 0) fallbackElev = sumE / sumW;
    }

    // Überblendete, bikubische DEM-Kachel-Auswertung mit C1-runder Produkt-Randfederung (0 L-Kanten/Nähte!)
    let totalDemW = 0;
    let totalDemVal = 0;
    let maxFeather = 0;
    for (const g of this.grids.values()) {
      if (lat <= g.south || lat >= g.north || lon <= g.west || lon >= g.east) continue;
      const uLat = (lat - g.south) / Math.max(1e-5, g.north - g.south);
      const uLon = (lon - g.west) / Math.max(1e-5, g.east - g.west);
      const edgeF =
        this._feather01(uLat) *
        this._feather01(1 - uLat) *
        this._feather01(uLon) *
        this._feather01(1 - uLon);
      if (edgeF <= 0.0005) continue;
      if (edgeF > maxFeather) maxFeather = edgeF;
      const w = edgeF / (Math.sqrt(Math.max(0.01, g.spanArea)) + 0.35);
      totalDemW += w;
      totalDemVal += w * this._sampleGridBicubic(g, lat, lon);
    }

    let baseElev = fallbackElev;
    if (totalDemW > 0.0005) {
      const demElev = totalDemVal / totalDemW;
      baseElev = fallbackElev + (demElev - fallbackElev) * maxFeather;
    }

    // Glatte, organische Gipfel-/Kamm-Verankerung (vermeidet kreisrunde oder kantige Schneefelder beim IDW-Fallback)
    if (stations && stations.length) {
      let maxW = 0;
      let anchorDelta = 0;
      for (let i = 0; i < stations.length; i++) {
        const st = stations[i];
        const dLat = lat - st.lat;
        const dLon = (lon - st.lon) * 0.68;
        const d2 = dLat * dLat + dLon * dLon;
        if (d2 < 0.012) {
          let w = Math.exp(-d2 / 0.0012);
          if (st.isMountain) {
            const ridgeWave = Math.sin(lat * 44.0 + lon * 31.0) * 0.55 + Math.cos(lon * 52.0 - lat * 29.0) * 0.45;
            w *= 0.86 + 0.14 * ridgeWave;
          }
          if (w > maxW && st.elevation !== undefined) {
            maxW = w;
            anchorDelta = st.elevation - baseElev;
          }
        }
      }
      if (maxW > 0.015) {
        const strength = totalDemW > 0.0005 ? 0.56 : 0.44;
        baseElev += anchorDelta * (strength * maxW);
      }
    }
    return baseElev;
  }
};

// =============================================================================
// VIEWPORT 5x5 FORECAST GRID STORE (Open-Meteo Multi-Point 48h Modellfeld)
// Verdichtet das Stationsnetz bei Zoom-Ins & 48h-Prognosen lokal (25 Punkte, gecacht)
// =============================================================================
const ViewportForecastGridStore = {
  GRID_N: 5, // 5x5 = 25 Punkte pro Viewport (schont Open-Meteo API-Quota)
  MAX_GRIDS: 10,
  STORAGE_KEY: 'viewport_forecast_grid_v2',
  STORAGE_TTL: 45 * 60 * 1000, // 45 Minuten frische Cache-Gültigkeit (halbiert API-Bedarf)
  STALE_TTL: 24 * 60 * 60 * 1000, // Bis 24h Stale-Fallback bei aktivem 429-Circuit-Breaker
  COOLDOWN_MS: 90 * 1000, // Min. Schutzpause bei Rate-Limit (HTTP 429)
  _storageHydrated: false,
  __cooldownUntil: 0,
  get _cooldownUntil() {
    return Math.max(this.__cooldownUntil || 0, getApiCooldownUntil('https://api.open-meteo.com'));
  },
  set _cooldownUntil(val) {
    this.__cooldownUntil = Number(val) || 0;
    if (!val || val <= Date.now()) {
      clearApiCooldown('https://api.open-meteo.com');
    } else {
      setApiCooldownUntil('https://api.open-meteo.com', val, { reason: 'ViewportForecastGridStore Cooldown' });
    }
  },
  grids: new Map(), // key -> { south, north, west, east, spanArea, ts, times, points }
  inFlight: new Set(),
  _debounceTimer: null,

  hydrateFromStorage() {
    if (this._storageHydrated) return;
    this._storageHydrated = true;
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries)) return;
      const now = Date.now();
      for (const item of parsed.entries) {
        if (!item || !item.key || !Array.isArray(item.times) || !Array.isArray(item.points) || !item.points.length) continue;
        if (item.ts && (now - item.ts) > this.STALE_TTL) continue;
        this.grids.set(item.key, item);
      }
    } catch (_) {}
  },

  persistToStorage() {
    try {
      const now = Date.now();
      const entries = [];
      for (const [, g] of this.grids.entries()) {
        if (!g.ts || (now - g.ts) <= this.STALE_TTL) {
          entries.push(g);
        }
      }
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ entries: entries.slice(-this.MAX_GRIDS) }));
    } catch (_) {}
  },

  getQuantizedKey(b) {
    const q = (v) => Math.round(v / 0.5) * 0.5;
    return `${q(b.south).toFixed(2)},${q(b.north).toFixed(2)},${q(b.west).toFixed(2)},${q(b.east).toFixed(2)}`;
  },

  scheduleFetchForMap(mapInstance, delayMs = 650) {
    if (!mapInstance || state.activeTab !== 'tab-map') return;
    if (state.map && state.map.activeOverlay !== 'precip' && state.map.activeOverlay !== 'rainviewer-radar') return;
    const z = mapInstance.getZoom ? mapInstance.getZoom() : 0;
    if (z < 6 || z > 13) return;
    if (Date.now() < this._cooldownUntil) return;
    const sz = mapInstance.getSize ? mapInstance.getSize() : null;
    if (!sz || sz.x < 80 || sz.y < 80) return;

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      if (state.activeTab !== 'tab-map') return;
      this.fetchBoundsForecast(mapInstance.getBounds());
    }, delayMs);
  },

  async fetchBoundsForecast(bounds) {
    if (!bounds || typeof fetch !== 'function') return;
    if (Date.now() < this._cooldownUntil) return;
    this.hydrateFromStorage();

    const rawS = bounds.getSouth();
    const rawN = bounds.getNorth();
    const rawW = bounds.getWest();
    const rawE = bounds.getEast();
    if (!Number.isFinite(rawS) || !Number.isFinite(rawN) || (rawN - rawS) < 0.05 || (rawE - rawW) < 0.05) {
      return;
    }

    const padLat = (rawN - rawS) * 0.15;
    const padLon = (rawE - rawW) * 0.15;
    const b = {
      south: Math.max(-84, rawS - padLat),
      north: Math.min(84, rawN + padLat),
      west: rawW - padLon,
      east: rawE + padLon
    };
    const spanArea = (b.north - b.south) * (b.east - b.west);
    const key = this.getQuantizedKey(b);
    const now = Date.now();

    const existing = this.grids.get(key);
    if ((existing && (now - existing.ts) <= this.STORAGE_TTL) || this.inFlight.has(key)) return;

    // Vorhandenes frisches Gitter weiterverwenden wenn es den Viewport in passender Auflösung umschließt
    for (const g of this.grids.values()) {
      if ((now - g.ts) <= this.STORAGE_TTL &&
          rawS >= g.south && rawN <= g.north && rawW >= g.west && rawE <= g.east &&
          g.spanArea <= spanArea * 2.2) {
        return;
      }
    }

    this.inFlight.add(key);
    try {
      const N = this.GRID_N;
      const lats = [];
      const lons = [];
      for (let r = 0; r < N; r++) {
        const lat = b.south + (r / (N - 1)) * (b.north - b.south);
        for (let c = 0; c < N; c++) {
          const lon = b.west + (c / (N - 1)) * (b.east - b.west);
          lats.push(lat.toFixed(3));
          lons.push(lon.toFixed(3));
        }
      }

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=precipitation,snowfall,temperature_2m,relative_humidity_2m,freezing_level_height,cloud_cover_low,cloud_cover,weather_code&forecast_days=3&timezone=GMT`;
      const res = await fetch(url);
      if (res.status === 429) {
        this.__cooldownUntil = tripCircuitBreakerFromResponse('https://api.open-meteo.com', res, this.COOLDOWN_MS, 'ForecastGrid 429');
        return;
      }
      if (!res.ok) {
        this.__cooldownUntil = Date.now() + 30 * 1000;
        return;
      }
      recordExternalNetworkCall(url, 25);

      const rawJson = await res.json();
      const results = Array.isArray(rawJson) ? rawJson : (rawJson && rawJson.hourly ? [rawJson] : []);
      if (!results.length || !results[0] || !results[0].hourly || !Array.isArray(results[0].hourly.time)) {
        return;
      }

      const times = results[0].hourly.time.map(tStr => {
        const s = String(tStr);
        return new Date(s.endsWith('Z') ? s : `${s}Z`).getTime();
      });
      if (!times.length) return;

      const points = [];
      const count = Math.min(results.length, lats.length);
      for (let i = 0; i < count; i++) {
        const item = results[i];
        const h = item && item.hourly;
        if (!h || !Array.isArray(h.precipitation)) continue;
        const elev = Number.isFinite(item.elevation) ? Math.round(item.elevation) : 520;
        const pLat = Number.isFinite(item.latitude) ? item.latitude : parseFloat(lats[i]);
        const pLon = Number.isFinite(item.longitude) ? item.longitude : parseFloat(lons[i]);
        points.push({
          lat: Math.round(pLat * 10000) / 10000,
          lon: Math.round(pLon * 10000) / 10000,
          elev,
          precip: h.precipitation.map(v => Math.max(0, Math.round((Number(v) || 0) * 100) / 100)),
          snow: Array.isArray(h.snowfall) ? h.snowfall.map(v => Math.max(0, Math.round((Number(v) || 0) * 100) / 100)) : [],
          temp: Array.isArray(h.temperature_2m) ? h.temperature_2m.map(v => Math.round((Number(v) || 0) * 10) / 10) : [],
          rh: Array.isArray(h.relative_humidity_2m) ? h.relative_humidity_2m.map(v => Math.round(Number(v) || 84)) : [],
          freeze: Array.isArray(h.freezing_level_height) ? h.freezing_level_height.map(v => Math.round(Number(v) || 1400)) : [],
          cloudLow: Array.isArray(h.cloud_cover_low) ? h.cloud_cover_low.map(v => Math.round(Number(v) || 0)) : [],
          cloud: Array.isArray(h.cloud_cover) ? h.cloud_cover.map(v => Math.round(Number(v) || 0)) : [],
          wCode: Array.isArray(h.weather_code) ? h.weather_code.map(v => Math.round(Number(v) || 0)) : []
        });
      }
      if (!points.length) return;

      if (this.grids.size >= this.MAX_GRIDS) {
        const firstKey = this.grids.keys().next().value;
        if (firstKey) this.grids.delete(firstKey);
      }

      this.grids.set(key, {
        key,
        south: b.south,
        north: b.north,
        west: b.west,
        east: b.east,
        spanArea,
        ts: Date.now(),
        times,
        points
      });
      this.persistToStorage();

      // Sofort neu rendern (auch bei Live / +5m, sobald Hochnebel & Alpen-NWP-Gitter geladen ist)
      if (state.activeTab === 'tab-map' && state.map && (state.map.activeOverlay === 'precip' || state.map.activeOverlay === 'rainviewer-radar')) {
        const frames = state.map.unifiedRadarFrames;
        const curFrame = (frames && frames.length) ? frames[state.map.radarIndex] : null;
        if (curFrame) {
          WeatherCanvasEngine.render(curFrame, state.map.activeOverlay);
        }
      }
    } catch (_) {
      this.__cooldownUntil = Date.now() + 30 * 1000;
    } finally {
      this.inFlight.delete(key);
    }
  },

  getDenseStationsForTimestamp(timestampMs, latMin, latMax, lonMin, lonMax, avgWindSpd = 16, avgWindDir = 240) {
    this.hydrateFromStorage();
    if (!this.grids.size || !Number.isFinite(timestampMs)) return [];

    const now = Date.now();
    const maxAllowedAge = (now < this._cooldownUntil) ? this.STALE_TTL : this.STORAGE_TTL;
    const cLat = (latMin + latMax) * 0.5;
    const cLon = (lonMin + lonMax) * 0.5;
    let best = null;
    let bestCoversCenter = false;

    for (const g of this.grids.values()) {
      if (g.ts && (now - g.ts) > maxAllowedAge) continue;
      if (g.north < latMin || g.south > latMax || g.east < lonMin || g.west > lonMax) continue;
      const coversCenter = cLat >= g.south && cLat <= g.north && cLon >= g.west && cLon <= g.east;
      if (!best || (coversCenter && !bestCoversCenter) || (coversCenter === bestCoversCenter && g.spanArea < best.spanArea)) {
        best = g;
        bestCoversCenter = coversCenter;
      }
    }
    if (!best || !best.times.length) return [];

    const times = best.times;
    const lastIdx = times.length - 1;
    if (timestampMs < times[0] - 3600000 || timestampMs > times[lastIdx] + 3600000) return [];

    let i0 = 0;
    let i1 = 0;
    let frac = 0;
    if (timestampMs <= times[0]) {
      i0 = 0; i1 = 0; frac = 0;
    } else if (timestampMs >= times[lastIdx]) {
      i0 = lastIdx; i1 = lastIdx; frac = 0;
    } else {
      for (let i = 0; i < lastIdx; i++) {
        if (times[i] <= timestampMs && timestampMs <= times[i + 1]) {
          i0 = i;
          i1 = i + 1;
          frac = (timestampMs - times[i0]) / Math.max(1, times[i1] - times[i0]);
          break;
        }
      }
    }

    const out = [];
    for (let i = 0; i < best.points.length; i++) {
      const pt = best.points[i];
      const p0 = pt.precip && pt.precip[i0] !== undefined ? pt.precip[i0] : 0;
      const p1 = pt.precip && pt.precip[i1] !== undefined ? pt.precip[i1] : p0;
      const precip = Math.max(0, p0 + (p1 - p0) * frac);

      const s0 = pt.snow && pt.snow[i0] !== undefined ? pt.snow[i0] : 0;
      const s1 = pt.snow && pt.snow[i1] !== undefined ? pt.snow[i1] : s0;
      const snow = Math.max(0, s0 + (s1 - s0) * frac);

      const t0 = pt.temp && pt.temp[i0] !== undefined ? pt.temp[i0] : 8;
      const t1 = pt.temp && pt.temp[i1] !== undefined ? pt.temp[i1] : t0;
      const temp = t0 + (t1 - t0) * frac;

      const r0 = pt.rh && pt.rh[i0] !== undefined ? pt.rh[i0] : 84;
      const r1 = pt.rh && pt.rh[i1] !== undefined ? pt.rh[i1] : r0;
      const rh = r0 + (r1 - r0) * frac;

      const f0 = pt.freeze && pt.freeze[i0] !== undefined ? pt.freeze[i0] : Math.round(pt.elev + (temp / 0.65) * 100);
      const f1 = pt.freeze && pt.freeze[i1] !== undefined ? pt.freeze[i1] : f0;
      const freeze = f0 + (f1 - f0) * frac;

      const c0 = pt.cloud && pt.cloud[i0] !== undefined ? pt.cloud[i0] : (precip > 0.05 ? 85 : 35);
      const c1 = pt.cloud && pt.cloud[i1] !== undefined ? pt.cloud[i1] : c0;
      const cloudCover = Math.round(c0 + (c1 - c0) * frac);

      const cl0 = pt.cloudLow && pt.cloudLow[i0] !== undefined ? pt.cloudLow[i0] : Math.round(cloudCover * (pt.elev < 950 ? 0.72 : 0.42));
      const cl1 = pt.cloudLow && pt.cloudLow[i1] !== undefined ? pt.cloudLow[i1] : cl0;
      const cloudCoverLow = Math.round(cl0 + (cl1 - cl0) * frac);

      const wc = pt.wCode && pt.wCode[i0] !== undefined ? (frac < 0.5 ? pt.wCode[i0] : (pt.wCode[i1] ?? pt.wCode[i0])) : (precip > 0.1 ? 61 : (cloudCoverLow >= 70 ? 45 : 2));

      out.push({
        lat: pt.lat,
        lon: pt.lon,
        elevation: pt.elev,
        precip: Math.max(precip, snow * 0.85),
        snow,
        temperature: temp,
        relativeHumidity: rh,
        freezingLevelHeight: freeze,
        wetBulbC: MicroEngine.computeWetBulbTemp(temp, rh),
        cloudCover,
        cloudCoverLow,
        weatherCode: wc,
        windSpeed: avgWindSpd,
        windDirection: avgWindDir,
        isGridPoint: true
      });
    }
    return out;
  }
};

// =============================================================================
// CONTINUOUS HIGH-PRECISION WEATHER FIELD CANVAS ENGINE (60 FPS HARDWARE-ACCELERATED)
// 100% ECHTE OPEN-METEO & RAINVIEWER API-DATEN, GESTROCHEN SCHARFE PHASEN & KONTUREN
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

    if (state.map && state.map.instance && state.map.instance.getPanes) {
      const overlayPane = state.map.instance.getPanes().overlayPane;
      if (overlayPane && canvas.parentElement !== overlayPane) {
        overlayPane.appendChild(canvas);
      }
      L.DomUtil.setPosition(canvas, state.map.instance.containerPointToLayerPoint([0, 0]));
    }

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

  render(frame, overlay, options = {}) {
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
      this.renderForecastPrecipitationField(ctx, width, height, stations, frame, options);
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

  // =========================================================================
  // 5. METEOSWISS-KALIBRIERTES 48H PHASEN- & ISO-BÄNDER-RADAR (NEU)
  // Tier 0 (< 0.04): Trocken | Tier 1 (0.04–0.20): Sehr helles Blau / transparentes Cyan
  // Tier 2 (0.2–0.5): Helles Blau | Tier 3 (0.5–1.0): Mittleres Blau | Tier 4 (1.0–2.5): Dunkelblau
  // Tier 5 (2.5–5.0): Grün | Tier 6 (5.0–7.5): Gelb-Grün | Tier 7 (7.5–10): Gelb
  // Tier 8 (10–20): Orange | Tier 9 (20–35): Rot | Tier 10 (>= 35): Dunkelrot
  // Phase 1: Regen | Phase 2: Blau-Grün (Mix) | Phase 3: Helles Blau-Weiß bis leichtes Cyan (Schnee)
  // =========================================================================
  _precipThresholds: [0.20, 0.50, 1.00, 2.50, 5.00, 7.50, 10.0, 20.0, 35.0],
  _traceRateMin: 0.04,

  isDarkBasemap() {
    const base = (state.map && state.map.activeBase) || 'osm-outdoor';
    return base === 'osm-dark' || base === 'satellite';
  },

  getPrecipTier(rateMmH) {
    if (rateMmH < 0.04) return 0;  // Trocken (transparent)
    if (rateMmH < 0.20) return 1;  // Sehr helles Blau / transparentes Cyan (0.0–0.2)
    if (rateMmH < 0.50) return 2;  // Helles Blau (0.2–0.5)
    if (rateMmH < 1.00) return 3;  // Mittleres Blau (0.5–1.0)
    if (rateMmH < 2.50) return 4;  // Dunkelblau (1.0–2.5)
    if (rateMmH < 5.00) return 5;  // Grün (2.5–5.0)
    if (rateMmH < 7.50) return 6;  // Gelb-Grün (5.0–7.5)
    if (rateMmH < 10.0) return 7;  // Gelb (7.5–10.0)
    if (rateMmH < 20.0) return 8;  // Orange (10–20)
    if (rateMmH < 35.0) return 9;  // Rot (20–35)
    return 10;                     // Dunkelrot (>= 35)
  },

  getPrecipIntensityLabel(rateMmH) {
    if (rateMmH < 0.04) return 'Trocken';
    if (rateMmH < 0.20) return 'Sehr leicht (< 0.2)';
    if (rateMmH < 0.50) return 'Leicht';
    if (rateMmH < 1.00) return 'Mäßig';
    if (rateMmH < 2.50) return 'Kräftig';
    if (rateMmH < 5.00) return 'Stark';
    if (rateMmH < 10.0) return 'Sehr stark';
    if (rateMmH < 20.0) return 'Heftig';
    return 'Extrem / Unwetter';
  },

  _traceColors: {
    dark:  [104, 212, 246, 92], // Transparentes Cyan (Untergrund bleibt klar lesbar, null Violett/Grau!)
    light: [56,  189, 248, 84]
  },
  _phaseTraceDark: {
    1: [[104, 212, 246, 92]], // Regen-Spur: Sehr helles Blau / transparentes Cyan
    2: [[76,  208, 192, 94]], // Mix-Spur: Blau-Grün transparent
    3: [[176, 236, 255, 98]]  // Schnee-Spur: Helles Cyan-Weiß transparent
  },
  _phaseTraceLight: {
    1: [[56,  189, 248, 84]], // Regen-Spur auf hellem Topo
    2: [[34,  178, 166, 86]], // Mix-Spur auf hellem Topo
    3: [[108, 204, 246, 92]]  // Schnee-Spur auf hellem Topo (Gletscherschutz)
  },
  _rgbaTmp2: [0, 0, 0, 0],
  _traceTmp: [0, 0, 0, 0],

  // MeteoSwiss Aktiv-Paletten für Tier 2..10 (Index 0..8)
  _precipPalettesDark: {
    1: [ // REGEN (Exakte Spezifikation mit optimaler Relief-Durchsicht)
      [64,  156, 255, 158], // Tier 2 (0.2–0.5): Helles Blau (#409cff)
      [28,  92,  240, 184], // Tier 3 (0.5–1.0): Mittleres Blau (#1c5cf0)
      [14,  42,  204, 202], // Tier 4 (1.0–2.5): Dunkelblau (#0e2acc)
      [20,  174, 58,  214], // Tier 5 (2.5–5.0): Grün (#14ae3a)
      [162, 230, 28,  222], // Tier 6 (5.0–7.5): Gelb-Grün (#a2e61c)
      [250, 210, 20,  232], // Tier 7 (7.5–10): Gelb (#fad214)
      [249, 115, 22,  240], // Tier 8 (10–20): Orange (#f97316)
      [224, 34,  34,  246], // Tier 9 (20–35): Rot (#e02222)
      [158, 14,  26,  250]  // Tier 10 (>= 35): Dunkelrot (#9e0e1a)
    ],
    2: [ // SCHNEEREGEN / MIX (Übergangsfarben zwischen Blau und Grün)
      [34,  178, 198, 162], // Tier 2: Blau-Türkis
      [20,  188, 172, 186], // Tier 3: Sattes Blau-Grün
      [16,  196, 146, 204], // Tier 4: Smaragd-Blaugrün
      [24,  206, 122, 216], // Tier 5: Kräftiges Meergrün
      [68,  222, 148, 224], // Tier 6: Helles Mintgrün
      [112, 234, 174, 232], // Tier 7
      [152, 242, 198, 240], // Tier 8
      [184, 248, 218, 245], // Tier 9
      [208, 252, 234, 250]  // Tier 10
    ],
    3: [ // SCHNEE (Helles Blau-Weiß bis leichtes Cyan)
      [132, 218, 252, 160], // Tier 2: Leichtes Cyan (#84dafb)
      [164, 230, 255, 186], // Tier 3: Eis-Cyan (#a4e6ff)
      [194, 240, 255, 206], // Tier 4: Helles Eisblau (#c2f0ff)
      [218, 246, 255, 218], // Tier 5: Blau-Weiß (#daf6ff)
      [232, 250, 255, 228], // Tier 6: Kristall-Blauweiß (#e8faff)
      [240, 252, 255, 234], // Tier 7
      [246, 253, 255, 240], // Tier 8
      [250, 254, 255, 246], // Tier 9
      [254, 255, 255, 250]  // Tier 10
    ]
  },

  _precipPalettesLight: {
    1: [ // REGEN (auf hellem Topo/Standard kontraststark & relieflesbar)
      [59,  142, 246, 162], // Tier 2 (0.2–0.5): Helles Blau
      [24,  86,  232, 186], // Tier 3 (0.5–1.0): Mittleres Blau
      [12,  38,  196, 204], // Tier 4 (1.0–2.5): Dunkelblau
      [16,  162, 50,  216], // Tier 5 (2.5–5.0): Grün
      [150, 218, 22,  224], // Tier 6 (5.0–7.5): Gelb-Grün
      [245, 196, 14,  234], // Tier 7 (7.5–10): Gelb
      [244, 106, 16,  242], // Tier 8 (10–20): Orange
      [216, 30,  30,  246], // Tier 9 (20–35): Rot
      [146, 12,  24,  250]  // Tier 10 (>= 35): Dunkelrot
    ],
    2: [ // SCHNEEREGEN / MIX (Blau-Grün mit Topo-Sättigung)
      [22,  162, 186, 166], // Tier 2
      [14,  172, 158, 190], // Tier 3
      [12,  178, 132, 208], // Tier 4
      [18,  188, 110, 220], // Tier 5
      [44,  204, 132, 228], // Tier 6
      [84,  218, 158, 236], // Tier 7
      [122, 228, 182, 242], // Tier 8
      [154, 236, 202, 246], // Tier 9
      [180, 244, 218, 250]  // Tier 10
    ],
    3: [ // SCHNEE (Leichtes Cyan -> Blau-Weiß mit Kontrastschutz über hellen Gipfeln)
      [74,  182, 238, 174], // Tier 2
      [108, 200, 248, 194], // Tier 3
      [140, 216, 252, 210], // Tier 4
      [172, 230, 255, 222], // Tier 5
      [196, 238, 255, 230], // Tier 6
      [214, 244, 255, 236], // Tier 7
      [226, 248, 255, 242], // Tier 8
      [236, 251, 255, 246], // Tier 9
      [244, 253, 255, 250]  // Tier 10
    ]
  },

  getActivePalettes(isDark) {
    return isDark ? this._precipPalettesDark : this._precipPalettesLight;
  },

  getPrecipPhaseCode(snowRatio) {
    if (snowRatio >= 0.68) return 3;
    if (snowRatio >= 0.22) return 2;
    return 1;
  },

  _smooth01(t) {
    const c = t <= 0 ? 0 : (t >= 1 ? 1 : t);
    return c * c * (3 - 2 * c);
  },

  // Gradient-normierte MeteoSwiss Phasen-Kante (~1.3px AA-Breite an Regen<->Mix 0.22 & Mix<->Schnee 0.68)
  _samplePhaseSharp(palettes, bandIdx, snowRatio, gradSnow, out) {
    if (gradSnow <= 1e-4) {
      const ph = this.getPrecipPhaseCode(snowRatio);
      const c = palettes[ph][bandIdx];
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3];
      return;
    }
    const HALF_W = 0.65;
    const INV_W = 0.76923077; // 1 / 1.3 px
    const g = Math.min(gradSnow, 0.28);
    const d1 = (snowRatio - 0.22) / g;
    if (d1 <= -HALF_W) {
      const c = palettes[1][bandIdx];
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3];
      return;
    }
    if (d1 < HALF_W) {
      const t = this._smooth01(d1 * INV_W + 0.5);
      const a = palettes[1][bandIdx];
      const b = palettes[2][bandIdx];
      out[0] = a[0] + (b[0] - a[0]) * t;
      out[1] = a[1] + (b[1] - a[1]) * t;
      out[2] = a[2] + (b[2] - a[2]) * t;
      out[3] = a[3] + (b[3] - a[3]) * t;
      return;
    }
    const d2 = (snowRatio - 0.68) / g;
    if (d2 <= -HALF_W) {
      const c = palettes[2][bandIdx];
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3];
      return;
    }
    if (d2 < HALF_W) {
      const t = this._smooth01(d2 * INV_W + 0.5);
      const a = palettes[2][bandIdx];
      const b = palettes[3][bandIdx];
      out[0] = a[0] + (b[0] - a[0]) * t;
      out[1] = a[1] + (b[1] - a[1]) * t;
      out[2] = a[2] + (b[2] - a[2]) * t;
      out[3] = a[3] + (b[3] - a[3]) * t;
      return;
    }
    const c = palettes[3][bandIdx];
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3];
  },

  // MeteoSwiss Screen-Space SDF Vektor-Konturen (~1.3px scharfe Iso-Kanten bei JEDEM Zoom & Gradienten)
  evalPrecipRgbaGradient(rateMmH, gradR, snowRatio, gradSnow, isDark, out, tmp) {
    const tracePal = isDark ? this._phaseTraceDark : this._phaseTraceLight;
    const palettes = isDark ? this._precipPalettesDark : this._precipPalettesLight;
    const trBuf = this._traceTmp;

    if (gradR <= 1e-6) {
      const tier = this.getPrecipTier(rateMmH);
      if (tier === 0) {
        out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
        return;
      }
      if (tier === 1) {
        this._samplePhaseSharp(tracePal, 0, snowRatio, gradSnow, out);
      } else {
        this._samplePhaseSharp(palettes, tier - 2, snowRatio, gradSnow, out);
      }
      out[0] = Math.round(out[0]);
      out[1] = Math.round(out[1]);
      out[2] = Math.round(out[2]);
      out[3] = Math.round(out[3]);
      return;
    }

    const HALF_W = 0.65;
    const INV_W = 0.76923077; // 1 / 1.3 px
    const d0 = (rateMmH - 0.04) / gradR;
    if (d0 <= -HALF_W) {
      out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
      return;
    }
    const wetCov = d0 < HALF_W ? this._smooth01(d0 * INV_W + 0.5) : 1;
    this._samplePhaseSharp(tracePal, 0, snowRatio, gradSnow, trBuf);
    const d1 = (rateMmH - 0.20) / gradR;

    // Tier 1 (0.04–0.20 mm/h): Helles Cyan / Blau-Grün / Eisweiß mit scharfer ~1.3px Außenkante
    if (d1 <= -HALF_W) {
      out[0] = Math.round(trBuf[0]);
      out[1] = Math.round(trBuf[1]);
      out[2] = Math.round(trBuf[2]);
      out[3] = Math.round(trBuf[3] * wetCov);
      return;
    }

    // Tier 2..10: Aktive Iso-Bänder mit konstanter ~1.3px SDF-Trennschärfe
    const cuts = this._precipThresholds;
    const act = this._rgbaTmp2;
    let hiIdx = 0;
    for (let i = 1; i < cuts.length; i++) {
      if ((rateMmH - cuts[i]) / gradR <= -HALF_W) break;
      hiIdx = i;
    }
    let loIdx = hiIdx;
    while (loIdx > 0 && (rateMmH - cuts[loIdx]) / gradR < HALF_W) {
      loIdx--;
    }

    this._samplePhaseSharp(palettes, loIdx, snowRatio, gradSnow, act);
    for (let b = loIdx + 1; b <= hiIdx; b++) {
      const db = (rateMmH - cuts[b]) / gradR;
      this._samplePhaseSharp(palettes, b, snowRatio, gradSnow, tmp);
      if (db >= HALF_W) {
        act[0] = tmp[0]; act[1] = tmp[1]; act[2] = tmp[2]; act[3] = tmp[3];
      } else if (db > -HALF_W) {
        const tb = this._smooth01(db * INV_W + 0.5);
        act[0] += (tmp[0] - act[0]) * tb;
        act[1] += (tmp[1] - act[1]) * tb;
        act[2] += (tmp[2] - act[2]) * tb;
        act[3] += (tmp[3] - act[3]) * tb;
      }
    }

    if (d1 >= HALF_W) {
      out[0] = Math.round(act[0]);
      out[1] = Math.round(act[1]);
      out[2] = Math.round(act[2]);
      out[3] = Math.round(act[3]);
      return;
    }

    // Premultiplied Alpha Composite Tier 1 (Cyan) -> Tier 2 (Helles Blau) ohne dunklen Saum
    const actCov = this._smooth01(d1 * INV_W + 0.5);
    const trCov = wetCov * (1 - actCov);
    const wA = actCov * act[3];
    const wT = trCov * trBuf[3];
    const wSum = wA + wT;
    if (wSum <= 0.001) {
      out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
      return;
    }
    out[0] = Math.round((trBuf[0] * wT + act[0] * wA) / wSum);
    out[1] = Math.round((trBuf[1] * wT + act[1] * wA) / wSum);
    out[2] = Math.round((trBuf[2] * wT + act[2] * wA) / wSum);
    out[3] = Math.round(wSum);
  },

  // Einzelpunkt-Kompatibilitätswrapper (ohne Gradient-Anti-Aliasing)
  evalPrecipRgba(rateMmH, snowRatio, isDark, out, tmp) {
    this.evalPrecipRgbaGradient(rateMmH, 1e-6, snowRatio, 1e-5, isDark, out, tmp);
  },

  getPrecisionPrecipRgba(rateMmH, snowRatio) {
    const tier = this.getPrecipTier(rateMmH);
    if (tier === 0) return [0, 0, 0, 0, 0, 0];
    const phase = this.getPrecipPhaseCode(snowRatio);
    const out = [0, 0, 0, 0];
    const tmp = [0, 0, 0, 0];
    this.evalPrecipRgbaGradient(rateMmH, 1e-6, snowRatio, 1e-5, this.isDarkBasemap(), out, tmp);
    return [out[0], out[1], out[2], out[3], tier, phase];
  },

  // Deterministisches räumliches fBM-Rauschen (nur von Weltkoordinaten abhängig -> kein Pan-Flackern)
  fbmNoise(lat, lon, phaseShift = 0) {
    const x = lon * 6.5 + phaseShift;
    const y = lat * 9.5 + phaseShift * 0.7;
    const n1 = Math.sin(x * 1.15 + Math.cos(y * 1.35)) * Math.cos(y * 1.10 - Math.sin(x * 0.95));
    const n2 = Math.sin(x * 2.40 - Math.sin(y * 2.20)) * Math.cos(y * 2.55 + Math.cos(x * 2.15)) * 0.5;
    const n3 = Math.sin((x + y) * 3.80) * 0.25;
    return (n1 + n2 + n3) / 1.75; // [-1, 1]
  },

  preparePrecipFieldContext(stations, frame) {
    let sumU = 0, sumV = 0, count = 0;
    const enriched = [];
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const spd = st.windSpeed !== undefined ? st.windSpeed : 16;
      const dir = st.windDirection !== undefined ? st.windDirection : 240;
      const rad = (dir * Math.PI) / 180;
      sumU += -spd * Math.sin(rad);
      sumV += -spd * Math.cos(rad);
      count++;

      const stTemp = st.temperature !== undefined ? st.temperature : 8;
      const stRh = st.relativeHumidity !== undefined ? st.relativeHumidity : 84;
      const stElev = st.elevation !== undefined ? st.elevation : 520;
      const tw = st.wetBulbC !== undefined ? st.wetBulbC : MicroEngine.computeWetBulbTemp(stTemp, stRh);
      // Reduktion auf Meeresniveau (~0.56°C / 100m Feuchtadiabate)
      const twMsl = tw + (stElev / 100) * 0.56;
      const freezeLvl = st.freezingLevelHeight !== undefined ? st.freezingLevelHeight : Math.round(stElev + (stTemp / 0.65) * 100);
      const rate = Math.max(st.precip || 0, (st.snow || 0) * 0.85);
      const wCodeSt = st.weatherCode !== undefined ? st.weatherCode : (st.weather && st.weather.weather_code);
      const cloudCoverVal = st.cloudCover !== undefined ? st.cloudCover : (st.weather && st.weather.cloud_cover !== undefined ? st.weather.cloud_cover : 45);
      const cloudLow = st.cloudCoverLow !== undefined
        ? st.cloudCoverLow
        : (st.weather && st.weather.cloud_cover_low !== undefined
            ? st.weather.cloud_cover_low
            : ((wCodeSt === 45 || wCodeSt === 48) ? 92 : Math.round(cloudCoverVal * (stElev < 950 ? 0.72 : 0.42))));
      enriched.push({ st, twMsl, freezeLvl, rate, snowRatio: st.snowRatio, cloudLow });
    }

    const avgU = count ? (sumU / count) : -12;
    const avgV = count ? (sumV / count) : 8;
    const avgDir = (Math.atan2(-avgU, -avgV) * (180 / Math.PI) + 360) % 360;
    const frontMotionDir = (avgDir + 180) % 360;
    const avgWindKmH = Math.hypot(avgU, avgV);

    const frontAxisRad = ((frontMotionDir + 90) * Math.PI) / 180;
    const cosA = Math.cos(frontAxisRad);
    const sinA = Math.sin(frontAxisRad);

    const minuteOffset = (frame && frame.minuteOffset !== undefined)
      ? frame.minuteOffset
      : (frame && typeof frame.hoursFromNow === 'number' ? Math.round(frame.hoursFromNow * 60) : 0);

    let hasDenseGrid = false;
    if (state.map && state.map.instance) {
      const avgU0 = count ? (sumU / count) : -12;
      const avgV0 = count ? (sumV / count) : 8;
      const avgDir0 = (Math.atan2(-avgU0, -avgV0) * (180 / Math.PI) + 360) % 360;
      const avgSpd0 = Math.hypot(avgU0, avgV0);
      const b = state.map.instance.getBounds();
      const targetTs = (frame && frame.timestampMs) || (Date.now() + minuteOffset * 60000);
      const gridPts = ViewportForecastGridStore.getDenseStationsForTimestamp(
        targetTs,
        b.getSouth(),
        b.getNorth(),
        b.getWest(),
        b.getEast(),
        avgSpd0,
        avgDir0
      );
      if (gridPts && gridPts.length > 0) {
        hasDenseGrid = true;
        for (let i = 0; i < gridPts.length; i++) {
          const gp = gridPts[i];
          const twMsl = gp.wetBulbC + (gp.elevation / 100) * 0.56;
          enriched.push({
            st: gp,
            twMsl,
            freezeLvl: gp.freezingLevelHeight,
            rate: gp.precip || 0,
            snowRatio: undefined,
            cloudLow: gp.cloudCoverLow !== undefined ? gp.cloudCoverLow : 0
          });
        }
      }
    }

    // RainViewer Tile-Pfad ermitteln
    const host = (state.map && state.map.radarHost) || 'https://tilecache.rainviewer.com';
    const rvPath = (frame && (frame.rvPath || frame.path))
      || (minuteOffset > 0 && state.map && state.map.liveRadarPath)
      || '';

    // Doppler-Advektionsgewicht: 100% live/past, abklingend von +30m nach +90m nahtlos ins NWP-Feld
    let radarWeight = 0;
    let advectLat = 0;
    let advectLon = 0;
    if (rvPath && minuteOffset <= 0) {
      radarWeight = 1.0;
    } else if (rvPath && minuteOffset > 0 && minuteOffset <= 90) {
      radarWeight = Math.max(0, 1.0 - Math.max(0, minuteOffset - 30) / 60);
      const advHours = minuteOffset / 60;
      const radMotion = (frontMotionDir * Math.PI) / 180;
      // 700hPa Lenkungswind ~1.25x Bodenwind, 1° Lat ≈ 111 km
      const steerKmH = Math.max(12, avgWindKmH * 1.25);
      const dKm = steerKmH * advHours;
      advectLat = (Math.cos(radMotion) * dKm) / 111.0;
      advectLon = (Math.sin(radMotion) * dKm) / (111.0 * 0.68);
    }

    const mapZoom = (state.map && state.map.instance) ? state.map.instance.getZoom() : 8;
    const rvZoom = Math.min(7, Math.max(4, Math.floor(mapZoom)));

    // Pre-fetch sichtbare RainViewer-Tiles im Hintergrund
    if (radarWeight > 0 && state.map && state.map.instance) {
      const b = state.map.instance.getBounds();
      RainViewerRadarStore.requestVisibleTiles(
        rvPath,
        host,
        rvZoom,
        b.getSouth() - Math.abs(advectLat) - 0.5,
        b.getNorth() + Math.abs(advectLat) + 0.5,
        b.getWest() - Math.abs(advectLon) - 0.8,
        b.getEast() + Math.abs(advectLon) + 0.8
      );
    }

    return {
      enriched,
      stations,
      hasDenseGrid,
      cosA,
      sinA,
      minuteOffset,
      hours: minuteOffset / 60,
      rvPath,
      host,
      rvZoom,
      radarWeight,
      advectLat,
      advectLon
    };
  },

  evalNwpPoint(lat, lon, ctx) {
    const list = ctx.enriched;
    let sumWP = 0, sumVP = 0;
    let sumWT = 0, sumTwMsl = 0, sumFz = 0, sumCloudLow = 0;

    // Organisches frontales FBM-Domain-Warping für Niederschlag (Thermodynamik bleibt topographietreu!)
    const phase = ctx.hours * 0.35;
    const nLat = this.fbmNoise(lat * 1.15, lon * 1.15, phase);
    const nLon = this.fbmNoise(lat * 1.15 + 3.7, lon * 1.15 - 2.3, phase + 5.1);
    const warpLat = lat + nLat * 0.044;
    const warpLon = lon + nLon * 0.062;
    const precipVar = ctx.hasDenseGrid ? 0.055 : 0.11;

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const dLatT = lat - item.st.lat;
      const dLonT = lon - item.st.lon;
      const uT = dLonT * ctx.cosA + dLatT * ctx.sinA;
      const vT = -dLonT * ctx.sinA + dLatT * ctx.cosA;
      const effDistSqT = (uT * 0.52) * (uT * 0.52) + (vT * 1.25) * (vT * 1.25);

      const dLatP = warpLat - item.st.lat;
      const dLonP = warpLon - item.st.lon;
      const uP = dLonP * ctx.cosA + dLatP * ctx.sinA;
      const vP = -dLonP * ctx.sinA + dLatP * ctx.cosA;
      const effDistSqP = (uP * 0.52) * (uP * 0.52) + (vP * 1.25) * (vP * 1.25);

      const wP = Math.exp(-effDistSqP / precipVar);
      const wT = Math.exp(-effDistSqT / 0.45);

      sumWP += wP;
      sumVP += item.rate * wP;

      sumWT += wT;
      sumTwMsl += item.twMsl * wT;
      sumFz += item.freezeLvl * wT;
      sumCloudLow += (item.cloudLow || 0) * wT;
    }

    const confidence = Math.min(1.0, sumWP * (ctx.hasDenseGrid ? 3.2 : 4.0));
    let nwpRate = sumWP > 0.001 ? (sumVP / sumWP) * confidence : 0;
    if (nwpRate > 0.042) {
      const turb = this.fbmNoise(warpLat * 1.25, warpLon * 1.25, ctx.hours * 0.42 + 1.9);
      nwpRate = Math.max(0, nwpRate * (1 + 0.34 * turb));
    } else {
      nwpRate = 0;
    }
    if (nwpRate < 0.025) nwpRate = 0;

    const twMsl = sumWT > 0.001 ? sumTwMsl / sumWT : 4.5;
    const freezeLvl = sumWT > 0.001 ? sumFz / sumWT : 1400;
    const baseCloudLow = sumWT > 0.001 ? (sumCloudLow / sumWT) : 0;
    const cloudLowNoise = this.fbmNoise(lat * 1.35 + 2.1, lon * 1.35 - 1.4, phase * 0.5) * 9;
    const cloudLow = Math.max(0, Math.min(100, baseCloudLow + cloudLowNoise));
    return { nwpRate, twMsl, freezeLvl, cloudLow };
  },

  computeSnowRatioAtTerrain(elev, twMsl, freezeLvl, rvSnowMask = 0) {
    const smooth01 = (v) => {
      const c = Math.max(0, Math.min(1, v));
      return c * c * (3 - 2 * c);
    };
    const twLocal = twMsl - (elev / 100) * 0.56;
    const thermoRatio = smooth01((1.7 - twLocal) / 2.1);
    const altRatio = smooth01((elev - (freezeLvl - 420)) / 360);
    const topoRatio = 0.62 * thermoRatio + 0.38 * altRatio;

    if (rvSnowMask >= 0.35) {
      return Math.max(rvSnowMask, topoRatio);
    }
    return topoRatio;
  },

  // Einzelpunkt-Abfrage synchron mit der Canvas-Pixelpipeline (für Info-Card & Tests)
  sampleAtLatLon(lat, lon, frame, options = {}) {
    // 0. Optionaler deterministischer Test-Hook für Multi-Phasen-Visualtests
    if (state.map && typeof state.map.syntheticRadarField === 'function') {
      const syn = state.map.syntheticRadarField(lat, lon, frame);
      if (syn) {
        const rateMmH = syn.rateMmH >= 0.04 ? syn.rateMmH : 0;
        const snowRatio = syn.snowRatio !== undefined ? syn.snowRatio : 0;
        const phase = rateMmH < 0.04
          ? 'dry'
          : (snowRatio >= 0.68 ? 'snow' : (snowRatio >= 0.22 ? 'sleet' : (rateMmH < 0.20 ? 'trace' : 'rain')));
        return {
          rateMmH,
          dbz: rateMmH > 0 ? Math.max(0, Math.round(23.01 + 16 * Math.log10(rateMmH))) : 0,
          snowRatio,
          phase,
          intensityLabel: this.getPrecipIntensityLabel(rateMmH),
          source: 'synthetic'
        };
      }
    }

    const stations = (frame && frame.stations && frame.stations.length > 0)
      ? frame.stations
      : ((state.map && state.map.regionalStationsData && state.map.regionalStationsData.length > 0)
          ? state.map.regionalStationsData
          : getSynthesizedBaselineStations());

    const ctx = this.preparePrecipFieldContext(stations, frame);
    const nwp = this.evalNwpPoint(lat, lon, ctx);
    const elev = options.overrideElevation !== undefined
      ? options.overrideElevation
      : ViewportDemStore.getElevation(lat, lon, stations);

    let finalRate = nwp.nwpRate;
    let rvSnowMask = 0;
    let source = 'nwp';

    if (ctx.radarWeight > 0 && ctx.rvPath) {
      const norm = RainViewerRadarStore.latLonToNormXY(lat - ctx.advectLat, lon - ctx.advectLon);
      const rv = RainViewerRadarStore.sampleAtNormXY(ctx.rvPath, ctx.rvZoom, norm.nx, norm.ny);
      if (rv.hasTile) {
        if (rv.rateMmH > 0.03) {
          finalRate = rv.rateMmH * ctx.radarWeight + nwp.nwpRate * (1 - ctx.radarWeight);
          rvSnowMask = rv.rvSnowMask * ctx.radarWeight;
          source = 'radar';
        } else {
          // Radar zeigt 0 mm/h (typisch bei schwachem Winter-Schneefall oder Alpentälern im Radarschatten) -> NWP-Feld erhalten
          const rvHasData = RainViewerRadarStore.hasTileDataAtNormXY(ctx.rvPath, ctx.rvZoom, norm.nx, norm.ny);
          const twLocal = nwp.twMsl - (elev / 100) * 0.56;
          if (!rvHasData || elev >= 900 || twLocal <= 2.0) {
            finalRate = nwp.nwpRate * (rvHasData ? 0.65 : 0.92);
            source = 'nwp';
          } else {
            finalRate = nwp.nwpRate * (1 - ctx.radarWeight);
            source = 'radar';
          }
        }
      }
    } else if (finalRate >= 0.025 && elev > 900) {
      finalRate *= 1 + Math.min(0.22, (elev - 900) / 7000);
    }

    if (finalRate < 0.04) finalRate = 0;
    const phaseEnabled = !(state.map && state.map.precipPhaseEnabled === false);
    const snowRatio = phaseEnabled ? this.computeSnowRatioAtTerrain(elev, nwp.twMsl, nwp.freezeLvl, rvSnowMask) : 0;
    const phase = finalRate < 0.04
      ? 'dry'
      : (snowRatio >= 0.68 ? 'snow' : (snowRatio >= 0.22 ? 'sleet' : (finalRate < 0.20 ? 'trace' : 'rain')));

    return {
      rateMmH: Math.round(finalRate * 100) / 100,
      dbz: finalRate > 0 ? Math.max(0, Math.round(23.01 + 16 * Math.log10(finalRate))) : 0,
      snowRatio: Math.round(snowRatio * 100) / 100,
      phase,
      intensityLabel: this.getPrecipIntensityLabel(finalRate),
      source
    };
  },

  drawSnowflakeCrystals(ctx, mapInst, minLat, maxLat, minLon, maxLon, getSnowTierAtPtFn, isDark = false) {
    const zoomFloor = Math.max(4, Math.min(13, Math.floor(mapInst.getZoom())));
    const centerLat = (minLat + maxLat) * 0.5;
    const cosLat = Math.max(0.42, Math.cos((centerLat * Math.PI) / 180));
    // Dezente, lockere Dichte (niemals flächendeckend, wie bei MeteoSwiss)
    const lonStep = 98.0 / Math.pow(2, zoomFloor);
    const latStep = lonStep * cosLat;

    const rStart = Math.floor(minLat / latStep);
    const rEnd = Math.ceil(maxLat / latStep);
    const cStart = Math.floor(minLon / lonStep);
    const cEnd = Math.ceil(maxLon / lonStep);

    if ((rEnd - rStart) * (cEnd - cStart) > 2000) return;

    const hashCell = (r, c, salt) => {
      let h = (Math.imul(r | 0, 374761393) ^ Math.imul(c | 0, 668265263) ^ Math.imul(salt | 0, 1442695041)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawCrystal = (cx, cy, arm) => {
      const branchAt = arm * 0.62;
      const branchLen = arm * 0.35;
      ctx.beginPath();
      for (let a = 0; a < 6; a++) {
        const ang = (a * Math.PI) / 3;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * arm, cy + dy * arm);

        const bx = cx + dx * branchAt;
        const by = cy + dy * branchAt;
        const leftAng = ang + Math.PI / 4;
        const rightAng = ang - Math.PI / 4;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(leftAng) * branchLen, by + Math.sin(leftAng) * branchLen);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(rightAng) * branchLen, by + Math.sin(rightAng) * branchLen);
      }
      ctx.stroke();
    };

    const points = [];
    for (let r = rStart; r <= rEnd; r++) {
      const stagger = (r & 1) ? 0.5 * lonStep : 0;
      for (let c = cStart; c <= cEnd; c++) {
        const jLat = (hashCell(r, c, 1) - 0.5) * 0.46 * latStep;
        const jLon = (hashCell(r, c, 2) - 0.5) * 0.46 * lonStep;
        const lat = r * latStep + jLat;
        const lon = c * lonStep + stagger + jLon;
        const pt = mapInst.latLngToContainerPoint([lat, lon]);
        const tier = getSnowTierAtPtFn(pt.x, pt.y);
        // Nur bei relevanten Schneemengen (Tier >= 4, d.h. >= 1.0 mm/h)
        if (tier < 4) continue;

        const prob = tier >= 7 ? 0.45 : (tier >= 5 ? 0.28 : 0.14);
        if (hashCell(r, c, 3) > prob) continue;

        const arm = tier >= 7 ? 4.8 : (tier >= 5 ? 4.2 : 3.6);
        points.push({ x: pt.x, y: pt.y, arm });
      }
    }

    if (points.length) {
      ctx.strokeStyle = isDark ? 'rgba(14, 52, 92, 0.48)' : 'rgba(12, 46, 86, 0.56)';
      ctx.lineWidth = 1.85;
      for (let i = 0; i < points.length; i++) {
        drawCrystal(points[i].x, points[i].y, points[i].arm);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = 1.05;
      for (let i = 0; i < points.length; i++) {
        drawCrystal(points[i].x, points[i].y, points[i].arm);
      }
    }
    ctx.restore();
  },

  // 5. 48H METEOSWISS-PHASEN- & ISO-BÄNDER-RADAR (BICUBIC RAINVIEWER + NWP + 12x12 DEM + ~1.3px SDF + FLUID MORPH)
  renderForecastPrecipitationField(ctx, width, height, stations, frame, options = {}) {
    ctx.clearRect(0, 0, width, height);
    if (!stations.length || !state.map.instance) return;

    const mapInst = state.map.instance;
    const isFastPan = !!options.fastPan;
    const isDark = this.isDarkBasemap();
    const morphNext = options.nextFrame || null;
    const morphAlpha = (morphNext && options.morphAlpha > 0 && options.morphAlpha < 1) ? options.morphAlpha : 0;
    const step = isFastPan ? 5 : 2;
    const sCols = Math.ceil(width / step) + 1;
    const sRows = Math.ceil(height / step) + 1;
    const sTotal = sCols * sRows;

    // 1D Mercator-Spalten-/Zeilen-Projektion
    const colLon = new Float64Array(sCols);
    const rowLat = new Float64Array(sRows);
    for (let c = 0; c < sCols; c++) {
      colLon[c] = mapInst.containerPointToLatLng([c * step, 0]).lng;
    }
    for (let r = 0; r < sRows; r++) {
      rowLat[r] = mapInst.containerPointToLatLng([0, r * step]).lat;
    }

    const rawRate = new Float32Array(sTotal);
    const rawSnow = new Float32Array(sTotal);
    const rawStratus = new Float32Array(sTotal);
    rawSnow.fill(-1);
    let hasWetAny = false;
    let hasStratusAny = false;
    let anyRvTileUsed = false;
    const hasSynthetic = !!(state.map && typeof state.map.syntheticRadarField === 'function');
    const showStratus = !hasSynthetic && !(state.map && state.map.showStratusOverlay === false);
    const phaseEnabled = hasSynthetic || !(state.map && state.map.precipPhaseEnabled === false);

    // 1. Kontinuierliches Skalarfeld auf 2px-Stützgitter berechnen
    if (hasSynthetic) {
      const synFn = state.map.syntheticRadarField;
      for (let r = 0; r < sRows; r++) {
        const lat = rowLat[r];
        const rowOff = r * sCols;
        for (let c = 0; c < sCols; c++) {
          const res = synFn(lat, colLon[c], frame);
          const rate = (res && res.rateMmH >= 0.015) ? res.rateMmH : 0;
          const idx = rowOff + c;
          if (rate > 0) {
            rawRate[idx] = rate;
            rawSnow[idx] = (res && res.snowRatio !== undefined) ? res.snowRatio : 0;
            if (rate >= 0.04) hasWetAny = true;
          }
        }
      }
    } else {
      // Optionales flüssiges Skalar-Morphing der Stationswerte für fließende Animationen
      let activeStations = stations;
      let activeFrame = frame;
      if (morphAlpha > 0 && morphNext && morphNext.stations && morphNext.stations.length) {
        const invA = 1 - morphAlpha;
        const stB = morphNext.stations;
        activeStations = stations.map((s0, si) => {
          const s1 = (stB[si] && stB[si].name === s0.name) ? stB[si] : (stB.find(x => x.name === s0.name) || s0);
          return {
            ...s0,
            temperature: (s0.temperature || 0) * invA + (s1.temperature || 0) * morphAlpha,
            relativeHumidity: (s0.relativeHumidity || 84) * invA + (s1.relativeHumidity || 84) * morphAlpha,
            wetBulbC: (s0.wetBulbC !== undefined && s1.wetBulbC !== undefined) ? (s0.wetBulbC * invA + s1.wetBulbC * morphAlpha) : s0.wetBulbC,
            freezingLevelHeight: (s0.freezingLevelHeight || 1400) * invA + (s1.freezingLevelHeight || 1400) * morphAlpha,
            precip: Math.max(0, (s0.precip || 0) * invA + (s1.precip || 0) * morphAlpha),
            snow: Math.max(0, (s0.snow || 0) * invA + (s1.snow || 0) * morphAlpha),
            snowRatio: (s0.snowRatio !== undefined && s1.snowRatio !== undefined) ? (s0.snowRatio * invA + s1.snowRatio * morphAlpha) : s0.snowRatio,
            windSpeed: (s0.windSpeed || 15) * invA + (s1.windSpeed || 15) * morphAlpha
          };
        });
        const mo0 = frame && frame.minuteOffset !== undefined ? frame.minuteOffset : 0;
        const mo1 = morphNext.minuteOffset !== undefined ? morphNext.minuteOffset : mo0;
        activeFrame = {
          ...frame,
          minuteOffset: mo0 + (mo1 - mo0) * morphAlpha,
          hoursFromNow: (mo0 + (mo1 - mo0) * morphAlpha) / 60,
          timestampMs: ((frame && frame.timestampMs) || Date.now()) * invA + ((morphNext.timestampMs) || Date.now()) * morphAlpha
        };
      }

      const fieldCtx = this.preparePrecipFieldContext(activeStations, activeFrame);
      const fieldCtxB = (morphAlpha > 0 && morphNext) ? this.preparePrecipFieldContext(morphNext.stations || activeStations, morphNext) : null;

      const cStep = isFastPan ? 2 : 4;
      const cCols = Math.ceil((sCols - 1) / cStep) + 1;
      const cRows = Math.ceil((sRows - 1) / cStep) + 1;
      const coarseNwpRate = new Float32Array(cCols * cRows);
      const coarseTwMsl = new Float32Array(cCols * cRows);
      const coarseFreeze = new Float32Array(cCols * cRows);
      const coarseCloudLow = new Float32Array(cCols * cRows);

      for (let cr = 0; cr < cRows; cr++) {
        const rIdx = Math.min(sRows - 1, cr * cStep);
        const lat = rowLat[rIdx];
        for (let cc = 0; cc < cCols; cc++) {
          const cIdx = Math.min(sCols - 1, cc * cStep);
          const ev = this.evalNwpPoint(lat, colLon[cIdx], fieldCtx);
          const k = cr * cCols + cc;
          coarseNwpRate[k] = ev.nwpRate;
          coarseTwMsl[k] = ev.twMsl;
          coarseFreeze[k] = ev.freezeLvl;
          coarseCloudLow[k] = ev.cloudLow || 0;
        }
      }

      let rvColNxA = null, rvRowNyA = null;
      let rvColNxB = null, rvRowNyB = null;
      const useRvA = fieldCtx.radarWeight > 0 && !!fieldCtx.rvPath;
      const useRvB = !!(fieldCtxB && fieldCtxB.radarWeight > 0 && fieldCtxB.rvPath && morphAlpha > 0);

      if (useRvA) {
        rvColNxA = new Float64Array(sCols);
        rvRowNyA = new Float64Array(sRows);
        for (let c = 0; c < sCols; c++) {
          rvColNxA[c] = ((((colLon[c] - fieldCtx.advectLon) + 180) / 360) % 1 + 1) % 1;
        }
        for (let r = 0; r < sRows; r++) {
          const sLat = Math.max(-85.0511, Math.min(85.0511, rowLat[r] - fieldCtx.advectLat));
          const sinL = Math.sin((sLat * Math.PI) / 180);
          rvRowNyA[r] = Math.max(0, Math.min(0.999999, 0.5 - Math.log((1 + sinL) / (1 - sinL)) / (4 * Math.PI)));
        }
      }
      if (useRvB) {
        rvColNxB = new Float64Array(sCols);
        rvRowNyB = new Float64Array(sRows);
        for (let c = 0; c < sCols; c++) {
          rvColNxB[c] = ((((colLon[c] - fieldCtxB.advectLon) + 180) / 360) % 1 + 1) % 1;
        }
        for (let r = 0; r < sRows; r++) {
          const sLat = Math.max(-85.0511, Math.min(85.0511, rowLat[r] - fieldCtxB.advectLat));
          const sinL = Math.sin((sLat * Math.PI) / 180);
          rvRowNyB[r] = Math.max(0, Math.min(0.999999, 0.5 - Math.log((1 + sinL) / (1 - sinL)) / (4 * Math.PI)));
        }
      }

      for (let r = 0; r < sRows; r++) {
        const lat = rowLat[r];
        const fr = Math.min(cRows - 1.0001, r / cStep);
        const r0 = Math.floor(fr);
        const dr = fr - r0;
        const rowOff = r * sCols;
        const nyA = useRvA ? rvRowNyA[r] : 0;
        const nyB = useRvB ? rvRowNyB[r] : 0;

        for (let c = 0; c < sCols; c++) {
          const fc = Math.min(cCols - 1.0001, c / cStep);
          const c0 = Math.floor(fc);
          const dc = fc - c0;
          const w00 = (1 - dc) * (1 - dr);
          const w10 = dc * (1 - dr);
          const w01 = (1 - dc) * dr;
          const w11 = dc * dr;
          const k00 = r0 * cCols + c0;
          const k10 = k00 + 1;
          const k01 = k00 + cCols;
          const k11 = k01 + 1;

          const nwpRate = coarseNwpRate[k00] * w00 + coarseNwpRate[k10] * w10 + coarseNwpRate[k01] * w01 + coarseNwpRate[k11] * w11;
          const twMsl = coarseTwMsl[k00] * w00 + coarseTwMsl[k10] * w10 + coarseTwMsl[k01] * w01 + coarseTwMsl[k11] * w11;
          const freezeLvl = coarseFreeze[k00] * w00 + coarseFreeze[k10] * w10 + coarseFreeze[k01] * w01 + coarseFreeze[k11] * w11;
          const cLow = showStratus ? (coarseCloudLow[k00] * w00 + coarseCloudLow[k10] * w10 + coarseCloudLow[k01] * w01 + coarseCloudLow[k11] * w11) : 0;

          let rate = nwpRate;
          let rvSnowMask = 0;
          let hasRvAtPt = false;
          let elevCache = -1;

          if (useRvA || useRvB) {
            const rvA = useRvA ? RainViewerRadarStore.sampleAtNormXY(fieldCtx.rvPath, fieldCtx.rvZoom, rvColNxA[c], nyA) : { hasTile: false, rateMmH: 0, rvSnowMask: 0 };
            if (useRvB && morphAlpha > 0) {
              const rvB = RainViewerRadarStore.sampleAtNormXY(fieldCtxB.rvPath, fieldCtxB.rvZoom, rvColNxB[c], nyB);
              if (rvA.hasTile || rvB.hasTile) {
                hasRvAtPt = true;
                anyRvTileUsed = true;
                let rA = nwpRate;
                if (rvA.hasTile) {
                  if (rvA.rateMmH > 0.03) {
                    rA = rvA.rateMmH * fieldCtx.radarWeight + nwpRate * (1 - fieldCtx.radarWeight);
                  } else if (nwpRate >= 0.025) {
                    const rvHasDataA = RainViewerRadarStore.hasTileDataAtNormXY(fieldCtx.rvPath, fieldCtx.rvZoom, rvColNxA[c], nyA);
                    if (elevCache < 0) elevCache = ViewportDemStore.getElevation(lat, colLon[c], activeStations);
                    const twLoc = twMsl - (elevCache / 100) * 0.56;
                    rA = (!rvHasDataA || elevCache >= 900 || twLoc <= 2.0) ? nwpRate * (rvHasDataA ? 0.65 : 0.92) : nwpRate * (1 - fieldCtx.radarWeight);
                  } else {
                    rA = 0;
                  }
                }
                let rB = nwpRate;
                if (rvB.hasTile) {
                  if (rvB.rateMmH > 0.03) {
                    rB = rvB.rateMmH * fieldCtxB.radarWeight + nwpRate * (1 - fieldCtxB.radarWeight);
                  } else if (nwpRate >= 0.025) {
                    const rvHasDataB = RainViewerRadarStore.hasTileDataAtNormXY(fieldCtxB.rvPath, fieldCtxB.rvZoom, rvColNxB[c], nyB);
                    if (elevCache < 0) elevCache = ViewportDemStore.getElevation(lat, colLon[c], activeStations);
                    const twLoc = twMsl - (elevCache / 100) * 0.56;
                    rB = (!rvHasDataB || elevCache >= 900 || twLoc <= 2.0) ? nwpRate * (rvHasDataB ? 0.65 : 0.92) : nwpRate * (1 - fieldCtxB.radarWeight);
                  } else {
                    rB = 0;
                  }
                }
                rate = rA * (1 - morphAlpha) + rB * morphAlpha;
                const sA = rvA.hasTile ? rvA.rvSnowMask * fieldCtx.radarWeight : 0;
                const sB = rvB.hasTile ? rvB.rvSnowMask * fieldCtxB.radarWeight : 0;
                const totR = rA * (1 - morphAlpha) + rB * morphAlpha;
                rvSnowMask = totR > 0.005 ? (rA * (1 - morphAlpha) * sA + rB * morphAlpha * sB) / totR : 0;
              }
            } else if (rvA.hasTile) {
              hasRvAtPt = true;
              anyRvTileUsed = true;
              if (rvA.rateMmH > 0.03) {
                rate = rvA.rateMmH * fieldCtx.radarWeight + nwpRate * (1 - fieldCtx.radarWeight);
                rvSnowMask = rvA.rvSnowMask * fieldCtx.radarWeight;
              } else if (nwpRate >= 0.025) {
                const rvHasDataA = RainViewerRadarStore.hasTileDataAtNormXY(fieldCtx.rvPath, fieldCtx.rvZoom, rvColNxA[c], nyA);
                if (elevCache < 0) elevCache = ViewportDemStore.getElevation(lat, colLon[c], activeStations);
                const twLoc = twMsl - (elevCache / 100) * 0.56;
                rate = (!rvHasDataA || elevCache >= 900 || twLoc <= 2.0)
                  ? nwpRate * (rvHasDataA ? 0.65 : 0.92)
                  : nwpRate * (1 - fieldCtx.radarWeight);
              } else {
                rate = 0;
              }
            }
          }

          const idx = rowOff + c;
          if (rate >= 0.018) {
            const elev = elevCache >= 0 ? elevCache : ViewportDemStore.getElevation(lat, colLon[c], activeStations);
            elevCache = elev;
            if (!hasRvAtPt && elev > 900) {
              rate *= 1 + Math.min(0.22, (elev - 900) / 7000);
            }
            rawRate[idx] = rate;
            rawSnow[idx] = phaseEnabled ? this.computeSnowRatioAtTerrain(elev, twMsl, freezeLvl, rvSnowMask) : 0;
            if (rate >= 0.04) hasWetAny = true;
          }

          // DEM-maskierter Hochnebel / tiefe Bewölkung (nur über trockenen Tälern, Berggipfel ragen dunkel heraus)
          if (showStratus && cLow >= 46 && rate < 0.045) {
            const elev = elevCache >= 0 ? elevCache : ViewportDemStore.getElevation(lat, colLon[c], activeStations);
            const invNoise = this.fbmNoise(lat * 2.1 + 4.1, colLon[c] * 2.1 - 1.7, 0) * 65;
            const stratusTop = 1090 + Math.max(0, Math.min(280, (freezeLvl - 1200) * 0.25)) + invNoise;
            if (elev < stratusTop) {
              const elevFactor = Math.max(0, Math.min(1, (stratusTop - elev) / 145));
              const cloudFactor = Math.max(0, Math.min(1, (cLow - 46) / 34));
              const sv = elevFactor * cloudFactor;
              if (sv >= 0.08) {
                rawStratus[idx] = sv;
                if (sv >= 0.22) hasStratusAny = true;
              }
            }
          }
        }
      }
    }

    if (!hasWetAny && !(showStratus && hasStratusAny)) return;

    // 2. Morphologisches Despeckling & 2x Binomial [1, 2, 1]/4 Kurvenglättung VOR scharfem SDF-Schnitt
    // Beseitigt jegliche Radar-Pixelstufen und formt organische MeteoSwiss-Bänder bei rasiermesserscharfen Kanten
    let sRate = rawRate;
    let sSnow = rawSnow;

    if (hasWetAny && !hasSynthetic && (anyRvTileUsed || !isFastPan)) {
      const workRate = new Float32Array(sTotal);
      const workSnow = new Float32Array(sTotal);
      if (anyRvTileUsed) {
        workSnow.fill(-1);
        for (let r = 0; r < sRows; r++) {
          const rowOff = r * sCols;
          const rMin = Math.max(0, r - 1);
          const rMax = Math.min(sRows - 1, r + 1);
          for (let c = 0; c < sCols; c++) {
            const idx = rowOff + c;
            const myR = rawRate[idx];
            const cMin = Math.max(0, c - 1);
            const cMax = Math.min(sCols - 1, c + 1);
            let traceWetN = 0;
            let activeWetN = 0;
            let sumNR = 0;
            let sumNRS = 0;
            for (let rr = rMin; rr <= rMax; rr++) {
              const nOff = rr * sCols;
              for (let cc = cMin; cc <= cMax; cc++) {
                if (rr === r && cc === c) continue;
                const nr = rawRate[nOff + cc];
                if (nr >= 0.04) {
                  traceWetN++;
                  if (nr >= 0.20) activeWetN++;
                  const nSn = rawSnow[nOff + cc];
                  sumNR += nr;
                  sumNRS += nr * (nSn >= 0 ? nSn : 0);
                }
              }
            }
            if (myR >= 0.04) {
              if (traceWetN <= 1 || (myR < 0.20 && traceWetN <= 2 && activeWetN === 0)) {
                workRate[idx] = 0;
                workSnow[idx] = -1;
              } else {
                workRate[idx] = myR;
                workSnow[idx] = rawSnow[idx];
              }
            } else if (activeWetN >= 5 || traceWetN >= 6) {
              workRate[idx] = sumNR / traceWetN;
              workSnow[idx] = sumNR > 0 ? (sumNRS / sumNR) : rawSnow[idx];
            } else {
              workRate[idx] = myR;
              workSnow[idx] = rawSnow[idx];
            }
          }
        }
      } else {
        workRate.set(rawRate);
        workSnow.set(rawSnow);
      }

      // Separabler Binomial-Pass ([1, 2, 1]/4 bei Radar, [1, 6, 1]/8 bei NWP)
      const wCenter = anyRvTileUsed ? 2 : 6;
      const wInv = 1 / (wCenter + 2);
      const tmpRate = new Float32Array(sTotal);
      const tmpSnow = new Float32Array(sTotal);
      for (let r = 0; r < sRows; r++) {
        const rowOff = r * sCols;
        for (let c = 0; c < sCols; c++) {
          const idx = rowOff + c;
          const cW = c > 0 ? idx - 1 : idx;
          const cE = c < sCols - 1 ? idx + 1 : idx;
          const rW = workRate[cW];
          const rC = workRate[idx];
          const rE = workRate[cE];
          tmpRate[idx] = (rW + wCenter * rC + rE) * wInv;

          const uW = (rW > 0 && workSnow[cW] >= 0) ? rW : 0;
          const uC = (rC > 0 && workSnow[idx] >= 0) ? wCenter * rC : 0;
          const uE = (rE > 0 && workSnow[cE] >= 0) ? rE : 0;
          const wSum = uW + uC + uE;
          tmpSnow[idx] = wSum > 0.0005
            ? ((uW * workSnow[cW] + uC * workSnow[idx] + uE * workSnow[cE]) / wSum)
            : -1;
        }
      }

      sRate = new Float32Array(sTotal);
      sSnow = new Float32Array(sTotal);
      for (let r = 0; r < sRows; r++) {
        const rowOff = r * sCols;
        const rN = r > 0 ? rowOff - sCols : rowOff;
        const rS = r < sRows - 1 ? rowOff + sCols : rowOff;
        for (let c = 0; c < sCols; c++) {
          const idx = rowOff + c;
          const kN = rN + c;
          const kS = rS + c;
          const tN = tmpRate[kN];
          const tC = tmpRate[idx];
          const tS = tmpRate[kS];
          const rAvg = (tN + wCenter * tC + tS) * wInv;
          sRate[idx] = rAvg >= 0.018 ? rAvg : 0;

          const uN = (tN > 0 && tmpSnow[kN] >= 0) ? tN : 0;
          const uC = (tC > 0 && tmpSnow[idx] >= 0) ? wCenter * tC : 0;
          const uS = (tS > 0 && tmpSnow[kS] >= 0) ? tS : 0;
          const wSum = uN + uC + uS;
          sSnow[idx] = wSum > 0.0005
            ? ((uN * tmpSnow[kN] + uC * tmpSnow[idx] + uS * tmpSnow[kS]) / wSum)
            : -1;
        }
      }
    }

    // 3. HiDPI / Retina Rasterisierung mit Screen-Space SDF Vektorkanten (~1.3px) & Block-FastPath (0.0 GC)
    const scale = isFastPan ? 0.5 : Math.min(window.devicePixelRatio || 1, 2);
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));
    const outTotal = outW * outH;
    const cellSz = step * scale;

    if (!this.offscreenCanvas || this.offscreenCanvas.width !== outW || this.offscreenCanvas.height !== outH) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = outW;
      this.offscreenCanvas.height = outH;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }
    if (!this._tierBuf || this._tierBuf.length < outTotal) {
      this._tierBuf = new Uint8Array(outTotal);
      this._phaseBuf = new Uint8Array(outTotal);
    }
    const tierBuf = this._tierBuf;
    const phaseBuf = this._phaseBuf;
    tierBuf.fill(0, 0, outTotal);
    phaseBuf.fill(0, 0, outTotal);

    const imgData = this.offscreenCtx.createImageData(outW, outH);
    const data = imgData.data;
    const tracePal = isDark ? this._phaseTraceDark : this._phaseTraceLight;
    const palettes = this.getActivePalettes(isDark);
    const cuts = this._precipThresholds;
    const invCellSz = 1 / cellSz;
    const rgbaOut = [0, 0, 0, 0];
    const rgbaTmp = [0, 0, 0, 0];
    const stratusR = isDark ? 156 : 148;
    const stratusG = isDark ? 128 : 122;
    const stratusB = isDark ? 162 : 156;
    const stratusBaseAlpha = isDark ? 98 : 88;

    for (let br = 0; br < sRows - 1; br++) {
      const yStart = Math.floor(br * cellSz);
      if (yStart >= outH) break;
      const yEnd = Math.min(outH, br === sRows - 2 ? outH : Math.floor((br + 1) * cellSz));
      const rowOff0 = br * sCols;
      const rowOff1 = rowOff0 + sCols;

      for (let bc = 0; bc < sCols - 1; bc++) {
        const k00 = rowOff0 + bc;
        const k10 = k00 + 1;
        const k01 = rowOff1 + bc;
        const k11 = k01 + 1;

        const r00 = sRate[k00];
        const r10 = sRate[k10];
        const r01 = sRate[k01];
        const r11 = sRate[k11];

        const st00 = showStratus ? rawStratus[k00] : 0;
        const st10 = showStratus ? rawStratus[k10] : 0;
        const st01 = showStratus ? rawStratus[k01] : 0;
        const st11 = showStratus ? rawStratus[k11] : 0;

        const hasWetBlock = hasWetAny && !(r00 < 0.024 && r10 < 0.024 && r01 < 0.024 && r11 < 0.024);
        const hasStratusBlock = showStratus && hasStratusAny && (st00 >= 0.08 || st10 >= 0.08 || st01 >= 0.08 || st11 >= 0.08);

        // Trocken- & nebelfreien Block sofort überspringen
        if (!hasWetBlock && !hasStratusBlock) continue;

        const xStart = Math.floor(bc * cellSz);
        if (xStart >= outW) break;
        const xEnd = Math.min(outW, bc === sCols - 2 ? outW : Math.floor((bc + 1) * cellSz));

        // Reiner Hochnebel-Block (ohne Niederschlag) -> DEM-scharf an Tälern gerendert
        if (!hasWetBlock && hasStratusBlock) {
          for (let py = yStart; py < yEnd; py++) {
            const fy = Math.max(0, Math.min(1, py * invCellSz - br));
            const oneMinusFy = 1 - fy;
            const pyOff = py * outW;
            for (let px = xStart; px < xEnd; px++) {
              const fx = Math.max(0, Math.min(1, px * invCellSz - bc));
              const oneMinusFx = 1 - fx;
              const sv = st00 * oneMinusFx * oneMinusFy + st10 * fx * oneMinusFy + st01 * oneMinusFx * fy + st11 * fx * fy;
              if (sv < 0.20) continue;
              const cov = sv >= 0.34 ? 1.0 : this._smooth01((sv - 0.20) / 0.14);
              const dIdx = (pyOff + px) << 2;
              data[dIdx] = stratusR;
              data[dIdx + 1] = stratusG;
              data[dIdx + 2] = stratusB;
              data[dIdx + 3] = Math.round(stratusBaseAlpha * cov);
            }
          }
          continue;
        }

        let sn00 = sSnow[k00];
        let sn10 = sSnow[k10];
        let sn01 = sSnow[k01];
        let sn11 = sSnow[k11];
        if (sn00 < 0 || sn10 < 0 || sn01 < 0 || sn11 < 0) {
          let wSn = 0, sSn = 0;
          if (sn00 >= 0) { const w = r00 + 0.001; wSn += w; sSn += sn00 * w; }
          if (sn10 >= 0) { const w = r10 + 0.001; wSn += w; sSn += sn10 * w; }
          if (sn01 >= 0) { const w = r01 + 0.001; wSn += w; sSn += sn01 * w; }
          if (sn11 >= 0) { const w = r11 + 0.001; wSn += w; sSn += sn11 * w; }
          const meanSn = wSn > 0 ? (sSn / wSn) : 0;
          if (sn00 < 0) sn00 = meanSn;
          if (sn10 < 0) sn10 = meanSn;
          if (sn01 < 0) sn01 = meanSn;
          if (sn11 < 0) sn11 = meanSn;
        }

        const t00 = this.getPrecipTier(r00);
        const t10 = this.getPrecipTier(r10);
        const t01 = this.getPrecipTier(r01);
        const t11 = this.getPrecipTier(r11);

        const p00 = this.getPrecipPhaseCode(sn00);
        const p10 = this.getPrecipPhaseCode(sn10);
        const p01 = this.getPrecipPhaseCode(sn01);
        const p11 = this.getPrecipPhaseCode(sn11);

        const minR = Math.min(r00, r10, r01, r11);
        const maxR = Math.max(r00, r10, r01, r11);
        const rxTop = r10 - r00;
        const rxBot = r11 - r01;
        const ryLeft = r01 - r00;
        const ryRight = r11 - r10;
        const maxGradR = Math.hypot(Math.max(Math.abs(rxTop), Math.abs(rxBot)), Math.max(Math.abs(ryLeft), Math.abs(ryRight))) * invCellSz;
        const marginR = 0.72 * maxGradR;

        const loCutR = t00 <= 1 ? 0.04 : cuts[t00 - 2];
        const hiCutR = t00 === 1 ? 0.20 : (t00 < 10 ? cuts[t00 - 1] : Infinity);

        const snxTop = sn10 - sn00;
        const snxBot = sn11 - sn01;
        const snyLeft = sn01 - sn00;
        const snyRight = sn11 - sn10;
        const minSn = Math.min(sn00, sn10, sn01, sn11);
        const maxSn = Math.max(sn00, sn10, sn01, sn11);
        const maxGradSn = Math.hypot(Math.max(Math.abs(snxTop), Math.abs(snxBot)), Math.max(Math.abs(snyLeft), Math.abs(snyRight))) * invCellSz;
        const marginSn = 0.72 * Math.min(maxGradSn, 0.28);
        const isPurePhase = (maxSn <= 0.22 - marginSn) || (minSn >= 0.22 + marginSn && maxSn <= 0.68 - marginSn) || (minSn >= 0.68 + marginSn);

        const isHomogeneousBand =
          t00 >= 1 &&
          t00 === t10 && t00 === t01 && t00 === t11 &&
          minR > loCutR + marginR &&
          maxR < hiCutR - marginR &&
          p00 === p10 && p00 === p01 && p00 === p11 &&
          isPurePhase;

        // Homogener Block -> außerhalb jeder SDF-Grenzzone
        if (isHomogeneousBand) {
          const col = t00 === 1 ? tracePal[p00][0] : palettes[p00][t00 - 2];
          const cr = col[0], cg = col[1], cb = col[2], ca = col[3];
          for (let py = yStart; py < yEnd; py++) {
            const pyOff = py * outW;
            for (let px = xStart; px < xEnd; px++) {
              const oIdx = pyOff + px;
              tierBuf[oIdx] = t00;
              phaseBuf[oIdx] = p00;
              const dIdx = oIdx << 2;
              data[dIdx] = cr;
              data[dIdx + 1] = cg;
              data[dIdx + 2] = cb;
              data[dIdx + 3] = ca;
            }
          }
          continue;
        }

        // Grenz- / Iso-Übergangsblock -> konstante ~1.3px Screen-Space SDF-Vektorkonturen
        for (let py = yStart; py < yEnd; py++) {
          const fy = Math.max(0, Math.min(1, py * invCellSz - br));
          const oneMinusFy = 1 - fy;
          const dRdx = (rxTop * oneMinusFy + rxBot * fy) * invCellSz;
          const dSdx = (snxTop * oneMinusFy + snxBot * fy) * invCellSz;
          const pyOff = py * outW;
          for (let px = xStart; px < xEnd; px++) {
            const fx = Math.max(0, Math.min(1, px * invCellSz - bc));
            const oneMinusFx = 1 - fx;
            const w00 = oneMinusFx * oneMinusFy;
            const w10 = fx * oneMinusFy;
            const w01 = oneMinusFx * fy;
            const w11 = fx * fy;

            const rate = r00 * w00 + r10 * w10 + r01 * w01 + r11 * w11;
            const dRdy = (ryLeft * oneMinusFx + ryRight * fx) * invCellSz;
            const gradR = Math.hypot(dRdx, dRdy);

            rgbaOut[3] = 0;
            if (rate >= 0.04 - 0.65 * gradR) {
              const snowRatio = sn00 * w00 + sn10 * w10 + sn01 * w01 + sn11 * w11;
              const dSdy = (snyLeft * oneMinusFx + snyRight * fx) * invCellSz;
              const gradSnow = Math.hypot(dSdx, dSdy);
              this.evalPrecipRgbaGradient(rate, gradR, snowRatio, gradSnow, isDark, rgbaOut, rgbaTmp);
              if (rgbaOut[3] > 0) {
                const oIdx = pyOff + px;
                tierBuf[oIdx] = this.getPrecipTier(rate);
                phaseBuf[oIdx] = this.getPrecipPhaseCode(snowRatio);
                const dIdx = oIdx << 2;
                data[dIdx] = rgbaOut[0];
                data[dIdx + 1] = rgbaOut[1];
                data[dIdx + 2] = rgbaOut[2];
                data[dIdx + 3] = rgbaOut[3];
                continue;
              }
            }

            if (hasStratusBlock) {
              const sv = st00 * w00 + st10 * w10 + st01 * w01 + st11 * w11;
              if (sv >= 0.20) {
                const cov = sv >= 0.34 ? 1.0 : this._smooth01((sv - 0.20) / 0.14);
                const dIdx = (pyOff + px) << 2;
                data[dIdx] = stratusR;
                data[dIdx + 1] = stratusG;
                data[dIdx + 2] = stratusB;
                data[dIdx + 3] = Math.round(stratusBaseAlpha * cov);
              }
            }
          }
        }
      }
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);

    // 4. Retina- & HiDPI-sauberes Blitten auf den Viewport
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreenCanvas, 0, 0, width, height);
    ctx.restore();

    // 5. Sehr dezente Schneekristalle nur bei relevanten Mengen (Tier >= 4) & aktiviertem Niederschlagstyp
    if (hasWetAny && phaseEnabled) {
      const b = mapInst.getBounds();
      const getSnowTierAtPt = (cx, cy) => {
        const ox = Math.round(cx * scale);
        const oy = Math.round(cy * scale);
        if (ox < 4 || ox >= outW - 4 || oy < 4 || oy >= outH - 4) return 0;
        const k = oy * outW + ox;
        if (phaseBuf[k] !== 3 || tierBuf[k] < 4) return 0;
        return tierBuf[k];
      };
      this.drawSnowflakeCrystals(ctx, mapInst, b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), getSnowTierAtPt, isDark);
    }
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
  const now = new Date();
  const isToday = t.toDateString() === now.toDateString();
  const tmrw = new Date(now.getTime() + 86400000);
  const isTomorrow = t.toDateString() === tmrw.toDateString();
  const dayStr = isToday ? 'Heute' : (isTomorrow ? 'Morgen' : t.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }));
  const timeStr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  
  let relStr = 'Live';
  if (frame) {
    if (frame.isLive || frame.minuteOffset === 0) {
      relStr = 'Live';
    } else if (frame.minuteOffset !== undefined) {
      const mo = frame.minuteOffset;
      if (mo < 0) {
        relStr = `vor ${Math.abs(mo)} Min.`;
      } else if (mo < 60) {
        relStr = `+${mo}m`;
      } else if (mo % 60 === 0) {
        relStr = `+${mo / 60}h`;
      } else {
        relStr = `+${Math.floor(mo / 60)}h ${mo % 60}m`;
      }
    } else if (frame.type === 'past') {
      const diffM = Math.round((Date.now() - t.getTime()) / 60000);
      relStr = `vor ${diffM} Min.`;
    } else if (frame.hoursFromNow) {
      relStr = `+${frame.hoursFromNow}h`;
    }
  }

  const fullDateTimeText = relStr ? `${dayStr}, ${timeStr} Uhr (${relStr})` : `${dayStr}, ${timeStr} Uhr`;

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
          modeChip.innerText = '🔴 Live';
          modeChip.style.background = 'rgba(239, 68, 68, 0.25)';
          modeChip.style.borderColor = '#ef4444';
        } else if (frame.minuteOffset !== undefined && frame.minuteOffset < 0) {
          modeChip.innerText = `⏪ -${Math.abs(frame.minuteOffset)}m`;
          modeChip.style.background = 'rgba(56, 189, 248, 0.2)';
          modeChip.style.borderColor = '#38bdf8';
        } else {
          modeChip.innerText = '⏪ Historie';
          modeChip.style.background = 'rgba(56, 189, 248, 0.2)';
          modeChip.style.borderColor = '#38bdf8';
        }
      }
      if (timeDisplay) {
        timeDisplay.innerText = fullDateTimeText;
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
          modeChip.innerText = `⚡ Nowcast (+${frame.minuteOffset}m)`;
          modeChip.style.background = 'rgba(245, 158, 11, 0.25)';
          modeChip.style.borderColor = '#f59e0b';
        } else if (frame.minuteOffset !== undefined && frame.minuteOffset <= 180) {
          const hStr = frame.minuteOffset % 60 === 0 ? `+${frame.minuteOffset / 60}h` : `+${Math.floor(frame.minuteOffset / 60)}h ${frame.minuteOffset % 60}m`;
          modeChip.innerText = `🔮 Detail (${hStr})`;
          modeChip.style.background = 'rgba(168, 85, 247, 0.25)';
          modeChip.style.borderColor = '#c084fc';
        } else {
          const h = frame.hoursFromNow || Math.round((frame.minuteOffset || 0) / 60);
          modeChip.innerText = `🔮 48h Radar (+${h}h)`;
          modeChip.style.background = 'rgba(168, 85, 247, 0.25)';
          modeChip.style.borderColor = '#c084fc';
        }
      }
      if (timeDisplay) {
        timeDisplay.innerText = fullDateTimeText;
      }
    }

    state.map.weatherLayerGroup.clearLayers();
    if (state.map.showLightningOverlay) {
      const storm = MicroEngine.computeLightningActivity(
        state.currentLocation.lat,
        state.currentLocation.lon,
        state.weatherData
      );
      if (storm && Array.isArray(storm.strikes)) {
        storm.strikes.slice(0, 10).forEach(s => {
          const color = s.ageMinutes < 10 ? '#ff3b30' : '#ffd166';
          const icon = L.divIcon({
            className: 'custom-lightning-icon',
            html: `<div class="lightning-marker" style="background:${color}; box-shadow:0 0 12px ${color};">⚡</div>`,
            iconAnchor: [12, 12]
          });
          L.marker([s.lat, s.lon], { icon }).addTo(state.map.weatherLayerGroup);
        });
      }
    }
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
      modeChip.innerText = (frame && frame.isLive) ? '💨 Live-Wind' : '💨 Windfeld';
      modeChip.style.background = 'rgba(56, 189, 248, 0.25)';
      modeChip.style.borderColor = '#38bdf8';
    }
    if (timeDisplay) {
      timeDisplay.innerText = fullDateTimeText;
    }

    state.map.weatherLayerGroup.clearLayers();
    const curLoc = state.currentLocation;
    stations.forEach(st => {
      if (curLoc && curLoc.lat !== undefined && Math.hypot(st.lat - curLoc.lat, st.lon - curLoc.lon) < 0.04) return;
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
      modeChip.innerText = (frame && frame.isLive) ? '⚡ Live-Blitze' : '⚡ Blitze';
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
        timeDisplay.innerText = fullDateTimeText;
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
        timeDisplay.innerText = fullDateTimeText;
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
      timeDisplay.innerText = fullDateTimeText;
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
      timeDisplay.innerText = fullDateTimeText;
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
      timeDisplay.innerText = fullDateTimeText;
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
    const precip = Math.max(0, Math.round((s0.precip + (s1.precip - s0.precip) * ratio) * 100) / 100);
    const rain = Math.max(0, Math.round(((s0.rain || 0) + ((s1.rain || 0) - (s0.rain || 0)) * ratio) * 100) / 100);
    const snow = Math.max(0, Math.round((s0.snow + (s1.snow - s0.snow) * ratio) * 100) / 100);
    const rh = Math.round((s0.relativeHumidity || 84) + ((s1.relativeHumidity || 84) - (s0.relativeHumidity || 84)) * ratio);
    const fz0 = s0.freezingLevelHeight !== undefined ? s0.freezingLevelHeight : 1400;
    const fz1 = s1.freezingLevelHeight !== undefined ? s1.freezingLevelHeight : fz0;
    const freezingLevelHeight = Math.round(fz0 + (fz1 - fz0) * ratio);
    const cloudCover = Math.round(s0.cloudCover + (s1.cloudCover - s0.cloudCover) * ratio);
    const pressureMsl = Math.round((s0.pressureMsl + (s1.pressureMsl - s0.pressureMsl) * ratio) * 10) / 10;
    const windSpeed = Math.round(s0.windSpeed + (s1.windSpeed - s0.windSpeed) * ratio);
    const windGusts = Math.round(s0.windGusts + (s1.windGusts - s0.windGusts) * ratio);
    const windDirection = interpAngle(s0.windDirection || 240, s1.windDirection || 240, ratio);
    const weatherCode = ratio < 0.5 ? s0.weatherCode : s1.weatherCode;

    const phaseInfo = MicroEngine.classifyPrecipPhase({
      tempC: temp,
      rhPct: rh,
      precipMm: precip,
      rainMm: rain,
      snowCm: snow,
      elevation: s0.elevation || 500,
      freezingLevelM: freezingLevelHeight,
      wCode: weatherCode
    });

    return {
      ...s0,
      temperature: temp,
      relativeHumidity: rh,
      freezingLevelHeight,
      wetBulbC: phaseInfo.wetBulbC,
      snowRatio: phaseInfo.snowRatio,
      phase: phaseInfo.phase,
      precip,
      rain,
      snow,
      cloudCover,
      pressureMsl,
      windSpeed,
      windGusts,
      windDirection,
      weatherCode,
      isSnow: phaseInfo.snowRatio >= 0.55
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
let _radarLoadInFlight = null;

export async function loadUnifiedRadarEngine() {
  if (_radarLoadInFlight) return _radarLoadInFlight;
  _radarLoadInFlight = (async () => {
    try {
      // Sofortige Baseline-Frames damit Zeitleiste & Windkompass bei Tab-Öffnung 0ms-Latenz haben
      if (!state.map.unifiedRadarFrames || state.map.unifiedRadarFrames.length === 0) {
        const initNow = Date.now();
        const baselineSt = getSynthesizedBaselineStations();
        const quickFrames = [];
        for (const m of [-60, -45, -30, -15, 0, 15, 30, 60, 120, 180]) {
          quickFrames.push({
            type: m <= 0 ? 'past' : 'future',
            minuteOffset: m,
            hoursFromNow: m / 60,
            timestampMs: initNow + m * 60000,
            label: m === 0 ? '🔴 Live-Scan (Jetzt)' : (m < 0 ? `Vor ${Math.abs(m)} Min.` : `+${m}m`),
            isLive: m === 0,
            stations: baselineSt
          });
        }
        const livePos = 4;
        state.map.unifiedRadarFrames = quickFrames;
        state.map.liveRadarIndex = livePos;
        const quickSlider = document.getElementById('radar-time-slider');
        if (quickSlider) {
          quickSlider.min = 0;
          quickSlider.max = quickFrames.length - 1;
          quickSlider.value = livePos;
        }
        showUnifiedRadarFrame(livePos);
      }

      // 1. RainViewer Doppler-Radar (Vergangenheit bis jetzt, via resilientFetch 5-Min-Cache + Deduplication)
      const rvPromise = resilientFetch('https://api.rainviewer.com/public/weather-maps.json', {
        ttlMs: 5 * 60 * 1000,
        persist: true
      }).catch(e => {
        console.warn('RainViewer API nicht erreichbar:', e);
        return null;
      });

      // 2. 48h Open-Meteo Niederschlags- & Schneeprognose für 36 alpine Stationen (DWD ICON & ECMWF)
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
      return minDiff <= 20 * 60 * 1000 ? closest : null;
    };

    // 1. Zurückliegende Stunde (-1h bis Jetzt) im 15-Minuten-Abstand: -60m, -45m, -30m, -15m
    const pastOffsets = [-60, -45, -30, -15];
    pastOffsets.forEach(m => {
      const fTimeMs = nowMs + m * 60000;
      const rvTile = findClosestRvTile(fTimeMs, pastList);
      const tilePath = rvTile ? rvTile.path : (pastList.length ? pastList[0].path : '');
      unifiedFrames.push({
        type: 'past',
        time: Math.floor(fTimeMs / 1000),
        minuteOffset: m,
        hoursFromNow: m / 60,
        path: tilePath,
        rvPath: tilePath,
        timestampMs: fTimeMs,
        label: `Vor ${Math.abs(m)} Min. (15m)`,
        isLive: false,
        stations: interpolateStationsForMinute(forecastFrames, m, baseLiveStations)
      });
    });

    // 2. JETZT (Live-Scan)
    const liveTile = nowcastList.length > 0 ? nowcastList[0] : (pastList.length > 0 ? pastList[pastList.length - 1] : null);
    const livePath = liveTile ? liveTile.path : '';
    state.map.liveRadarPath = livePath;
    const liveIdx = unifiedFrames.length;
    unifiedFrames.push({
      type: 'past',
      time: liveTile ? liveTile.time : Math.floor(nowMs / 1000),
      minuteOffset: 0,
      hoursFromNow: 0,
      path: livePath,
      rvPath: livePath,
      timestampMs: nowMs,
      label: '🔴 Live-Scan (Jetzt)',
      isLive: true,
      stations: baseLiveStations
    });

    // 3. Nächste 90 Minuten in der Zukunft (Jetzt bis +90m) im 5-Minuten-Abstand (Advektions-Nowcast + NWP-Blend)
    for (let m = 5; m <= 90; m += 5) {
      const fTimeMs = nowMs + m * 60000;
      const rvTile = findClosestRvTile(fTimeMs, nowcastList);
      const tilePath = rvTile ? rvTile.path : livePath;
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
        path: tilePath,
        rvPath: tilePath,
        cells: [],
        stations: stationsInterp
      });
    }

    // 4. Folgende Stunden (+1h45m bis +3h) im 15-Minuten-Abstand: +105m bis +180m
    for (let m = 105; m <= 180; m += 15) {
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
        rvPath: '',
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
      state.map._radarLoaded = true;

      // Konfiguriere Timeline-Slider
      const slider = document.getElementById('radar-time-slider');
      if (slider) {
        slider.min = 0;
        slider.max = Math.max(0, unifiedFrames.length - 1);
        slider.value = liveIdx;
      }

      // Starte standardmäßig auf Live-Scan
      showUnifiedRadarFrame(liveIdx);

      // Feature 4A: Preload sichtbare 512px 2/0_1.png Radar-Tiles & DEM-Höhengitter
      preloadRadarFrames(unifiedFrames, state.map.radarHost);
      if (state.map.instance) {
        ViewportDemStore.scheduleFetchForMap(state.map.instance);
        ViewportForecastGridStore.scheduleFetchForMap(state.map.instance);
      }
    } catch (err) {
      console.error('Fehler beim Initialisieren der 48h-Radar-Engine:', err);
    } finally {
      _radarLoadInFlight = null;
    }
  })();
  return _radarLoadInFlight;
}

/**
 * FEATURE 4A: Hardware-beschleunigter 512px Radar-Tile Preloader & Decoder (z <= 7)
 */
export function preloadRadarFrames(frames, host) {
  if (!frames || !host || !state.map.instance) return;
  const mapZoom = state.map.instance.getZoom() || 8;
  const rvZoom = Math.min(7, Math.max(4, Math.floor(mapZoom)));
  const b = state.map.instance.getBounds();
  const seen = new Set();

  frames.forEach(f => {
    const p = f.rvPath || f.path;
    if (f.type === 'past' && p && !seen.has(p)) {
      seen.add(p);
      RainViewerRadarStore.requestVisibleTiles(p, host, rvZoom, b.getSouth(), b.getNorth(), b.getWest(), b.getEast());
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

export function updateMeteoSwissTimelineUI(frame, idx, total) {
  const frames = state.map && state.map.unifiedRadarFrames ? state.map.unifiedRadarFrames : [];
  const count = total || frames.length || 1;
  const maxIdx = Math.max(1, count - 1);
  const clampedIdx = Math.max(0, Math.min(maxIdx, idx || 0));
  const pct = (clampedIdx / maxIdx) * 100;
  const liveIdx = (state.map && state.map.liveRadarIndex !== undefined)
    ? Math.max(0, Math.min(maxIdx, state.map.liveRadarIndex))
    : Math.min(4, maxIdx);
  const livePct = (liveIdx / maxIdx) * 100;

  const ts = (frame && frame.timestampMs) || Date.now();
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');

  const watermark = document.getElementById('ms-radar-watermark');
  if (watermark) {
    watermark.innerText = `${dd}.${mm}.${yy} | ${hh}:${min}`;
  }

  const cTime = document.getElementById('mscb-time');
  if (cTime) cTime.innerText = `${hh}:${min}`;

  const weekdays = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const cDay = document.getElementById('mscb-day');
  if (cDay) {
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const isTomorrow = d.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    cDay.innerText = isToday ? 'Heute' : (isTomorrow ? 'Morgen' : weekdays[d.getDay()]);
  }

  const isMeasured = !!(frame && (frame.isLive || frame.type === 'past' || (frame.minuteOffset !== undefined && frame.minuteOffset <= 0)));
  const cKind = document.getElementById('mscb-kind');
  if (cKind) {
    cKind.innerText = isMeasured ? 'Messung' : 'Prognose';
    cKind.classList.toggle('is-live', isMeasured);
  }

  const needle = document.getElementById('ms-scrubber-needle');
  if (needle) needle.style.left = `${pct.toFixed(2)}%`;

  const barMeasured = document.getElementById('ms-bar-measured');
  if (barMeasured) barMeasured.style.width = `${livePct.toFixed(2)}%`;

  const dotNow = document.getElementById('ms-dot-now');
  if (dotNow) dotNow.style.left = `${livePct.toFixed(2)}%`;

  const barForecast = document.getElementById('ms-bar-forecast');
  if (barForecast) {
    barForecast.style.left = `${livePct.toFixed(2)}%`;
    barForecast.style.width = `${Math.max(0, 100 - livePct).toFixed(2)}%`;
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
  updateMeteoSwissTimelineUI(frame, idx, frames.length);

  // Rendere das aktuell gewählte Wetter-Overlay exakt für diesen Zeitschritt
  const activeOverlay = state.map.activeOverlay || 'precip';
  if ((activeOverlay === 'precip' || activeOverlay === 'rainviewer-radar') && state.map.instance) {
    ViewportForecastGridStore.scheduleFetchForMap(state.map.instance, 120);
  }
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
      if (player.classList.contains('is-collapsed') && !e.target.closest('#radar-player-toggle-btn')) {
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

  const delays = { 1: 820, 2: 440, 3: 240 };
  const stepMs = delays[state.map.radarPlaybackSpeed || 1] || 820;
  let stepStart = performance.now();
  let lastMorphRender = 0;

  function radarLoop(currentTime) {
    if (!state.map.radarPlaying) return;
    const frames = state.map.unifiedRadarFrames;
    if (frames && frames.length > 0) {
      const elapsed = currentTime - stepStart;
      if (elapsed >= stepMs) {
        stepStart = currentTime - (elapsed % stepMs);
        lastMorphRender = currentTime;
        let next = state.map.radarIndex + 1;
        if (next >= frames.length) next = 0;
        showUnifiedRadarFrame(next);
      } else {
        const activeOverlay = state.map.activeOverlay || 'precip';
        if ((activeOverlay === 'precip' || activeOverlay === 'rainviewer-radar') && currentTime - lastMorphRender >= 80) {
          lastMorphRender = currentTime;
          const idx = state.map.radarIndex || 0;
          const nextIdx = idx + 1 >= frames.length ? 0 : idx + 1;
          const alpha = elapsed / stepMs;
          if (alpha > 0.04 && alpha < 0.96 && frames[idx] && frames[nextIdx]) {
            WeatherCanvasEngine.render(frames[idx], 'precip', {
              nextFrame: frames[nextIdx],
              morphAlpha: alpha
            });
          }
        }
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

export { WeatherCanvasEngine, RainViewerRadarStore, ViewportDemStore, ViewportForecastGridStore };
if (typeof window !== 'undefined') {
  window.WeatherCanvasEngine = WeatherCanvasEngine;
  window.RainViewerRadarStore = RainViewerRadarStore;
  window.ViewportDemStore = ViewportDemStore;
  window.ViewportForecastGridStore = ViewportForecastGridStore;
  window.showUnifiedRadarFrame = showUnifiedRadarFrame;
  window.setMapBaseLayer = setMapBaseLayer;
}
