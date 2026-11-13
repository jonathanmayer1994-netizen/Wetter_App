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

    // DPR Clamping for fillrate optimization on retina mobile & mac screens
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.updateDimensions();

    // iOS ProMotion 120Hz Frame-Pacing & Eco-Engine
    this.lastFrameTime = 0;
    this.targetFps = 60;
    this.frameInterval = 1000 / this.targetFps; // 16.6ms
    this.slowFrameStreak = 0;
    this.isEcoMode = false;

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
      this.ctx = this.canvas.getContext('2d', { alpha: true });
      this.particles = [];
      this.stars = [];
      this.initStars();
      this.animate = this.animate.bind(this);
      const hasParticles = (this.currentMode === 'rain' || this.currentMode === 'thunder' || this.currentMode === 'snow');
      if (!this.reducedMotion && hasParticles) {
        this.animate();
      } else {
        this.renderStaticFrame();
      }
    }

    // Tab visibility listener: immediately sleep background animations when tab is hidden
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.pause();
        } else {
          this.resume();
        }
      });
    }

    // Handle Window, Orientation & VisualViewport Resize (Adaptive full-screen canvas on iOS PWA)
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.handleResize(), 80);
      setTimeout(() => this.handleResize(), 260);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.handleResize(), { passive: true });
    }

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
    this.width = Math.max(window.innerWidth || 0, this.canvas ? this.canvas.clientWidth || 0 : 0);
    this.height = Math.max(window.innerHeight || 0, this.canvas ? this.canvas.clientHeight || 0 : 0);
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
      } else {
        const hasParticles = (this.currentMode === 'rain' || this.currentMode === 'thunder' || this.currentMode === 'snow');
        if (hasParticles && !this.rafId) {
          this.animate();
        } else {
          this.renderStaticFrame();
        }
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
    const hasParticles = (theme === 'rain' || theme === 'thunder' || theme === 'snow');

    if (theme === 'rain' || theme === 'thunder') {
      const count = Math.min(45, Math.floor(this.width / 24));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          len: 12 + Math.random() * 12,
          speed: 12 + Math.random() * 6
        });
      }
    } else if (theme === 'snow') {
      const count = Math.min(35, Math.floor(this.width / 28));
      for (let i = 0; i < count; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          r: 1.2 + Math.random() * 2.0,
          speed: 0.9 + Math.random() * 1.2,
          sway: Math.random() * Math.PI * 2
        });
      }
    }

    // Performance: If no precipitation, render once and sleep!
    if (!hasParticles) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.renderStaticFrame();
    } else if (!this.isPaused && !this.reducedMotion && !this.rafId) {
      this.animate();
    }
  }

  initStars() {
    this.stars = [];
    for (let i = 0; i < 45; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * (this.height * 0.6),
        radius: 0.8 + Math.random() * 1.4,
        alpha: 0.35 + Math.random() * 0.45,
        speed: 0.008 + Math.random() * 0.015
      });
    }
  }

  renderStaticFrame() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (!this.isDay || this.currentMode === 'clear-night') {
      for (const star of this.stars) {
        this.ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  setEcoMode(enabled) {
    this.isEcoMode = Boolean(enabled);
    this.targetFps = this.isEcoMode ? 30 : 60;
    this.frameInterval = 1000 / this.targetFps;
    if (this.useWorker && this.worker) {
      this.worker.postMessage({ action: 'ecoMode', payload: { enabled: this.isEcoMode } });
    }
  }

  animate(now) {
    if (this.isPaused || this.reducedMotion || !this.ctx) {
      this.rafId = null;
      return;
    }

    // iOS ProMotion 120Hz Frame-Pacing
    if (now && this.lastFrameTime && (now - this.lastFrameTime < this.frameInterval - 1.5)) {
      this.rafId = requestAnimationFrame(this.animate);
      return;
    }

    // Dynamic Thermal / Eco detection
    if (now && this.lastFrameTime) {
      const delta = now - this.lastFrameTime;
      if (delta > 36) {
        this.slowFrameStreak++;
        if (this.slowFrameStreak > 8 && !this.isEcoMode) {
          this.setEcoMode(true);
        }
      } else if (delta < 20 && this.slowFrameStreak > 0) {
        this.slowFrameStreak--;
      }
    }
    this.lastFrameTime = now || performance.now();

    this.ctx.clearRect(0, 0, this.width, this.height);

    if (!this.isDay || this.currentMode === 'clear-night') {
      for (const star of this.stars) {
        star.alpha += star.speed;
        const op = (Math.sin(star.alpha) + 1) / 2 * 0.5 + 0.2;
        this.ctx.fillStyle = `rgba(255, 255, 255, ${op})`;
        this.ctx.beginPath();
        this.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    if (this.currentMode === 'rain' || this.currentMode === 'thunder') {
      this.ctx.strokeStyle = 'rgba(180, 225, 255, 0.50)';
      this.ctx.lineWidth = 1.1;
      for (const p of this.particles) {
        p.y += p.speed;
        p.x -= 1.5;
        if (p.y > this.height) {
          p.y = -p.len;
          p.x = Math.random() * (this.width + 100);
        }
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y);
        this.ctx.lineTo(p.x - 1.5, p.y + p.len);
        this.ctx.stroke();
      }
    }

    if (this.currentMode === 'snow') {
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      for (const s of this.particles) {
        s.sway += 0.02;
        s.y += s.speed;
        s.x += Math.sin(s.sway) * 0.8;
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
