/**
 * BEST WEATHER — Map Canvas WebWorker (Off-Main-Thread Scalar & Vector Field Engine)
 * Berechnet rechenintensive 2D-Wetterfelder (Temperatur-DEM-Gitter, Wolken, Luftdruck, 36x28 Wind-Vektorfeld)
 * komplett außerhalb des UI-Threads über reine Web-Mercator-Projektion & Zero-Copy ArrayBuffer Transfers.
 */

import { createMercatorViewport, viewportPxToLatLon } from './mapMercator.js';

function interpolateStationMetric(lat, lon, stations, key, power = 1.35) {
  if (!stations || !stations.length) return 0;
  let sumWeight = 0;
  let sumVal = 0;
  const eps = 0.00008;

  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    const val = st[key];
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
}

function computeWindGrid(vp, stations, cols = 36, rows = 28) {
  const uGrid = new Float32Array(cols * rows);
  const vGrid = new Float32Array(cols * rows);
  const spdGrid = new Float32Array(cols * rows);
  const eps = 0.00008;

  for (let r = 0; r < rows; r++) {
    const py = (r / (rows - 1)) * vp.height;
    for (let c = 0; c < cols; c++) {
      const px = (c / (cols - 1)) * vp.width;
      const { lat, lon } = viewportPxToLatLon(vp, px, py);
      let sumW = 0, sumU = 0, sumV = 0, sumSpd = 0;
      let hit = false;
      const idx = r * cols + c;

      for (let i = 0; i < stations.length; i++) {
        const st = stations[i];
        const spd = st.windSpeed !== undefined ? st.windSpeed : 15;
        const dir = st.windDirection !== undefined ? st.windDirection : 240;
        const rad = (dir * Math.PI) / 180;
        const u = -spd * Math.sin(rad);
        const v = -spd * Math.cos(rad);
        const dLat = lat - st.lat;
        const dLon = lon - st.lon;
        const distSq = dLat * dLat + dLon * dLon;
        if (distSq < 0.00004) {
          uGrid[idx] = u;
          vGrid[idx] = v;
          spdGrid[idx] = spd;
          hit = true;
          break;
        }
        const w = 1 / Math.pow(distSq + eps, 1.35);
        sumW += w;
        sumU += w * u;
        sumV += w * v;
        sumSpd += w * spd;
      }

      if (!hit) {
        uGrid[idx] = sumW > 0 ? (sumU / sumW) : -12;
        vGrid[idx] = sumW > 0 ? (sumV / sumW) : 8;
        spdGrid[idx] = sumW > 0 ? (sumSpd / sumW) : 15;
      }
    }
  }

  return { cols, rows, uGrid, vGrid, spdGrid };
}

function computeScalarGrid(vp, stations, step, metricKey) {
  const cols = Math.ceil(vp.width / step) + 1;
  const rows = Math.ceil(vp.height / step) + 1;
  const grid = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const py = r * step;
    for (let c = 0; c < cols; c++) {
      const px = c * step;
      const { lat, lon } = viewportPxToLatLon(vp, px, py);
      grid[r * cols + c] = interpolateStationMetric(lat, lon, stations, metricKey);
    }
  }
  return { cols, rows, grid };
}

self.addEventListener('message', (ev) => {
  const msg = ev.data || {};
  const { jobId, type, viewport, stations, step, metricKey, cols, rows } = msg;
  if (!viewport || !Array.isArray(stations)) return;

  const vp = createMercatorViewport(
    viewport.centerLat,
    viewport.centerLon,
    viewport.zoom,
    viewport.width,
    viewport.height
  );

  if (type === 'windGrid') {
    const res = computeWindGrid(vp, stations, cols || 36, rows || 28);
    self.postMessage(
      {
        jobId,
        type: 'windGridResult',
        cols: res.cols,
        rows: res.rows,
        uGrid: res.uGrid,
        vGrid: res.vGrid,
        spdGrid: res.spdGrid
      },
      [res.uGrid.buffer, res.vGrid.buffer, res.spdGrid.buffer]
    );
    return;
  }

  if (type === 'scalarGrid') {
    const res = computeScalarGrid(vp, stations, step || 20, metricKey || 'pressureMsl');
    self.postMessage(
      {
        jobId,
        type: 'scalarGridResult',
        metricKey,
        cols: res.cols,
        rows: res.rows,
        grid: res.grid
      },
      [res.grid.buffer]
    );
  }
});
