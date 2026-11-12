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
import { getLocalDateKey } from './httpClient.js';

// Domain Feature Modules (Task 1a)
import { setupLocationTypeToggle, updateLocationHeaderUI, updateAlpineSkyIllumination, renderOverviewTab, setupExpertModeToggle, renderMultiModelComparison, renderAirQualityAndUV, setupMeteogramControls, openDayDetailModal, convertTemp, setupHourlyGranularityToggle, getTodayDailyIndex } from './features/overview.js';
import { setupWallSelector, setupAltitudeSlider, setupMountainControls, setupMountain3DControls, setupWebcamModal, renderAdaptiveTab2 } from './features/mountain.js';
import { initLeafletMap, stopRadarAnimation, updateMapLocation, updatePointWeatherCard, updateWeatherOverlay, enterMobileMapFullscreen, exitMobileMapFullscreen } from './features/map.js';
import { setupGPXInspector, setupSportsTab, initSportsTour } from './features/sports.js';
import { setupSearch, setupSpotlightAndQuickGps, updateNavigationWarningBadges, selectExactLocation, initSearchHandlers, triggerExactGps } from './features/search.js';
import { setupFavorites, updateFavStarUI, renderFavoritesTab, initFavoritesHandlers } from './features/favorites.js';
import { setupSourcesQuickNav, updateGeoRoutingNetworks } from './features/networks.js';
import { ActualEngine } from './core/actualEngine.js';
import { renderVerificationDashboard, setupVerificationUI, initVerificationHandlers } from './features/verificationUI.js';
import { initBentoSheets } from './features/bentoSheets.js';
import { initPullToRefresh } from './features/pullToRefresh.js?v=2.9.2';
import { GoogleSheetsSync } from './core/googleSheetsSync.js';
import { AlpineStorage } from './storage.js';

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

  const appLayoutEl = document.querySelector('.app-layout');
  if (appLayoutEl) appLayoutEl.scrollTop = 0;
  if (window.scrollY > 0) window.scrollTo(0, 0);

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
        updateWeatherOverlay();
      }
    }, 80);
    setTimeout(() => {
      if (state.map.instance) {
        state.map.instance.invalidateSize();
        updateWeatherOverlay();
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
      checkFreshnessAndRollover('visibility');
    }
  });

  window.addEventListener('pageshow', () => {
    checkFreshnessAndRollover('pageshow');
  });

  window.addEventListener('focus', () => {
    checkFreshnessAndRollover('focus');
  });

  window.addEventListener('online', () => {
    checkFreshnessAndRollover('online');
  });

  setInterval(() => {
    if (!document.hidden) {
      checkFreshnessAndRollover('interval');
    }
  }, 60000);
}

// =============================================================================
// AUTOMATISCHER TAGESWECHSEL- & STALE-CACHE-CHECK (PWA RESUME / MITTERNACHT)
// =============================================================================
let lastAutoFreshnessCheckAt = 0;
let lastAutoRolloverAttemptAt = 0;

export function checkFreshnessAndRollover(reason = 'resume') {
  if (!state.currentLocation) return;

  const now = Date.now();
  const todayKey = getLocalDateKey(now);
  const dailyFirstKey = state.weatherData?.daily?.time?.[0]
    ? String(state.weatherData.daily.time[0]).slice(0, 10)
    : '';
  const loadedDayKey = state.lastWeatherDayKey || '';

  const isDateRolledOver = Boolean(
    (dailyFirstKey && dailyFirstKey < todayKey) ||
    (loadedDayKey && loadedDayKey !== todayKey)
  );

  // Im Stale-/Tageswechsel-Fall Ansicht sofort auf das reale heutige Datum neu rendern
  if (isDateRolledOver && state.weatherData) {
    try {
      renderOverviewTab();
      renderAdaptiveTab2();
      renderFavoritesTab();
      updateNavigationWarningBadges();
    } catch (_) {}
  }

  // Bei Tageswechsel sofort ein Live-Refresh anstoßen (ohne 30-Min-Cache; bei Open-Meteo 429 greift BrightSky/MET Fallback)
  // solange das geladene Modell noch von gestern/früher stammt (4s Entprellung gegen Event-Stürme)
  if (isDateRolledOver) {
    if ((now - lastAutoRolloverAttemptAt) >= 4000) {
      lastAutoRolloverAttemptAt = now;
      lastAutoFreshnessCheckAt = now;
      return loadLocation(state.currentLocation, { forceRefresh: true });
    }
    return;
  }

  // Schutz vor Doppelauslösung bei gleichzeitigen Focus-/Visibility-Events
  if ((now - lastAutoFreshnessCheckAt) < 10000 && reason !== 'online') return;

  const ageMs = state.lastWeatherLoadedAt ? (now - state.lastWeatherLoadedAt) : Infinity;
  const staleThresholdMs = reason === 'interval' ? (30 * 60 * 1000) : (reason === 'online' ? (2 * 60 * 1000) : (20 * 60 * 1000));

  if (state.lastWeatherLoadedAt && ageMs >= staleThresholdMs) {
    lastAutoFreshnessCheckAt = now;
    return loadLocation(state.currentLocation, { forceRefresh: reason === 'online' });
  }
}

// =============================================================================
// CENTRAL LOCATION LOADER & WEATHER REFRESH (STATE-02: AbortController-Kaskade)
// =============================================================================
let activeLocationAbortController = null;
let activeLocationSequence = 0;

export async function loadLocation(loc, options = {}) {
  const validLoc = validateLocation(loc);
  const forceRefresh = Boolean(options?.forceRefresh);
  state.currentLocation = validLoc;
  updateLocationHeaderUI();
  updateGeoRoutingNetworks();
  renderAdaptiveTab2();
  updateMapLocation();

  // Bricht laufende Vorhersage-Anfragen des vorherigen Standorts zuverlässig ab
  if (activeLocationAbortController) {
    try { activeLocationAbortController.abort(); } catch (_) {}
  }
  activeLocationAbortController = new AbortController();
  const currentSeq = ++activeLocationSequence;

  try {
    const customTilt = state.activeAspect.isAuto ? null : state.activeAspect.tilt;
    const customAzimuth = state.activeAspect.isAuto ? null : state.activeAspect.azimuth;
    const reqOpts = { signal: activeLocationAbortController.signal, forceRefresh };

    const microResult = await MicroEngine.getMicroScaleWeather(
      validLoc.lat,
      validLoc.lon,
      validLoc.elevation,
      validLoc.isMountain,
      customTilt,
      customAzimuth,
      validLoc.country,
      reqOpts
    );

    if (currentSeq !== activeLocationSequence) return { ok: false, aborted: true };

    const [multiModel, airQuality] = await Promise.all([
      MicroEngine.fetchMultiModelComparison(validLoc.lat, validLoc.lon, validLoc.elevation, validLoc.isMountain, reqOpts),
      MicroEngine.fetchAirQualityAndUV(validLoc.lat, validLoc.lon, validLoc.elevation, reqOpts)
    ]);

    // Ignoriere veraltete Antwort falls Nutzer zwischenzeitlich einen anderen Ort gewählt hat
    if (currentSeq !== activeLocationSequence) return { ok: false, aborted: true };

    const returnedDaily = microResult?.weatherRaw?.daily;
    const todayCheck = getTodayDailyIndex(returnedDaily);
    const firstDailyKey = returnedDaily?.time?.[0] ? String(returnedDaily.time[0]).slice(0, 10) : '';
    const isStaleDayPayload = Boolean(
      todayCheck.isAllPast ||
      (firstDailyKey && firstDailyKey < todayCheck.todayKey && !todayCheck.isExactToday)
    );

    if (
      isStaleDayPayload &&
      !forceRefresh &&
      !options?._retriedFresh &&
      typeof navigator !== 'undefined' &&
      navigator.onLine !== false
    ) {
      return loadLocation(validLoc, { ...options, forceRefresh: true, _retriedFresh: true });
    }

    state.microData = microResult;
    state.weatherData = microResult.weatherRaw;
    state.multiModel = multiModel || microResult.multiModel;
    state.airQuality = airQuality;
    state.lastWeatherLoadedAt = Date.now();
    state.lastWeatherDayKey = getLocalDateKey(state.lastWeatherLoadedAt);

    // A.C.T.U.A.L. Engine: Verifikation (Soll vs. Ist) & Adaptive Vorhersage-Kalibrierung
    try {
      const verificationResult = ActualEngine.processVerificationAndCalibration({
        lat: validLoc.lat,
        lon: validLoc.lon,
        elevation: validLoc.elevation,
        isMountain: validLoc.isMountain,
        weatherRaw: state.weatherData,
        stationData: microResult.stationData,
        multiModel: state.multiModel,
        modelHistory: microResult.modelHistory,
        radarData: microResult.radarData,
        webcams: MicroEngine.getMountainWebcams(validLoc.name, validLoc.lat, validLoc.lon)
      });
      state.actualVerification = verificationResult;

      // Wenn Bayesianische Modellgewichte berechnet wurden, in multiModel übernehmen
      if (verificationResult?.modelEvaluation?.models && state.multiModel?.weights) {
        const evModels = verificationResult.modelEvaluation.models;
        if (evModels.icon_d2?.weight) state.multiModel.weights.regional = evModels.icon_d2.weight;
        if (evModels.ecmwf?.weight) state.multiModel.weights.ecmwf = evModels.ecmwf.weight;
        if (evModels.gfs?.weight) state.multiModel.weights.gfs = evModels.gfs.weight;
      }
    } catch (e) {
      console.warn('ActualEngine verification failed:', e);
    }

    if (state.multiModel && state.multiModel.weightedConsensus) {
      MicroEngine.applyMultiModelWeightsToWeather(state.weatherData, state.microData, state.multiModel);
    }

    await WeatherTourCache.saveLocationAndWeather(validLoc, state.weatherData, state.microData);

    const heroTime = document.getElementById('hero-update-time');
    if (heroTime) {
      if (todayCheck.isAllPast && firstDailyKey) {
        const lastKey = String(returnedDaily.time[returnedDaily.time.length - 1] || firstDailyKey).slice(0, 10);
        heroTime.innerText = `⚠️ Cache-Stand (${lastKey}) · Zum Aktualisieren ziehen`;
      } else {
        heroTime.innerText = `Aktualisiert: ${new Date(state.lastWeatherLoadedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
      }
    }

    dispatcher.dispatch(ACTIONS.LOCATION_LOADED, validLoc);
    dispatcher.dispatch(ACTIONS.WEATHER_UPDATED, { weatherData: state.weatherData, microData: state.microData, multiModel: state.multiModel, airQuality: state.airQuality });

    renderOverviewTab();
    renderVerificationDashboard();
    renderMultiModelComparison();
    renderAirQualityAndUV();
    renderAdaptiveTab2();
    renderFavoritesTab();
    updateMapLocation();
    updateNavigationWarningBadges();

    return { ok: true, refreshedAt: state.lastWeatherLoadedAt };
  } catch (err) {
    if (err?.name === 'AbortError' || currentSeq !== activeLocationSequence) {
      return { ok: false, aborted: true };
    }
    console.error('Fehler beim Laden des Wetters:', err);
    const isRateLimit = Boolean(err && (err.status === 429 || err.isCircuitOpen));
    const retryWaitLabel = (isRateLimit && err.retryAfterMs > 0)
      ? (err.retryAfterMs >= 60000 ? `${Math.ceil(err.retryAfterMs / 60000)} Min.` : `${Math.ceil(err.retryAfterMs / 1000)} Sek.`)
      : '';
    const locKey = `${validLoc.lat.toFixed(3)}_${validLoc.lon.toFixed(3)}`;
    const cached = await WeatherTourCache.getCachedWeather(locKey);
    if (cached?.weatherData) {
      state.weatherData = cached.weatherData;
      if (cached.microData) state.microData = { ...cached.microData, weatherRaw: cached.weatherData };
      renderOverviewTab();
      renderAdaptiveTab2();
      renderFavoritesTab();
      updateNavigationWarningBadges();
      const heroTime = document.getElementById('hero-update-time');
      const cachedDate = new Date(cached.timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      const tsStr = new Date(cached.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      if (heroTime) heroTime.innerText = isRateLimit ? `API-Cooldown · Cache (${cachedDate} ${tsStr})` : `Offline-Cache (${cachedDate} ${tsStr})`;
      return { ok: false, isRateLimit, retryAfterMs: err?.retryAfterMs || 0, usedCache: true };
    } else {
      const cond = document.getElementById('hero-condition-text');
      if (cond) {
        cond.innerText = isRateLimit
          ? `Open-Meteo Rate-Limit / Cooldown aktiv${retryWaitLabel ? ` (~${retryWaitLabel})` : ''}`
          : 'Verbindungsfehler beim Laden der Daten';
      }
      return { ok: false, isRateLimit, retryAfterMs: err?.retryAfterMs || 0, usedCache: false };
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
  initVerificationHandlers({ onReload: loadLocation });

  setupDispatcherSubscriptions();
  setupTabs();
  setupSearch();
  setupSpotlightAndQuickGps();
  setupWallSelector();
  setupAltitudeSlider();
  setupMountainControls();
  setupFavorites();
  setupVerificationUI();
  setupLocationTypeToggle();
  setupHourlyGranularityToggle();
  setupMeteogramControls();
  setupGPXInspector();
  setupWebcamModal();
  setupSportsTab();
  initLeafletMap();
  setupSourcesQuickNav();
  setupExpertModeToggle();
  initBentoSheets();

  // Pull-Down-to-Refresh: Aktualisiert Wetter & Cloud-Favoriten per Wischgeste auf Dashboard & Stadt-/Bergklima
  initPullToRefresh({
    onRefreshWeather: (targetLoc) => loadLocation(targetLoc || state.currentLocation, { forceRefresh: true }),
    onRefreshSync: () => GoogleSheetsSync.pullAll()
  });

  // VOLLAUTOMATISCHER SYNC: Bei App-Start Favoriten jedes Mal kurz mit Google Sheets abgleichen
  if (GoogleSheetsSync.isConnected()) {
    GoogleSheetsSync.pullAll();
  }

  // DEFAULT LOCATION: Beim Öffnen immer aktueller GPS-Standort des Geräts
  const cachedGps = AlpineStorage.safeGetItem('best_weather_last_gps', null);
  if (cachedGps) {
    loadLocation(cachedGps);
  } else {
    loadLocation(state.currentLocation);
  }

  // Live-Standort via GPS ermitteln & synchronisieren
  if ('geolocation' in navigator) {
    triggerExactGps({ isStartup: true });
  }
});
