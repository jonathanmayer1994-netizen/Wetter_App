/**
 * BEST WEATHER — Atmospheric Background Canvas Controller (Task 5b)
 * Offloads particle rendering to background.worker.js via OffscreenCanvas,
 * with automatic Main-Thread fallback, IntersectionObserver pausing, and DPR clamping.
 */

export class BackgroundCanvasEngine {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;

    this.reducedMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.currentMode = 'clear-day';
    this.isDay = true;
    this.isPaused = false;
    this.useWorker = false;
    this.worker = null;
    this.rafId = null;

    // DPR Clamping for fillrate optimization on retina mobile screens
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.updateDimensions();

    // Check OffscreenCanvas & Worker support
    const supportsOffscreen = typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function' &&
      typeof Worker !== 'undefined';

    if (supportsOffscreen && !this.reducedMotion) {
      try {
        const offscreen = this.canvas.transferControlToOffscreen();
        this.worker = new Worker('./background.worker.js');
        this.worker.postMessage({
          action: 'init',
          payload: {
            canvas: offscreen,
            width: this.width,
            height: this.height,
            currentMode: this.currentMode,
            isDay: this.isDay,
            reducedMotion: this.reducedMotion
          }
        }, [offscreen]);
        this.useWorker = true;
      } catch (e) {
        console.warn('[BackgroundCanvas] OffscreenCanvas transfer failed, falling back to main-thread rendering:', e);
        this.useWorker = false;
      }
    }

    if (!this.useWorker) {
      this.ctx = this.canvas.getContext('2d');
      this.particles = [];
      this.stars = [];
      this.initStars();
      this.animate = this.animate.bind(this);
      if (!this.reducedMotion) {
        this.animate();
      } else {
        this.renderStaticFrame();
      }
    }

    // Handle Window Resize
    window.addEventListener('resize', () => this.handleResize());

    // IntersectionObserver to auto-pause when scrolled out of view
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.resume();
          } else {
            this.pause();
          }
        }
      }, { threshold: 0.05 });
      this.observer.observe(this.canvas);
    }
  }

  updateDimensions() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    if (!this.useWorker && this.canvas) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
  }

  handleResize() {
    this.updateDimensions();
    if (this.useWorker && this.worker) {
      this.worker.postMessage({
        action: 'resize',
        payload: { width: this.width, height: this.height }
      });
    } else if (this.ctx) {
      this.initStars();
      this.setMode(this.currentMode, this.isDay);
    }
  }

  pause() {
    this.isPaused = true;
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ action: 'pause' });
    } else if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resume() {
    if (this.isPaused && !this.reducedMotion) {
      this.isPaused = false;
      if (this.useWorker && this.worker) {
        this.worker.postMessage({ action: 'resume' });
      } else if (!this.rafId) {
        this.animate();
      }
    }
  }

  setMode(theme, isDay) {
    this.currentMode = theme;
    this.isDay = isDay;

    if (this.useWorker && this.worker) {
      this.worker.postMessage({
        action: 'setMode',
        payload: { theme, isDay }
      });
      return;
    }

    this.particles = [];
    if (theme === 'rain' || theme === 'thunder') {
      const count = Math.min(70, Math.floor(this.width / 14));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          len: 14 + Math.random() * 14,
          speed: 14 + Math.random() * 8
        });
      }
    } else if (theme === 'snow') {
      const count = Math.min(50, Math.floor(this.width / 18));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          r: 1.5 + Math.random() * 2.5,
          speed: 1 + Math.random() * 1.5,
          sway: Math.random() * Math.PI * 2
        });
      }
    }
  }

  initStars() {
    this.stars = [];
    for (let i = 0; i < 65; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * (this.height * 0.6),
        radius: 0.8 + Math.random() * 1.5,
        alpha: Math.random(),
        speed: 0.01 + Math.random() * 0.02
      });
    }
  }

  renderStaticFrame() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (!this.isDay || this.currentMode === 'clear-night') {
      for (const star of this.stars) {
        this.ctx.fillStyle = `rgba(255, 255, 255, 0.65)`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  animate() {
    if (this.isPaused || this.reducedMotion || !this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);

    if (!this.isDay || this.currentMode === 'clear-night') {
      for (const star of this.stars) {
        star.alpha += star.speed;
        const op = (Math.sin(star.alpha) + 1) / 2 * 0.7 + 0.1;
        this.ctx.fillStyle = `rgba(255, 255, 255, ${op})`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    if (this.currentMode === 'rain' || this.currentMode === 'thunder') {
      this.ctx.strokeStyle = 'rgba(180, 225, 255, 0.55)';
      this.ctx.lineWidth = 1.2;
      for (const p of this.particles) {
        p.y += p.speed;
        p.x -= 2;
        if (p.y > this.height) {
          p.y = -p.len;
          p.x = Math.random() * (this.width + 100);
        }
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
        this.ctx.lineTo(p.x - 2, p.y + p.len);
        this.ctx.stroke();
      }
    }

    if (this.currentMode === 'snow') {
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      for (const s of this.particles) {
        s.sway += 0.02;
        s.y += s.speed;
        s.x += Math.sin(s.sway) * 1;
        if (s.y > this.height) {
          s.y = -5;
          s.x = Math.random() * this.width;
        }
        this.ctx.beginPath();
        this.ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    this.rafId = requestAnimationFrame(this.animate);
  }
}
