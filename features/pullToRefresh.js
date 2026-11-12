/**
 * BEST WEATHER — Native iOS-Grade & Cross-Platform Pull-Down-to-Refresh Module
 * Elastic pull-down gesture on Dashboard (#tab-overview) and Stadtklima / Bergklima (#tab-mountain)
 * Supports iOS Safari / Standalone PWA Touch (120Hz Retina), Android Chrome Touch, Desktop Pointer Drag & Mac Trackpad.
 */

import { GoogleSheetsSync } from '../core/googleSheetsSync.js';
import { checkForAppUpdate } from '../core/appUpdater.js?v=2.9.3';

let startX = 0;
let startY = 0;
let activeTouchId = null;
let gestureTarget = null;
let gestureActive = false;
let directionLocked = null; // null | 'pull' | 'native'
let isPulling = false;
let pointerDown = false;
let mouseStartX = 0;
let mouseStartY = 0;
let suppressNextClick = false;
let suppressClickTimer = null;
let wheelPulling = false;
let wheelAccum = 0;
let wheelEndTimer = null;
let collapseTimer = null;
let lastNonTopScrollAt = 0;
let isRefreshing = false;
let activePaneEl = null;
let initialized = false;

const THRESHOLD = 48;
const MAX_PULL_PX = 80;
const REFRESH_TIMEOUT_MS = 12000;

export function initPullToRefresh({ onRefreshWeather, onRefreshSync } = {}) {
  const indicator = document.getElementById('pull-to-refresh');
  const arrow = document.getElementById('ptr-arrow');
  const text = document.getElementById('ptr-text');
  const appLayout = document.querySelector('.app-layout');

  if (!indicator || initialized) return;
  initialized = true;

  function getActiveTabPane() {
    return document.querySelector('.tab-pane.active');
  }

  function isSupportedTab(pane) {
    if (!pane) return false;
    return pane.id === 'tab-overview' || pane.id === 'tab-mountain';
  }

  function getContextLabel(pane) {
    if (pane?.id === 'tab-mountain') {
      return window.state?.currentLocation?.isMountain ? 'Bergklima' : 'Stadtklima';
    }
    return 'Dashboard';
  }

  function getScrollY() {
    return Math.max(
      0,
      appLayout ? appLayout.scrollTop : 0,
      window.scrollY || 0,
      document.scrollingElement ? document.scrollingElement.scrollTop : 0,
      document.documentElement ? document.documentElement.scrollTop : 0,
      document.body ? document.body.scrollTop : 0
    );
  }

  function hasOpenModalOrOverlay() {
    if (document.body.classList.contains('modal-open')) return true;
    if (document.querySelector('.modal-overlay.active, .sheet-overlay.active, .drawer-open, .bento-sheet-open')) {
      return true;
    }
    const overlayIds = [
      'day-detail-modal',
      'bento-detail-modal',
      'gpx-modal-overlay',
      'webcam-modal-overlay',
      'cloud-sync-modal',
      'spotlight-modal-overlay'
    ];
    for (const id of overlayIds) {
      const el = document.getElementById(id);
      if (el) {
        const st = getComputedStyle(el);
        if (st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0') {
          return true;
        }
      }
    }
    return false;
  }

  function isAtScrollTop(target) {
    if (getScrollY() > 3) return false;

    const activePane = getActiveTabPane();
    if (activePane && activePane.scrollTop > 3) return false;

    let el = target && target.nodeType === 1 ? target : null;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el !== appLayout) {
        const style = getComputedStyle(el);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
          if (el.scrollTop > 3) return false;
        }
      }
      el = el.parentElement;
    }
    return true;
  }

  function resolveLiveTarget(candidate, fallbackTarget, x, y) {
    if (candidate && candidate.isConnected) return candidate;
    if (fallbackTarget && fallbackTarget.isConnected) return fallbackTarget;
    if (typeof x === 'number' && typeof y === 'number' && document.elementFromPoint) {
      return document.elementFromPoint(x, y);
    }
    return null;
  }

  function canPull(target = null) {
    if (isRefreshing) return false;

    const activePane = getActiveTabPane();
    if (!isSupportedTab(activePane)) return false;

    if (hasOpenModalOrOverlay()) return false;

    if (target && target.nodeType === 1 && target.closest(
      '#map-container, .leaflet-container, .leaflet-control, #sports-map, ' +
      '.range-slider, .track-slider, #route-scrubber, ' +
      '.interactive-chart, .day-chart-svg-wrap, #ensemble-meteogram-svg, #ensemble-meteogram-canvas, ' +
      'input, textarea, select, [contenteditable="true"]'
    )) {
      return false;
    }

    return isAtScrollTop(target);
  }

  function armSuppressClick() {
    suppressNextClick = true;
    if (suppressClickTimer) clearTimeout(suppressClickTimer);
    suppressClickTimer = setTimeout(() => {
      suppressNextClick = false;
      suppressClickTimer = null;
    }, 320);
  }

  function beginVisualPull() {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
    indicator.classList.add('ptr-active');
    indicator.style.transition = 'none';
  }

  function updatePullUI(rawDeltaY) {
    const pullDist = Math.min(Math.pow(Math.max(rawDeltaY, 1), 0.78) * 1.38, MAX_PULL_PX);
    indicator.style.height = `${Math.round(pullDist)}px`;
    indicator.style.opacity = `${Math.min(pullDist / 20, 1)}`;
    indicator.dataset.pullDist = String(Math.round(pullDist));

    const pane = activePaneEl || getActiveTabPane();
    const contextLabel = getContextLabel(pane);
    if (pullDist >= THRESHOLD) {
      indicator.classList.add('ptr-ready');
      if (arrow) arrow.style.transform = 'rotate(180deg)';
      if (text) text.innerText = `Loslassen zum Aktualisieren (${contextLabel})`;
    } else {
      indicator.classList.remove('ptr-ready');
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      if (text) text.innerText = `Nach unten ziehen (${contextLabel})...`;
    }
    return pullDist;
  }

  function collapseIndicator() {
    activePaneEl = null;
    wheelPulling = false;
    wheelAccum = 0;
    if (collapseTimer) clearTimeout(collapseTimer);
    indicator.style.transition = 'height 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
    indicator.style.height = '0px';
    indicator.style.opacity = '0';
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      indicator.classList.remove('is-refreshing', 'ptr-ready', 'ptr-success', 'ptr-active');
      if (arrow) arrow.style.transform = 'rotate(0deg)';
      isRefreshing = false;
    }, 260);
  }

  async function executeRefresh() {
    isRefreshing = true;
    const contextLabel = getContextLabel(activePaneEl || getActiveTabPane());
    indicator.style.transition = 'height 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
    indicator.classList.add('ptr-active', 'is-refreshing');
    indicator.style.height = '54px';
    indicator.style.opacity = '1';
    if (text) text.innerText = `Aktualisiere ${contextLabel}...`;

    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (_) {}
    }

    let weatherResult = null;
    try {
      const updatePromise = checkForAppUpdate({ reason: 'ptr' }).catch(() => null);

      let weatherPromise = Promise.resolve(null);
      if (onRefreshWeather && window.state?.currentLocation) {
        weatherPromise = Promise.race([
          Promise.resolve(onRefreshWeather(window.state.currentLocation)).catch(() => ({ ok: false })),
          new Promise(resolve => setTimeout(() => resolve({ ok: false, timedOut: true }), REFRESH_TIMEOUT_MS))
        ]);
      }

      const syncPromise = Promise.resolve(
        onRefreshSync ? onRefreshSync() : GoogleSheetsSync.pullAll()
      ).catch(() => null);

      const updateRes = await Promise.race([updatePromise, new Promise(resolve => setTimeout(() => resolve(null), 1200))]);
      if (updateRes && updateRes.updated) {
        if (text) text.innerText = '🔄 Neue Version gefunden — aktualisiere App...';
        return;
      }

      weatherResult = await weatherPromise;
      await Promise.race([syncPromise, new Promise(resolve => setTimeout(resolve, 350))]);

      const timeStr = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (text) text.innerText = '⚠️ Offline — Cache aktiv';
      } else if (weatherResult && weatherResult.isRateLimit) {
        if (text) text.innerText = '⏳ API-Cooldown · Cache aktiv';
      } else if (weatherResult && weatherResult.timedOut) {
        if (text) text.innerText = '⚠️ Zeitüberschreitung — Cache aktiv';
      } else if (weatherResult && weatherResult.ok === false && !weatherResult.aborted) {
        if (text) text.innerText = '⚠️ Verbindung gestört — Cache aktiv';
      } else {
        if (text) text.innerText = `✓ Aktualisiert · ${timeStr}`;
        indicator.classList.add('ptr-success');
      }
    } catch (_) {
      if (text) text.innerText = '⚠️ Aktualisierung fehlgeschlagen';
    } finally {
      setTimeout(collapseIndicator, 650);
    }
  }

  function findActiveTouch(touches) {
    if (!touches || touches.length === 0) return null;
    if (activeTouchId !== null) {
      for (let i = 0; i < touches.length; i++) {
        if (touches[i].identifier === activeTouchId) return touches[i];
      }
    }
    return touches[0];
  }

  // ---------------------------------------------------------------------------
  // 1. TOUCH HANDLER (iOS Safari / iOS PWA 120Hz Retina / Android Chrome)
  // ---------------------------------------------------------------------------
  function handleTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) {
      if (isPulling && parseFloat(indicator.dataset.pullDist || '0') < THRESHOLD) {
        collapseIndicator();
      }
      gestureActive = false;
      gestureTarget = null;
      directionLocked = null;
      activeTouchId = null;
      isPulling = false;
      return;
    }

    const t = e.touches[0];
    if (!canPull(e.target)) {
      gestureActive = false;
      gestureTarget = null;
      directionLocked = null;
      activeTouchId = null;
      isPulling = false;
      return;
    }

    startX = t.clientX;
    startY = t.clientY;
    activeTouchId = t.identifier;
    gestureTarget = e.target;
    gestureActive = true;
    directionLocked = null;
    isPulling = false;
    activePaneEl = getActiveTabPane();
  }

  function handleTouchMove(e) {
    if (!gestureActive || isRefreshing || !e.touches || e.touches.length !== 1) return;

    const t = findActiveTouch(e.touches);
    if (!t) return;

    const x = t.clientX;
    const y = t.clientY;
    const diffX = Math.abs(x - startX);
    const diffY = y - startY;

    if (!isPulling) {
      // Klares Wischen nach oben (Seiten-Scroll nach unten) oder Horizontal (24h Slider) -> nativ freigeben
      if (diffY <= -6 || (diffX >= 9 && diffX > Math.max(diffY, 0) * 1.15)) {
        directionLocked = 'native';
        gestureActive = false;
        gestureTarget = null;
        return;
      }

      // Sofort beim ersten Abwärts-Mikro-Impuls preventDefault() aufrufen,
      // bevor iOS UIScrollView die Geste als nativen Scroll kapert!
      if (diffY > 0 && (diffY >= diffX * 0.75 || diffX <= 3)) {
        const liveTarget = resolveLiveTarget(gestureTarget, e.target, x, y);
        if (!canPull(liveTarget)) {
          directionLocked = 'native';
          gestureActive = false;
          gestureTarget = null;
          return;
        }
        if (e.cancelable) e.preventDefault();
        if (diffY >= 3 && diffY > diffX * 0.95) {
          directionLocked = 'pull';
          isPulling = true;
          armSuppressClick();
          beginVisualPull();
        } else {
          return;
        }
      } else {
        // Noch im Sub-Pixel-Finger-Settle (< 6px nach oben) -> weiter beobachten
        return;
      }
    }

    if (isPulling) {
      if (e.cancelable) e.preventDefault();
      if (diffY > 0) {
        updatePullUI(diffY);
      } else {
        indicator.style.height = '0px';
        indicator.style.opacity = '0';
        indicator.dataset.pullDist = '0';
      }
    }
  }

  async function finalizeTouchGesture(wasCancelled = false) {
    gestureTarget = null;
    activeTouchId = null;
    directionLocked = null;
    if (!gestureActive && !isPulling) return;
    gestureActive = false;

    if (!isPulling) {
      activePaneEl = null;
      return;
    }
    isPulling = false;
    armSuppressClick();

    const pullDist = parseFloat(indicator.dataset.pullDist || '0');
    delete indicator.dataset.pullDist;

    if (!wasCancelled && pullDist >= THRESHOLD) {
      await executeRefresh();
    } else {
      indicator.classList.remove('ptr-ready');
      collapseIndicator();
    }
  }

  function handleTouchEnd() {
    finalizeTouchGesture(false);
  }

  function handleTouchCancel() {
    finalizeTouchGesture(true);
  }

  // ---------------------------------------------------------------------------
  // 2. DESKTOP POINTER / MOUSE DRAG HANDLER (nicht-Touch Browser / DevTools)
  // ---------------------------------------------------------------------------
  function handlePointerDown(e) {
    if (e.pointerType === 'touch' || e.button !== 0 || isRefreshing) return;
    if (e.target && e.target.closest('button, a, input, textarea, select, summary, [contenteditable="true"]')) return;
    if (!canPull(e.target)) return;

    pointerDown = true;
    mouseStartX = e.clientX;
    mouseStartY = e.clientY;
    activePaneEl = getActiveTabPane();
  }

  function handlePointerMove(e) {
    if (!pointerDown || e.pointerType === 'touch' || isRefreshing) return;
    const diffX = Math.abs(e.clientX - mouseStartX);
    const diffY = e.clientY - mouseStartY;

    if (!isPulling) {
      if (diffY < -4 || (diffX > 8 && diffX >= Math.max(diffY, 0))) {
        pointerDown = false;
        return;
      }
      if (diffY > 14 && diffY > diffX * 1.8 && canPull(e.target)) {
        isPulling = true;
        armSuppressClick();
        try { window.getSelection?.()?.removeAllRanges(); } catch (_) {}
        beginVisualPull();
      } else {
        return;
      }
    }

    if (isPulling && diffY > 0) {
      updatePullUI(diffY);
    }
  }

  async function handlePointerUp(e) {
    if (!pointerDown || e.pointerType === 'touch') return;
    pointerDown = false;

    if (!isPulling) {
      activePaneEl = null;
      return;
    }
    isPulling = false;
    armSuppressClick();

    const pullDist = parseFloat(indicator.dataset.pullDist || '0');
    delete indicator.dataset.pullDist;

    if (pullDist >= THRESHOLD) {
      await executeRefresh();
    } else {
      indicator.classList.remove('ptr-ready');
      collapseIndicator();
    }
  }

  // ---------------------------------------------------------------------------
  // 3. MAC TRACKPAD / WHEEL OVERSCROLL AT TOP (Zwei-Finger-Wisch nach unten)
  // ---------------------------------------------------------------------------
  function handleWheel(e) {
    if (isRefreshing || gestureActive || pointerDown) return;

    if (wheelPulling && e.deltaY > 4) {
      if (wheelEndTimer) clearTimeout(wheelEndTimer);
      wheelPulling = false;
      wheelAccum = 0;
      delete indicator.dataset.pullDist;
      collapseIndicator();
      return;
    }

    if (e.deltaY >= -3 || Math.abs(e.deltaY) <= Math.abs(e.deltaX) * 1.3) return;
    if ((Date.now() - lastNonTopScrollAt) < 380) return;
    if (!canPull(e.target)) return;

    if (!wheelPulling) {
      wheelPulling = true;
      wheelAccum = 0;
      activePaneEl = getActiveTabPane();
      beginVisualPull();
    }

    wheelAccum = Math.min(wheelAccum + (-e.deltaY * 0.45), 140);
    updatePullUI(wheelAccum);

    if (wheelEndTimer) clearTimeout(wheelEndTimer);
    wheelEndTimer = setTimeout(async () => {
      if (!wheelPulling) return;
      wheelPulling = false;
      const pullDist = parseFloat(indicator.dataset.pullDist || '0');
      delete indicator.dataset.pullDist;
      wheelAccum = 0;

      if (pullDist >= THRESHOLD && !isRefreshing) {
        await executeRefresh();
      } else {
        indicator.classList.remove('ptr-ready');
        collapseIndicator();
      }
    }, 220);
  }

  const trackScroll = () => {
    if (getScrollY() > 3) lastNonTopScrollAt = Date.now();
  };
  window.addEventListener('scroll', trackScroll, { passive: true });
  if (appLayout) appLayout.addEventListener('scroll', trackScroll, { passive: true });

  document.addEventListener('click', (e) => {
    if (suppressNextClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressNextClick = false;
      if (suppressClickTimer) {
        clearTimeout(suppressClickTimer);
        suppressClickTimer = null;
      }
    }
  }, true);

  document.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
  document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
  document.addEventListener('touchcancel', handleTouchCancel, { passive: true, capture: true });

  document.addEventListener('pointerdown', handlePointerDown, { passive: true });
  document.addEventListener('pointermove', handlePointerMove, { passive: true });
  document.addEventListener('pointerup', handlePointerUp, { passive: true });
  document.addEventListener('pointercancel', handlePointerUp, { passive: true });

  window.addEventListener('wheel', handleWheel, { passive: true });
}
