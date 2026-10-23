/**
 * BEST WEATHER — Resilient HTTP Client & Security Utilities
 * Features: Request-Deduplication, AbortController, Auto-Timeouts,
 * Bounded LRU Caching, Exponential Backoff, and XSS Sanitization.
 */

// Bounded LRU Cache with TTL to prevent memory leaks in long-running sessions
class BoundedLRUCache {
  constructor(maxEntries = 150) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.map.delete(key);
      return null;
    }
    // Refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.data;
  }

  set(key, data, ttl) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, { data, timestamp: Date.now(), ttl });
  }

  has(key) {
    return this.get(key) !== null;
  }

  clear() {
    this.map.clear();
  }
}

export const memoryCache = new BoundedLRUCache(150);

// In-Flight Request Deduplication (URL -> Promise)
const inFlightRequests = new Map();

// Active Request Controllers for cancellation categories (e.g. 'search')
const activeControllers = new Map();

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
 * Resilienter Fetch mit Timeout, Cache, In-Flight Deduplication und automatischer Abbruchsteuerung
 */
export async function resilientFetch(url, options = {}) {
  const {
    timeoutMs = 9000,
    ttlMs = 3 * 60 * 1000, // 3 Minuten Standard-Cache
    cancelCategory = null, // z.B. 'search', bricht vorherige Anfrage dieser Kategorie ab
    retryOn429 = true
  } = options;

  // 1. In-Memory Cache prüfen
  const cached = memoryCache.get(url);
  if (cached !== null) {
    return cached;
  }

  // 2. In-Flight Request Deduplication: Falls identische URL bereits lädt und nicht cancelable ist
  if (!cancelCategory && inFlightRequests.has(url)) {
    return inFlightRequests.get(url);
  }

  // 3. Vorherige Anfrage gleicher Kategorie abbrechen (Race-Condition Schutz)
  if (cancelCategory) {
    if (activeControllers.has(cancelCategory)) {
      try {
        activeControllers.get(cancelCategory).abort();
      } catch (e) {}
    }
  }

  const fetchPromise = (async () => {
    const controller = new AbortController();
    if (cancelCategory) {
      activeControllers.set(cancelCategory, controller);
    }

    let attempt = 0;
    const maxAttempts = retryOn429 ? 2 : 1;

    while (attempt < maxAttempts) {
      attempt++;
      let timeoutId = null;

      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(`Timeout (${timeoutMs}ms) für Anfrage an ${url}`));
          }, timeoutMs);
        });

        const networkPromise = fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            ...(options.headers || {})
          }
        });

        const res = await Promise.race([networkPromise, timeoutPromise]);
        if (timeoutId) clearTimeout(timeoutId);

        if (res.status === 429 && attempt < maxAttempts) {
          console.warn(`[HTTP 429] Rate Limit erreicht für ${url}. Warte vor Wiederholung...`);
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();

        // Erfolgreichen Call im Bounded LRU Cache ablegen
        if (ttlMs > 0) {
          memoryCache.set(url, data, ttlMs);
        }

        if (cancelCategory && activeControllers.get(cancelCategory) === controller) {
          activeControllers.delete(cancelCategory);
        }

        return data;
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);

        if (err.name === 'AbortError' || err.message?.includes('Timeout')) {
          if (cancelCategory && activeControllers.get(cancelCategory) === controller) {
            activeControllers.delete(cancelCategory);
          }
          throw err;
        }

        if (attempt >= maxAttempts) {
          if (cancelCategory && activeControllers.get(cancelCategory) === controller) {
            activeControllers.delete(cancelCategory);
          }
          throw err;
        }
      }
    }
  })();

  if (!cancelCategory) {
    inFlightRequests.set(url, fetchPromise);
    fetchPromise
      .finally(() => {
        inFlightRequests.delete(url);
      })
      .catch(() => {});
  }

  return fetchPromise;
}
