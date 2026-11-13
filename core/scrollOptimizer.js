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

  window.addEventListener('scroll', onScrollStart, { passive: true });
  window.addEventListener('touchmove', onScrollStart, { passive: true });

  if ('onscrollend' in window) {
    window.addEventListener('scrollend', onScrollEnd, { passive: true });
  }

  // Also bind to any scrollable panes (appLayout, drawers)
  const appLayout = document.querySelector('.app-layout');
  if (appLayout) {
    appLayout.addEventListener('scroll', onScrollStart, { passive: true });
  }
}
