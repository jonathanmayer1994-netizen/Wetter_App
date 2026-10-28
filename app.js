/**
 * BEST WEATHER — Ultra-High Precision Alpine Weather Platform
 * Modular Enterprise Orchestrator (< 200 lines, Domain-Driven Architecture)
 */

import { state } from './core/state.js';
import { dispatcher, ACTIONS } from './core/dispatcher.js';
import { MicroEngine } from './microEngine.js';
import { BackgroundCanvasEngine } from './core/backgroundCanvas.js';
import { WeatherTourCache } from './core/weatherTourCache.js';

import { validateLocation } from './core/contracts.js';

// Domain Feature Modules (Task 1a)
import { setupLocationTypeToggle, updateLocationHeaderUI, updateAlpineSkyIllumination, renderOverviewTab, setupExpertModeToggle, renderMultiModelComparison, renderAirQualityAndUV, setupMeteogramControls, openDayDetailModal, convertTemp, setupHourlyGranularityToggle } from './features/overview.js';
import { setupWallSelector, setupAltitudeSlider, setupMountainControls, setupMountain3DControls, setupWebcamModal, renderAdaptiveTab2 } from './features/mountain.js';
import { initLeafletMap, stopRadarAnimation, updateMapLocation, updatePointWeatherCard, enterMobileMapFullscreen, exitMobileMapFullscreen } from './features/map.js';
import { setupGPXInspector, setupSportsTab, initSportsTour } from './features/sports.js';
import { setupSearch, setupSpotlightAndQuickGps, updateNavigationWarningBadges, selectExactLocation, initSearchHandlers } from './features/search.js';
import { setupFavorites, updateFavStarUI, renderFavoritesTab, initFavoritesHandlers } from './features/favorites.js';
import { setupSourcesQuickNav, updateGeoRoutingNetworks } from './features/networks.js';

// Central Dispatcher Event Bus Subscriptions
export function setupDispatcherSubscriptions() {
  dispatcher.on(ACTIONS.LOCATION_SELECT, (targetLoc) => {
    if (targetLoc) loadLocation(targetLoc);
  });
  dispatcher.on(ACTIONS.TAB_SWITCH, (targetTab) => {
    if (targetTab) switchTab(targetTab);
  });
}

// =============================================================================
// TEMPLATE-BASED ON-DEMAND MOUNTING / VIRTUAL HYDRATION (Task 2a)
// =============================================================================
export function hydrateTab(tabId) {
  const pane = document.getElementById(tabId);
  if (!pane || pane.dataset.hydrated === 'true') return;
  const tpl = pane.querySelector('template');
  if (tpl) {
    pane.replaceChildren(tpl.content.cloneNode(true));
    pane.dataset.hydrated = 'true';
    if (tabId === 'tab-networks') {
      setupSourcesQuickNav();
      updateGeoRoutingNetworks();
    }
  }
}

// =============================================================================
// TAB CONTROLLER & PAGE VISIBILITY
// =============================================================================
export function switchTab(tabId) {
  if (state.activeTab && state.activeTab !== 'tab-map') {
    state.previousTab = state.activeTab;
  }
  state.activeTab = tabId;
  document.querySelectorAll('.tab-btn, .mbn-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === tabId));

  // On-Demand Virtual Hydration (Task 2a)
  hydrateTab(tabId);

  if (tabId !== 'tab-map') {
    if (state.map?.radarPlaying) stopRadarAnimation();
    exitMobileMapFullscreen();
  }

  if (tabId === 'tab-sports') {
    if (!state.sports.initialized) {
      initSportsTour();
    }
    setTimeout(() => {
      if (state.sports.map) {
        state.sports.map.invalidateSize();
        if (state.sports.routeLine) {
          try {
            state.sports.map.fitBounds(state.sports.routeLine.getBounds(), { padding: [35, 35] });
          } catch (_) {}
        }
      }
    }, 150);
  }

  if (tabId === 'tab-map') {
    const isMobile = window.innerWidth <= 768 || window.matchMedia('(max-width: 768px)').matches;
    if (isMobile) {
      enterMobileMapFullscreen();
    }
    setTimeout(() => {
      if (state.map.instance) {
        state.map.instance.invalidateSize();
        if (state.currentLocation) state.map.instance.panTo([state.currentLocation.lat, state.currentLocation.lon], { animate: false });
      }
    }, 80);
    setTimeout(() => {
      if (state.map.instance) {
        state.map.instance.invalidateSize();
      }
    }, 250);
  }
}

export function setupTabs() {
  document.querySelectorAll('.tab-btn, .mbn-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (tabId === 'tab-map' && btn.classList.contains('mbn-btn')) {
        enterMobileMapFullscreen();
      }
      switchTab(tabId);
    });
  });

  window.addEventListener('resize', () => {
    if (state.activeTab === 'tab-map') {
      const isMobile = window.innerWidth <= 768;
      if (isMobile && !document.body.classList.contains('mobile-map-fullscreen-active')) {
        enterMobileMapFullscreen();
      } else if (!isMobile && document.body.classList.contains('mobile-map-fullscreen-active')) {
        exitMobileMapFullscreen();
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.canvasEngine) state.canvasEngine.pause();
      if (state.map?.radarPlaying) stopRadarAnimation();
    } else {
      if (state.canvasEngine) state.canvasEngine.resume();
    }
  });
}

// =============================================================================
// CENTRAL LOCATION LOADER & WEATHER REFRESH
// =============================================================================
export async function loadLocation(loc) {
  const validLoc = validateLocation(loc);
  state.currentLocation = validLoc;
  updateLocationHeaderUI();
  updateGeoRoutingNetworks();
  renderAdaptiveTab2();
  updateMapLocation();

  try {
    const customTilt = state.activeAspect.isAuto ? null : state.activeAspect.tilt;
    const customAzimuth = state.activeAspect.isAuto ? null : state.activeAspect.azimuth;

    const [microResult, multiModel, airQuality] = await Promise.all([
      MicroEngine.getMicroScaleWeather(validLoc.lat, validLoc.lon, validLoc.elevation, validLoc.isMountain, customTilt, customAzimuth, validLoc.country),
      MicroEngine.fetchMultiModelComparison(validLoc.lat, validLoc.lon, validLoc.elevation, validLoc.isMountain),
      MicroEngine.fetchAirQualityAndUV(validLoc.lat, validLoc.lon, validLoc.elevation)
    ]);

    state.microData = microResult;
    state.weatherData = microResult.weatherRaw;
    state.multiModel = multiModel || microResult.multiModel;
    state.airQuality = airQuality;

    if (state.multiModel && state.multiModel.weightedConsensus) {
      MicroEngine.applyMultiModelWeightsToWeather(state.weatherData, state.microData, state.multiModel);
    }

    await WeatherTourCache.saveLocationAndWeather(validLoc, state.weatherData, state.microData);

    dispatcher.dispatch(ACTIONS.LOCATION_LOADED, validLoc);
    dispatcher.dispatch(ACTIONS.WEATHER_UPDATED, { weatherData: state.weatherData, microData: state.microData, multiModel: state.multiModel, airQuality: state.airQuality });

    renderOverviewTab();
    renderMultiModelComparison();
    renderAirQualityAndUV();
    renderAdaptiveTab2();
    renderFavoritesTab();
    updateMapLocation();
    updateNavigationWarningBadges();
  } catch (err) {
    console.error('Fehler beim Laden des Wetters:', err);
    const cached = await WeatherTourCache.getCachedWeather();
    if (cached?.weatherData) {
      state.weatherData = cached.weatherData;
      if (cached.microData) state.microData = { ...cached.microData, weatherRaw: cached.weatherData };
      renderOverviewTab();
      renderAdaptiveTab2();
      renderFavoritesTab();
      updateNavigationWarningBadges();
      const heroTime = document.getElementById('hero-update-time');
      if (heroTime) heroTime.innerText = `Offline-Modus (${new Date(cached.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})`;
    } else {
      const cond = document.getElementById('hero-condition-text');
      if (cond) cond.innerText = 'Verbindungsfehler beim Laden der Daten';
    }
  }
}

// Preset Mountain Loader Helper
window.loadNamedMountain = (name) => {
  const presets = {
    'zugspitze': { name: 'Zugspitze', lat: 47.4212, lon: 10.9864, elevation: 2962, country: 'Deutschland', isMountain: true },
    'matterhorn': { name: 'Matterhorn', lat: 45.9764, lon: 7.6586, elevation: 4478, country: 'Schweiz', isMountain: true },
    'mont blanc': { name: 'Mont Blanc', lat: 45.8326, lon: 6.8652, elevation: 4808, country: 'Frankreich', isMountain: true },
    'großglockner': { name: 'Großglockner', lat: 47.0742, lon: 12.6947, elevation: 3798, country: 'Österreich', isMountain: true },
    'grossglockner': { name: 'Großglockner', lat: 47.0742, lon: 12.6947, elevation: 3798, country: 'Österreich', isMountain: true },
    'nebelhorn': { name: 'Nebelhorn', lat: 47.4219, lon: 10.3444, elevation: 2224, country: 'Deutschland', isMountain: true },
    'gruenten': { name: 'Grünten', lat: 47.5458, lon: 10.3168, elevation: 1738, country: 'Deutschland', isMountain: true }
  };
  const key = (name || '').toLowerCase().trim();
  const target = presets[key] || (state.favorites && state.favorites.find(f => f.name.toLowerCase().includes(key)));
  if (target) {
    selectExactLocation(target);
    if (state.activeTab === 'tab-mountain') switchTab('tab-mountain');
  }
};

// Global Bindings for Tests & Cross-Domain Callbacks
window.state = state;
window.switchTab = switchTab;
window.loadLocation = loadLocation;
window.selectExactLocation = selectExactLocation;
window.renderOverviewTab = renderOverviewTab;
window.renderAdaptiveTab2 = renderAdaptiveTab2;
window.drawMountain3DCanvas = () => {};
window.openDayDetailModal = openDayDetailModal;
window.convertTemp = convertTemp;
window.updatePointWeatherCard = updatePointWeatherCard;

// =============================================================================
// MAIN INITIALIZATION
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  state.canvasEngine = new BackgroundCanvasEngine('weather-canvas');
  initSearchHandlers({ onLoadLocation: loadLocation, onRenderOverview: renderOverviewTab, onRenderAdaptiveTab2: renderAdaptiveTab2 });
  initFavoritesHandlers({ onSelectLocation: selectExactLocation, onSwitchTab: switchTab });

  setupDispatcherSubscriptions();
  setupTabs();
  setupSearch();
  setupSpotlightAndQuickGps();
  setupWallSelector();
  setupAltitudeSlider();
  setupMountainControls();
  setupFavorites();
  setupLocationTypeToggle();
  setupHourlyGranularityToggle();
  setupMeteogramControls();
  setupGPXInspector();
  setupWebcamModal();
  setupSportsTab();
  initLeafletMap();
  setupSourcesQuickNav();
  setupExpertModeToggle();

  loadLocation(state.currentLocation);
});
