/**
 * BEST WEATHER — High-Performance Weather Canvas Engine (v2.0)
 * - Zero-GC Persistent TypedArray Buffer Pool
 * - O(1) Bilinear Wind Vector Field (36x28) + Off-Main-Thread Worker Acceleration
 * - Reine Web-Mercator-Entkopplung (kein DOM/Leaflet containerPointToLatLng in 2px-/Partikel-Loops)
 * - DEM-korrigiertes Temperaturfeld + echte Marching-Squares-Polylines (0°C-Frostgrenze & Isobaren)
 * - Dynamische Inversions-Obergrenze, rauschfreie Physik-Abfrage (sampleAtLatLon) & CAPE-Gewitterfeld
 */

import { state } from '../../core/state.js';
import { MicroEngine } from '../../microEngine.js';
import { isMapCurrentlyDark } from '../mapSolar.js';
import {
  createMercatorViewport,
  viewportPxToLatLon,
  latLonToViewportPx,
  extractIsobarContours
} from './mapMercator.js';
import {
  RainViewerRadarStore,
  ViewportDemStore,
  ViewportForecastGridStore
} from './mapStores.js';

let _baselineStationsFn = () => [];
export function setWeatherCanvasHelpers({ getBaselineStations } = {}) {
  if (typeof getBaselineStations === 'function') _baselineStationsFn = getBaselineStations;
}

export const WeatherCanvasEngine = {
  animId: null,
  activeOverlay: 'precip',
  currentFrame: null,
  particles: [],
  maxParticles: 420,
  offscreenCanvas: null,
  offscreenCtx: null,

  // Persistent Zero-GC TypedArray Buffer Pool
  _pool: {
    sCols: 0,
    sRows: 0,
    sTotal: 0,
    cCols: 0,
    cRows: 0,
    cTotal: 0,
    colLon: null,
    rowLat: null,
    rawRate: null,
    rawSnow: null,
    rawStratus: null,
    workRate: null,
    workSnow: null,
    tmpRate: null,
    tmpSnow: null,
    sRate: null,
    sSnow: null,
    rvColNxA: null,
    rvRowNyA: null,
    rvColNxB: null,
    rvRowNyB: null,
    coarseNwpRate: null,
    coarseTwMsl: null,
    coarseFreeze: null,
    coarseCloudLow: null,
    coarseInversionTop: null,
    thermalGrid: null,
    pressureGrid: null
  },

  // O(1) Bilinear Wind Vector Field Cache (36x28)
  _windGrid: {
    cols: 36,
    rows: 28,
    width: 0,
    height: 0,
    vpKey: '',
    frameKey: '',
    u: null,
    v: null,
    spd: null
  },

  // Optionaler WebWorker für Hintergrund-Vorberechnung (mit automatischem Fallback)
  _worker: null,
  _workerFailed: false,
  _workerJobId: 0,

  // Gecachter Kontext des letzten Frame-Renders zur Vermeidung doppelter Prepare-Arbeit in updatePointWeatherCard
  _lastPreparedFrameKey: null,
  _lastPreparedCtx: null,

  _initWorker() {
    if (this._worker || this._workerFailed || typeof Worker === 'undefined') return this._worker;
    try {
      this._worker = new Worker(new URL('./mapCanvas.worker.js', import.meta.url), { type: 'module' });
      this._worker.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type === 'windGridResult' && msg.jobId === this._workerJobId && msg.uGrid && msg.vGrid && msg.spdGrid) {
          this._windGrid.cols = msg.cols;
          this._windGrid.rows = msg.rows;
          this._windGrid.u = msg.uGrid;
          this._windGrid.v = msg.vGrid;
          this._windGrid.spd = msg.spdGrid;
        }
      };
      this._worker.onerror = () => {
        this._workerFailed = true;
        try { this._worker.terminate(); } catch (_) {}
        this._worker = null;
      };
    } catch (_) {
      this._workerFailed = true;
      this._worker = null;
    }
    return this._worker;
  },

  _ensureFieldPool(sCols, sRows, cCols, cRows) {
    const p = this._pool;
    const sTotal = sCols * sRows;
    const cTotal = cCols * cRows;

    if (p.sCols !== sCols) {
      p.colLon = new Float64Array(sCols);
      p.rvColNxA = new Float64Array(sCols);
      p.rvColNxB = new Float64Array(sCols);
      p.sCols = sCols;
    }
    if (p.sRows !== sRows) {
      p.rowLat = new Float64Array(sRows);
      p.rvRowNyA = new Float64Array(sRows);
      p.rvRowNyB = new Float64Array(sRows);
      p.sRows = sRows;
    }
    if (p.sTotal < sTotal) {
      p.rawRate = new Float32Array(sTotal);
      p.rawSnow = new Float32Array(sTotal);
      p.rawStratus = new Float32Array(sTotal);
      p.workRate = new Float32Array(sTotal);
      p.workSnow = new Float32Array(sTotal);
      p.tmpRate = new Float32Array(sTotal);
      p.tmpSnow = new Float32Array(sTotal);
      p.sRate = new Float32Array(sTotal);
      p.sSnow = new Float32Array(sTotal);
      p.sTotal = sTotal;
    }
    if (p.cTotal < cTotal) {
      p.coarseNwpRate = new Float32Array(cTotal);
      p.coarseTwMsl = new Float32Array(cTotal);
      p.coarseFreeze = new Float32Array(cTotal);
      p.coarseCloudLow = new Float32Array(cTotal);
      p.coarseInversionTop = new Float32Array(cTotal);
      p.cTotal = cTotal;
    }
    p.rawRate.fill(0, 0, sTotal);
    p.rawSnow.fill(-1, 0, sTotal);
    p.rawStratus.fill(0, 0, sTotal);
    return p;
  },

  _getMercatorViewport(width, height) {
    const mapInst = state.map && state.map.instance;
    if (!mapInst || typeof mapInst.getCenter !== 'function') return null;
    const c = mapInst.getCenter();
    const z = mapInst.getZoom();
    return createMercatorViewport(c.lat, c.lng, z, width, height);
  },

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
      let val = st[key];
      if (val === undefined && alt) val = st[alt];
      if (val === undefined && st.weather) {
        val = st.weather[key] !== undefined ? st.weather[key] : (alt ? st.weather[alt] : undefined);
      }
      if (val === undefined || Number.isNaN(val)) continue;

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

  interpolateWindVector(lat, lon, stations) {
    if (!stations || !stations.length) return { u: -12, v: 8, speed: 15, dir: 240 };
    let sumWeight = 0, sumU = 0, sumV = 0, sumSpd = 0;
    const eps = 0.00008;

    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const spd = st.windSpeed !== undefined ? st.windSpeed : (st.weather && st.weather.wind_speed_10m !== undefined ? st.weather.wind_speed_10m : 15);
      const dir = st.windDirection !== undefined ? st.windDirection : (st.weather && st.weather.wind_direction_10m !== undefined ? st.weather.wind_direction_10m : 240);
      const rad = (dir * Math.PI) / 180;
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

  /** Verbindet Stationsliste mit weltweitem 5x5 NWP Viewport-Grid für beliebige Regionen außerhalb DACH. */
  _mergeWithViewportGrid(stations, frame) {
    const mapInst = state.map && state.map.instance;
    if (!mapInst) return stations;
    const b = mapInst.getBounds();
    const targetTs = (frame && frame.timestampMs) || Date.now();
    let sumU = 0, sumV = 0;
    for (let i = 0; i < stations.length; i++) {
      const spd = stations[i].windSpeed ?? 16;
      const rad = ((stations[i].windDirection ?? 240) * Math.PI) / 180;
      sumU += -spd * Math.sin(rad);
      sumV += -spd * Math.cos(rad);
    }
    const avgSpd = stations.length ? Math.hypot(sumU / stations.length, sumV / stations.length) : 16;
    const avgDir = stations.length ? (Math.atan2(-sumU, -sumV) * 180 / Math.PI + 360) % 360 : 240;

    const dense = ViewportForecastGridStore.getDenseStationsForTimestamp(
      targetTs, b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), avgSpd, avgDir
    );
    if (!dense || !dense.length) return stations;
    return stations.concat(dense);
  },

  render(frame, overlay, options = {}) {
    const baseStations = (frame && frame.stations && frame.stations.length > 0)
      ? frame.stations
      : ((state.map.regionalStationsData && state.map.regionalStationsData.length > 0)
          ? state.map.regionalStationsData
          : _baselineStationsFn());

    if (overlay === 'wind' && this.activeOverlay === 'wind' && this.animId && !options.forceRestart) {
      this.currentFrame = frame;
      const mergedWind = this._mergeWithViewportGrid(baseStations, frame);
      this._windStations = mergedWind;
      const cData = this.ensureCanvas();
      if (cData) this._rebuildWindVectorGrid(cData.width, cData.height, mergedWind, frame);
      return;
    }

    this.currentFrame = frame;
    this.activeOverlay = overlay;
    this.stopAnimation();

    const cData = this.ensureCanvas();
    if (!cData || !state.map || !state.map.instance) return;
    const { ctx, width, height } = cData;

    // Globales NWP-Grid nahtlos in ALLE Overlays einmischen
    const stations = (overlay === 'precip' || overlay === 'rainviewer-radar')
      ? baseStations
      : this._mergeWithViewportGrid(baseStations, frame);

    if (overlay === 'temp') {
      this.renderThermalHeatmap(ctx, width, height, stations);
    } else if (overlay === 'wind') {
      this.startWindParticleSimulation(ctx, width, height, stations, frame);
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

  // ===========================================================================
  // 1. TEMPERATURFELD MIT ECHTER DEM-HÖHENKORREKTUR & MARCHING-SQUARES ISOTHERMEN
  // ===========================================================================
  renderThermalHeatmap(ctx, width, height, stations) {
    ctx.clearRect(0, 0, width, height);
    const vp = this._getMercatorViewport(width, height);
    if (!stations.length || !vp) return;

    const step = 18;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;
    const total = cols * rows;
    if (!this._pool.thermalGrid || this._pool.thermalGrid.length < total) {
      this._pool.thermalGrid = new Float32Array(total);
    }
    const gridT = this._pool.thermalGrid;

    // Stationstemperaturen für echte Geländetreue einmalig auf Meereshöhe (MSL, -0.65 °C/100m) reduzieren
    const mslStations = new Array(stations.length);
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      const elev = s.elevation !== undefined ? s.elevation : 520;
      const tVal = s.temperature !== undefined ? s.temperature : (s.weather ? s.weather.temperature_2m : 10);
      mslStations[i] = {
        lat: s.lat,
        lon: s.lon,
        tempMsl: (tVal ?? 10) + (elev / 100) * 0.65
      };
    }

    for (let r = 0; r < rows; r++) {
      const y = r * step;
      const rowOff = r * cols;
      for (let c = 0; c < cols; c++) {
        const x = c * step;
        const { lat, lon } = viewportPxToLatLon(vp, x, y);
        const tMsl = this.interpolateStationMetric(lat, lon, mslStations, 'tempMsl', 1.35);
        const elevDem = ViewportDemStore.getElevation(lat, lon, stations);
        gridT[rowOff + c] = tMsl - (elevDem / 100) * 0.65;
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

    for (let i = 0; i < total; i++) {
      const rgb = this.getThermalRgb(gridT[i]);
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

  /** Echte Marching-Squares Kontur-Polylines statt einzelner Punkte (glatte 0°C-Frostgrenze & Isothermen) */
  drawIsothermsAndFrostLine(ctx, width, height, gridT, cols, rows, step) {
    const isoLevels = [-10, -5, 0, 5, 10, 15, 20, 25];
    const contours = extractIsobarContours(gridT, cols, rows, isoLevels, step, step, 0, 0);
    if (!contours.length) return;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let k = 0; k < contours.length; k++) {
      const { level, polylines } = contours[k];
      const isFrost = (level === 0);
      ctx.lineWidth = isFrost ? 2.6 : 1.15;
      ctx.strokeStyle = isFrost ? '#00f5ff' : 'rgba(255, 255, 255, 0.46)';
      ctx.setLineDash(isFrost ? [8, 5] : [4, 5]);
      ctx.shadowColor = isFrost ? '#00f5ff' : 'transparent';
      ctx.shadowBlur = isFrost ? 9 : 0;

      ctx.beginPath();
      let labelX = -1, labelY = -1;
      for (let p = 0; p < polylines.length; p++) {
        const line = polylines[p];
        if (line.length < 4) continue;
        ctx.moveTo(line[0], line[1]);
        for (let i = 2; i < line.length; i += 2) {
          ctx.lineTo(line[i], line[i + 1]);
          if (labelX < 0 && line[i] > 80 && line[i] < width - 140 && line[i + 1] > 45 && line[i + 1] < height - 70 && line.length >= 10) {
            labelX = line[i];
            labelY = line[i + 1];
          }
        }
      }
      ctx.stroke();

      if (labelX >= 0) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = isFrost ? '#00f5ff' : 'rgba(255, 255, 255, 0.88)';
        ctx.font = isFrost ? 'bold 11px sans-serif' : 'bold 10px monospace';
        ctx.fillText(isFrost ? '❄️ 0°C Frostgrenze' : `${level}°C`, labelX + 5, labelY - 4);
        ctx.restore();
      }
    }

    ctx.restore();
  },

  // ===========================================================================
  // 2. O(1) BILINEARES WIND-VEKTORFELD (36x28) + WORKER-SUPPORT
  // ===========================================================================
  _rebuildWindVectorGrid(width, height, stations, frame = null) {
    const vp = this._getMercatorViewport(width, height);
    if (!vp || !stations || !stations.length) return;

    const cols = 36;
    const rows = 28;
    const wg = this._windGrid;
    const total = cols * rows;
    if (!wg.u || wg.u.length !== total) {
      wg.u = new Float32Array(total);
      wg.v = new Float32Array(total);
      wg.spd = new Float32Array(total);
    }

    const vpKey = `${vp.centerLat.toFixed(4)}_${vp.centerLon.toFixed(4)}_${vp.zoom}_${width}x${height}`;
    const frameKey = frame ? String(frame.timestampMs || frame.minuteOffset || '') : 'live';
    if (wg.vpKey === vpKey && wg.frameKey === frameKey && wg.width === width && wg.height === height) return;

    wg.vpKey = vpKey;
    wg.frameKey = frameKey;
    wg.width = width;
    wg.height = height;

    // Sofort synchron füllen (deterministisch & instant bei Start)
    for (let r = 0; r < rows; r++) {
      const py = (r / (rows - 1)) * height;
      const rowOff = r * cols;
      for (let c = 0; c < cols; c++) {
        const px = (c / (cols - 1)) * width;
        const { lat, lon } = viewportPxToLatLon(vp, px, py);
        const vec = this.interpolateWindVector(lat, lon, stations);
        const idx = rowOff + c;
        wg.u[idx] = vec.u;
        wg.v[idx] = vec.v;
        wg.spd[idx] = vec.speed;
      }
    }

    // Optionaler Worker-Abgleich im Hintergrund
    const worker = this._initWorker();
    if (worker) {
      const compactStations = new Array(stations.length);
      for (let i = 0; i < stations.length; i++) {
        const s = stations[i];
        compactStations[i] = {
          lat: s.lat,
          lon: s.lon,
          windSpeed: s.windSpeed ?? (s.weather ? s.weather.wind_speed_10m : 15) ?? 15,
          windDirection: s.windDirection ?? (s.weather ? s.weather.wind_direction_10m : 240) ?? 240
        };
      }
      worker.postMessage({
        jobId: ++this._workerJobId,
        type: 'windGrid',
        cols,
        rows,
        viewport: { centerLat: vp.centerLat, centerLon: vp.centerLon, zoom: vp.zoom, width, height },
        stations: compactStations
      });
    }
  },

  _sampleWindGrid(px, py, width, height) {
    const wg = this._windGrid;
    const cols = wg.cols;
    const rows = wg.rows;
    const fc = Math.max(0, Math.min(cols - 1.001, (px / width) * (cols - 1)));
    const fr = Math.max(0, Math.min(rows - 1.001, (py / height) * (rows - 1)));
    const c0 = fc | 0;
    const r0 = fr | 0;
    const dc = fc - c0;
    const dr = fr - r0;
    const w00 = (1 - dc) * (1 - dr);
    const w10 = dc * (1 - dr);
    const w01 = (1 - dc) * dr;
    const w11 = dc * dr;
    const k00 = r0 * cols + c0;
    const k10 = k00 + 1;
    const k01 = k00 + cols;
    const k11 = k01 + 1;
    return {
      u: wg.u[k00] * w00 + wg.u[k10] * w10 + wg.u[k01] * w01 + wg.u[k11] * w11,
      v: wg.v[k00] * w00 + wg.v[k10] * w10 + wg.v[k01] * w01 + wg.v[k11] * w11,
      speed: wg.spd[k00] * w00 + wg.spd[k10] * w10 + wg.spd[k01] * w01 + wg.spd[k11] * w11
    };
  },

  startWindParticleSimulation(ctx, width, height, stations, frame = null) {
    if (!stations.length || !state.map.instance) return;
    this._windStations = stations;
    this._rebuildWindVectorGrid(width, height, stations, frame);

    if (!this.particles || this.particles.length !== this.maxParticles) {
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
      if (self.activeOverlay !== 'wind' || state.activeTab !== 'tab-map' || (typeof document !== 'undefined' && document.hidden)) {
        self.animId = null;
        return;
      }

      const isDarkMap = isMapCurrentlyDark();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = isDarkMap ? 'rgba(0, 0, 0, 0.09)' : 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = isDarkMap ? 2.6 : 2.8;
      ctx.lineCap = 'round';

      const dt = 0.28;
      for (let i = 0; i < self.particles.length; i++) {
        const p = self.particles[i];
        // O(1) Grid-Sample statt teurer containerPointToLatLng + IDW-Stationsschleife!
        const vec = self._sampleWindGrid(p.x, p.y, width, height);
        p.speed = vec.speed;

        const nextX = p.x + vec.u * dt;
        const nextY = p.y - vec.v * dt;

        let color;
        if (isDarkMap) {
          color = '#22c55e';
          if (p.speed >= 75) color = '#c084fc';
          else if (p.speed >= 55) color = '#ef4444';
          else if (p.speed >= 35) color = '#f59e0b';
          else if (p.speed >= 20) color = '#38bdf8';
        } else {
          color = '#002855';
          if (p.speed >= 75) color = '#312e81';
          else if (p.speed >= 55) color = '#991b1b';
          else if (p.speed >= 35) color = '#b45309';
          else if (p.speed >= 20) color = '#0d47a1';
        }

        const alpha = Math.sin((p.age / p.maxAge) * Math.PI);
        ctx.strokeStyle = color;
        ctx.globalAlpha = isDarkMap ? Math.max(0.40, alpha * 0.95) : Math.max(0.35, alpha * 0.95);
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

  // ===========================================================================
  // 3. BEWÖLKUNGSFELD (Reine Web-Mercator-Projektion)
  // ===========================================================================
  renderCloudDensityField(ctx, width, height, stations) {
    ctx.clearRect(0, 0, width, height);
    const vp = this._getMercatorViewport(width, height);
    if (!stations.length || !vp) return;

    const step = 18;
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
        const { lat, lon } = viewportPxToLatLon(vp, x, y);
        const cVal = this.interpolateStationMetric(lat, lon, stations, 'cloudCover');
        const noise = Math.sin(lon * 4.5) * Math.cos(lat * 6.5) * 12 + Math.sin((lon + lat) * 9.0) * 6;
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

  // ===========================================================================
  // 4. LUFTDRUCKFELD & MARCHING-SQUARES ISOBAREN
  // ===========================================================================
  renderPressureAndIsobars(ctx, width, height, stations) {
    ctx.clearRect(0, 0, width, height);
    const vp = this._getMercatorViewport(width, height);
    if (!stations.length || !vp) return;

    const step = 20;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;
    const total = cols * rows;
    if (!this._pool.pressureGrid || this._pool.pressureGrid.length < total) {
      this._pool.pressureGrid = new Float32Array(total);
    }
    const gridP = this._pool.pressureGrid;

    let minP = 9999, maxP = 0, minX = width / 2, minY = height / 2, maxX = width / 2, maxY = height / 2;

    for (let r = 0; r < rows; r++) {
      const y = r * step;
      const rowOff = r * cols;
      for (let c = 0; c < cols; c++) {
        const x = c * step;
        const { lat, lon } = viewportPxToLatLon(vp, x, y);
        const pVal = this.interpolateStationMetric(lat, lon, stations, 'pressureMsl');
        const idx = rowOff + c;
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

    for (let i = 0; i < total; i++) {
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

    const isobarLevels = [996, 1000, 1004, 1008, 1012, 1016, 1020, 1024, 1028, 1032];
    const contours = extractIsobarContours(gridP, cols, rows, isobarLevels, step, step, 0, 0);
    ctx.lineWidth = 1.9;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowBlur = 5;

    for (let k = 0; k < contours.length; k++) {
      const { level, polylines } = contours[k];
      const isCore = (level === 1012 || level === 1016);
      ctx.strokeStyle = isCore ? 'rgba(56, 189, 248, 0.95)' : 'rgba(165, 180, 252, 0.78)';
      ctx.shadowColor = isCore ? '#38bdf8' : '#818cf8';

      ctx.beginPath();
      let labelX = -1, labelY = -1;
      for (let p = 0; p < polylines.length; p++) {
        const line = polylines[p];
        if (line.length < 4) continue;
        ctx.moveTo(line[0], line[1]);
        for (let i = 2; i < line.length; i += 2) {
          ctx.lineTo(line[i], line[i + 1]);
          if (labelX < 0 && line[i] > 70 && line[i] < width - 110 && line[i + 1] > 40 && line[i + 1] < height - 50) {
            labelX = line[i];
            labelY = line[i + 1];
          }
        }
      }
      ctx.stroke();

      if (labelX >= 0) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`${level} hPa`, labelX + 5, labelY - 4);
      }
    }

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

  // ===========================================================================
  // 5. METEOSWISS-KALIBRIERTES 48H PHASEN- & ISO-BÄNDER-RADAR
  // ===========================================================================
  _precipThresholds: [0.20, 0.50, 1.00, 2.50, 5.00, 7.50, 10.0, 20.0, 35.0],
  _traceRateMin: 0.04,

  isDarkBasemap() {
    return isMapCurrentlyDark();
  },

  getPrecipTier(rateMmH) {
    if (rateMmH < 0.04) return 0;
    if (rateMmH < 0.20) return 1;
    if (rateMmH < 0.50) return 2;
    if (rateMmH < 1.00) return 3;
    if (rateMmH < 2.50) return 4;
    if (rateMmH < 5.00) return 5;
    if (rateMmH < 7.50) return 6;
    if (rateMmH < 10.0) return 7;
    if (rateMmH < 20.0) return 8;
    if (rateMmH < 35.0) return 9;
    return 10;
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

  _phaseTraceDark: {
    1: [[104, 212, 246, 72]],
    2: [[76,  208, 192, 74]],
    3: [[176, 236, 255, 76]]
  },
  _phaseTraceLight: {
    1: [[56,  189, 248, 70]],
    2: [[34,  178, 166, 72]],
    3: [[108, 204, 246, 74]]
  },
  _rgbaTmp2: [0, 0, 0, 0],
  _traceTmp: [0, 0, 0, 0],

  _precipPalettesDark: {
    1: [
      [64,  156, 255, 128], [28,  92,  240, 140], [14,  42,  204, 152],
      [20,  174, 58,  164], [162, 230, 28,  176], [250, 210, 20,  186],
      [249, 115, 22,  194], [224, 34,  34,  202], [158, 14,  26,  208]
    ],
    2: [
      [34,  178, 198, 130], [20,  188, 172, 142], [16,  196, 146, 154],
      [24,  206, 122, 166], [68,  222, 148, 178], [112, 234, 174, 188],
      [152, 242, 198, 196], [184, 248, 218, 202], [208, 252, 234, 208]
    ],
    3: [
      [132, 218, 252, 132], [164, 230, 255, 144], [194, 240, 255, 156],
      [218, 246, 255, 168], [232, 250, 255, 178], [240, 252, 255, 188],
      [246, 253, 255, 196], [250, 254, 255, 202], [254, 255, 255, 208]
    ]
  },

  _precipPalettesLight: {
    1: [
      [59,  142, 246, 130], [24,  86,  232, 142], [12,  38,  196, 154],
      [16,  162, 50,  166], [150, 218, 22,  178], [245, 196, 14,  188],
      [244, 106, 16,  196], [216, 30,  30,  202], [146, 12,  24,  208]
    ],
    2: [
      [22,  162, 186, 132], [14,  172, 158, 144], [12,  178, 132, 156],
      [18,  188, 110, 168], [44,  204, 132, 178], [84,  218, 158, 188],
      [122, 228, 182, 196], [154, 236, 202, 202], [180, 244, 218, 208]
    ],
    3: [
      [74,  182, 238, 136], [108, 200, 248, 148], [140, 216, 252, 158],
      [172, 230, 255, 168], [196, 238, 255, 178], [214, 244, 255, 188],
      [226, 248, 255, 196], [236, 251, 255, 202], [244, 253, 255, 208]
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

  _samplePhaseSharp(palettes, bandIdx, snowRatio, gradSnow, out) {
    if (gradSnow <= 1e-4) {
      const ph = this.getPrecipPhaseCode(snowRatio);
      const c = palettes[ph][bandIdx];
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = c[3];
      return;
    }
    const HALF_W = 0.65;
    const INV_W = 0.76923077;
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

  evalPrecipRgbaGradient(rateMmH, gradR, snowRatio, gradSnow, isDark, out, tmp) {
    const tracePal = isDark ? this._phaseTraceDark : this._phaseTraceLight;
    const palettes = isDark ? this._precipPalettesDark : this._precipPalettesLight;
    const trBuf = this._traceTmp;

    if (gradR <= 1e-6) {
      const tier = this.getPrecipTier(rateMmH);
      if (tier === 0) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return; }
      if (tier === 1) this._samplePhaseSharp(tracePal, 0, snowRatio, gradSnow, out);
      else this._samplePhaseSharp(palettes, tier - 2, snowRatio, gradSnow, out);
      out[0] = Math.round(out[0]); out[1] = Math.round(out[1]);
      out[2] = Math.round(out[2]); out[3] = Math.round(out[3]);
      return;
    }

    const HALF_W = 0.65;
    const INV_W = 0.76923077;
    const d0 = (rateMmH - 0.04) / gradR;
    if (d0 <= -HALF_W) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return; }
    const wetCov = d0 < HALF_W ? this._smooth01(d0 * INV_W + 0.5) : 1;
    this._samplePhaseSharp(tracePal, 0, snowRatio, gradSnow, trBuf);
    const d1 = (rateMmH - 0.20) / gradR;

    if (d1 <= -HALF_W) {
      out[0] = Math.round(trBuf[0]); out[1] = Math.round(trBuf[1]);
      out[2] = Math.round(trBuf[2]); out[3] = Math.round(trBuf[3] * wetCov);
      return;
    }

    const cuts = this._precipThresholds;
    const act = this._rgbaTmp2;
    let hiIdx = 0;
    for (let i = 1; i < cuts.length; i++) {
      if ((rateMmH - cuts[i]) / gradR <= -HALF_W) break;
      hiIdx = i;
    }
    let loIdx = hiIdx;
    while (loIdx > 0 && (rateMmH - cuts[loIdx]) / gradR < HALF_W) loIdx--;

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
      out[0] = Math.round(act[0]); out[1] = Math.round(act[1]);
      out[2] = Math.round(act[2]); out[3] = Math.round(act[3]);
      return;
    }

    const actCov = this._smooth01(d1 * INV_W + 0.5);
    const trCov = wetCov * (1 - actCov);
    const wA = actCov * act[3];
    const wT = trCov * trBuf[3];
    const wSum = wA + wT;
    if (wSum <= 0.001) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return; }
    out[0] = Math.round((trBuf[0] * wT + act[0] * wA) / wSum);
    out[1] = Math.round((trBuf[1] * wT + act[1] * wA) / wSum);
    out[2] = Math.round((trBuf[2] * wT + act[2] * wA) / wSum);
    out[3] = Math.round(wSum);
  },

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

  fbmNoise(lat, lon, phaseShift = 0) {
    const x = lon * 6.5 + phaseShift;
    const y = lat * 9.5 + phaseShift * 0.7;
    const n1 = Math.sin(x * 1.15 + Math.cos(y * 1.35)) * Math.cos(y * 1.10 - Math.sin(x * 0.95));
    const n2 = Math.sin(x * 2.40 - Math.sin(y * 2.20)) * Math.cos(y * 2.55 + Math.cos(x * 2.15)) * 0.5;
    const n3 = Math.sin((x + y) * 3.80) * 0.25;
    return (n1 + n2 + n3) / 1.75;
  },

  /**
   * Schätzt reale Inversions- / Hochnebel-Obergrenze aus Stations-Temperaturprofil, Luftfeuchte & MicroEngine.
   */
  estimateInversionTopMeters(stations, frame) {
    let valleyTemp = 0, valleyCount = 0;
    let valleyRh = 0;
    let peakTemp = 0, peakElev = 0, peakCount = 0;
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i];
      const elev = s.elevation ?? 520;
      const t = s.temperature ?? 6;
      const rh = s.relativeHumidity ?? 85;
      if (elev <= 750) {
        valleyTemp += t; valleyRh += rh; valleyCount++;
      } else if (elev >= 1200 && elev <= 2500) {
        peakTemp += t; peakElev += elev; peakCount++;
      }
    }
    const microInv = state.microClimate && Number.isFinite(state.microClimate.inversionTopMeters)
      ? state.microClimate.inversionTopMeters
      : null;
    if (microInv !== null && (!frame || Math.abs(frame.minuteOffset || 0) <= 60)) {
      return Math.max(550, Math.min(2000, microInv));
    }
    if (valleyCount > 0 && peakCount > 0) {
      const vt = valleyTemp / valleyCount;
      const vrh = valleyRh / valleyCount;
      const pt = peakTemp / peakCount;
      const pe = peakElev / peakCount;
      const lapse = ((vt - pt) / Math.max(400, pe - 500)) * 100; // °C/100m positiv = Normal, negativ/klein = Inversion
      if (lapse < 0.25) {
        // Starke Inversion: tiefe, kühle Nebeldecke (~700..1150m); feuchte Luft drückt LCL weiter runter
        const baseCeil = 780 + Math.max(0, 0.25 - lapse) * 240 - Math.max(0, vrh - 86) * 14;
        return Math.max(580, Math.min(1850, Math.round(baseCeil)));
      }
      return Math.max(650, Math.min(1850, Math.round(950 + (1 - Math.min(1, vrh / 100)) * 450)));
    }
    return 950;
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
      const b = state.map.instance.getBounds();
      const targetTs = (frame && frame.timestampMs) || (Date.now() + minuteOffset * 60000);
      const gridPts = ViewportForecastGridStore.getDenseStationsForTimestamp(
        targetTs, b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), avgWindKmH, avgDir
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

    const inversionTopM = this.estimateInversionTopMeters(stations, frame);
    const host = (state.map && state.map.radarHost) || 'https://tilecache.rainviewer.com';
    const rvPath = (frame && (frame.rvPath || frame.path))
      || (minuteOffset > 0 && state.map && state.map.liveRadarPath)
      || '';

    let radarWeight = 0, advectLat = 0, advectLon = 0;
    if (rvPath && minuteOffset <= 0) {
      radarWeight = 1.0;
    } else if (rvPath && minuteOffset > 0 && minuteOffset <= 90) {
      radarWeight = Math.max(0, 1.0 - Math.max(0, minuteOffset - 30) / 60);
      const advHours = minuteOffset / 60;
      const radMotion = (frontMotionDir * Math.PI) / 180;
      const steerKmH = Math.max(12, avgWindKmH * 1.25);
      const dKm = steerKmH * advHours;
      advectLat = (Math.cos(radMotion) * dKm) / 111.0;
      advectLon = (Math.sin(radMotion) * dKm) / (111.0 * 0.68);
    }

    const mapZoom = (state.map && state.map.instance) ? state.map.instance.getZoom() : 8;
    const rvZoom = Math.min(7, Math.max(4, Math.floor(mapZoom)));

    if (radarWeight > 0 && state.map && state.map.instance) {
      const b = state.map.instance.getBounds();
      RainViewerRadarStore.requestVisibleTiles(
        rvPath, host, rvZoom,
        b.getSouth() - Math.abs(advectLat) - 0.5,
        b.getNorth() + Math.abs(advectLat) + 0.5,
        b.getWest() - Math.abs(advectLon) - 0.8,
        b.getEast() + Math.abs(advectLon) + 0.8
      );
    }

    const ctxObj = {
      enriched, stations, hasDenseGrid, cosA, sinA, minuteOffset,
      hours: minuteOffset / 60, rvPath, host, rvZoom, radarWeight,
      advectLat, advectLon, inversionTopM
    };
    this._lastPreparedFrameKey = `${frame ? (frame.timestampMs || minuteOffset) : 'live'}_${rvPath}`;
    this._lastPreparedCtx = ctxObj;
    return ctxObj;
  },

  /**
   * Saubere Trennung zwischen visueller Textur (withVisualNoise=true für Canvas-Rendering)
   * und purer NWP/Stations-Physik (withVisualNoise=false für sampleAtLatLon / Punkt-Inspektor).
   */
  evalNwpPoint(lat, lon, ctx, { withVisualNoise = true } = {}) {
    const list = ctx.enriched;
    let sumWP = 0, sumVP = 0;
    let sumWT = 0, sumTwMsl = 0, sumFz = 0, sumCloudLow = 0;

    const phase = ctx.hours * 0.35;
    const warpLat = withVisualNoise ? (lat + this.fbmNoise(lat * 1.15, lon * 1.15, phase) * 0.044) : lat;
    const warpLon = withVisualNoise ? (lon + this.fbmNoise(lat * 1.15 + 3.7, lon * 1.15 - 2.3, phase + 5.1) * 0.062) : lon;
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
      if (withVisualNoise) {
        const turb = this.fbmNoise(warpLat * 1.25, warpLon * 1.25, ctx.hours * 0.42 + 1.9);
        nwpRate = Math.max(0, nwpRate * (1 + 0.34 * turb));
      }
    } else {
      nwpRate = 0;
    }
    if (nwpRate < 0.025) nwpRate = 0;

    const twMsl = sumWT > 0.001 ? sumTwMsl / sumWT : 4.5;
    const freezeLvl = sumWT > 0.001 ? sumFz / sumWT : 1400;
    const baseCloudLow = sumWT > 0.001 ? (sumCloudLow / sumWT) : 0;
    const cloudLow = withVisualNoise
      ? Math.max(0, Math.min(100, baseCloudLow + this.fbmNoise(lat * 1.35 + 2.1, lon * 1.35 - 1.4, phase * 0.5) * 9))
      : Math.max(0, Math.min(100, baseCloudLow));
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

    if (rvSnowMask >= 0.35) return Math.max(rvSnowMask, topoRatio);
    return topoRatio;
  },

  /** Rauschfreie Einzelpunkt-Abfrage (nutzt gecachten Frame-Kontext um Doppelarbeit zu vermeiden). */
  sampleAtLatLon(lat, lon, frame, options = {}) {
    if (state.map && typeof state.map.syntheticRadarField === 'function') {
      const syn = state.map.syntheticRadarField(lat, lon, frame);
      if (syn) {
        const rateMmH = syn.rateMmH >= 0.04 ? syn.rateMmH : 0;
        const snowRatio = syn.snowRatio !== undefined ? syn.snowRatio : 0;
        const phase = rateMmH < 0.04 ? 'dry' : (snowRatio >= 0.68 ? 'snow' : (snowRatio >= 0.22 ? 'sleet' : (rateMmH < 0.20 ? 'trace' : 'rain')));
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
          : _baselineStationsFn());

    const mo = (frame && frame.minuteOffset !== undefined) ? frame.minuteOffset : 0;
    const rvP = (frame && (frame.rvPath || frame.path)) || '';
    const cacheKey = `${frame ? (frame.timestampMs || mo) : 'live'}_${rvP}`;
    const ctx = (this._lastPreparedFrameKey === cacheKey && this._lastPreparedCtx && options.forceRecompute !== true)
      ? this._lastPreparedCtx
      : this.preparePrecipFieldContext(stations, frame);

    const nwp = this.evalNwpPoint(lat, lon, ctx, { withVisualNoise: false });
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
    const phase = finalRate < 0.04 ? 'dry' : (snowRatio >= 0.68 ? 'snow' : (snowRatio >= 0.22 ? 'sleet' : (finalRate < 0.20 ? 'trace' : 'rain')));

    return {
      rateMmH: Math.round(finalRate * 100) / 100,
      dbz: finalRate > 0 ? Math.max(0, Math.round(23.01 + 16 * Math.log10(finalRate))) : 0,
      snowRatio: Math.round(snowRatio * 100) / 100,
      phase,
      elevation: Math.round(elev),
      intensityLabel: this.getPrecipIntensityLabel(finalRate),
      source
    };
  },

  drawSnowflakeCrystals(ctx, vp, mapInst, minLat, maxLat, minLon, maxLon, getSnowTierAtPtFn, isDark = false) {
    const zoomFloor = Math.max(4, Math.min(13, Math.floor(mapInst.getZoom())));
    const centerLat = (minLat + maxLat) * 0.5;
    const cosLat = Math.max(0.42, Math.cos((centerLat * Math.PI) / 180));
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
        const dx = Math.cos(ang), dy = Math.sin(ang);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * arm, cy + dy * arm);
        const bx = cx + dx * branchAt, by = cy + dy * branchAt;
        const leftAng = ang + Math.PI / 4, rightAng = ang - Math.PI / 4;
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
        const lat = r * latStep + (hashCell(r, c, 1) - 0.5) * 0.46 * latStep;
        const lon = c * lonStep + stagger + (hashCell(r, c, 2) - 0.5) * 0.46 * lonStep;
        const pt = latLonToViewportPx(vp, lat, lon);
        const tier = getSnowTierAtPtFn(pt.x, pt.y);
        if (tier < 4) continue;
        const prob = tier >= 7 ? 0.45 : (tier >= 5 ? 0.28 : 0.14);
        if (hashCell(r, c, 3) > prob) continue;
        points.push({ x: pt.x, y: pt.y, arm: tier >= 7 ? 4.8 : (tier >= 5 ? 4.2 : 3.6) });
      }
    }

    if (points.length) {
      ctx.strokeStyle = isDark ? 'rgba(14, 52, 92, 0.48)' : 'rgba(12, 46, 86, 0.56)';
      ctx.lineWidth = 1.85;
      for (let i = 0; i < points.length; i++) drawCrystal(points[i].x, points[i].y, points[i].arm);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.lineWidth = 1.05;
      for (let i = 0; i < points.length; i++) drawCrystal(points[i].x, points[i].y, points[i].arm);
    }
    ctx.restore();
  },

  renderForecastPrecipitationField(ctx, width, height, stations, frame, options = {}) {
    ctx.clearRect(0, 0, width, height);
    const vp = this._getMercatorViewport(width, height);
    if (!stations.length || !vp || !state.map.instance) return;

    const mapInst = state.map.instance;
    const isFastPan = !!options.fastPan;
    const isDark = this.isDarkBasemap();
    const stationsPreInterpolated = !!options.stationsPreInterpolated;
    const morphNext = options.rvFrameB || options.nextFrame || null;
    const rawMorphAlpha = (morphNext && options.morphAlpha > 0 && options.morphAlpha < 1) ? options.morphAlpha : 0;
    const morphAlpha = stationsPreInterpolated ? 0 : rawMorphAlpha;
    const rvBlendAlpha = rawMorphAlpha;
    const step = isFastPan ? 5 : 2;
    const sCols = Math.ceil(width / step) + 1;
    const sRows = Math.ceil(height / step) + 1;
    const sTotal = sCols * sRows;
    const cStep = isFastPan ? 2 : 4;
    const cCols = Math.ceil((sCols - 1) / cStep) + 1;
    const cRows = Math.ceil((sRows - 1) / cStep) + 1;

    // Zero-GC Buffer Pool statt 12+ TypedArray-Allokationen pro Frame
    const pool = this._ensureFieldPool(sCols, sRows, cCols, cRows);
    const colLon = pool.colLon;
    const rowLat = pool.rowLat;
    for (let c = 0; c < sCols; c++) colLon[c] = viewportPxToLatLon(vp, c * step, 0).lon;
    for (let r = 0; r < sRows; r++) rowLat[r] = viewportPxToLatLon(vp, 0, r * step).lat;

    const rawRate = pool.rawRate;
    const rawSnow = pool.rawSnow;
    const rawStratus = pool.rawStratus;
    let hasWetAny = false;
    let hasStratusAny = false;
    let anyRvTileUsed = false;
    const hasSynthetic = !!(state.map && typeof state.map.syntheticRadarField === 'function');
    const showStratus = !hasSynthetic && !(state.map && state.map.showStratusOverlay === false);
    const phaseEnabled = hasSynthetic || !(state.map && state.map.precipPhaseEnabled === false);

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

      const frameForCtxA = (stationsPreInterpolated && options.rvFrameA)
        ? { ...activeFrame, rvPath: options.rvFrameA.rvPath || options.rvFrameA.path || '', path: options.rvFrameA.path || options.rvFrameA.rvPath || '' }
        : activeFrame;
      const fieldCtx = this.preparePrecipFieldContext(activeStations, frameForCtxA);
      const needsRvBlend = rvBlendAlpha > 0 && morphNext && (morphAlpha > 0 || (stationsPreInterpolated && (frameForCtxA.rvPath || morphNext.rvPath || morphNext.path)));
      const fieldCtxB = needsRvBlend ? this.preparePrecipFieldContext(morphNext.stations || activeStations, morphNext) : null;

      const coarseNwpRate = pool.coarseNwpRate;
      const coarseTwMsl = pool.coarseTwMsl;
      const coarseFreeze = pool.coarseFreeze;
      const coarseCloudLow = pool.coarseCloudLow;

      for (let cr = 0; cr < cRows; cr++) {
        const rIdx = Math.min(sRows - 1, cr * cStep);
        const lat = rowLat[rIdx];
        for (let cc = 0; cc < cCols; cc++) {
          const cIdx = Math.min(sCols - 1, cc * cStep);
          const ev = this.evalNwpPoint(lat, colLon[cIdx], fieldCtx, { withVisualNoise: true });
          const k = cr * cCols + cc;
          coarseNwpRate[k] = ev.nwpRate;
          coarseTwMsl[k] = ev.twMsl;
          coarseFreeze[k] = ev.freezeLvl;
          coarseCloudLow[k] = ev.cloudLow || 0;
        }
      }

      const rvColNxA = pool.rvColNxA;
      const rvRowNyA = pool.rvRowNyA;
      const rvColNxB = pool.rvColNxB;
      const rvRowNyB = pool.rvRowNyB;
      const useRvA = fieldCtx.radarWeight > 0 && !!fieldCtx.rvPath;
      const useRvB = !!(fieldCtxB && fieldCtxB.radarWeight > 0 && fieldCtxB.rvPath && rvBlendAlpha > 0);
      let rvMatrixA = null;
      let rvMatrixB = null;

      if (useRvA) {
        let minNxA = 1, maxNxA = 0, minNyA = 1, maxNyA = 0;
        for (let c = 0; c < sCols; c++) {
          const nx = ((((colLon[c] - fieldCtx.advectLon) + 180) / 360) % 1 + 1) % 1;
          rvColNxA[c] = nx;
          if (nx < minNxA) minNxA = nx;
          if (nx > maxNxA) maxNxA = nx;
        }
        for (let r = 0; r < sRows; r++) {
          const sLat = Math.max(-85.0511, Math.min(85.0511, rowLat[r] - fieldCtx.advectLat));
          const sinL = Math.sin((sLat * Math.PI) / 180);
          const ny = Math.max(0, Math.min(0.999999, 0.5 - Math.log((1 + sinL) / (1 - sinL)) / (4 * Math.PI)));
          rvRowNyA[r] = ny;
          if (ny < minNyA) minNyA = ny;
          if (ny > maxNyA) maxNyA = ny;
        }
        rvMatrixA = RainViewerRadarStore.buildViewportTileMatrix(fieldCtx.rvPath, fieldCtx.rvZoom, minNxA, maxNxA, minNyA, maxNyA);
      }
      if (useRvB) {
        let minNxB = 1, maxNxB = 0, minNyB = 1, maxNyB = 0;
        for (let c = 0; c < sCols; c++) {
          const nx = ((((colLon[c] - fieldCtxB.advectLon) + 180) / 360) % 1 + 1) % 1;
          rvColNxB[c] = nx;
          if (nx < minNxB) minNxB = nx;
          if (nx > maxNxB) maxNxB = nx;
        }
        for (let r = 0; r < sRows; r++) {
          const sLat = Math.max(-85.0511, Math.min(85.0511, rowLat[r] - fieldCtxB.advectLat));
          const sinL = Math.sin((sLat * Math.PI) / 180);
          const ny = Math.max(0, Math.min(0.999999, 0.5 - Math.log((1 + sinL) / (1 - sinL)) / (4 * Math.PI)));
          rvRowNyB[r] = ny;
          if (ny < minNyB) minNyB = ny;
          if (ny > maxNyB) maxNyB = ny;
        }
        rvMatrixB = RainViewerRadarStore.buildViewportTileMatrix(fieldCtxB.rvPath, fieldCtxB.rvZoom, minNxB, maxNxB, minNyB, maxNyB);
      }

      const dynInvTopBase = fieldCtx.inversionTopM || 950;

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
            const rvA = (useRvA && rvMatrixA)
              ? RainViewerRadarStore.sampleAtNormXYWithMatrix(rvMatrixA, rvColNxA[c], nyA)
              : { hasTile: false, rateMmH: 0, rvSnowMask: 0 };
            if (useRvB && rvBlendAlpha > 0 && rvMatrixB) {
              const rvB = RainViewerRadarStore.sampleAtNormXYWithMatrix(rvMatrixB, rvColNxB[c], nyB);
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
                rate = rA * (1 - rvBlendAlpha) + rB * rvBlendAlpha;
                const sA = rvA.hasTile ? rvA.rvSnowMask * fieldCtx.radarWeight : 0;
                const sB = rvB.hasTile ? rvB.rvSnowMask * fieldCtxB.radarWeight : 0;
                const totR = rA * (1 - rvBlendAlpha) + rB * rvBlendAlpha;
                rvSnowMask = totR > 0.005 ? (rA * (1 - rvBlendAlpha) * sA + rB * rvBlendAlpha * sB) / totR : 0;
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
                rate = (!rvHasDataA || elevCache >= 900 || twLoc <= 2.0) ? nwpRate * (rvHasDataA ? 0.65 : 0.92) : nwpRate * (1 - fieldCtx.radarWeight);
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

          // Reale dynamische Inversions-Obergrenze statt hartcodiert 1090m!
          if (showStratus && cLow >= 46 && rate < 0.045) {
            const elev = elevCache >= 0 ? elevCache : ViewportDemStore.getElevation(lat, colLon[c], activeStations);
            const invNoise = this.fbmNoise(lat * 2.1 + 4.1, colLon[c] * 2.1 - 1.7, 0) * 55;
            const stratusTop = dynInvTopBase + invNoise;
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

    let sRate = rawRate;
    let sSnow = rawSnow;

    if (hasWetAny && !hasSynthetic && (anyRvTileUsed || !isFastPan)) {
      const workRate = pool.workRate;
      const workSnow = pool.workSnow;
      if (anyRvTileUsed) {
        workSnow.fill(-1, 0, sTotal);
        for (let r = 0; r < sRows; r++) {
          const rowOff = r * sCols;
          const rMin = Math.max(0, r - 1);
          const rMax = Math.min(sRows - 1, r + 1);
          for (let c = 0; c < sCols; c++) {
            const idx = rowOff + c;
            const myR = rawRate[idx];
            const cMin = Math.max(0, c - 1);
            const cMax = Math.min(sCols - 1, c + 1);
            let traceWetN = 0, activeWetN = 0, sumNR = 0, sumNRS = 0;
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
        workRate.set(rawRate.subarray(0, sTotal));
        workSnow.set(rawSnow.subarray(0, sTotal));
      }

      const wCenter = anyRvTileUsed ? 2 : 6;
      const wInv = 1 / (wCenter + 2);
      const tmpRate = pool.tmpRate;
      const tmpSnow = pool.tmpSnow;
      for (let r = 0; r < sRows; r++) {
        const rowOff = r * sCols;
        for (let c = 0; c < sCols; c++) {
          const idx = rowOff + c;
          const cW = c > 0 ? idx - 1 : idx;
          const cE = c < sCols - 1 ? idx + 1 : idx;
          const rW = workRate[cW], rC = workRate[idx], rE = workRate[cE];
          tmpRate[idx] = (rW + wCenter * rC + rE) * wInv;

          const uW = (rW > 0 && workSnow[cW] >= 0) ? rW : 0;
          const uC = (rC > 0 && workSnow[idx] >= 0) ? wCenter * rC : 0;
          const uE = (rE > 0 && workSnow[cE] >= 0) ? rE : 0;
          const wSum = uW + uC + uE;
          tmpSnow[idx] = wSum > 0.0005 ? ((uW * workSnow[cW] + uC * workSnow[idx] + uE * workSnow[cE]) / wSum) : -1;
        }
      }

      sRate = pool.sRate;
      sSnow = pool.sSnow;
      for (let r = 0; r < sRows; r++) {
        const rowOff = r * sCols;
        const rN = r > 0 ? rowOff - sCols : rowOff;
        const rS = r < sRows - 1 ? rowOff + sCols : rowOff;
        for (let c = 0; c < sCols; c++) {
          const idx = rowOff + c;
          const kN = rN + c, kS = rS + c;
          const tN = tmpRate[kN], tC = tmpRate[idx], tS = tmpRate[kS];
          const rAvg = (tN + wCenter * tC + tS) * wInv;
          sRate[idx] = rAvg >= 0.018 ? rAvg : 0;

          const uN = (tN > 0 && tmpSnow[kN] >= 0) ? tN : 0;
          const uC = (tC > 0 && tmpSnow[idx] >= 0) ? wCenter * tC : 0;
          const uS = (tS > 0 && tmpSnow[kS] >= 0) ? tS : 0;
          const wSum = uN + uC + uS;
          sSnow[idx] = wSum > 0.0005 ? ((uN * tmpSnow[kN] + uC * tmpSnow[idx] + uS * tmpSnow[kS]) / wSum) : -1;
        }
      }
    }

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
        const k00 = rowOff0 + bc, k10 = k00 + 1, k01 = rowOff1 + bc, k11 = k01 + 1;
        const r00 = sRate[k00], r10 = sRate[k10], r01 = sRate[k01], r11 = sRate[k11];
        const st00 = showStratus ? rawStratus[k00] : 0;
        const st10 = showStratus ? rawStratus[k10] : 0;
        const st01 = showStratus ? rawStratus[k01] : 0;
        const st11 = showStratus ? rawStratus[k11] : 0;

        const hasWetBlock = hasWetAny && !(r00 < 0.024 && r10 < 0.024 && r01 < 0.024 && r11 < 0.024);
        const hasStratusBlock = showStratus && hasStratusAny && (st00 >= 0.08 || st10 >= 0.08 || st01 >= 0.08 || st11 >= 0.08);
        if (!hasWetBlock && !hasStratusBlock) continue;

        const xStart = Math.floor(bc * cellSz);
        if (xStart >= outW) break;
        const xEnd = Math.min(outW, bc === sCols - 2 ? outW : Math.floor((bc + 1) * cellSz));

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
              data[dIdx] = stratusR; data[dIdx + 1] = stratusG; data[dIdx + 2] = stratusB;
              data[dIdx + 3] = Math.round(stratusBaseAlpha * cov);
            }
          }
          continue;
        }

        let sn00 = sSnow[k00], sn10 = sSnow[k10], sn01 = sSnow[k01], sn11 = sSnow[k11];
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

        const t00 = this.getPrecipTier(r00), t10 = this.getPrecipTier(r10), t01 = this.getPrecipTier(r01), t11 = this.getPrecipTier(r11);
        const p00 = this.getPrecipPhaseCode(sn00), p10 = this.getPrecipPhaseCode(sn10), p01 = this.getPrecipPhaseCode(sn01), p11 = this.getPrecipPhaseCode(sn11);

        const minR = Math.min(r00, r10, r01, r11);
        const maxR = Math.max(r00, r10, r01, r11);
        const rxTop = r10 - r00, rxBot = r11 - r01, ryLeft = r01 - r00, ryRight = r11 - r10;
        const maxGradR = Math.hypot(Math.max(Math.abs(rxTop), Math.abs(rxBot)), Math.max(Math.abs(ryLeft), Math.abs(ryRight))) * invCellSz;
        const marginR = 0.72 * maxGradR;
        const loCutR = t00 <= 1 ? 0.04 : cuts[t00 - 2];
        const hiCutR = t00 === 1 ? 0.20 : (t00 < 10 ? cuts[t00 - 1] : Infinity);

        const snxTop = sn10 - sn00, snxBot = sn11 - sn01, snyLeft = sn01 - sn00, snyRight = sn11 - sn10;
        const minSn = Math.min(sn00, sn10, sn01, sn11);
        const maxSn = Math.max(sn00, sn10, sn01, sn11);
        const maxGradSn = Math.hypot(Math.max(Math.abs(snxTop), Math.abs(snxBot)), Math.max(Math.abs(snyLeft), Math.abs(snyRight))) * invCellSz;
        const marginSn = 0.72 * Math.min(maxGradSn, 0.28);
        const isPurePhase = (maxSn <= 0.22 - marginSn) || (minSn >= 0.22 + marginSn && maxSn <= 0.68 - marginSn) || (minSn >= 0.68 + marginSn);

        const isHomogeneousBand =
          t00 >= 1 && t00 === t10 && t00 === t01 && t00 === t11 &&
          minR > loCutR + marginR && maxR < hiCutR - marginR &&
          p00 === p10 && p00 === p01 && p00 === p11 && isPurePhase;

        if (isHomogeneousBand) {
          const col = t00 === 1 ? tracePal[p00][0] : palettes[p00][t00 - 2];
          const cr = col[0], cg = col[1], cb = col[2], ca = col[3];
          for (let py = yStart; py < yEnd; py++) {
            const pyOff = py * outW;
            for (let px = xStart; px < xEnd; px++) {
              const oIdx = pyOff + px;
              tierBuf[oIdx] = t00; phaseBuf[oIdx] = p00;
              const dIdx = oIdx << 2;
              data[dIdx] = cr; data[dIdx + 1] = cg; data[dIdx + 2] = cb; data[dIdx + 3] = ca;
            }
          }
          continue;
        }

        for (let py = yStart; py < yEnd; py++) {
          const fy = Math.max(0, Math.min(1, py * invCellSz - br));
          const oneMinusFy = 1 - fy;
          const dRdx = (rxTop * oneMinusFy + rxBot * fy) * invCellSz;
          const dSdx = (snxTop * oneMinusFy + snxBot * fy) * invCellSz;
          const pyOff = py * outW;
          for (let px = xStart; px < xEnd; px++) {
            const fx = Math.max(0, Math.min(1, px * invCellSz - bc));
            const oneMinusFx = 1 - fx;
            const w00 = oneMinusFx * oneMinusFy, w10 = fx * oneMinusFy, w01 = oneMinusFx * fy, w11 = fx * fy;
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
                data[dIdx] = rgbaOut[0]; data[dIdx + 1] = rgbaOut[1]; data[dIdx + 2] = rgbaOut[2]; data[dIdx + 3] = rgbaOut[3];
                continue;
              }
            }

            if (hasStratusBlock) {
              const sv = st00 * w00 + st10 * w10 + st01 * w01 + st11 * w11;
              if (sv >= 0.20) {
                const cov = sv >= 0.34 ? 1.0 : this._smooth01((sv - 0.20) / 0.14);
                const dIdx = (pyOff + px) << 2;
                data[dIdx] = stratusR; data[dIdx + 1] = stratusG; data[dIdx + 2] = stratusB;
                data[dIdx + 3] = Math.round(stratusBaseAlpha * cov);
              }
            }
          }
        }
      }
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.offscreenCanvas, 0, 0, width, height);
    ctx.restore();

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
      this.drawSnowflakeCrystals(ctx, vp, mapInst, b.getSouth(), b.getNorth(), b.getWest(), b.getEast(), getSnowTierAtPt, isDark);
    }
  },

  // ===========================================================================
  // 6. BLITZE & KONVEKTIVES GEWITTERPOTENZIAL (inkl. echter CAPE-Auswertung)
  // ===========================================================================
  renderLightningField(ctx, width, height, stations, frame) {
    ctx.clearRect(0, 0, width, height);
    const vp = this._getMercatorViewport(width, height);
    if (!stations.length || !vp) return;

    const step = 24;
    const cols = Math.ceil(width / step) + 1;
    const rows = Math.ceil(height / step) + 1;

    ctx.save();
    for (let r = 0; r < rows; r++) {
      const y = r * step;
      for (let c = 0; c < cols; c++) {
        const x = c * step;
        const { lat, lon } = viewportPxToLatLon(vp, x, y);
        const pVal = this.interpolateStationMetric(lat, lon, stations, 'precip');
        const tVal = this.interpolateStationMetric(lat, lon, stations, 'temperature');
        const wCode = this.interpolateStationMetric(lat, lon, stations, 'weatherCode');
        const capeVal = this.interpolateStationMetric(lat, lon, stations, 'cape');

        const isStorm = (wCode >= 95 && wCode <= 99) || (capeVal >= 550 && pVal >= 1.2) || (pVal >= 3.5 && tVal >= 15);
        const isElevatedCap = !isStorm && capeVal >= 320 && pVal >= 0.4;
        if (isStorm || isElevatedCap) {
          ctx.fillStyle = isStorm ? 'rgba(245, 158, 11, 0.30)' : 'rgba(251, 191, 36, 0.16)';
          ctx.beginPath();
          ctx.arc(x, y, step * (isStorm ? 1.25 : 0.95), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
};
