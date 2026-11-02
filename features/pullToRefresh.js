/**
 * BEST WEATHER — Native iOS-Grade Pull-Down-to-Refresh Module
 * Smooth elastic pull-down gesture to refresh live weather data and trigger Google Sheets cloud sync.
 */

import { GoogleSheetsSync } from '../core/googleSheetsSync.js';

let isPulling = false;
let startY = 0;
let currentY = 0;
let isRefreshing = false;

const THRESHOLD = 65;

export function initPullToRefresh({ onRefreshWeather, onRefreshSync } = {}) {
  const indicator = document.getElementById('pull-to-refresh');
  const arrow = document.getElementById('ptr-arrow');
  const spinner = document.getElementById('ptr-spinner');
  const text = document.getElementById('ptr-text');

  if (!indicator) return;

  function canPull() {
    if (isRefreshing) return false;
    // Only allow when at the very top of the page
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    return scrollY <= 0;
  }

  function handleTouchStart(e) {
    if (!canPull()) return;
    startY = e.touches[0].clientY;
    currentY = startY;
    isPulling = false;
  }

  function handleTouchMove(e) {
    if (isRefreshing) return;
    const y = e.touches[0].clientY;
    const diff = y - startY;

    if (!isPulling && diff > 10 && canPull()) {
      isPulling = true;
    }

    if (isPulling && diff > 0) {
      // Damped pull distance (elastic feel)
      const pullDist = Math.min(Math.pow(diff, 0.82) * 1.5, 90);
      indicator.style.height = `${pullDist}px`;
      indicator.style.opacity = `${Math.min(pullDist / 40, 1)}`;

      if (pullDist >= THRESHOLD) {
        indicator.classList.add('ptr-ready');
        if (arrow) arrow.style.transform = 'rotate(180deg)';
        if (text) text.innerText = 'Loslassen zum Aktualisieren';
      } else {
        indicator.classList.remove('ptr-ready');
        if (arrow) arrow.style.transform = 'rotate(0deg)';
        if (text) text.innerText = 'Nach unten ziehen...';
      }
    }
  }

  async function handleTouchEnd() {
    if (!isPulling) return;
    isPulling = false;

    const currentHeight = parseFloat(indicator.style.height || '0');

    if (currentHeight >= THRESHOLD) {
      // Trigger Refresh!
      isRefreshing = true;
      indicator.classList.add('is-refreshing');
      indicator.style.height = '54px';
      if (text) text.innerText = 'Aktualisiere Wetter & Cloud-Favoriten...';

      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (_) {}
      }

      try {
        const promises = [];
        if (onRefreshWeather && window.state?.currentLocation) {
          promises.push(Promise.resolve(onRefreshWeather(window.state.currentLocation)));
        }
        if (onRefreshSync) {
          promises.push(Promise.resolve(onRefreshSync()));
        } else {
          promises.push(GoogleSheetsSync.pullAll());
        }

        await Promise.allSettled(promises);

        if (text) text.innerText = '✓ Aktualisiert';
        indicator.classList.add('ptr-success');
      } catch (err) {
        if (text) text.innerText = '⚠️ Aktualisiert';
      } finally {
        setTimeout(() => {
          indicator.style.height = '0px';
          indicator.style.opacity = '0';
          setTimeout(() => {
            indicator.classList.remove('is-refreshing', 'ptr-ready', 'ptr-success');
            if (arrow) arrow.style.transform = 'rotate(0deg)';
            isRefreshing = false;
          }, 280);
        }, 500);
      }
    } else {
      // Spring back without refreshing
      indicator.style.height = '0px';
      indicator.style.opacity = '0';
      indicator.classList.remove('ptr-ready');
    }
  }

  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });
  window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
}
