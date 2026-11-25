/**
 * BEST WEATHER — Central DOM, Security & Calendar Helpers
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

/**
 * Escaped HTML-Sonderzeichen sicher für HTML-Text & HTML-Attribute
 */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] || ch);
}

/**
 * Validiert eine externe HTTPS-URL streng per WHATWG URL Parser
 * und prüft optional gegen erlaubte Hostnamen (exakt oder Subdomain).
 */
export function validateHttpsUrl(rawUrl, allowedHosts = null) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (!host) return null;
    if (Array.isArray(allowedHosts) && allowedHosts.length > 0) {
      const ok = allowedHosts.some((allowed) => {
        const cleanAllowed = String(allowed || '').toLowerCase();
        return host === cleanAllowed || host.endsWith(`.${cleanAllowed}`);
      });
      if (!ok) return null;
    }
    return u;
  } catch (_) {
    return null;
  }
}

/**
 * Liefert den lokalen Kalendertag (YYYY-MM-DD) ohne UTC-Tagesverschiebung um Mitternacht
 */
export function getLocalCalendarDateKey(ts = Date.now()) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
