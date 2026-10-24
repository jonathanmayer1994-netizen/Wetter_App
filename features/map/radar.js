/**
 * BEST WEATHER — Radar Engine Module
 * Unified RainViewer + forecast radar animation, controls and frame management.
 */

import { state } from '../../core/state.js';
import { REGIONAL_STATIONS } from '../../core/constants.js';
import { MicroEngine } from '../../microEngine.js';
import { getSynthesizedBaselineStations } from './stations.js';

export async function loadUnifiedRadarEngine() {
  try {
    const rvPromise = fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(res => res.json())
      .catch(e => {
        console.warn('RainViewer API nicht erreichbar:', e);
        return null;
      });

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
      return closest;
    };

    [...pastList, ...nowcastList].forEach(tile => {
      unifiedFrames.push({
        time: tile.time * 1000,
        isPast: tile.time * 1000 < nowMs,
        path: tile.path,
        stations: baseLiveStations
      });
    });

    if (forecastFrames && forecastFrames.length) {
      forecastFrames.forEach(ff => {
        unifiedFrames.push({
          time: ff.time,
          isPast: false,
          path: null,
          stations: ff.stations || baseLiveStations
        });
      });
    }

    state.map.unifiedRadarFrames = unifiedFrames.sort((a, b) => a.time - b.time);
    if (state.map.unifiedRadarFrames.length) {
      showUnifiedRadarFrame(0);
      setupUnifiedRadarControls();
    }
  } catch (err) {
    console.error('Fehler beim Initialisieren der 24h-Radar-Engine:', err);
  }
}

export function preloadRadarFrames(frames, host) {
  if (!frames || !host) return;
  frames.forEach(frame => {
    if (frame.path && !state.map.radarImageBuffer.has(frame.path)) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
      state.map.radarImageBuffer.set(frame.path, img);
    }
  });
}

export function renderFutureRadarCells(frame) {
  if (!state.map.futureRadarLayerGroup || !frame || !frame.stations) return;
  state.map.futureRadarLayerGroup.clearLayers();
  frame.stations.forEach(st => {
    if (st.precipMm > 0.1) {
      const circle = L.circle([st.lat, st.lon], {
        radius: 8000 + st.precipMm * 1200,
        color: st.isSnow ? '#a5f3fc' : '#38bdf8',
        fillColor: st.isSnow ? '#67e8f9' : '#0ea5e9',
        fillOpacity: Math.min(0.55, 0.15 + st.precipMm * 0.08),
        weight: 1
      });
      state.map.futureRadarLayerGroup.addLayer(circle);
    }
  });
}

export function showUnifiedRadarFrame(idx) {
  if (!state.map.unifiedRadarFrames || !state.map.unifiedRadarFrames[idx]) return;
  state.map.radarIndex = idx;
  const frame = state.map.unifiedRadarFrames[idx];

  if (frame.path && state.map.radarHost) {
    const url = `${state.map.radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
    if (state.map.radarTileLayer) {
      state.map.radarTileLayer.setUrl(url);
    } else {
      state.map.radarTileLayer = L.tileLayer(url, {
        opacity: 0.7,
        zIndex: 400
      }).addTo(state.map.instance);
    }
    if (state.map.futureRadarLayerGroup) state.map.futureRadarLayerGroup.clearLayers();
  } else {
    if (state.map.radarTileLayer) {
      state.map.instance.removeLayer(state.map.radarTileLayer);
      state.map.radarTileLayer = null;
    }
    renderFutureRadarCells(frame);
  }

  updateJumpButtonsActive(idx);
  const timeLabel = document.getElementById('radar-time-label');
  if (timeLabel) {
    const d = new Date(frame.time);
    timeLabel.textContent = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
}

export function setupUnifiedRadarControls() {
  const playBtn = document.getElementById('radar-play-btn');
  const prevBtn = document.getElementById('radar-prev-btn');
  const nextBtn = document.getElementById('radar-next-btn');
  const scrubber = document.getElementById('radar-scrubber');

  if (playBtn) playBtn.onclick = toggleRadarPlay;
  if (prevBtn) prevBtn.onclick = () => stepRadar(-1);
  if (nextBtn) nextBtn.onclick = () => stepRadar(1);

  if (scrubber && state.map.unifiedRadarFrames) {
    scrubber.max = state.map.unifiedRadarFrames.length - 1;
    scrubber.oninput = (e) => showUnifiedRadarFrame(parseInt(e.target.value, 10));
  }
}

export function findFrameIndexForTarget(target) {
  if (!state.map.unifiedRadarFrames) return 0;
  let best = 0;
  let minDiff = Infinity;
  state.map.unifiedRadarFrames.forEach((f, i) => {
    const diff = Math.abs(f.time - target);
    if (diff < minDiff) {
      minDiff = diff;
      best = i;
    }
  });
  return best;
}

export function findFrameIndexForHourOffset(offsetHours) {
  const target = Date.now() + offsetHours * 3600000;
  return findFrameIndexForTarget(target);
}

export function updateJumpButtonsActive(idx) {
  document.querySelectorAll('.radar-jump-btn').forEach(btn => {
    const offset = parseInt(btn.dataset.offset || '0', 10);
    const targetIdx = findFrameIndexForHourOffset(offset);
    btn.classList.toggle('active', targetIdx === idx);
  });
}

export function startRadarAnimation() {
  if (state.map.radarPlaying || !state.map.unifiedRadarFrames?.length) return;
  state.map.radarPlaying = true;
  const playBtn = document.getElementById('radar-play-btn');
  if (playBtn) playBtn.textContent = '⏸';

  const step = () => {
    if (!state.map.radarPlaying) return;
    stepRadar(1);
    state.map.radarRafId = requestAnimationFrame(step);
  };
  state.map.radarRafId = requestAnimationFrame(step);
}

export function stopRadarAnimation() {
  state.map.radarPlaying = false;
  if (state.map.radarRafId) {
    cancelAnimationFrame(state.map.radarRafId);
    state.map.radarRafId = null;
  }
  const playBtn = document.getElementById('radar-play-btn');
  if (playBtn) playBtn.textContent = '▶';
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
