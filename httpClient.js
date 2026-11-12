/**
 * BEST WEATHER — Resilient HTTP Client, Persistent L2 Cache & Global 429 Circuit Breaker
 * Features:
 * - L1 RAM Bounded LRU Cache + L2 Persistent localStorage Cache (Quota-bounded LRU)
 * - Global Persistent HTTP 429 Circuit Breaker (Retry-After / X-RateLimit-Reset aware)
 * - Stale-While-Error / Stale-on-429 Fallback for offline & rate-limit resilience
 * - In-Flight Request Deduplication, AbortController, Auto-Timeouts & XSS Sanitization
 */

const L2_INDEX_KEY = 'bw_http_l2_index_v1';
const L2_ENTRY_PREFIX = 'bw_l2_';
const COOLDOWN_STORAGE_KEY = 'bw_api_cooldowns_v1';
const STATS_STORAGE_KEY = 'bw_api_quota_stats_v1';

const MAX_L2_ENTRIES = 40;
const MAX_L2_TOTAL_CHARS = 2_200_000;
const MAX_L2_ENTRY_CHARS = 550_000;
const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24h Stale-Fallback Aufbewahrung
const DEFAULT_429_COOLDOWN_MS = 90 * 1000;
const MIN_429_COOLDOWN_MS = 15 * 1000;
const MAX_429_COOLDOWN_MS = 30 * 60 * 1000; // max 30 min pro Cooldown-Fenster (schont Quota & bleibt selbstheilend bei IP-Wechsel)

export class HttpStatusError extends Error {
  constructor(status, message, { url = '', retryAfterMs = 0, isCircuitOpen = false } = {}) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
    this.url = url;
    this.retryAfterMs = retryAfterMs;
    this.isCircuitOpen = isCircuitOpen;
  }
}

function getStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (_) {}
  return null;
}

function clonePayload(val) {
  if (val === null || val === undefined || typeof val !== 'object') return val;
  try {
    if (typeof structuredClone === 'function') return structuredClone(val);
  } catch (_) {}
  try {
    return JSON.parse(JSON.stringify(val));
  } catch (_) {
    return val;
  }
}

export function getLocalDateKey(ts = Date.now()) {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isForecastCacheStaleForToday(data, entryTs, effectiveTtl) {
  if (!effectiveTtl || effectiveTtl <= 0 || effectiveTtl > 12 * 60 * 60 * 1000) {
    return false;
  }
  const todayKey = getLocalDateKey(Date.now());
  if (entryTs && getLocalDateKey(entryTs) !== todayKey) {
    return true;
  }
  const firstDaily = data && data.daily && Array.isArray(data.daily.time) && data.daily.time[0]
    ? String(data.daily.time[0]).slice(0, 10)
    : null;
  if (firstDaily && /^\d{4}-\d{2}-\d{2}$/.test(firstDaily) && firstDaily < todayKey) {
    return true;
  }
  return false;
}

// Bounded LRU Cache (L1 RAM) mit TTL + Stale-Aufbewahrung
class BoundedLRUCache {
  constructor(maxEntries = 180) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  getEntry(key, overrideTtlMs = null) {
    const entry = this.map.get(key);
    if (!entry) return null;
    const now = Date.now();
    const effectiveTtl = overrideTtlMs !== null ? Math.min(entry.ttl, overrideTtlMs) : entry.ttl;
    const maxRetention = Math.max(effectiveTtl, entry.staleTtl || DEFAULT_STALE_TTL_MS);

    if (now - entry.timestamp > maxRetention) {
      this.map.delete(key);
      return null;
    }

    // Refresh LRU recency
    this.map.delete(key);
    this.map.set(key, entry);

    const staleByDay = isForecastCacheStaleForToday(entry.data, entry.timestamp, effectiveTtl);

    return {
      data: clonePayload(entry.data),
      timestamp: entry.timestamp,
      isFresh: !staleByDay && (now - entry.timestamp) <= effectiveTtl
    };
  }

  get(key) {
    const entry = this.getEntry(key);
    return entry && entry.isFresh ? entry.data : null;
  }

  set(key, data, ttl, staleTtl = DEFAULT_STALE_TTL_MS) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, {
      data: clonePayload(data),
      timestamp: Date.now(),
      ttl,
      staleTtl: Math.max(ttl, staleTtl)
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  clear() {
    this.map.clear();
  }
}

export const memoryCache = new BoundedLRUCache(180);

// In-Flight Request Deduplication (Key -> Promise)
const inFlightRequests = new Map();

// Active Request Controllers for cancellation categories (e.g. 'main_search')
const activeControllers = new Map();

// =============================================================================
// DAILY API QUOTA TELEMETRY (Diagnose & Verbrauchsüberwachung)
// =============================================================================
function getTodayDateKey() {
  return getLocalDateKey(Date.now());
}

function loadQuotaStats() {
  const today = getTodayDateKey();
  const base = {
    date: today,
    networkCalls: 0,
    estimatedCost: 0,
    cacheHitsMem: 0,
    cacheHitsL2: 0,
    circuitBlocked: 0,
    staleFallbacks: 0,
    http429Count: 0,
    last429At: 0,
    lastRemainingQuota: null
  };
  const ls = getStorage();
  if (!ls) return base;
  try {
    const raw = ls.getItem(STATS_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.date !== today) return base;
    return { ...base, ...parsed };
  } catch (_) {
    return base;
  }
}

function saveQuotaStats(stats) {
  const ls = getStorage();
  if (!ls) return;
  try {
    ls.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch (_) {}
}

function bumpStat(field, delta = 1, extra = null) {
  const stats = loadQuotaStats();
  stats[field] = (stats[field] || 0) + delta;
  if (extra && typeof extra === 'object') {
    Object.assign(stats, extra);
  }
  saveQuotaStats(stats);
}

export function getApiQuotaStats() {
  return loadQuotaStats();
}

export function recordExternalNetworkCall(url, costEstimate = 1, meta = null) {
  const stats = loadQuotaStats();
  stats.networkCalls = (stats.networkCalls || 0) + 1;
  stats.estimatedCost = Math.round(((stats.estimatedCost || 0) + (Number(costEstimate) || 1)) * 100) / 100;
  if (meta && typeof meta === 'object') Object.assign(stats, meta);
  saveQuotaStats(stats);
}

// =============================================================================
// PERSISTENT L2 LOCALSTORAGE CACHE (Bounded LRU + Quota Protection)
// =============================================================================
function hashCacheKey(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (ch + i);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}_${str.length}`;
}

function loadL2Index(ls) {
  try {
    const raw = ls.getItem(L2_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function saveL2Index(ls, index) {
  try {
    ls.setItem(L2_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch (_) {
    return false;
  }
}

function readL2Cache(cacheKey, overrideTtlMs = null) {
  const ls = getStorage();
  if (!ls) return null;
  const id = hashCacheKey(cacheKey);
  const entryKey = `${L2_ENTRY_PREFIX}${id}`;

  try {
    const raw = ls.getItem(entryKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.k !== cacheKey || parsed.v === undefined) {
      return null;
    }

    const now = Date.now();
    const ageMs = now - (parsed.ts || 0);
    const effectiveTtl = overrideTtlMs !== null ? Math.min(parsed.ttl || overrideTtlMs, overrideTtlMs) : (parsed.ttl || 0);
    const maxStale = Math.max(effectiveTtl, parsed.staleTtl || DEFAULT_STALE_TTL_MS);

    if (ageMs > maxStale) {
      // Abgelaufenen Stale-Eintrag aufräumen
      try { ls.removeItem(entryKey); } catch (_) {}
      const idx = loadL2Index(ls).filter((e) => e.id !== id);
      saveL2Index(ls, idx);
      return null;
    }

    const staleByDay = isForecastCacheStaleForToday(parsed.v, parsed.ts, effectiveTtl);

    return {
      data: parsed.v,
      ts: parsed.ts,
      isFresh: !staleByDay && effectiveTtl > 0 && ageMs <= effectiveTtl,
      isStaleValid: true
    };
  } catch (_) {
    return null;
  }
}

function writeL2Cache(cacheKey, data, ttlMs, staleTtlMs = DEFAULT_STALE_TTL_MS) {
  const ls = getStorage();
  if (!ls || ttlMs <= 0) return false;

  const id = hashCacheKey(cacheKey);
  const entryKey = `${L2_ENTRY_PREFIX}${id}`;
  const effectiveStale = Math.max(ttlMs, staleTtlMs || DEFAULT_STALE_TTL_MS);
  const now = Date.now();

  let serialized = '';
  try {
    serialized = JSON.stringify({
      k: cacheKey,
      ts: now,
      ttl: ttlMs,
      staleTtl: effectiveStale,
      v: data
    });
  } catch (_) {
    return false;
  }

  if (!serialized || serialized.length > MAX_L2_ENTRY_CHARS) {
    return false;
  }

  let index = loadL2Index(ls);

  // Abgelaufene Einträge & vorhandenen Eintrag gleicher ID bereinigen
  const cleanIndex = [];
  for (const item of index) {
    if (!item || !item.id) continue;
    const isSame = item.id === id;
    const expired = item.staleTtl && (now - (item.ts || 0) > item.staleTtl);
    if (isSame || expired) {
      if (expired && !isSame) {
        try { ls.removeItem(`${L2_ENTRY_PREFIX}${item.id}`); } catch (_) {}
      }
      continue;
    }
    cleanIndex.push(item);
  }
  index = cleanIndex;

  let totalChars = index.reduce((acc, item) => acc + (item.size || 0), 0);

  // Älteste Einträge verdrängen falls Budget überschritten
  while (index.length > 0 && (index.length >= MAX_L2_ENTRIES || totalChars + serialized.length > MAX_L2_TOTAL_CHARS)) {
    const oldest = index.shift();
    if (oldest) {
      totalChars -= (oldest.size || 0);
      try { ls.removeItem(`${L2_ENTRY_PREFIX}${oldest.id}`); } catch (_) {}
    }
  }

  // Schreiben mit QuotaExceededError-Selbstheilung
  let written = false;
  const maxEvictTries = index.length + 1;
  for (let tries = 0; tries < maxEvictTries; tries++) {
    try {
      ls.setItem(entryKey, serialized);
      written = true;
      break;
    } catch (_) {
      const oldest = index.shift();
      if (!oldest) break;
      try { ls.removeItem(`${L2_ENTRY_PREFIX}${oldest.id}`); } catch (_) {}
    }
  }

  if (!written) return false;

  index.push({
    id,
    ts: now,
    staleTtl: effectiveStale,
    size: serialized.length
  });
  saveL2Index(ls, index);
  return true;
}

export function clearPersistentHttpCache() {
  memoryCache.clear();
  const ls = getStorage();
  if (!ls) return;
  try {
    const idx = loadL2Index(ls);
    for (const item of idx) {
      if (item?.id) ls.removeItem(`${L2_ENTRY_PREFIX}${item.id}`);
    }
    ls.removeItem(L2_INDEX_KEY);
  } catch (_) {}
}

// =============================================================================
// GLOBALER HTTP 429 CIRCUIT BREAKER (Host-basiert, persistent in localStorage)
// =============================================================================
const cooldownMemory = new Map();

export function getRateLimitBucket(url) {
  if (!url) return 'default';
  const rawStr = String(url);
  if (!rawStr.includes('://') && !rawStr.startsWith('/')) {
    return rawStr.toLowerCase();
  }
  try {
    const base = (typeof location !== 'undefined' && location.origin && location.origin !== 'null')
      ? location.origin
      : 'https://localhost';
    const parsed = new URL(rawStr, base);
    return (parsed.hostname || 'default').toLowerCase();
  } catch (_) {
    return 'default';
  }
}

function loadCooldownMap() {
  const now = Date.now();
  const merged = new Map();

  for (const [k, v] of cooldownMemory.entries()) {
    if (v && v.untilMs > now) merged.set(k, v);
    else cooldownMemory.delete(k);
  }

  const ls = getStorage();
  if (ls) {
    try {
      const raw = ls.getItem(COOLDOWN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          let dirty = false;
          for (const [bucket, info] of Object.entries(parsed)) {
            if (info && info.untilMs > now) {
              const prev = merged.get(bucket);
              if (!prev || info.untilMs > prev.untilMs) {
                merged.set(bucket, info);
              }
            } else {
              dirty = true;
            }
          }
          if (dirty) saveCooldownMap(merged);
        }
      }
    } catch (_) {}
  }

  return merged;
}

function saveCooldownMap(map) {
  const now = Date.now();
  const obj = {};
  for (const [bucket, info] of map.entries()) {
    if (info && info.untilMs > now) {
      obj[bucket] = info;
    }
  }
  const ls = getStorage();
  if (!ls) return;
  try {
    if (Object.keys(obj).length === 0) {
      ls.removeItem(COOLDOWN_STORAGE_KEY);
    } else {
      ls.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(obj));
    }
  } catch (_) {}
}

export function getApiCooldownInfo(url) {
  const bucket = getRateLimitBucket(url);
  const map = loadCooldownMap();
  const entry = map.get(bucket);
  const now = Date.now();
  if (!entry || entry.untilMs <= now) return null;
  return {
    active: true,
    bucket,
    untilMs: entry.untilMs,
    remainingMs: entry.untilMs - now,
    reason: entry.reason || 'Rate Limit aktiv',
    serverRetryAfterMs: entry.serverRetryAfterMs || 0,
    trippedAt: entry.trippedAt || 0
  };
}

export function getApiCooldownUntil(url) {
  const info = getApiCooldownInfo(url);
  return info ? info.untilMs : 0;
}

export function isApiCoolingDown(url) {
  return getApiCooldownInfo(url) !== null;
}

export function setApiCooldownUntil(url, untilMs, meta = {}) {
  const bucket = getRateLimitBucket(url);
  const map = loadCooldownMap();
  const now = Date.now();
  if (!untilMs || untilMs <= now) {
    cooldownMemory.delete(bucket);
    map.delete(bucket);
    saveCooldownMap(map);
    return 0;
  }
  const entry = {
    untilMs,
    trippedAt: meta.trippedAt || now,
    reason: meta.reason || '',
    serverRetryAfterMs: meta.serverRetryAfterMs || (untilMs - now)
  };
  cooldownMemory.set(bucket, entry);
  map.set(bucket, entry);
  saveCooldownMap(map);
  return untilMs;
}

export function clearApiCooldown(url = null) {
  if (!url) {
    cooldownMemory.clear();
    const ls = getStorage();
    if (ls) {
      try { ls.removeItem(COOLDOWN_STORAGE_KEY); } catch (_) {}
    }
    return;
  }
  const bucket = getRateLimitBucket(url);
  cooldownMemory.delete(bucket);
  const map = loadCooldownMap();
  map.delete(bucket);
  saveCooldownMap(map);
}

export function parseRetryAfterMs(res, fallbackMs = DEFAULT_429_COOLDOWN_MS) {
  let rawMs = 0;
  try {
    const headers = res && res.headers;
    if (headers && typeof headers.get === 'function') {
      const ra = headers.get('retry-after');
      if (ra !== null && ra !== '') {
        const secs = Number(ra);
        if (Number.isFinite(secs) && secs > 0) {
          rawMs = secs * 1000;
        } else {
          const dateMs = Date.parse(ra);
          if (Number.isFinite(dateMs)) {
            rawMs = Math.max(0, dateMs - Date.now());
          }
        }
      }
      if (!rawMs) {
        const resetHdr = headers.get('x-ratelimit-reset');
        if (resetHdr !== null && resetHdr !== '') {
          const resetEpochSec = Number(resetHdr);
          if (Number.isFinite(resetEpochSec) && resetEpochSec > 0) {
            rawMs = Math.max(0, resetEpochSec * 1000 - Date.now());
          }
        }
      }
    }
  } catch (_) {}

  const effectiveMs = rawMs > 0
    ? Math.min(Math.max(rawMs, MIN_429_COOLDOWN_MS), MAX_429_COOLDOWN_MS)
    : Math.min(Math.max(fallbackMs || DEFAULT_429_COOLDOWN_MS, MIN_429_COOLDOWN_MS), MAX_429_COOLDOWN_MS);

  return { effectiveMs, rawServerMs: rawMs };
}

export function tripCircuitBreaker(url, cooldownMs = DEFAULT_429_COOLDOWN_MS, meta = {}) {
  const boundedMs = Math.min(Math.max(cooldownMs, MIN_429_COOLDOWN_MS), MAX_429_COOLDOWN_MS);
  const untilMs = Date.now() + boundedMs;
  const bucket = getRateLimitBucket(url);
  setApiCooldownUntil(bucket, untilMs, {
    trippedAt: Date.now(),
    reason: meta.reason || 'HTTP 429 Too Many Requests',
    serverRetryAfterMs: meta.serverRetryAfterMs || boundedMs
  });
  bumpStat('http429Count', 1, { last429At: Date.now() });
  return untilMs;
}

export function tripCircuitBreakerFromResponse(url, res, fallbackMs = DEFAULT_429_COOLDOWN_MS, reason = '') {
  const { effectiveMs, rawServerMs } = parseRetryAfterMs(res, fallbackMs);
  return tripCircuitBreaker(url, effectiveMs, {
    reason: reason || `HTTP ${res?.status || 429}`,
    serverRetryAfterMs: rawServerMs || effectiveMs
  });
}

// Helper: Prüft L1 & L2 auf (ggf. abgelaufene) Stale-Fallback-Daten
function getStaleFallbackData(cacheKey, allowStale = true) {
  if (!allowStale) return null;
  const l1 = memoryCache.getEntry(cacheKey);
  if (l1 && l1.data !== undefined && l1.data !== null) {
    return l1.data;
  }
  const l2 = readL2Cache(cacheKey);
  if (l2 && l2.isStaleValid && l2.data !== undefined && l2.data !== null) {
    return l2.data;
  }
  return null;
}

/**
 * XSS-Schutz: Sichere HTML-Maskierung aller Strings vor dem Einfügen in innerHTML
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resilienter Fetch mit:
 * 1. L1 RAM + L2 localStorage Cache
 * 2. Globalem HTTP 429 Circuit Breaker (kein Retry-Spam!)
 * 3. Stale-While-Error / Stale-on-429 Fallback
 * 4. In-Flight Deduplication & Timeout-/Abbruchsteuerung
 */
export async function resilientFetch(url, options = {}) {
  const {
    timeoutMs = 9000,
    ttlMs = 3 * 60 * 1000,
    staleTtlMs = DEFAULT_STALE_TTL_MS,
    cancelCategory = null,
    persist = true,
    allowStaleOnError = true,
    forceRefresh = false,
    cacheKey: customCacheKey = null,
    transformResponse = null
  } = options;

  const key = customCacheKey || String(url);

  // 1. L1 RAM-Cache prüfen
  if (!forceRefresh && ttlMs > 0) {
    const l1Hit = memoryCache.getEntry(key, ttlMs);
    if (l1Hit && l1Hit.isFresh) {
      bumpStat('cacheHitsMem', 1);
      return l1Hit.data;
    }

    // 2. L2 Persistent localStorage Cache prüfen
    if (persist) {
      const l2Hit = readL2Cache(key, ttlMs);
      if (l2Hit && l2Hit.isFresh) {
        memoryCache.set(key, l2Hit.data, ttlMs, staleTtlMs);
        bumpStat('cacheHitsL2', 1);
        return l2Hit.data;
      }
    }
  }

  // 3. Globaler 429-Circuit-Breaker prüfen BEVOR irgendein Netzwerkcall rausgeht
  const cooldownInfo = getApiCooldownInfo(url);
  if (cooldownInfo && cooldownInfo.active) {
    bumpStat('circuitBlocked', 1);
    const stale = getStaleFallbackData(key, allowStaleOnError);
    if (stale !== null) {
      bumpStat('staleFallbacks', 1);
      return stale;
    }
    throw new HttpStatusError(
      429,
      `Circuit Breaker aktiv für ${cooldownInfo.bucket} (noch ${Math.ceil(cooldownInfo.remainingMs / 1000)}s)`,
      { url, retryAfterMs: cooldownInfo.remainingMs, isCircuitOpen: true }
    );
  }

  // 4. In-Flight Request Deduplication: Identische parallele Anfragen teilen sich das Promise (bei forceRefresh frisch laden)
  if (!cancelCategory && !forceRefresh && inFlightRequests.has(key)) {
    return inFlightRequests.get(key);
  }

  // 5. Vorherige Anfrage gleicher Kategorie abbrechen (z. B. Tipp-Suche)
  if (cancelCategory) {
    if (activeControllers.has(cancelCategory)) {
      try {
        activeControllers.get(cancelCategory).abort();
      } catch (_) {}
    }
  }

  const fetchPromise = (async () => {
    const controller = new AbortController();
    let externalAborted = false;
    let timedOut = false;

    if (options.signal) {
      if (options.signal.aborted) {
        externalAborted = true;
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => {
          externalAborted = true;
          controller.abort();
        }, { once: true });
      }
    }
    if (cancelCategory) {
      activeControllers.set(cancelCategory, controller);
    }

    let timeoutId = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error(`Timeout (${timeoutMs}ms) für Anfrage an ${url}`));
        }, timeoutMs);
      });

      const isWeatherApi = /open-meteo\.com|brightsky\.dev|geosphere\.at|rainviewer\.com/i.test(String(url));
      const networkPromise = fetch(url, {
        signal: controller.signal,
        cache: (forceRefresh || isWeatherApi) ? 'no-store' : 'default',
        headers: {
          'Accept': 'application/json',
          ...(options.headers || {})
        }
      });

      const res = await Promise.race([networkPromise, timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);

      // HTTP 429: Globaler Circuit Breaker greift SOFORT ohne Retry-Sturm!
      if (res.status === 429) {
        let reason = '';
        try {
          if (typeof res.clone === 'function') {
            const errJson = await res.clone().json();
            if (errJson && errJson.reason) reason = String(errJson.reason);
          }
        } catch (_) {}

        const untilMs = tripCircuitBreakerFromResponse(url, res, DEFAULT_429_COOLDOWN_MS, reason);
        const remainingMs = Math.max(0, untilMs - Date.now());
        console.warn(`[Circuit Breaker 429] ${getRateLimitBucket(url)} für ${Math.round(remainingMs / 1000)}s pausiert.${reason ? ` (${reason})` : ''}`);

        const stale = getStaleFallbackData(key, allowStaleOnError);
        if (stale !== null) {
          bumpStat('staleFallbacks', 1);
          return stale;
        }
        throw new HttpStatusError(429, `HTTP Error 429: ${reason || res.statusText || 'Too Many Requests'}`, {
          url,
          retryAfterMs: remainingMs
        });
      }

      if (!res.ok) {
        if (res.status >= 500) {
          const stale = getStaleFallbackData(key, allowStaleOnError);
          if (stale !== null) {
            bumpStat('staleFallbacks', 1);
            return stale;
          }
        }
        throw new HttpStatusError(res.status, `HTTP Error ${res.status}: ${res.statusText || 'Error'}`, { url });
      }

      // Open-Meteo Quota-Header für Verbrauchsstatistik mitlesen
      let callCost = 1;
      let remainingHeader = null;
      try {
        if (res.headers && typeof res.headers.get === 'function') {
          const c = Number(res.headers.get('x-ratelimit-cost'));
          if (Number.isFinite(c) && c > 0) callCost = c;
          const rem = Number(res.headers.get('x-ratelimit-remaining'));
          if (Number.isFinite(rem)) remainingHeader = rem;
        }
      } catch (_) {}

      const rawData = await res.json();

      recordExternalNetworkCall(url, callCost, remainingHeader !== null ? { lastRemainingQuota: remainingHeader } : null);

      const data = typeof transformResponse === 'function'
        ? transformResponse(rawData)
        : rawData;

      // Bei Erfolg L1 + L2 Cache aktualisieren
      if (ttlMs > 0 && data !== undefined && data !== null) {
        memoryCache.set(key, data, ttlMs, staleTtlMs);
        if (persist) {
          writeL2Cache(key, data, ttlMs, staleTtlMs);
        }
      }

      return data;
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);

      // Expliziten Abbruch (z. B. Tipp-Suche oder Tab-Wechsel) niemals mit Stale-Daten überspielen
      if ((err.name === 'AbortError' || externalAborted) && !timedOut) {
        throw err;
      }

      if (err instanceof HttpStatusError && err.status === 429) {
        throw err;
      }

      // Netzwerk-/Timeout-Fehler: Auf vorhandene Stale-Daten zurückfallen, falls erlaubt
      if (allowStaleOnError && !externalAborted) {
        const stale = getStaleFallbackData(key, allowStaleOnError);
        if (stale !== null) {
          bumpStat('staleFallbacks', 1);
          return stale;
        }
      }
      throw err;
    } finally {
      if (cancelCategory && activeControllers.get(cancelCategory) === controller) {
        activeControllers.delete(cancelCategory);
      }
    }
  })();

  if (!cancelCategory) {
    inFlightRequests.set(key, fetchPromise);
    fetchPromise
      .finally(() => {
        if (inFlightRequests.get(key) === fetchPromise) {
          inFlightRequests.delete(key);
        }
      })
      .catch(() => {});
  }

  return fetchPromise;
}

if (typeof window !== 'undefined') {
  window.BestWeatherHttp = {
    getApiQuotaStats,
    getApiCooldownInfo,
    isApiCoolingDown,
    clearApiCooldown,
    clearPersistentHttpCache
  };
}
