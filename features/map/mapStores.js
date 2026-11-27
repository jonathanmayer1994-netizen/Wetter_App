/**
 * BEST WEATHER — Map Stores Module (v2.0)
 * 1. RainViewerRadarStore (512px dBZ Decoder, MAX_CACHE 160, O(1) Viewport Tile-Matrix-Pointer-Cache, CORS/Backoff-Safe)
 * 2. ViewportDemStore (AWS Terrarium High-Res Elevation Tiles ~30-100m + 12x12 Open-Meteo Bicubic Fallback)
 * 3. ViewportForecastGridStore (5x5 Open-Meteo NWP-Grid incl. CAPE, Wind, Pressure für alle Overlays weltweit)
 */

import { state } from '../../core/state.js';
import { MicroEngine } from '../../microEngine.js';
import {
  getApiCooldownUntil,
  setApiCooldownUntil,
  clearApiCooldown,
  tripCircuitBreakerFromResponse,
  recordExternalNetworkCall
} from '../../httpClient.js';
import { lonToNormX, latToNormY } from './mapMercator.js';

let _storeRenderHook = null;
export function setMapStoresRenderHook(fn) {
  _storeRenderHook = typeof fn === 'function' ? fn : null;
}

function triggerOverlayRefresh(overlays) {
  if (_storeRenderHook) {
    _storeRenderHook(overlays);
  }
}

// =============================================================================
// 1. RAINVIEWER 512px RADAR TILE DECODER & O(1) VIEWPORT MATRIX CACHE
// =============================================================================
export const RainViewerRadarStore = {
  TILE_SIZE: 512,
  MAX_CACHE: 160,
  tiles: new Map(), // key -> { status: 'loading'|'ready'|'error', dbzX10, snowMask, hasData }
  decodeCanvas: null,
  decodeCtx: null,
  _rerenderRaf: null,
  _consecutiveErrors: 0,
  _backoffUntil: 0,

  // Verifizierte RainViewer Scheme 2 (Universal Blue, smooth=0, snow=1) Regen-LUT (>= 14 dBZ + Taupe Trace)
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
    return Math.pow(10, (dbz - 23.01) / 16.0);
  },

  decodePixel(r, g, b, a) {
    if (a < 105) return { dbz: -32, snow: 0 };
    if (Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2 && r < 240) return { dbz: -32, snow: 0 };

    if (b >= 244 && r <= 212 && g >= 210 && b >= g && Math.abs(Math.min(255, r + 64) - g) <= 28) {
      let dbz = 10;
      if (r >= 127) dbz = 10 + ((200 - Math.min(200, r)) / 73) * 10;
      else if (r >= 72) dbz = 20 + ((127 - r) / 55) * 8;
      else dbz = 28 + ((72 - r) / 72) * 27;

      if (a < 232) dbz *= (a / 245);
      if (dbz < 5.5) return { dbz: -32, snow: 0 };
      return { dbz, snow: 1.0 };
    }

    if (r >= 242 && b > g + 5 && b < 252 && g >= 95) {
      const dbz = 10 + ((215 - Math.min(215, g)) / 105) * 32;
      if (a < 180 && dbz < 9.5) return { dbz: -32, snow: 0 };
      if (dbz < 5.5) return { dbz: -32, snow: 0 };
      return { dbz, snow: 0.48 };
    }

    if (r > b + 16 && r >= 150 && g >= 138 && b >= 110 && a >= 108 && a <= 205) {
      const dbz = 5.5 + Math.min(1, Math.max(0, (a - 108) / 84)) * 8.5;
      return { dbz, snow: 0 };
    }

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
    let raw;
    try {
      raw = dCtx.getImageData(0, 0, TS, TS).data;
    } catch (_) {
      // CORS-tainted Fallback verhindern
      return { status: 'error', dbzX10: null, snowMask: null, hasData: false };
    }
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

  _touchLru(key, entry) {
    this.tiles.delete(key);
    this.tiles.set(key, entry);
  },

  requestTile(rvPath, host, z, x, y) {
    if (!rvPath || !host) return null;
    if (Date.now() < this._backoffUntil) return null;

    const n = 1 << z;
    const wx = ((x % n) + n) % n;
    if (y < 0 || y >= n) return null;

    const key = this.getKey(rvPath, z, wx, y);
    const existing = this.tiles.get(key);
    if (existing) {
      this._touchLru(key, existing);
      return existing;
    }

    if (this.tiles.size >= this.MAX_CACHE) {
      const oldestKey = this.tiles.keys().next().value;
      if (oldestKey) this.tiles.delete(oldestKey);
    }

    const entry = { status: 'loading', dbzX10: null, snowMask: null, hasData: false };
    this.tiles.set(key, entry);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this._consecutiveErrors = 0;
      try {
        const decoded = this.decodeImage(img);
        entry.status = decoded.status;
        entry.dbzX10 = decoded.dbzX10;
        entry.snowMask = decoded.snowMask;
        entry.hasData = decoded.hasData;
      } catch (_) {
        entry.status = 'error';
      }
      if (entry.status === 'ready') {
        this.scheduleCanvasRerender();
      }
    };
    img.onerror = () => {
      entry.status = 'error';
      this._consecutiveErrors++;
      if (this._consecutiveErrors >= 6) {
        const backoffMs = Math.min(60000, 3000 * Math.pow(2, Math.min(4, this._consecutiveErrors - 6)));
        this._backoffUntil = Date.now() + backoffMs;
      }
    };
    img.src = `${host}${rvPath}/${this.TILE_SIZE}/${z}/${wx}/${y}/2/0_1.png`;
    return entry;
  },

  scheduleCanvasRerender() {
    if (this._rerenderRaf) return;
    this._rerenderRaf = requestAnimationFrame(() => {
      this._rerenderRaf = null;
      triggerOverlayRefresh(['precip', 'rainviewer-radar']);
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

  /**
   * Baut einmalig pro Frame-Render eine direkte Pointer-Matrix (Zero-String / Zero-Map-Lookup in der 2px-Schleife).
   */
  buildViewportTileMatrix(rvPath, rvZoom, nxMin, nxMax, nyMin, nyMax) {
    if (!rvPath) return null;
    const n = 1 << rvZoom;
    const x0 = Math.floor(nxMin * n) - 1;
    const x1 = Math.floor(nxMax * n) + 1;
    const y0 = Math.max(0, Math.floor(nyMin * n) - 1);
    const y1 = Math.min(n - 1, Math.floor(nyMax * n) + 1);

    const cols = Math.max(1, x1 - x0 + 1);
    const rows = Math.max(1, y1 - y0 + 1);
    const entries = new Array(rows * cols);
    let anyReady = false;

    for (let r = 0; r < rows; r++) {
      const ty = y0 + r;
      const rowOff = r * cols;
      for (let c = 0; c < cols; c++) {
        const tx = x0 + c;
        const wx = ((tx % n) + n) % n;
        const e = this.tiles.get(this.getKey(rvPath, rvZoom, wx, ty));
        if (e && e.status === 'ready' && e.dbzX10) {
          entries[rowOff + c] = e;
          anyReady = true;
        } else {
          entries[rowOff + c] = null;
        }
      }
    }

    return { rvPath, rvZoom, n, x0, y0, cols, rows, entries, anyReady };
  },

  buildViewportMatrix(rvPath, rvZoom, latMin, latMax, lonMin, lonMax) {
    if (!rvPath) return null;
    const nw = this.latLonToNormXY(latMax, lonMin);
    const se = this.latLonToNormXY(latMin, lonMax);
    return this.buildViewportTileMatrix(rvPath, rvZoom, nw.nx, se.nx, nw.ny, se.ny);
  },

  sampleAtNormXYWithMatrix(matrix, nx, ny) {
    if (!matrix) return { hasTile: false, rateMmH: 0, rvSnowMask: 0 };
    return this.sampleAtNormXY(matrix.rvPath, matrix.rvZoom, nx, ny, matrix);
  },

  _samplePixelFromMatrix(matrix, pxGlobal, pyGlobal, out) {
    const TS = this.TILE_SIZE;
    const txRaw = Math.floor(pxGlobal / TS);
    const ty = Math.floor(pyGlobal / TS);
    const col = txRaw - matrix.x0;
    const row = ty - matrix.y0;
    if (col < 0 || col >= matrix.cols || row < 0 || row >= matrix.rows) return false;

    const entry = matrix.entries[row * matrix.cols + col];
    if (!entry) return false;

    const lx = pxGlobal - txRaw * TS;
    const ly = pyGlobal - ty * TS;
    const idx = ly * TS + lx;
    const dbzX10 = entry.dbzX10[idx];
    if (dbzX10 < 52) {
      out.rate = 0;
      out.snow = 0;
      return true;
    }
    const dbz = dbzX10 * 0.1;
    out.rate = Math.pow(10, (dbz - 23.01) / 16.0);
    out.snow = entry.snowMask[idx] * 0.01;
    return true;
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

  // Wiederverwendbarer Scratch-Puffer (0 Allokationen in der inneren Schleife)
  _pxScratch: { rate: 0, snow: 0 },

  sampleAtNormXY(rvPath, rvZoom, nx, ny, matrix = null) {
    if (!rvPath) return { hasTile: false, rateMmH: 0, rvSnowMask: 0 };
    if (matrix && !matrix.anyReady) return { hasTile: false, rateMmH: 0, rvSnowMask: 0 };

    const TS = this.TILE_SIZE;
    const totalPx = (1 << rvZoom) * TS;
    const gx = nx * totalPx - 0.5;
    const gy = ny * totalPx - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;

    let r00 = 0, s00 = 0, h00 = false;
    let r10 = 0, s10 = 0, h10 = false;
    let r01 = 0, s01 = 0, h01 = false;
    let r11 = 0, s11 = 0, h11 = false;

    const sc = this._pxScratch;
    const fetchPx = (px, py) => {
      if (matrix) {
        return this._samplePixelFromMatrix(matrix, px, py, sc) ? sc : null;
      }
      return this.sampleSinglePixel(rvPath, rvZoom, px, py);
    };

    const p00 = fetchPx(x0, y0);
    if (p00) { r00 = p00.rate; s00 = p00.snow; h00 = true; }
    const p10 = fetchPx(x0 + 1, y0);
    if (p10) { r10 = p10.rate; s10 = p10.snow; h10 = true; }
    const p01 = fetchPx(x0, y0 + 1);
    if (p01) { r01 = p01.rate; s01 = p01.snow; h01 = true; }
    const p11 = fetchPx(x0 + 1, y0 + 1);
    if (p11) { r11 = p11.rate; s11 = p11.snow; h11 = true; }

    if (!h00 && !h10 && !h01 && !h11) {
      return { hasTile: false, rateMmH: 0, rvSnowMask: 0 };
    }

    const rCenterMax = Math.max(r00, r10, r01, r11);
    const fbRate = h00 ? r00 : (h10 ? r10 : (h01 ? r01 : r11));
    const fbSnow = h00 ? s00 : (h10 ? s10 : (h01 ? s01 : s11));
    const a00r = h00 ? r00 : fbRate, a00s = h00 ? s00 : fbSnow;
    const a10r = h10 ? r10 : a00r,  a10s = h10 ? s10 : a00s;
    const a01r = h01 ? r01 : a00r,  a01s = h01 ? s01 : a00s;
    const a11r = h11 ? r11 : a00r,  a11s = h11 ? s11 : a00s;

    const getRate = (px, py, fallbackR) => {
      const hit = fetchPx(px, py);
      return hit ? hit.rate : fallbackR;
    };

    if (rCenterMax === 0) {
      const ringMax = Math.max(
        getRate(x0 - 1, y0, 0), getRate(x0 + 2, y0, 0),
        getRate(x0 - 1, y0 + 1, 0), getRate(x0 + 2, y0 + 1, 0),
        getRate(x0, y0 - 1, 0), getRate(x0 + 1, y0 - 1, 0),
        getRate(x0, y0 + 2, 0), getRate(x0 + 1, y0 + 2, 0)
      );
      if (ringMax < 0.04) {
        return { hasTile: true, rateMmH: 0, rvSnowMask: 0 };
      }
    }

    const col0 = this._cubic1D(
      getRate(x0 - 1, y0 - 1, a00r), getRate(x0, y0 - 1, a00r), getRate(x0 + 1, y0 - 1, a10r), getRate(x0 + 2, y0 - 1, a10r),
      fx
    );
    const xm1_0 = getRate(x0 - 1, y0, a00r);
    const xp2_0 = getRate(x0 + 2, y0, a10r);
    const col1 = this._cubic1D(xm1_0, a00r, a10r, xp2_0, fx);

    const xm1_1 = getRate(x0 - 1, y0 + 1, a01r);
    const xp2_1 = getRate(x0 + 2, y0 + 1, a11r);
    const col2 = this._cubic1D(xm1_1, a01r, a11r, xp2_1, fx);

    const col3 = this._cubic1D(
      getRate(x0 - 1, y0 + 2, a01r), getRate(x0, y0 + 2, a01r), getRate(x0 + 1, y0 + 2, a11r), getRate(x0 + 2, y0 + 2, a11r),
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
    const linRate = a00r * w00 + a10r * w10 + a01r * w01 + a11r * w11;
    const snowNum = a00r * a00s * w00 + a10r * a10s * w10 + a01r * a01s * w01 + a11r * a11s * w11;
    const rvSnowMask = linRate > 0.01 ? Math.max(0, Math.min(1, snowNum / linRate)) : 0;

    return { hasTile: true, rateMmH, rvSnowMask };
  }
};

// =============================================================================
// 2. VIEWPORT DEM ELEVATION STORE (AWS Terrarium High-Res Tiles + 12x12 Fallback)
// =============================================================================
export const ViewportDemStore = {
  GRID_N: 12,
  MAX_GRIDS: 24,
  TERRARIUM_MAX_TILES: 64,
  STORAGE_KEY: 'viewport_dem_cache_v2',
  STORAGE_TTL: 30 * 24 * 60 * 60 * 1000,
  COOLDOWN_MS: 90 * 1000,
  _storageHydrated: false,
  __cooldownUntil: 0,
  _terrariumDisabled: false,
  _terrariumCanvas: null,
  _terrariumCtx: null,
  terrariumTiles: new Map(), // key `${z}|${x}|${y}` -> { status, z, data: Float32Array(256*256) }
  grids: new Map(),
  inFlight: new Set(),
  _debounceTimer: null,
  _terrariumTimer: null,

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

  _requestTerrariumTile(z, tx, ty) {
    if (this._terrariumDisabled || typeof Image === 'undefined') return null;
    const n = 1 << z;
    const wx = ((tx % n) + n) % n;
    if (ty < 0 || ty >= n) return null;
    const key = `${z}|${wx}|${ty}`;
    const existing = this.terrariumTiles.get(key);
    if (existing) {
      this.terrariumTiles.delete(key);
      this.terrariumTiles.set(key, existing);
      return existing;
    }

    if (this.terrariumTiles.size >= this.TERRARIUM_MAX_TILES) {
      const oldest = this.terrariumTiles.keys().next().value;
      if (oldest) this.terrariumTiles.delete(oldest);
    }

    const entry = { status: 'loading', z, x: wx, y: ty, data: null };
    this.terrariumTiles.set(key, entry);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        if (!this._terrariumCanvas) {
          this._terrariumCanvas = document.createElement('canvas');
          this._terrariumCanvas.width = 256;
          this._terrariumCanvas.height = 256;
          this._terrariumCtx = this._terrariumCanvas.getContext('2d', { willReadFrequently: true });
        }
        const ctx = this._terrariumCtx;
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(img, 0, 0, 256, 256);
        const rgba = ctx.getImageData(0, 0, 256, 256).data;
        const elev = new Float32Array(256 * 256);
        for (let i = 0; i < 65536; i++) {
          const o = i << 2;
          const h = (rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256) - 32768;
          elev[i] = Number.isFinite(h) ? h : 0;
        }
        entry.data = elev;
        entry.status = 'ready';
        if (this._terrariumTimer) clearTimeout(this._terrariumTimer);
        this._terrariumTimer = setTimeout(() => {
          triggerOverlayRefresh(['precip', 'rainviewer-radar', 'temp', 'clouds']);
        }, 120);
      } catch (_) {
        entry.status = 'error';
      }
    };
    img.onerror = () => {
      entry.status = 'error';
    };
    img.src = `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${wx}/${ty}.png`;
    return entry;
  },

  requestTerrariumBounds(bounds, mapZoom) {
    if (!bounds || this._terrariumDisabled) return;
    const z = Math.max(7, Math.min(11, Math.round(mapZoom || 8)));
    const n = 1 << z;
    const nwX = lonToNormX(bounds.getWest());
    const seX = lonToNormX(bounds.getEast());
    const nwY = latToNormY(bounds.getNorth());
    const seY = latToNormY(bounds.getSouth());
    const x0 = Math.floor(nwX * n);
    const x1 = Math.floor(seX * n);
    const y0 = Math.max(0, Math.floor(nwY * n));
    const y1 = Math.min(n - 1, Math.floor(seY * n));

    // Kachel-Burst auf max. 20 Terrarium-Tiles pro Viewport begrenzen
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 20) return;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        this._requestTerrariumTile(z, tx, ty);
      }
    }
  },

  sampleTerrariumElevation(lat, lon) {
    if (!this.terrariumTiles.size) return null;
    const nx = ((lonToNormX(lon) % 1) + 1) % 1;
    const ny = latToNormY(lat);

    // Höchste verfügbare Zoomstufe (11 -> 7) zuerst prüfen
    for (let z = 11; z >= 7; z--) {
      const n = 1 << z;
      const gx = nx * n * 256 - 0.5;
      const gy = ny * n * 256 - 0.5;
      const tx = Math.floor(nx * n);
      const ty = Math.floor(ny * n);
      const entry = this.terrariumTiles.get(`${z}|${tx}|${ty}`);
      if (!entry || entry.status !== 'ready' || !entry.data) continue;

      const lx0 = Math.max(0, Math.min(254, Math.floor(gx - tx * 256)));
      const ly0 = Math.max(0, Math.min(254, Math.floor(gy - ty * 256)));
      const fx = Math.max(0, Math.min(1, (gx - tx * 256) - lx0));
      const fy = Math.max(0, Math.min(1, (gy - ty * 256) - ly0));
      const d = entry.data;
      const row0 = ly0 * 256;
      const row1 = (ly0 + 1) * 256;
      const h00 = d[row0 + lx0];
      const h10 = d[row0 + lx0 + 1];
      const h01 = d[row1 + lx0];
      const h11 = d[row1 + lx0 + 1];
      const h = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
      if (Number.isFinite(h)) return Math.max(0, h);
    }
    return null;
  },

  scheduleFetchForMap(mapInstance) {
    if (!mapInstance || state.activeTab !== 'tab-map') return;
    if (mapInstance.getZoom() < 5) return;
    const sz = mapInstance.getSize ? mapInstance.getSize() : null;
    if (!sz || sz.x < 80 || sz.y < 80) return;

    // 1. Hochauflösende AWS Terrarium Tiles direkt laden (0 API-Quota, ~30–100m Alpentäler)
    this.requestTerrariumBounds(mapInstance.getBounds(), mapInstance.getZoom());

    // 2. Open-Meteo 12x12 Gitter als Fallback / Weitwinkel-Stütze (bei aktivem Cooldown überspringen)
    if (mapInstance.getZoom() < 6 || Date.now() < this._cooldownUntil) return;
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
      const CHUNK = 72;
      const merged = [];
      for (let start = 0; start < lats.length; start += CHUNK) {
        if (Date.now() < this._cooldownUntil) throw new Error('Cooldown');
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
        triggerOverlayRefresh(['precip', 'rainviewer-radar', 'temp']);
      }
    } catch (_) {
      // Stiller Fallback
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
    // Priorität 1: Hochauflösende AWS Terrarium Tiles (~30-100m, täler- & kammgenau)
    const terrariumElev = this.sampleTerrariumElevation(lat, lon);
    if (terrariumElev !== null && Number.isFinite(terrariumElev)) {
      return terrariumElev;
    }

    this.hydrateFromStorage();

    const defaultElev = (state.currentLocation && Number.isFinite(state.currentLocation.elevation))
      ? state.currentLocation.elevation
      : 520;
    let fallbackElev = defaultElev;
    if (stations && stations.length) {
      let sumW = 0, sumE = 0;
      for (let i = 0; i < stations.length; i++) {
        const st = stations[i];
        const dLat = lat - st.lat;
        const dLon = lon - st.lon;
        const d2 = dLat * dLat + dLon * dLon + 0.0009;
        const w = 1 / d2;
        sumW += w;
        sumE += w * (st.elevation !== undefined ? st.elevation : defaultElev);
      }
      if (sumW > 0) fallbackElev = sumE / sumW;
    }

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
// 3. VIEWPORT 5x5 FORECAST GRID STORE (Open-Meteo Multi-Point 48h Modellfeld)
// Verdichtet das Stationsnetz WELTWEIT für ALLE Overlays (inkl. Wind, CAPE, Luftdruck)
// =============================================================================
export const ViewportForecastGridStore = {
  GRID_N: 5,
  MAX_GRIDS: 10,
  STORAGE_KEY: 'viewport_forecast_grid_v3',
  STORAGE_TTL: 45 * 60 * 1000,
  STALE_TTL: 24 * 60 * 60 * 1000,
  COOLDOWN_MS: 90 * 1000,
  _storageHydrated: false,
  __cooldownUntil: 0,
  grids: new Map(),
  inFlight: new Set(),
  _debounceTimer: null,

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
    const z = mapInstance.getZoom ? mapInstance.getZoom() : 0;
    if (z < 5 || z > 14) return;
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

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}&hourly=precipitation,snowfall,temperature_2m,relative_humidity_2m,freezing_level_height,cloud_cover_low,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,cape&forecast_days=3&timezone=GMT`;
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
          press: Array.isArray(h.pressure_msl) ? h.pressure_msl.map(v => Math.round((Number(v) || 1013) * 10) / 10) : [],
          windSpd: Array.isArray(h.wind_speed_10m) ? h.wind_speed_10m.map(v => Math.round((Number(v) || 0) * 10) / 10) : [],
          windDir: Array.isArray(h.wind_direction_10m) ? h.wind_direction_10m.map(v => Math.round(Number(v) || 240)) : [],
          windGust: Array.isArray(h.wind_gusts_10m) ? h.wind_gusts_10m.map(v => Math.round((Number(v) || 0) * 10) / 10) : [],
          wCode: Array.isArray(h.weather_code) ? h.weather_code.map(v => Math.round(Number(v) || 0)) : [],
          cape: Array.isArray(h.cape) ? h.cape.map(v => Math.round(Number(v) || 0)) : []
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

      triggerOverlayRefresh(['precip', 'rainviewer-radar', 'temp', 'wind', 'clouds', 'pressure', 'lightning']);
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

      const pr0 = pt.press && pt.press[i0] !== undefined ? pt.press[i0] : 1013.2;
      const pr1 = pt.press && pt.press[i1] !== undefined ? pt.press[i1] : pr0;
      const pressureMsl = Math.round((pr0 + (pr1 - pr0) * frac) * 10) / 10;

      const ws0 = pt.windSpd && pt.windSpd[i0] !== undefined ? pt.windSpd[i0] : avgWindSpd;
      const ws1 = pt.windSpd && pt.windSpd[i1] !== undefined ? pt.windSpd[i1] : ws0;
      const windSpeed = ws0 + (ws1 - ws0) * frac;

      const wd0 = pt.windDir && pt.windDir[i0] !== undefined ? pt.windDir[i0] : avgWindDir;
      const wd1 = pt.windDir && pt.windDir[i1] !== undefined ? pt.windDir[i1] : wd0;
      let dDiff = wd1 - wd0;
      if (dDiff > 180) dDiff -= 360;
      else if (dDiff < -180) dDiff += 360;
      const windDirection = (wd0 + dDiff * frac + 360) % 360;

      const wg0 = pt.windGust && pt.windGust[i0] !== undefined ? pt.windGust[i0] : windSpeed * 1.4;
      const wg1 = pt.windGust && pt.windGust[i1] !== undefined ? pt.windGust[i1] : wg0;
      const windGusts = wg0 + (wg1 - wg0) * frac;

      const cp0 = pt.cape && pt.cape[i0] !== undefined ? pt.cape[i0] : 0;
      const cp1 = pt.cape && pt.cape[i1] !== undefined ? pt.cape[i1] : cp0;
      const cape = Math.round(cp0 + (cp1 - cp0) * frac);

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
        pressureMsl,
        windSpeed,
        windDirection,
        windGusts,
        cape,
        weatherCode: wc,
        isGridPoint: true
      });
    }
    return out;
  }
};
