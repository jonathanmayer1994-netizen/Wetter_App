/**
 * BEST WEATHER — iOS Motion-Aware Scroll Optimizer
 * Decouples heavy 30px Gaussian blurs & complex multi-shadows during 120Hz ProMotion touch scrolling.
 * Bypasses GPU overdraw while the finger moves, restoring full liquid glass when motion rests.
 */

let scrollTimeout = null;
let isScrollingActive = false;

export function initScrollOptimizer() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const onScrollStart = () => {
    if (!isScrollingActive) {
      isScrollingActive = true;
      document.body.classList.add('is-scrolling');
    }
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    scrollTimeout = setTimeout(() => {
      isScrollingActive = false;
      document.body.classList.remove('is-scrolling');
    }, 110);
  };

  const onScrollEnd = () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    isScrollingActive = false;
    document.body.classList.remove('is-scrolling');
  };

  const appLayout = document.querySelector('.app-layout');
  window.addEventListener('scroll', onScrollStart, { passive: true });

  if ('onscrollend' in window) {
    window.addEventListener('scrollend', onScrollEnd, { passive: true });
    if (appLayout) appLayout.addEventListener('scrollend', onScrollEnd, { passive: true });
  }

  // Nur tatsächliches Container-/Fenster-Scrollen entkoppeln (kein Fehltrigger beim Karten-Panning oder Slider-Drag)
  if (appLayout) {
    appLayout.addEventListener('scroll', onScrollStart, { passive: true });
    appLayout.addEventListener('touchmove', onScrollStart, { passive: true });
  }
}

