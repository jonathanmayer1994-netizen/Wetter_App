/**
 * BEST WEATHER — Native iOS-Grade & Cross-Platform Pull-Down-to-Refresh Module
 * Elastic pull-down gesture on Dashboard (#tab-overview) and Stadtklima / Bergklima (#tab-mountain)
 * Supports iOS Safari / Standalone PWA Touch, Android Chrome Touch, Desktop Pointer/Mouse Drag & Mac Trackpad.
 */

import { GoogleSheetsSync } from '../core/googleSheetsSync.js';

let startX = 0;
let startY = 0;
let gestureTarget = null;
let gestureActive = false;
let isPulling = false;
let pointerDown = false;
let mouseStartX = 0;
let mouseStartY = 0;
let suppressNextClick = false;
let wheelPulling = false;
let wheelAccum = 0;
let wheelEndTimer = null;
let collapseTimer = null;
let lastNonTopScrollAt = 0;
let isRefreshing = false;
let activePaneEl = null;
let initialized = false;

const THRESHOLD = 48;
const MAX_PULL_PX = 76;

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
      if (el && getComputedStyle(el).display !== 'none') return true;
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
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
          if (el.scrollTop > 3) return false;
        }
      }
      el = el.parentElement;
    }
    return true;
  }

  function canPull(target = null) {
    if (isRefreshing) return false;

    const activePane = getActiveTabPane();
    if (!isSupportedTab(activePane)) return false;

    if (hasOpenModalOrOverlay()) return false;

    if (target && target.closest(
      '#map-container, .leaflet-container, .leaflet-control, #sports-map, ' +
      '.range-slider, .track-slider, #route-scrubber, ' +
      '.interactive-chart, .day-chart-svg-wrap, #ensemble-meteogram-svg, #ensemble-meteogram-canvas, ' +
      'input, textarea, select, [contenteditable="true"]'
    )) {
      return false;
    }

    return isAtScrollTop(target);
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
    const pullDist = Math.min(Math.pow(Math.max(rawDeltaY, 1), 0.78) * 1.35, MAX_PULL_PX);
    indicator.style.height = `${Math.round(pullDist)}px`;
    indicator.style.opacity = `${Math.min(pullDist / 22, 1)}`;
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
      let weatherPromise = Promise.resolve(null);
      if (onRefreshWeather && window.state?.currentLocation) {
        weatherPromise = Promise.resolve(onRefreshWeather(window.state.currentLocation)).catch(() => ({ ok: false }));
      }

      const syncPromise = Promise.resolve(
        onRefreshSync ? onRefreshSync() : GoogleSheetsSync.pullAll()
      ).catch(() => null);

      weatherResult = await weatherPromise;
      await Promise.race([syncPromise, new Promise(resolve => setTimeout(resolve, 350))]);

      const timeStr = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (text) text.innerText = '⚠️ Offline — Cache aktiv';
      } else if (weatherResult && weatherResult.isRateLimit) {
        if (text) text.innerText = '⏳ API-Cooldown · Cache aktiv';
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

  // ---------------------------------------------------------------------------
  // 1. TOUCH HANDLER (iOS Safari / iOS PWA 120Hz / Android Chrome)
  // ---------------------------------------------------------------------------
  function handleTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) {
      gestureActive = false;
      gestureTarget = null;
      return;
    }
    if (!canPull(e.target)) {
      gestureActive = false;
      gestureTarget = null;
      isPulling = false;
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    gestureTarget = e.target;
    gestureActive = true;
    isPulling = false;
    activePaneEl = getActiveTabPane();
  }

  function handleTouchMove(e) {
    if (!gestureActive || isRefreshing || !e.touches || e.touches.length !== 1) return;

    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const diffX = Math.abs(x - startX);
    const diffY = y - startY;

    if (!isPulling) {
      // Nach oben oder horizontal wischen -> native Scroll sofort freigeben
      if (diffY < -0.5 || (diffX > 4 && diffX >= Math.max(diffY, 0))) {
        gestureActive = false;
        gestureTarget = null;
        return;
      }
      // Auf iOS WebKit (120Hz) sofort beim allerersten Abwärts-Tick preventDefault(),
      // bevor UIScrollView ein natives Rubber-Banding übernimmt!
      if (diffY > 0.15 && diffY > diffX * 1.05) {
        if (!canPull(gestureTarget || e.target)) {
          gestureActive = false;
          gestureTarget = null;
          return;
        }
        if (e.cancelable) e.preventDefault();
        if (diffY >= 2) {
          isPulling = true;
          beginVisualPull();
        } else {
          return;
        }
      } else {
        return;
      }
    }

    if (isPulling && diffY > 0) {
      if (e.cancelable) e.preventDefault();
      updatePullUI(diffY);
    } else if (isPulling && diffY <= 0) {
      indicator.style.height = '0px';
      indicator.style.opacity = '0';
      indicator.dataset.pullDist = '0';
    }
  }

  async function handleTouchEnd() {
    gestureTarget = null;
    if (!gestureActive && !isPulling) return;
    gestureActive = false;

    if (!isPulling) {
      activePaneEl = null;
      return;
    }
    isPulling = false;

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
      if (diffY < -2 || (diffX > 8 && diffX >= Math.max(diffY, 0))) {
        pointerDown = false;
        return;
      }
      if (diffY > 12 && diffY > diffX * 1.4 && canPull(e.target)) {
        const sel = window.getSelection?.()?.toString();
        if (sel && sel.length > 0) {
          pointerDown = false;
          return;
        }
        isPulling = true;
        suppressNextClick = true;
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

    const pullDist = parseFloat(indicator.dataset.pullDist || '0');
    delete indicator.dataset.pullDist;

    setTimeout(() => { suppressNextClick = false; }, 120);

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
    }
  }, true);

  document.addEventListener('touchstart', handleTouchStart, { passive: true });
  document.addEventListener('touchmove', handleTouchMove, { passive: false });
  document.addEventListener('touchend', handleTouchEnd, { passive: true });
  document.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  document.addEventListener('pointerdown', handlePointerDown, { passive: true });
  document.addEventListener('pointermove', handlePointerMove, { passive: true });
  document.addEventListener('pointerup', handlePointerUp, { passive: true });
  document.addEventListener('pointercancel', handlePointerUp, { passive: true });

  window.addEventListener('wheel', handleWheel, { passive: true });
}
