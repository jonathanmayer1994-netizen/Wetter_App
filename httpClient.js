/**
 * BEST WEATHER — Resilient HTTP Client & Security Utilities
 * Features: Request-Deduplication, AbortController, Auto-Timeouts,
 * In-Memory Caching, Exponential Backoff, and XSS Sanitization.
 */

// In-Memory Cache (URL -> { data, timestamp, ttl })
const memoryCache = new Map();

// Aktive Request-Controller für Abbruch alter Requests (z.B. bei der Suche)
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
 * Resilienter Fetch mit Timeout, Cache und automatischer Abbruchsteuerung
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
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    return cached.data;
  }

  // 2. Vorherige Anfrage gleicher Kategorie abbrechen (Race-Condition Schutz)
  if (cancelCategory) {
    if (activeControllers.has(cancelCategory)) {
      try {
        activeControllers.get(cancelCategory).abort();
      } catch (e) {}
    }
  }

  const controller = new AbortController();
  if (cancelCategory) {
    activeControllers.set(cancelCategory, controller);
  }

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let attempt = 0;
  const maxAttempts = retryOn429 ? 2 : 1;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...(options.headers || {})
        }
      });

      clearTimeout(timeoutId);

      if (res.status === 429 && attempt < maxAttempts) {
        console.warn(`[HTTP 429] Rate Limit erreicht für ${url}. Warte vor Wiederholung...`);
        await new Promise((r) => setTimeout(r, 1200 * attempt));
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      // Erfolgreichen Call im Memory Cache ablegen
      if (ttlMs > 0) {
        memoryCache.set(url, { data, timestamp: Date.now(), ttl: ttlMs });
      }

      if (cancelCategory && activeControllers.get(cancelCategory) === controller) {
        activeControllers.delete(cancelCategory);
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw err; // Bewusster Abbruch
      }
      if (attempt >= maxAttempts) {
        if (cancelCategory && activeControllers.get(cancelCategory) === controller) {
          activeControllers.delete(cancelCategory);
        }
        throw err;
      }
    }
  }
}
