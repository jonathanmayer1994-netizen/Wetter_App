/**
 * BEST WEATHER — Interactive Map & 48h Radar Orchestrator (v2.0)
 * Modulare Architektur über:
 * - features/map/mapMercator.js (Reine Web-Mercator-Mathematik & Marching Squares)
 * - features/map/mapStores.js   (RainViewer Pointer-Matrix, AWS Terrarium DEM, Globales 5x5 NWP-Grid)
 * - features/map/mapCanvas.js   (Zero-GC Pool, O(1) Wind-Grid, Worker-Bridge, Dem-Thermal & Isolinien)
 * - features/map/mapHud.js      (Tap-to-Inspect, Fadenkreuz-Pin, Attribution, Gewitter-HUD)
 * - features/map/mapTimeline.js (Zeitproportionales Playback, fester NWP UTC-Anker, 120-FPS Scrubbing)
 */

import { state } from '../core/state.js';
import { BASE_LAYERS, REGIONAL_STATIONS } from '../core/constants.js';
import { MicroEngine } from '../microEngine.js';
import { initMapSolarTransition, updateMapSolarTransition, isMapCurrentlyDark } from './mapSolar.js';
import { escapeHtml } from '../httpClient.js';

import {
  RainViewerRadarStore,
  ViewportDemStore,
  ViewportForecastGridStore,
  setMapStoresRenderHook
} from './map/mapStores.js';

import {
  WeatherCanvasEngine,
  setWeatherCanvasHelpers
} from './map/mapCanvas.js';

import {
  formatCleanLocationName,
  createUserLocationBeaconIcon,
  syncMeteoSwissHudControls,
  getWindCardinalName,
  getLocationWeatherForFrame,
  updateWindCompassWidget,
  updatePointWeatherCard,
  updateMapLayerPill,
  updateMapAttribution,
  getSynthesizedBaselineStations,
  loadRegionalStationWeather,
  updateMapLegend,
  inspectMapPoint,
  clearInspectedMapPoint,
  promoteInspectedPointToPrimary,
  updateThunderstormAlertBox,
  syncSportsRouteOverlay
} from './map/mapHud.js';

import {
  setTimelineHelpers,
  interpolateStationsForMinute,
  realignRadarTimelineTimestamps,
  ensureFreshMapRadar,
  loadUnifiedRadarEngine,
  preloadRadarFrames,
  startPredictive3RingPreload,
  renderFutureRadarCells,
  interpolateStationLists,
  getInterpolatedRadarSpec,
  getActiveInterpolatedRadarSpec,
  updateMeteoSwissTimelineUI,
  positionMeteoSwissAxisTicks,
  showUnifiedRadarFrame,
  getFrameWeatherSummary,
  updateScrubberHud,
  showScrubberHud,
  hideScrubberHud,
  setupUnifiedRadarControls,
  findFrameIndexForTarget,
  findFrameIndexForHourOffset,
  updateJumpButtonsActive,
  startRadarAnimation,
  stopRadarAnimation,
  toggleRadarPlay,
  stepRadar
} from './map/mapTimeline.js';

// Abhängigkeiten einmalig sauber verdrahten
setWeatherCanvasHelpers({
  getBaselineStations: getSynthesizedBaselineStations
});

setTimelineHelpers({
  getSynthesizedBaselineStations,
  renderActiveWeatherOverlayForFrame,
  getLocationWeatherForFrame
});

setMapStoresRenderHook((allowedOverlays) => {
  if (!state.map || state.activeTab !== 'tab-map') return;
  const ov = state.map.activeOverlay || 'precip';
  if (Array.isArray(allowedOverlays) && !allowedOverlays.includes(ov)) return;
  const spec = getActiveInterpolatedRadarSpec();
  if (spec) {
    WeatherCanvasEngine.render(spec.frame, ov, {
      rvFrameA: spec.frameA,
      rvFrameB: spec.frameB,
      morphAlpha: spec.morphAlpha,
      stationsPreInterpolated: spec.morphAlpha > 0
    });
    updatePointWeatherCard(spec.frame);
    updateMapAttribution();
  }
});

let _globalMapDocListenersBound = false;
let _mobileFullscreenUiBound = false;

function closeMapLegend() {
  if (state.map && state.map.legendVisible) {
    state.map.legendVisible = false;
    syncMeteoSwissHudControls();
  }
  const btn = document.getElementById('map-legend-toggle-btn');
  if (btn && typeof btn.blur === 'function') btn.blur();
}

function openMapLayerDrawer() {
  closeMapLegend();
  const layerDrawer = document.getElementById('map-layer-drawer');
  const layerBackdrop = document.getElementById('map-layer-backdrop');
  const layerPill = document.getElementById('map-layer-pill');
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
  const layerDrawer = document.getElementById('map-layer-drawer');
  const layerBackdrop = document.getElementById('map-layer-backdrop');
  const layerPill = document.getElementById('map-layer-pill');
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

function syncTopReliefVisibility() {
  const mapInst = state.map && state.map.instance;
  const topRelief = state.map && state.map.topReliefLayer;
  if (!mapInst || !topRelief) return;
  const z = mapInst.getZoom();
  const ov = (state.map && state.map.activeOverlay) || 'precip';
  // 3D Top-Relief nur bei Alpen-Detailzoom (>= 8) & außerhalb 60-FPS-Windmodus aktivieren (Compositor & Kachel-Entlastung)
  const shouldShow = z >= 8 && ov !== 'wind';
  const isAttached = mapInst.hasLayer(topRelief);
  if (shouldShow && !isAttached) topRelief.addTo(mapInst);
  else if (!shouldShow && isAttached) mapInst.removeLayer(topRelief);
}

export function initLeafletMap() {
  const mapElem = document.getElementById('interactive-map');
  if (!mapElem || typeof L === 'undefined') return;

  // Idempotenter Schutz gegen Doppel-Initialisierung
  if (state.map && state.map.instance) {
    state.map.instance.invalidateSize({ animate: false });
    return;
  }

  state.map.instance = L.map('interactive-map', {
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: true,
    touchZoom: true,
    doubleClickZoom: true,
    maxZoom: 20
  }).setView([state.currentLocation.lat, state.currentLocation.lon], 9);

  const hillshadePane = state.map.instance.createPane('hillshadePane');
  hillshadePane.style.zIndex = 205;
  hillshadePane.style.pointerEvents = 'none';

  const topReliefPane = state.map.instance.getPane('topReliefPane') || state.map.instance.createPane('topReliefPane');
  topReliefPane.style.zIndex = 420;
  topReliefPane.style.pointerEvents = 'none';
  topReliefPane.style.mixBlendMode = 'multiply';

  const labelsPane = state.map.instance.createPane('labelsOverlayPane');
  labelsPane.style.zIndex = 450;
  labelsPane.style.pointerEvents = 'none';

  const weatherCanvas = document.getElementById('wind-flow-canvas');
  const overlayPane = state.map.instance.getPanes().overlayPane;
  if (weatherCanvas && overlayPane && weatherCanvas.parentElement !== overlayPane) {
    overlayPane.appendChild(weatherCanvas);
    L.DomUtil.setPosition(weatherCanvas, state.map.instance.containerPointToLayerPoint([0, 0]));
  }

  state.map.futureRadarLayerGroup = L.layerGroup().addTo(state.map.instance);
  state.map.weatherLayerGroup = L.layerGroup().addTo(state.map.instance);
  state.map.updateLegend = updateMapLegend;
  initMapSolarTransition(state.map.instance);

  const initialBase = (state.map.activeBase && BASE_LAYERS[state.map.activeBase]) ? state.map.activeBase : 'osm-dark';
  state.map.activeBase = initialBase;
  setMapBaseLayer(initialBase);

  state.map.marker = L.marker([state.currentLocation.lat, state.currentLocation.lon], {
    icon: createUserLocationBeaconIcon(state.currentLocation),
    zIndexOffset: 3000
  }).addTo(state.map.instance);

  // Tap-to-Inspect (0ms Inspektion mit verschiebbarem Pin, KEIN ungewollter globaler Standortwechsel!)
  let mapClickTimer = null;
  state.map.instance.on('click', (e) => {
    if (state.map?.legendVisible) {
      closeMapLegend();
      return;
    }
    if (mapClickTimer) {
      clearTimeout(mapClickTimer);
      mapClickTimer = null;
      return;
    }
    const lat = e.latlng.lat;
    const lon = e.latlng.lng;
    mapClickTimer = setTimeout(() => {
      mapClickTimer = null;
      inspectMapPoint(lat, lon, { pan: false });
    }, 180);
  });

  state.map.instance.on('dblclick', (e) => {
    if (mapClickTimer) {
      clearTimeout(mapClickTimer);
      mapClickTimer = null;
    }
    if (e.originalEvent) e.originalEvent.stopPropagation();
  });

  // Base- & Overlay-Auswahl
  document.querySelectorAll('.map-base-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const base = btn.dataset.base;
      document.querySelectorAll('.map-base-btn').forEach(b => b.classList.toggle('active', b.dataset.base === base));
      setMapBaseLayer(base);
    });
  });

  document.querySelectorAll('.map-overlay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const overlay = btn.dataset.overlay;
      document.querySelectorAll('.map-overlay-btn').forEach(b => b.classList.toggle('active', b.dataset.overlay === overlay));
      setMapOverlay(overlay);
    });
  });

  // Layer Drawer Controller
  const layerPill = document.getElementById('map-layer-pill');
  const layerDrawer = document.getElementById('map-layer-drawer');
  const layerBackdrop = document.getElementById('map-layer-backdrop');
  const layerCloseBtn = document.getElementById('map-layer-close-btn');
  const layerDoneBtn = document.getElementById('map-layer-done-btn');

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

  const mldRecenterBtn = document.getElementById('mld-recenter-btn');
  if (mldRecenterBtn) {
    mldRecenterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearInspectedMapPoint();
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
      if (state.map.instance) state.map.instance.setView([47.2, 11.5], 7, { animate: true });
      closeMapLayerDrawer();
    });
  }

  // Inspektor CTAs ("Als Hauptort laden" / "Schließen")
  const loadPrimaryBtn = document.getElementById('mpw-load-primary-btn');
  if (loadPrimaryBtn) {
    loadPrimaryBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      promoteInspectedPointToPrimary();
    });
  }
  const clearInspectBtn = document.getElementById('mpw-clear-inspect-btn');
  if (clearInspectBtn) {
    clearInspectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearInspectedMapPoint();
    });
  }

  // Gewitter-Box schließen
  const tabCloseBtn = document.getElementById('tab-close-btn');
  if (tabCloseBtn) {
    tabCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.map._thunderAlertDismissed = true;
      const box = document.getElementById('thunderstorm-alert-box');
      if (box) box.style.display = 'none';
    });
  }

  setupUnifiedRadarControls();

  state.map.activeOverlay = 'precip';
  if (state.activeTab === 'tab-map') {
    loadUnifiedRadarEngine();
  }
  updateWeatherOverlay();
  updatePointWeatherCard();
  updateMapLayerPill();

  // Pan & Zoom Synchronisation
  let panRenderRaf = null;
  state.map.instance.on('move', () => {
    const wc = document.getElementById('wind-flow-canvas');
    if (wc && state.map.instance) {
      L.DomUtil.setPosition(wc, state.map.instance.containerPointToLayerPoint([0, 0]));
    }
    if (state.map._suppressNextMoveEndRender || state.map.activeOverlay === 'wind') return;
    if (panRenderRaf) return;
    panRenderRaf = requestAnimationFrame(() => {
      panRenderRaf = null;
      const spec = getActiveInterpolatedRadarSpec();
      if (spec) {
        WeatherCanvasEngine.render(spec.frame, state.map.activeOverlay, {
          fastPan: true,
          rvFrameA: spec.frameA,
          rvFrameB: spec.frameB,
          morphAlpha: spec.morphAlpha,
          stationsPreInterpolated: spec.morphAlpha > 0
        });
      }
    });
  });

  state.map.instance.on('moveend zoomend', () => {
    syncTopReliefVisibility();
    if (state.map._suppressNextMoveEndRender) return;
    const spec = getActiveInterpolatedRadarSpec();
    if (spec) {
      WeatherCanvasEngine.render(spec.frame, state.map.activeOverlay, {
        rvFrameA: spec.frameA,
        rvFrameB: spec.frameB,
        morphAlpha: spec.morphAlpha,
        stationsPreInterpolated: spec.morphAlpha > 0
      });
    }
    ViewportDemStore.scheduleFetchForMap(state.map.instance);
    ViewportForecastGridStore.scheduleFetchForMap(state.map.instance);
  });

  // Legenden- & Right-FAB Buttons
  const legendToggleBtn = document.getElementById('map-legend-toggle-btn');
  const legendCloseBtn = document.getElementById('map-legend-close-btn');
  const legendCard = document.getElementById('map-legend-card');
  if (legendToggleBtn) {
    legendToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willBeVisible = !state.map.legendVisible;
      if (willBeVisible) closeMapLayerDrawer();
      state.map.legendVisible = willBeVisible;
      syncMeteoSwissHudControls();
      if (!willBeVisible && typeof legendToggleBtn.blur === 'function') legendToggleBtn.blur();
    });
  }
  if (legendCloseBtn) legendCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeMapLegend(); });
  if (legendCard) legendCard.addEventListener('click', (e) => e.stopPropagation());

  const fabLightning = document.getElementById('ms-fab-lightning');
  if (fabLightning) {
    fabLightning.addEventListener('click', (e) => {
      e.stopPropagation();
      state.map._thunderAlertDismissed = false;
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
      if (state.map.activeOverlay !== 'precip') setMapOverlay('precip');
      else {
        const frames = state.map.unifiedRadarFrames;
        if (frames && frames.length) showUnifiedRadarFrame(state.map.radarIndex);
      }
    });
  }

  const fabZoomIn = document.getElementById('ms-fab-zoom-in');
  if (fabZoomIn) {
    fabZoomIn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance) state.map.instance.zoomIn();
    });
  }

  const fabZoomOut = document.getElementById('ms-fab-zoom-out');
  if (fabZoomOut) {
    fabZoomOut.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.map.instance) state.map.instance.zoomOut();
    });
  }

  const fabRecenter = document.getElementById('ms-fab-recenter');
  if (fabRecenter) {
    fabRecenter.addEventListener('click', (e) => {
      e.stopPropagation();
      clearInspectedMapPoint();
      if (state.map.instance && state.currentLocation) {
        state.map.instance.panTo([state.currentLocation.lat, state.currentLocation.lon], { animate: true });
      }
    });
  }

  // Deduplizierte globale Dokument-/Fenster-Listener (einmalig gebunden)
  if (!_globalMapDocListenersBound) {
    _globalMapDocListenersBound = true;

    let resizeDebounce = null;
    window.addEventListener('resize', () => {
      const spec = getActiveInterpolatedRadarSpec();
      if (spec && state.activeTab === 'tab-map') {
        WeatherCanvasEngine.render(spec.frame, state.map.activeOverlay, {
          rvFrameA: spec.frameA,
          rvFrameB: spec.frameB,
          morphAlpha: spec.morphAlpha,
          stationsPreInterpolated: spec.morphAlpha > 0
        });
      }
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        if (state.activeTab === 'tab-map' && state.map && state.map.instance) {
          state.map.instance.invalidateSize({ animate: false });
          const debSpec = getActiveInterpolatedRadarSpec();
          if (debSpec) {
            WeatherCanvasEngine.render(debSpec.frame, state.map.activeOverlay, {
              rvFrameA: debSpec.frameA,
              rvFrameB: debSpec.frameB,
              morphAlpha: debSpec.morphAlpha,
              stationsPreInterpolated: debSpec.morphAlpha > 0
            });
          }
        }
      }, 100);
    }, { passive: true });

    document.addEventListener('click', (e) => {
      if (!state.map?.legendVisible) return;
      const t = e.target;
      if (t && (t.closest('#map-legend-card') || t.closest('#map-legend-toggle-btn'))) return;
      closeMapLegend();
    });

    // Desktop-Tastatur-Shortcuts für blitzschnelle Navigation
    document.addEventListener('keydown', (e) => {
      if (state.activeTab !== 'tab-map') return;
      const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;

      if (e.key === ' ') {
        e.preventDefault();
        toggleRadarPlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stopRadarAnimation();
        stepRadar(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stopRadarAnimation();
        stepRadar(1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        if (state.map?.instance) state.map.instance.zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        if (state.map?.instance) state.map.instance.zoomOut();
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        state.map.legendVisible = !state.map.legendVisible;
        syncMeteoSwissHudControls();
      } else if (e.key >= '1' && e.key <= '6') {
        const order = ['precip', 'wind', 'lightning', 'clouds', 'temp', 'pressure'];
        const nextOv = order[Number(e.key) - 1];
        if (nextOv) {
          document.querySelectorAll('.map-overlay-btn').forEach(b => b.classList.toggle('active', b.dataset.overlay === nextOv));
          setMapOverlay(nextOv);
        }
      } else if (e.key === 'Escape') {
        closeMapLayerDrawer();
        closeMapLegend();
        if (state.map?.inspectedPoint) {
          clearInspectedMapPoint();
        } else if (document.body.classList.contains('mobile-map-fullscreen-active')) {
          closeMobileMapFullscreen();
        }
      }
    });
  }

  setupMobileMapFullscreen();
  syncMeteoSwissHudControls();
}

export function enterMobileMapFullscreen() {
  document.body.classList.add('mobile-map-fullscreen-active');
  const wrapper = document.getElementById('fullscreen-map-wrapper');
  if (wrapper) wrapper.classList.add('is-fullscreen');

  const pwCard = document.getElementById('map-point-weather-card');
  const pwToggle = document.getElementById('mpw-mobile-toggle-btn');
  if (pwCard && !pwCard.classList.contains('collapsed') && !(state.map && state.map.inspectedPoint)) {
    pwCard.classList.add('collapsed');
    if (pwToggle) pwToggle.innerText = '▴';
  }

  if (state.map?.instance) {
    state.map.instance.invalidateSize({ animate: false });
    requestAnimationFrame(() => {
      if (state.map?.instance) state.map.instance.invalidateSize({ animate: false });
    });
  }
}

export function exitMobileMapFullscreen() {
  document.body.classList.remove('mobile-map-fullscreen-active');
  const wrapper = document.getElementById('fullscreen-map-wrapper');
  if (wrapper) wrapper.classList.remove('is-fullscreen');

  if (state.map?.instance) {
    state.map.instance.invalidateSize({ animate: false });
  }
}

export function closeMobileMapFullscreen() {
  exitMobileMapFullscreen();
  const targetTab = (state.previousTab && state.previousTab !== 'tab-map') ? state.previousTab : 'tab-overview';
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${targetTab}"], .mbn-btn[data-tab="${targetTab}"]`);
  if (targetBtn) targetBtn.click();
  else {
    const overviewBtn = document.querySelector('[data-tab="tab-overview"]');
    if (overviewBtn) overviewBtn.click();
  }
}

export function setupMobileMapFullscreen() {
  if (_mobileFullscreenUiBound) return;
  _mobileFullscreenUiBound = true;

  const closeBtn = document.getElementById('map-mobile-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMobileMapFullscreen();
    });
  }

  const wrapper = document.getElementById('fullscreen-map-wrapper');
  if (wrapper) {
    wrapper.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  const pwCard = document.getElementById('map-point-weather-card');
  const pwToggle = document.getElementById('mpw-mobile-toggle-btn');
  if (pwCard) {
    const header = pwCard.querySelector('.mpw-header');
    const toggleHandler = (e) => {
      if (window.innerWidth <= 768 && !e.target.closest('#mpw-load-primary-btn') && !e.target.closest('#mpw-clear-inspect-btn')) {
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

  const windWidget = document.getElementById('map-wind-compass-widget');
  if (windWidget) {
    windWidget.addEventListener('click', () => {
      if (window.innerWidth <= 768) windWidget.classList.toggle('compact');
    });
  }
}

export function setMapBaseLayer(baseKey) {
  const resolvedKey = BASE_LAYERS[baseKey] ? baseKey : 'osm-dark';
  const conf = BASE_LAYERS[resolvedKey];
  state.map.activeBase = resolvedKey;

  document.querySelectorAll('.map-base-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.base === resolvedKey);
  });

  if (state.map.baseTileLayer) { state.map.instance.removeLayer(state.map.baseTileLayer); state.map.baseTileLayer = null; }
  if (state.map.hillshadeTileLayer) { state.map.instance.removeLayer(state.map.hillshadeTileLayer); state.map.hillshadeTileLayer = null; }
  if (state.map.topReliefLayer) { state.map.instance.removeLayer(state.map.topReliefLayer); state.map.topReliefLayer = null; }
  if (state.map.satelliteLabelsLayer) { state.map.instance.removeLayer(state.map.satelliteLabelsLayer); state.map.satelliteLabelsLayer = null; }

  const mapElem = document.getElementById('interactive-map');
  if (mapElem) mapElem.classList.toggle('osm-dark-tiles', !!(conf.isDark || resolvedKey === 'osm-dark'));

  const isRetina = (typeof window !== 'undefined' && window.devicePixelRatio >= 1.5);
  // Paket 1 Optimierung: keepBuffer auf 3 / 2 reduzieren + updateWhenZooming: false (~65% weniger parallele Kacheln)
  const options = {
    ...conf.options,
    keepBuffer: 3,
    updateWhenZooming: false,
    updateWhenIdle: true
  };

  const tileUrl = conf.url;
  if (tileUrl.includes('{r}')) options.r = isRetina ? '@2x' : '';

  const baseLayer = L.tileLayer(tileUrl, options);
  if (conf.fallbackUrl) {
    baseLayer.on('tileerror', function (err) {
      if (err.tile && !err.tile._fallbackTried) {
        err.tile._fallbackTried = true;
        const coords = err.coords;
        err.tile.src = conf.fallbackUrl
          .replace('{z}', coords.z).replace('{x}', coords.x).replace('{y}', coords.y)
          .replace('{s}', 'a').replace('{r}', '');
      }
    });
  }
  baseLayer.addTo(state.map.instance);
  state.map.baseTileLayer = baseLayer;

  if (conf.hillshadeUrl) {
    const hsPane = state.map.instance.getPane('hillshadePane') ? 'hillshadePane' : 'tilePane';
    const hsLayer = L.tileLayer(conf.hillshadeUrl, {
      pane: hsPane, maxNativeZoom: 16, maxZoom: conf.options.maxZoom || 20,
      keepBuffer: 2, updateWhenZooming: false, className: 'ms-hillshade-tile'
    });
    hsLayer.addTo(state.map.instance);
    state.map.hillshadeTileLayer = hsLayer;
  }

  if (conf.topReliefUrl) {
    const trPane = state.map.instance.getPane('topReliefPane') ? 'topReliefPane' : 'overlayPane';
    const topReliefLayer = L.tileLayer(conf.topReliefUrl, {
      pane: trPane, opacity: resolvedKey === 'osm-dark' ? 0.44 : 0.36,
      maxNativeZoom: 16, maxZoom: conf.options.maxZoom || 20,
      keepBuffer: 2, updateWhenZooming: false, className: 'ms-top-relief-tile'
    });
    state.map.topReliefLayer = topReliefLayer;
    syncTopReliefVisibility();
  }

  if (conf.labelsUrl) {
    const lblPane = state.map.instance.getPane('labelsOverlayPane') ? 'labelsOverlayPane' : 'overlayPane';
    const labelsOptions = {
      pane: lblPane, zIndex: 455, opacity: 0.98, subdomains: ['a', 'b', 'c', 'd'],
      maxNativeZoom: resolvedKey === 'osm-dark' ? 19 : 18, maxZoom: conf.options.maxZoom || 20,
      keepBuffer: 2, updateWhenZooming: false, className: 'ms-labels-tile'
    };
    if (conf.labelsUrl.includes('{r}')) labelsOptions.r = isRetina ? '@2x' : '';
    const labelsLayer = L.tileLayer(conf.labelsUrl, labelsOptions);
    if (conf.labelsFallbackUrl) {
      labelsLayer.on('tileerror', function (err) {
        if (err.tile && !err.tile._fallbackTried) {
          err.tile._fallbackTried = true;
          const coords = err.coords;
          err.tile.src = conf.labelsFallbackUrl
            .replace('{z}', coords.z).replace('{x}', coords.x).replace('{y}', coords.y)
            .replace('{s}', 'a').replace('{r}', '');
        }
      });
    }
    labelsLayer.addTo(state.map.instance);
    state.map.satelliteLabelsLayer = labelsLayer;
  }

  if (state.map.activeOverlay === 'wind') {
    updateMapLegend('wind');
    const canvas = document.getElementById('wind-flow-canvas');
    if (canvas) { const ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
    const spec = getActiveInterpolatedRadarSpec();
    if (spec) showUnifiedRadarFrame(spec.floatIdx);
  } else if (state.map.activeOverlay) {
    updateMapLegend(state.map.activeOverlay);
    const spec = getActiveInterpolatedRadarSpec();
    if (spec) {
      WeatherCanvasEngine.render(spec.frame, state.map.activeOverlay, {
        rvFrameA: spec.frameA, rvFrameB: spec.frameB, morphAlpha: spec.morphAlpha, stationsPreInterpolated: spec.morphAlpha > 0
      });
    }
  }

  updateMapLayerPill();
  syncMeteoSwissHudControls();
  updateMapSolarTransition();
}

export function setMapOverlay(overlayKey) {
  state.map.activeOverlay = overlayKey;
  syncTopReliefVisibility();
  updateWindCompassWidget();
  updateWeatherOverlay();
  updateMapLayerPill();
  syncMeteoSwissHudControls();
  updateMapSolarTransition();
}

export function cleanupRadarTiles() {
  if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();
  if (state.map.radarTileLayer && state.map.instance && state.map.instance.hasLayer(state.map.radarTileLayer)) {
    state.map.instance.removeLayer(state.map.radarTileLayer);
    state.map.radarTileLayer = null;
  }
}

export async function updateWeatherOverlay() {
  if (!state.map.instance || !state.map.weatherLayerGroup) return;
  const overlay = state.map.activeOverlay;
  const radarControls = document.getElementById('radar-floating-controls');
  if (radarControls) radarControls.style.display = 'flex';

  updateMapLegend(overlay);
  updateMapAttribution();

  if (state.activeTab === 'tab-map') {
    ensureFreshMapRadar();
    ViewportDemStore.scheduleFetchForMap(state.map.instance);
    ViewportForecastGridStore.scheduleFetchForMap(state.map.instance);
    syncSportsRouteOverlay();
    return;
  }

  if (state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length) {
    showUnifiedRadarFrame(state.map.radarIndex);
  }
}

export function renderActiveWeatherOverlayForFrame(frame, overlay, renderOpts = {}) {
  if (!state.map.instance || !state.map.weatherLayerGroup) return;

  const stations = (frame && frame.stations && frame.stations.length > 0)
    ? frame.stations
    : ((state.map.regionalStationsData && state.map.regionalStationsData.length > 0)
        ? state.map.regionalStationsData
        : getSynthesizedBaselineStations());

  const t = new Date((frame && frame.timestampMs) || Date.now());
  const now = new Date();
  const isToday = t.toDateString() === now.toDateString();
  const isTomorrow = t.toDateString() === new Date(now.getTime() + 86400000).toDateString();
  const dayStr = isToday ? 'Heute' : (isTomorrow ? 'Morgen' : t.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }));
  const timeStr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  const rawMo = (frame && frame.minuteOffset !== undefined) ? Number(frame.minuteOffset) : undefined;
  const dispMin = rawMo !== undefined ? Math.round(rawMo) : undefined;
  const isLiveNow = !!(frame && (frame.isLive || dispMin === 0));

  let relStr = 'Live';
  if (frame) {
    if (isLiveNow) relStr = 'Live';
    else if (dispMin !== undefined) {
      if (dispMin < 0) relStr = `vor ${Math.abs(dispMin)} Min.`;
      else if (dispMin < 60) relStr = `+${dispMin}m`;
      else if (dispMin % 60 === 0) relStr = `+${dispMin / 60}h`;
      else relStr = `+${Math.floor(dispMin / 60)}h ${dispMin % 60}m`;
    } else if (frame.type === 'past') {
      relStr = `vor ${Math.round((Date.now() - t.getTime()) / 60000)} Min.`;
    } else if (frame.hoursFromNow) {
      relStr = `+${Math.round(frame.hoursFromNow)}h`;
    }
  }

  const fullDateTimeText = relStr ? `${dayStr}, ${timeStr} Uhr (${relStr})` : `${dayStr}, ${timeStr} Uhr`;
  const modeChip = document.getElementById('radar-mode-chip');
  const timeDisplay = document.getElementById('radar-time-display');
  const radarControls = document.getElementById('radar-floating-controls');
  if (radarControls) radarControls.style.display = 'flex';

  updateWindCompassWidget(frame);
  updateThunderstormAlertBox(frame, overlay, stations);

  const canvasOpts = {
    rvFrameA: renderOpts.rvFrameA,
    rvFrameB: renderOpts.rvFrameB,
    morphAlpha: renderOpts.morphAlpha,
    stationsPreInterpolated: renderOpts.stationsPreInterpolated,
    fastPan: renderOpts.fastPan
  };

  const shouldThrottleDomMarkers = (targetOverlay) => {
    if (!renderOpts.isScrubOrPlay) return false;
    if (state.map._stationLayerOverlay !== targetOverlay) return false;
    if (!state.map.weatherLayerGroup || state.map.weatherLayerGroup.getLayers().length === 0) return false;
    return (performance.now() - (state.map._lastStationMarkerAt || 0)) < 140;
  };
  const markDomMarkersFresh = (targetOverlay) => {
    state.map._stationLayerOverlay = targetOverlay;
    state.map._lastStationMarkerAt = performance.now();
  };

  if (overlay === 'precip' || overlay === 'rainviewer-radar') {
    if (frame && (frame.type === 'past' || isLiveNow)) {
      if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();
      cleanupRadarTiles();
      if (modeChip) {
        if (isLiveNow) {
          modeChip.innerText = '🔴 Messung · Live';
          modeChip.style.background = 'rgba(239, 68, 68, 0.25)'; modeChip.style.borderColor = '#ef4444';
        } else {
          modeChip.innerText = dispMin !== undefined && dispMin < 0 ? `⏪ Messung -${Math.abs(dispMin)}m` : '⏪ Historie';
          modeChip.style.background = 'rgba(56, 189, 248, 0.2)'; modeChip.style.borderColor = '#38bdf8';
        }
      }
      if (timeDisplay) timeDisplay.innerText = fullDateTimeText;
      WeatherCanvasEngine.render(frame, 'precip', canvasOpts);
    } else if (frame) {
      cleanupRadarTiles();
      renderFutureRadarCells(frame);
      WeatherCanvasEngine.render(frame, 'precip', canvasOpts);
      if (modeChip) {
        if (dispMin !== undefined && dispMin <= 90 && dispMin > 0) {
          modeChip.innerText = `⚡ Nowcast (+${dispMin}m)`;
          modeChip.style.background = 'rgba(245, 158, 11, 0.25)'; modeChip.style.borderColor = '#f59e0b';
        } else if (dispMin !== undefined && dispMin <= 180) {
          const hStr = dispMin % 60 === 0 ? `+${dispMin / 60}h` : `+${Math.floor(dispMin / 60)}h ${dispMin % 60}m`;
          modeChip.innerText = `🔮 Detail (${hStr})`;
          modeChip.style.background = 'rgba(168, 85, 247, 0.25)'; modeChip.style.borderColor = '#c084fc';
        } else {
          const h = dispMin !== undefined ? Math.round(dispMin / 60) : (frame.hoursFromNow || 0);
          modeChip.innerText = `🔮 Prognose (+${h}h)`;
          modeChip.style.background = 'rgba(168, 85, 247, 0.25)'; modeChip.style.borderColor = '#c084fc';
        }
      }
      if (timeDisplay) timeDisplay.innerText = fullDateTimeText;
    }

    if (!shouldThrottleDomMarkers('precip')) {
      state.map.weatherLayerGroup.clearLayers();
      if (state.map.showLightningOverlay) {
        const storm = MicroEngine.computeLightningActivity(state.currentLocation.lat, state.currentLocation.lon, state.weatherData);
        if (storm && Array.isArray(storm.strikes)) {
          storm.strikes.slice(0, 10).forEach(s => {
            const color = s.ageMinutes < 10 ? '#ff3b30' : '#ffd166';
            L.marker([s.lat, s.lon], {
              icon: L.divIcon({
                className: 'custom-lightning-icon',
                html: `<div class="lightning-marker" style="background:${color}; box-shadow:0 0 12px ${color};">⚡</div>`,
                iconAnchor: [12, 12]
              })
            }).addTo(state.map.weatherLayerGroup);
          });
        }
      }
      markDomMarkersFresh('precip');
    }
  } else if (overlay === 'wind') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'wind', canvasOpts);
    if (modeChip) { modeChip.innerText = isLiveNow ? '💨 Live-Wind' : '💨 Windfeld'; modeChip.style.background = 'rgba(56, 189, 248, 0.25)'; modeChip.style.borderColor = '#38bdf8'; }
    if (timeDisplay) timeDisplay.innerText = fullDateTimeText;

    if (!shouldThrottleDomMarkers('wind')) {
      state.map.weatherLayerGroup.clearLayers();
      const curLoc = state.currentLocation;
      stations.forEach(st => {
        if (curLoc && curLoc.lat !== undefined && Math.hypot(st.lat - curLoc.lat, st.lon - curLoc.lon) < 0.04) return;
        const spd = st.windSpeed !== undefined ? st.windSpeed : 15;
        const gust = st.windGusts !== undefined ? st.windGusts : Math.round(spd * 1.35);
        const dir = st.windDirection !== undefined ? st.windDirection : 240;
        const isDarkMap = isMapCurrentlyDark();
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
        const m = L.marker([st.lat, st.lon], {
          icon: L.divIcon({
            className: 'custom-weather-icon',
            html: `<div class="station-mini-chip wind-chip" style="border-color:${color}; ${chipBg}"><span style="display:inline-block; transform:rotate(${dir}deg); font-weight:900; color:${color}; font-size:14px; line-height:1;">↑</span><span class="smc-name" style="color:${nameCol};">${st.name}</span><span class="smc-val" style="color:${color}; font-weight:800;">${spd} <small style="opacity:0.8;">(${gust})</small></span></div>`,
            iconAnchor: [48, 12]
          })
        }).addTo(state.map.weatherLayerGroup);
        m.bindTooltip(`<div style="color:#0f172a; padding:2px; line-height:1.45;"><strong>${st.name} (${st.elevation} m)</strong><br>Wind: <b>${spd} km/h</b> · Böen: <b>${gust} km/h</b> (${dir}°, ${bftClass})</div>`, { direction: 'top', offset: [0, -10] });
        m.on('click', () => inspectMapPoint(st.lat, st.lon));
      });
      markDomMarkersFresh('wind');
    }
  } else if (overlay === 'lightning') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'lightning', canvasOpts);
    if (modeChip) { modeChip.innerText = isLiveNow ? '⚡ Live-Blitze' : '⚡ Konvektion'; modeChip.style.background = 'rgba(239, 68, 68, 0.25)'; modeChip.style.borderColor = '#ef4444'; }
    if (timeDisplay) timeDisplay.innerText = fullDateTimeText;

    if (!shouldThrottleDomMarkers('lightning')) {
      state.map.weatherLayerGroup.clearLayers();
      if (!frame || isLiveNow || frame.type === 'past') {
        const storm = MicroEngine.computeLightningActivity(state.currentLocation.lat, state.currentLocation.lon, state.weatherData);
        L.circle([state.currentLocation.lat, state.currentLocation.lon], {
          radius: 14000, color: '#ff453a', fillColor: '#ff453a', fillOpacity: 0.08, weight: 1.5, dashArray: '4, 4'
        }).addTo(state.map.weatherLayerGroup);
        storm.strikes.forEach(s => {
          let color = '#64d2ff';
          if (s.ageMinutes < 5) color = '#ff3b30';
          else if (s.ageMinutes < 15) color = '#ff9500';
          else if (s.ageMinutes < 30) color = '#ffd166';
          const m = L.marker([s.lat, s.lon], {
            icon: L.divIcon({
              className: 'custom-lightning-icon',
              html: `<div class="lightning-marker" style="background:${color}; box-shadow:0 0 14px ${color};">⚡</div>`,
              iconAnchor: [12, 12]
            })
          }).addTo(state.map.weatherLayerGroup);
          m.bindPopup(`<div style="font-family:sans-serif; color:#0f172a; padding:4px;"><strong style="color:${color}; font-size:13px;">⚡ Blitzentladung</strong><br><b>Typ:</b> ${s.type}<br><b>Stromstärke:</b> ${s.intensityKa} kA<br><b>Alter:</b> vor ${s.ageMinutes} Min.<br><b>Distanz:</b> ${s.distKm} km</div>`);
        });
      } else {
        stations.forEach(st => {
          const cape = st.cape || 0;
          const isThunderstorm = (st.weatherCode >= 95 && st.weatherCode <= 99) || (cape >= 500 && st.precip >= 0.8) || (st.precip >= 3.0 && st.temperature >= 15);
          if (isThunderstorm) {
            const m = L.marker([st.lat, st.lon], {
              icon: L.divIcon({
                className: 'custom-lightning-icon',
                html: `<div class="lightning-marker" style="background:#ef4444; box-shadow:0 0 16px #ff3b30;">⚡</div>`,
                iconAnchor: [12, 12]
              })
            }).addTo(state.map.weatherLayerGroup);
            m.bindTooltip(`<div style="color:#0f172a; padding:2px; line-height:1.45;">⚠️ <strong style="color:#b91c1c;">${st.name} (${relStr})</strong><br>Gewitterrisiko · CAPE: <b>${cape} J/kg</b> · Regen: <b>${st.precip} mm/h</b></div>`, { direction: 'top', offset: [0, -10] });
          }
        });
      }
      markDomMarkersFresh('lightning');
    }
  } else if (overlay === 'clouds') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'clouds', canvasOpts);
    if (modeChip) { modeChip.innerText = isLiveNow ? '☁️ Live-Bewölkung' : `☁️ ${relStr} Wolken`; modeChip.style.background = 'rgba(148, 163, 184, 0.25)'; modeChip.style.borderColor = '#cbd5e1'; }
    if (timeDisplay) timeDisplay.innerText = fullDateTimeText;

    if (!shouldThrottleDomMarkers('clouds')) {
      state.map.weatherLayerGroup.clearLayers();
      stations.forEach(st => {
        const c = st.cloudCover !== undefined ? st.cloudCover : 50;
        const icon = c >= 80 ? '☁️' : (c >= 50 ? '⛅' : (c >= 20 ? '🌤️' : '☀️'));
        const desc = c >= 80 ? 'Bedeckt' : (c >= 50 ? 'Wolkig' : (c >= 20 ? 'Heiter' : 'Sonnig'));
        const m = L.marker([st.lat, st.lon], {
          icon: L.divIcon({
            className: 'custom-weather-icon',
            html: `<div class="station-mini-chip cloud-chip"><span>${icon}</span><span class="smc-name">${st.name}</span><span class="smc-val">${c}%</span></div>`,
            iconAnchor: [38, 12]
          })
        }).addTo(state.map.weatherLayerGroup);
        m.bindTooltip(`<div style="color:#0f172a; padding:2px;"><strong>${st.name} (${st.elevation} m)</strong><br>${desc} (<b>${c}%</b> Bewölkung)</div>`, { direction: 'top', offset: [0, -10] });
        m.on('click', () => inspectMapPoint(st.lat, st.lon));
      });
      markDomMarkersFresh('clouds');
    }
  } else if (overlay === 'temp') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'temp', canvasOpts);
    if (modeChip) { modeChip.innerText = isLiveNow ? '🌡️ Live-Temperatur' : `🌡️ ${relStr} Temperatur`; modeChip.style.background = 'rgba(234, 179, 8, 0.25)'; modeChip.style.borderColor = '#eab308'; }
    if (timeDisplay) timeDisplay.innerText = fullDateTimeText;

    if (!shouldThrottleDomMarkers('temp')) {
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
        const m = L.marker([st.lat, st.lon], {
          icon: L.divIcon({
            className: 'custom-weather-icon',
            html: `<div class="station-mini-chip temp-chip" style="border-color:${color};"><span>${isFrost ? '❄️' : '🌡️'}</span><span class="smc-name">${st.name}</span><span class="smc-val" style="color:${color}; font-weight:800;">${tVal.toFixed(1)}°C</span></div>`,
            iconAnchor: [42, 12]
          })
        }).addTo(state.map.weatherLayerGroup);
        m.bindTooltip(`<div style="color:#0f172a; padding:2px;"><strong>${st.name} (${st.elevation} m)</strong><br>Temperatur: <b>${tVal.toFixed(1)}°C</b> · ${isFrost ? '❄️ Frost' : '💧 Plusgrade'}</div>`, { direction: 'top', offset: [0, -10] });
        m.on('click', () => inspectMapPoint(st.lat, st.lon));
      });
      markDomMarkersFresh('temp');
    }
  } else if (overlay === 'pressure') {
    cleanupRadarTiles();
    WeatherCanvasEngine.render(frame, 'pressure', canvasOpts);
    if (modeChip) { modeChip.innerText = isLiveNow ? '⏱️ Bodendruck QNH' : `⏱️ ${relStr} Druck`; modeChip.style.background = 'rgba(99, 102, 241, 0.25)'; modeChip.style.borderColor = '#818cf8'; }
    if (timeDisplay) timeDisplay.innerText = fullDateTimeText;

    if (!shouldThrottleDomMarkers('pressure')) {
      state.map.weatherLayerGroup.clearLayers();
      stations.forEach(st => {
        const p = (st.pressureMsl !== undefined && st.pressureMsl !== null) ? Number(st.pressureMsl) : ((st.weather && st.weather.pressure_msl != null) ? Number(st.weather.pressure_msl) : 1013.2);
        let color = '#38bdf8', tag = 'Normal';
        if (p >= 1022) { color = '#3b82f6'; tag = '🔵 Hoch H'; }
        else if (p <= 1008) { color = '#ef4444'; tag = '🔴 Tief T'; }
        const m = L.marker([st.lat, st.lon], {
          icon: L.divIcon({
            className: 'custom-weather-icon',
            html: `<div class="station-mini-chip pressure-chip" style="border-color:${color};"><span>⏲️</span><span class="smc-name">${st.name}</span><span class="smc-val" style="color:${color}; font-weight:800;">${Math.round(p)} <small>hPa</small></span></div>`,
            iconAnchor: [44, 12]
          })
        }).addTo(state.map.weatherLayerGroup);
        m.bindTooltip(`<div style="color:#0f172a; padding:2px;"><strong>${st.name}</strong>: <b>${p.toFixed(1)} hPa QNH</b> (${tag})</div>`, { direction: 'top', offset: [0, -10] });
        m.on('click', () => inspectMapPoint(st.lat, st.lon));
      });
      markDomMarkersFresh('pressure');
    }
  }

  // Zuletzt Punkt-Wetter-Karte aktualisieren (profitiert vom bereits warmen _lastPreparedCtx -> 0 Doppelarbeit)
  updatePointWeatherCard(frame);
}

export function startWindCanvas() {
  const spec = getActiveInterpolatedRadarSpec();
  const currentFrame = spec
    ? spec.frame
    : ((state.map.unifiedRadarFrames && state.map.unifiedRadarFrames.length)
        ? state.map.unifiedRadarFrames[state.map.radarIndex || 0]
        : null);
  WeatherCanvasEngine.render(currentFrame, 'wind', spec ? {
    rvFrameA: spec.frameA, rvFrameB: spec.frameB, morphAlpha: spec.morphAlpha, stationsPreInterpolated: spec.morphAlpha > 0
  } : {});
}

export function stopWindCanvas() {
  WeatherCanvasEngine.stopAnimation();
}

export function resumeWindCanvasIfActive() {
  if (state.activeTab === 'tab-map' && state.map?.activeOverlay === 'wind' && !(typeof document !== 'undefined' && document.hidden)) {
    updateWeatherOverlay();
  }
}

export function updateMapLocation() {
  if (!state.map.instance) return;
  const loc = state.currentLocation;
  const frames = state.map?.unifiedRadarFrames;
  if (Array.isArray(frames)) {
    for (let i = 0; i < frames.length; i++) if (frames[i]) delete frames[i]._cachedSummary;
  }
  clearInspectedMapPoint();
  state.map.instance.panTo([loc.lat, loc.lon], { animate: true });
  if (state.map.marker) {
    state.map.marker.setLatLng([loc.lat, loc.lon]);
    state.map.marker.setIcon(createUserLocationBeaconIcon(loc));
  }
  updateWeatherOverlay();
  updatePointWeatherCard();
}

export {
  formatCleanLocationName,
  createUserLocationBeaconIcon,
  syncMeteoSwissHudControls,
  getWindCardinalName,
  getLocationWeatherForFrame,
  updateWindCompassWidget,
  updatePointWeatherCard,
  updateMapLayerPill,
  updateMapAttribution,
  getSynthesizedBaselineStations,
  loadRegionalStationWeather,
  updateMapLegend,
  inspectMapPoint,
  clearInspectedMapPoint,
  promoteInspectedPointToPrimary,
  updateThunderstormAlertBox,
  syncSportsRouteOverlay,
  interpolateStationsForMinute,
  realignRadarTimelineTimestamps,
  ensureFreshMapRadar,
  loadUnifiedRadarEngine,
  preloadRadarFrames,
  startPredictive3RingPreload,
  renderFutureRadarCells,
  interpolateStationLists,
  getInterpolatedRadarSpec,
  getActiveInterpolatedRadarSpec,
  updateMeteoSwissTimelineUI,
  positionMeteoSwissAxisTicks,
  showUnifiedRadarFrame,
  getFrameWeatherSummary,
  updateScrubberHud,
  showScrubberHud,
  hideScrubberHud,
  setupUnifiedRadarControls,
  findFrameIndexForTarget,
  findFrameIndexForHourOffset,
  updateJumpButtonsActive,
  startRadarAnimation,
  stopRadarAnimation,
  toggleRadarPlay,
  stepRadar,
  WeatherCanvasEngine,
  RainViewerRadarStore,
  ViewportDemStore,
  ViewportForecastGridStore
};

if (typeof window !== 'undefined') {
  window.WeatherCanvasEngine = WeatherCanvasEngine;
  window.RainViewerRadarStore = RainViewerRadarStore;
  window.ViewportDemStore = ViewportDemStore;
  window.ViewportForecastGridStore = ViewportForecastGridStore;
  window.showUnifiedRadarFrame = showUnifiedRadarFrame;
  window.getInterpolatedRadarSpec = getInterpolatedRadarSpec;
  window.setMapBaseLayer = setMapBaseLayer;
  window.setMapOverlay = setMapOverlay;
  window.updateMapLegend = updateMapLegend;
  window.isMapCurrentlyDark = isMapCurrentlyDark;
  window.updateMapSolarTransition = updateMapSolarTransition;
  window.ensureFreshMapRadar = ensureFreshMapRadar;
  window.realignRadarTimelineTimestamps = realignRadarTimelineTimestamps;
  window.inspectMapPoint = inspectMapPoint;
  window.clearInspectedMapPoint = clearInspectedMapPoint;
}
