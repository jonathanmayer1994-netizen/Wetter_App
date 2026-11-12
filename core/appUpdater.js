/**
 * BEST WEATHER — Autonomous iOS Standalone PWA & GitHub Pages Auto-Updater
 * Solves GitHub Pages Varnish `max-age=600` caching & iOS Home-Screen WebKit suspend/resume locks.
 */

const STORAGE_SIG_KEY = 'bw_deploy_sig';
const RELOAD_TS_KEY = 'bw_last_update_reload_ts';
const RELOAD_COOLDOWN_MS = 15000;
const MIN_CHECK_GAP_MS = 800;

let updaterInitialized = false;
let activeCheckPromise = null;
let lastCheckAt = 0;
let reloadScheduled = false;

function hashShort(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function canTriggerReloadNow() {
  if (reloadScheduled) return false;
  try {
    const lastTs = parseInt(sessionStorage.getItem(RELOAD_TS_KEY) || '0', 10);
    if (lastTs && (Date.now() - lastTs) < RELOAD_COOLDOWN_MS) {
      return false;
    }
  } catch (_) {}
  return true;
}

function triggerHardReload(reason = 'update') {
  if (!canTriggerReloadNow()) return false;
  reloadScheduled = true;
  try {
    sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));
  } catch (_) {}
  console.info(`[AppUpdater] Lade App für neue Version neu (${reason})...`);
  window.location.reload();
  return true;
}

async function clearNonTileCaches() {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => !k.startsWith('best-weather-tiles-'))
        .map((k) => caches.delete(k))
    );
  } catch (_) {}
}

async function registerAndActivateSw(token) {
  if (!('serviceWorker' in navigator)) return null;
  const swUrl = token ? `./sw.js?v=${encodeURIComponent(token)}` : './sw.js';
  try {
    const reg = await navigator.serviceWorker.register(swUrl, {
      scope: './',
      updateViaCache: 'none'
    });

    if (reg.waiting) {
      try { reg.waiting.postMessage({ type: 'SKIP_WAITING', token }); } catch (_) {}
    }

    if (navigator.serviceWorker.controller && token) {
      try { navigator.serviceWorker.controller.postMessage({ type: 'FORCE_REVALIDATE', token }); } catch (_) {}
    }

    await reg.update().catch(() => {});

    if (reg.installing) {
      await new Promise((resolve) => {
        const sw = reg.installing;
        const done = setTimeout(resolve, 1800);
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && reg.waiting) {
            try { reg.waiting.postMessage({ type: 'SKIP_WAITING', token }); } catch (_) {}
          }
          if (sw.state === 'activated' || sw.state === 'redundant') {
            clearTimeout(done);
            resolve();
          }
        });
      });
    }
    return reg;
  } catch (err) {
    console.warn('[AppUpdater] SW Registrierung Hinweis:', err);
    return null;
  }
}

async function fetchOriginSignature() {
  const cb = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const fetchJson = fetch(`./version.json?_bw_cb=${cb}`, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  }).then(async (res) => {
    if (!res.ok) return null;
    try { return await res.json(); } catch (_) { return null; }
  }).catch(() => null);

  const fetchHead = fetch(`./index.html?_bw_cb=${cb}`, {
    method: 'HEAD',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' }
  }).then((res) => {
    if (!res.ok) return null;
    const lm = res.headers.get('last-modified') || '';
    const etag = res.headers.get('etag') || '';
    return (lm || etag) ? `${lm}|${etag}` : null;
  }).catch(() => null);

  const [vData, headSig] = await Promise.all([
    Promise.race([fetchJson, new Promise((r) => setTimeout(() => r(null), 4500))]),
    Promise.race([fetchHead, new Promise((r) => setTimeout(() => r(null), 4500))])
  ]);

  if (!vData && !headSig) return null;
  const vPart = vData ? `${vData.version || ''}|${vData.build || ''}` : '';
  const combined = `${vPart}|${headSig || ''}`;
  return {
    sig: combined,
    token: hashShort(combined)
  };
}

export async function checkForAppUpdate({ reason = 'auto' } = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { updated: false, offline: true };
  }
  const now = Date.now();
  const bypassThrottle = reason === 'boot' || reason === 'visibility' || reason === 'pageshow' || reason === 'online' || reason === 'ptr';
  if (activeCheckPromise) return activeCheckPromise;
  if (!bypassThrottle && (now - lastCheckAt) < MIN_CHECK_GAP_MS) {
    return { updated: false, throttled: true };
  }

  lastCheckAt = now;
  activeCheckPromise = (async () => {
    try {
      const originInfo = await fetchOriginSignature();
      if (!originInfo) return { updated: false, unreachable: true };

      let prevSig = null;
      try {
        prevSig = localStorage.getItem(STORAGE_SIG_KEY);
      } catch (_) {}

      if (!prevSig) {
        try { localStorage.setItem(STORAGE_SIG_KEY, originInfo.sig); } catch (_) {}
        await registerAndActivateSw(originInfo.token);
        return { updated: false, initial: true, token: originInfo.token };
      }

      if (originInfo.sig !== prevSig) {
        try { localStorage.setItem(STORAGE_SIG_KEY, originInfo.sig); } catch (_) {}
        await clearNonTileCaches();
        await registerAndActivateSw(originInfo.token);
        const reloaded = triggerHardReload(reason);
        return { updated: true, reloaded, token: originInfo.token };
      }

      // Signatur unverändert -> normalen SW trotzdem im Hintergrund aktuell halten
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('./').catch(() => null);
        if (reg) {
          if (reg.waiting) {
            try { reg.waiting.postMessage({ type: 'SKIP_WAITING', token: originInfo.token }); } catch (_) {}
          }
          reg.update().catch(() => {});
        }
      }
      return { updated: false, upToDate: true, token: originInfo.token };
    } finally {
      activeCheckPromise = null;
    }
  })();

  return activeCheckPromise;
}

export function initAppUpdater() {
  if (updaterInitialized) return;
  updaterInitialized = true;

  if ('serviceWorker' in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      triggerHardReload('sw-controllerchange');
    });

    window.addEventListener('load', () => {
      setTimeout(() => {
        let storedToken = '';
        try {
          const sig = localStorage.getItem(STORAGE_SIG_KEY);
          if (sig) storedToken = hashShort(sig);
        } catch (_) {}

        registerAndActivateSw(storedToken).then(() => {
          checkForAppUpdate({ reason: 'boot' });
        });
      }, 250);
    });
  } else {
    window.addEventListener('load', () => {
      setTimeout(() => checkForAppUpdate({ reason: 'boot' }), 250);
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForAppUpdate({ reason: 'visibility' });
    }
  });

  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      checkForAppUpdate({ reason: 'pageshow' });
    }
  });

  window.addEventListener('focus', () => {
    checkForAppUpdate({ reason: 'focus' });
  });

  window.addEventListener('online', () => {
    checkForAppUpdate({ reason: 'online' });
  });

  setInterval(() => {
    if (!document.hidden) {
      checkForAppUpdate({ reason: 'interval' });
    }
  }, 180000);
}
