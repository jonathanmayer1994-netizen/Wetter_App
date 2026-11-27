/**
 * Reine Web-Mercator Projektions-Mathematik (entkoppelt vom Leaflet DOM).
 * Kann sowohl im UI-Thread als auch in WebWorkern / OffscreenCanvas genutzt werden.
 */

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const MAX_MERCATOR_LAT = 85.05112877980659;

export function clampMercatorLat(lat) {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

/** Normalisierte Mercator-X-Koordinate [0..1] aus Längengrad. */
export function lonToNormX(lon) {
  return (lon + 180) / 360;
}

/** Normalisierte Mercator-Y-Koordinate [0..1] aus Breitengrad. */
export function latToNormY(lat) {
  const rad = clampMercatorLat(lat) * DEG_TO_RAD;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
}

export function normXToLon(nx) {
  return nx * 360 - 180;
}

export function normYToLat(ny) {
  const n = Math.PI - 2 * Math.PI * ny;
  return RAD_TO_DEG * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Erzeugt ein leichtgewichtiges, serialisierbares Viewport-Projektions-Objekt (Worker-tauglich).
 */
export function createMercatorViewport(centerLat, centerLon, zoom, width, height) {
  const worldSize = 256 * Math.pow(2, zoom);
  const centerWorldX = lonToNormX(centerLon) * worldSize;
  const centerWorldY = latToNormY(centerLat) * worldSize;
  const originX = centerWorldX - width * 0.5;
  const originY = centerWorldY - height * 0.5;
  return {
    centerLat,
    centerLon,
    zoom,
    width,
    height,
    worldSize,
    originX,
    originY
  };
}

export function latLonToViewportPx(vp, lat, lon) {
  return {
    x: lonToNormX(lon) * vp.worldSize - vp.originX,
    y: latToNormY(lat) * vp.worldSize - vp.originY
  };
}

export function viewportPxToLatLon(vp, px, py) {
  const nx = (vp.originX + px) / vp.worldSize;
  const ny = (vp.originY + py) / vp.worldSize;
  return {
    lat: normYToLat(ny),
    lon: normXToLon(nx)
  };
}

/**
 * Reiner Marching-Squares Kontur-Extraktor für reguläre 2D-Skalarfelder (z. B. 0°C-Isotherme, Isobaren).
 * Gibt Segmentpaare [x1, y1, x2, y2] bzw. verbundene Polylines im Pixelkoordinatenraum zurück.
 */
export function extractIsobarContours(field, cols, rows, thresholds, cellW, cellH, offsetX = 0, offsetY = 0) {
  const results = [];
  const invAbs = (a, b, level) => {
    const d = b - a;
    if (Math.abs(d) < 1e-6) return 0.5;
    return Math.max(0, Math.min(1, (level - a) / d));
  };

  for (let tIdx = 0; tIdx < thresholds.length; tIdx++) {
    const level = thresholds[tIdx];
    const segments = [];

    for (let r = 0; r < rows - 1; r++) {
      const rowOff = r * cols;
      const nextRowOff = (r + 1) * cols;
      const y0 = offsetY + r * cellH;
      const y1 = offsetY + (r + 1) * cellH;

      for (let c = 0; c < cols - 1; c++) {
        const v0 = field[rowOff + c];       // top-left
        const v1 = field[rowOff + c + 1];   // top-right
        const v2 = field[nextRowOff + c + 1]; // bottom-right
        const v3 = field[nextRowOff + c];   // bottom-left
        if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) continue;

        let mask = 0;
        if (v0 >= level) mask |= 8;
        if (v1 >= level) mask |= 4;
        if (v2 >= level) mask |= 2;
        if (v3 >= level) mask |= 1;
        if (mask === 0 || mask === 15) continue;

        const x0 = offsetX + c * cellW;
        const x1 = offsetX + (c + 1) * cellW;

        // Kanten-Schnittpunkte: top(0), right(1), bottom(2), left(3)
        const topX = x0 + invAbs(v0, v1, level) * cellW;
        const rightY = y0 + invAbs(v1, v2, level) * cellH;
        const botX = x0 + invAbs(v3, v2, level) * cellW;
        const leftY = y0 + invAbs(v0, v3, level) * cellH;

        const addSeg = (ax, ay, bx, by) => segments.push(ax, ay, bx, by);

        switch (mask) {
          case 1:  addSeg(x0, leftY, botX, y1); break;
          case 2:  addSeg(botX, y1, x1, rightY); break;
          case 3:  addSeg(x0, leftY, x1, rightY); break;
          case 4:  addSeg(topX, y0, x1, rightY); break;
          case 5: {
            const center = 0.25 * (v0 + v1 + v2 + v3);
            if (center >= level) {
              addSeg(x0, leftY, topX, y0);
              addSeg(botX, y1, x1, rightY);
            } else {
              addSeg(x0, leftY, botX, y1);
              addSeg(topX, y0, x1, rightY);
            }
            break;
          }
          case 6:  addSeg(topX, y0, botX, y1); break;
          case 7:  addSeg(x0, leftY, topX, y0); break;
          case 8:  addSeg(x0, leftY, topX, y0); break;
          case 9:  addSeg(topX, y0, botX, y1); break;
          case 10: {
            const center = 0.25 * (v0 + v1 + v2 + v3);
            if (center >= level) {
              addSeg(topX, y0, x1, rightY);
              addSeg(x0, leftY, botX, y1);
            } else {
              addSeg(x0, leftY, topX, y0);
              addSeg(botX, y1, x1, rightY);
            }
            break;
          }
          case 11: addSeg(topX, y0, x1, rightY); break;
          case 12: addSeg(x0, leftY, x1, rightY); break;
          case 13: addSeg(botX, y1, x1, rightY); break;
          case 14: addSeg(x0, leftY, botX, y1); break;
        }
      }
    }

    // Kurze Stitch-Pass für durchgehende glatte Pfade ohne Perlenketten-Artefakte
    const polylines = stitchContourSegments(segments);
    if (polylines.length > 0) {
      results.push({ level, segments, polylines });
    }
  }

  return results;
}

function stitchContourSegments(segs) {
  const n = segs.length / 4;
  if (n === 0) return [];
  const used = new Uint8Array(n);
  const key = (x, y) => `${Math.round(x * 4)}_${Math.round(y * 4)}`;
  const endpointMap = new Map();

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const kA = key(segs[o], segs[o + 1]);
    const kB = key(segs[o + 2], segs[o + 3]);
    if (!endpointMap.has(kA)) endpointMap.set(kA, []);
    if (!endpointMap.has(kB)) endpointMap.set(kB, []);
    endpointMap.get(kA).push({ i, end: 0 });
    endpointMap.get(kB).push({ i, end: 1 });
  }

  const polylines = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const o = i * 4;
    const line = [segs[o], segs[o + 1], segs[o + 2], segs[o + 3]];

    // Vorwärts verlängern
    while (true) {
      const lx = line[line.length - 2];
      const ly = line[line.length - 1];
      const list = endpointMap.get(key(lx, ly));
      if (!list) break;
      let extended = false;
      for (let m = 0; m < list.length; m++) {
        const cand = list[m];
        if (used[cand.i]) continue;
        used[cand.i] = 1;
        const co = cand.i * 4;
        if (cand.end === 0) {
          line.push(segs[co + 2], segs[co + 3]);
        } else {
          line.push(segs[co], segs[co + 1]);
        }
        extended = true;
        break;
      }
      if (!extended) break;
    }

    // Rückwärts verlängern
    while (true) {
      const fx = line[0];
      const fy = line[1];
      const list = endpointMap.get(key(fx, fy));
      if (!list) break;
      let extended = false;
      for (let m = 0; m < list.length; m++) {
        const cand = list[m];
        if (used[cand.i]) continue;
        used[cand.i] = 1;
        const co = cand.i * 4;
        if (cand.end === 1) {
          line.unshift(segs[co], segs[co + 1]);
        } else {
          line.unshift(segs[co + 2], segs[co + 3]);
        }
        extended = true;
        break;
      }
      if (!extended) break;
    }

    polylines.push(line);
  }
  return polylines;
}
