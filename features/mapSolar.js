/**
 * BEST WEATHER — Interactive Map Solar Transition Controller (Option D: Hybrid)
 * Orchestrates geographic solar terminator polygon (macro zoom <= 6)
 * and smooth atmospheric day/night lighting shader (local zoom >= 7)
 * aligned with precise sunrise/sunset and solar altitude across the timeline.
 */

import { getSolarPosition, getTerminatorPolygon, getSolarAtmosphereStyle } from '../core/solarEngine.js';
import { state } from '../core/state.js';

let ambientOverlayEl = null;

/**
 * Initializes the solar day/night lighting system on the Leaflet map instance.
 * @param {L.Map} map
 */
export function initMapSolarTransition(map) {
  if (!map) return;

  // 1. Dedicated Leaflet pane for Solar Lighting (Above tiles & hillshade, BELOW weather canvas & city labels)
  let solarPane = map.getPane('solarLightingPane');
  if (!solarPane) {
    solarPane = map.createPane('solarLightingPane');
    solarPane.style.zIndex = 250;
    solarPane.style.pointerEvents = 'none';
  }

  // 2. Geographic Solar Terminator Polygon for Macro/Regional View (Zoom <= 7)
  if (!state.map.solarTerminatorLayer) {
    state.map.solarTerminatorLayer = L.polygon([], {
      pane: 'solarLightingPane',
      stroke: true,
      color: '#f59e0b',
      weight: 1.8,
      opacity: 0,
      fillColor: '#070e22',
      fillOpacity: 0,
      smoothFactor: 1.5,
      className: 'solar-terminator-polygon',
      interactive: false
    }).addTo(map);
  }

  // 3. Viewport Ambient Overlay Div for Local Day/Night Atmosphere (Zoom >= 6)
  if (!ambientOverlayEl) {
    ambientOverlayEl = document.getElementById('map-solar-ambient-overlay');
    if (!ambientOverlayEl) {
      ambientOverlayEl = document.createElement('div');
      ambientOverlayEl.id = 'map-solar-ambient-overlay';
      ambientOverlayEl.className = 'map-solar-ambient-overlay';
      solarPane.appendChild(ambientOverlayEl);
    }
    state.map.solarAmbientOverlay = ambientOverlayEl;
  }

  // Synchronize ambient overlay size and position with map viewport
  const updateAmbientBounds = () => {
    if (!ambientOverlayEl || !map) return;
    try {
      const size = map.getSize();
      ambientOverlayEl.style.width = Math.max(100, size.x || 1000) + 'px';
      ambientOverlayEl.style.height = Math.max(100, size.y || 800) + 'px';
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(ambientOverlayEl, topLeft);
    } catch (e) {
      // Map might not be fully initialized in DOM yet
    }
  };

  map.on('move resize zoom', updateAmbientBounds);
  map.on('zoomend moveend', () => {
    updateMapSolarTransition();
  });
  updateAmbientBounds();

  // 4. Setup Toggle Button in Layer Drawer
  setupSolarToggleButton();

  // Run initial calculation
  updateMapSolarTransition();
}

/**
 * Updates the day/night lighting on the map according to a specific timestamp
 * @param {number} [targetTimeMs] - Milliseconds timestamp (defaults to current timeline frame)
 */
export function updateMapSolarTransition(targetTimeMs) {
  const map = state.map && state.map.instance;
  if (!map) return;

  const isEnabled = state.map.solarTransitionEnabled !== false;
  const mapEl = document.getElementById('interactive-map');

  if (!isEnabled) {
    if (state.map.solarTerminatorLayer) {
      state.map.solarTerminatorLayer.setStyle({ fillOpacity: 0, opacity: 0 });
    }
    if (ambientOverlayEl) {
      ambientOverlayEl.style.opacity = '0';
    }
    if (mapEl) {
      mapEl.style.removeProperty('--solar-dark-brightness');
      mapEl.style.removeProperty('--solar-dark-contrast');
      mapEl.style.removeProperty('--solar-tile-brightness');
      mapEl.style.removeProperty('--solar-tile-contrast');
    }
    const pill = document.getElementById('mscb-solar-pill');
    if (pill) pill.style.display = 'none';
    return;
  }

  // Determine current timeline timestamp (sub-frame interpolated)
  let timeMs = targetTimeMs;
  if (!timeMs) {
    const floatIdx = (state.map && state.map.radarFloatIndex !== undefined) ? state.map.radarFloatIndex : 0;
    const frames = (state.map && state.map.unifiedRadarFrames) ? state.map.unifiedRadarFrames : [];
    if (frames.length > 0) {
      const i0 = Math.max(0, Math.min(frames.length - 1, Math.floor(floatIdx)));
      const i1 = Math.max(0, Math.min(frames.length - 1, Math.ceil(floatIdx)));
      const alpha = floatIdx - i0;
      const t0 = frames[i0]?.timestampMs || Date.now();
      const t1 = frames[i1]?.timestampMs || t0;
      timeMs = t0 + (t1 - t0) * alpha;
    } else {
      timeMs = Date.now();
    }
  }

  // Location and Zoom
  let centerLat = 47.72;
  let centerLon = 10.32;
  try {
    const center = map.getCenter();
    centerLat = center.lat;
    centerLon = center.lng;
  } catch (e) {
    if (state.currentLocation) {
      centerLat = state.currentLocation.lat;
      centerLon = state.currentLocation.lon;
    }
  }

  let zoom = 9;
  try {
    zoom = map.getZoom();
  } catch (e) {
    zoom = 9;
  }

  // Astronomical Solar Calculation
  const solar = getSolarPosition(timeMs, centerLat, centerLon);
  const style = getSolarAtmosphereStyle(solar);

  // Hybrid Zoom Weighting (Option D):
  // Zoom <= 6: Full geographic terminator shadow across continent
  // Zoom >= 8: Full local ambient lighting filter over the valley/city
  // In between: Soft linear blend
  const zoomTermWeight = Math.max(0, Math.min(1, (8 - zoom) / 2));
  const zoomAmbientWeight = Math.max(0, Math.min(1, (zoom - 5) / 2.5));

  // 1. Geographic Solar Terminator Polygon (Macro View)
  if (state.map.solarTerminatorLayer) {
    if (zoomTermWeight > 0.02) {
      const ring = getTerminatorPolygon(timeMs, 4);
      state.map.solarTerminatorLayer.setLatLngs(ring);
      state.map.solarTerminatorLayer.setStyle({
        fillOpacity: 0.60 * zoomTermWeight,
        opacity: 0.70 * zoomTermWeight
      });
    } else {
      state.map.solarTerminatorLayer.setStyle({ fillOpacity: 0, opacity: 0 });
    }
  }

  // 2. Local Ambient Lighting Shader Overlay (Local View)
  if (ambientOverlayEl) {
    const effNightOp = style.nightOpacity * zoomAmbientWeight;
    const effWarmthOp = style.warmthOpacity * zoomAmbientWeight;

    if (effNightOp > 0.005 || effWarmthOp > 0.005) {
      ambientOverlayEl.style.opacity = '1';
      if (effWarmthOp > 0.03) {
        ambientOverlayEl.style.background = `radial-gradient(ellipse at 50% 50%, rgba(245, 140, 40, ${effWarmthOp.toFixed(3)}) 0%, rgba(6, 12, 26, ${effNightOp.toFixed(3)}) 75%)`;
      } else {
        ambientOverlayEl.style.background = `rgba(6, 12, 26, ${effNightOp.toFixed(3)})`;
      }
    } else {
      ambientOverlayEl.style.opacity = '0';
    }
  }

  // 3. Tile-Pane Shaders (CSS Variables on #interactive-map)
  if (mapEl) {
    // osm-dark: At noon lightFactor=1.0 brightens to 1.12, at night darkens to 0.62
    const darkB = 0.62 + (0.50 * solar.lightFactor * zoomAmbientWeight);
    const darkC = 1.14 - (0.09 * solar.lightFactor * zoomAmbientWeight);
    mapEl.style.setProperty('--solar-dark-brightness', darkB.toFixed(3));
    mapEl.style.setProperty('--solar-dark-contrast', darkC.toFixed(3));

    // Standard / Topo / Satellite: At noon 1.0 (natural), at night dim to 0.60 with 1.15 contrast
    const stdB = 1.0 - (0.40 * (1.0 - solar.lightFactor) * zoomAmbientWeight);
    const stdC = 1.0 + (0.15 * (1.0 - solar.lightFactor) * zoomAmbientWeight);
    mapEl.style.setProperty('--solar-tile-brightness', stdB.toFixed(3));
    mapEl.style.setProperty('--solar-tile-contrast', stdC.toFixed(3));
  }

  // 4. Update Astro Pill in Timeline Callout Badge
  const pill = document.getElementById('mscb-solar-pill');
  if (pill) {
    pill.style.display = 'inline-flex';
    pill.innerText = solar.icon;
    pill.title = `${solar.label} (Sonnenstand ${solar.altitude >= 0 ? '+' : ''}${solar.altitude.toFixed(1)}°)`;
    pill.setAttribute('aria-label', `Sonnenstand: ${solar.label}`);
  }
}

/**
 * Configures the Tag/Nacht-Licht toggle button inside the Map Layer Drawer
 */
export function setupSolarToggleButton() {
  const toggleBtn = document.getElementById('map-solar-toggle-btn');
  const toggleText = document.getElementById('map-solar-toggle-text');
  if (!toggleBtn) return;

  const isEnabled = state.map.solarTransitionEnabled !== false;
  toggleBtn.classList.toggle('active', isEnabled);
  if (toggleText) {
    toggleText.innerText = isEnabled ? 'Tag/Nacht-Licht: An' : 'Tag/Nacht-Licht: Aus';
  }

  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    state.map.solarTransitionEnabled = !state.map.solarTransitionEnabled;
    const nowActive = state.map.solarTransitionEnabled;
    try {
      localStorage.setItem('best_weather_solar_transition', String(nowActive));
    } catch (err) {}

    toggleBtn.classList.toggle('active', nowActive);
    if (toggleText) {
      toggleText.innerText = nowActive ? 'Tag/Nacht-Licht: An' : 'Tag/Nacht-Licht: Aus';
    }

    updateMapSolarTransition();
  };
}

