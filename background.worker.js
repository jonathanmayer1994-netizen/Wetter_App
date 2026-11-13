/**
 * BEST WEATHER — Atmospheric Background Worker (macOS Silicon High-Performance Engine)
 * Runs off the main UI thread via OffscreenCanvas.
 * Automatically sleeps when idle (clear/cloudy/fog) to ensure 0% GPU/CPU overhead.
 */

let canvas = null;
let ctx = null;
let width = 800;
let height = 600;
let currentMode = 'clear-day';
let isDay = true;
let isPaused = false;
let rafId = null;
let reducedMotion = false;
let particles = [];
let stars = [];

function initStars() {
  stars = [];
  for (let i = 0; i < 45; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * (height * 0.6),
      radius: 0.8 + Math.random() * 1.4,
      alpha: 0.35 + Math.random() * 0.45,
      speed: 0.008 + Math.random() * 0.015
    });
  }
}

function renderStaticFrame() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);

  if (!isDay || currentMode === 'clear-night') {
    for (const star of stars) {
      ctx.fillStyle = `rgba(255, 255, 255, ${star.alpha})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function setMode(theme, day) {
  currentMode = theme;
  isDay = day;
  particles = [];

  const hasParticles = (theme === 'rain' || theme === 'thunder' || theme === 'snow');

  if (theme === 'rain' || theme === 'thunder') {
    const count = Math.min(45, Math.floor(width / 24));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        len: 12 + Math.random() * 12,
        speed: 12 + Math.random() * 6
      });
    }
  } else if (theme === 'snow') {
    const count = Math.min(35, Math.floor(width / 28));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1.2 + Math.random() * 2.0,
        speed: 0.9 + Math.random() * 1.2,
        sway: Math.random() * Math.PI * 2
      });
    }
  }

  // Idle sleep optimization: If no precipitation, render once and sleep!
  if (!hasParticles) {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    renderStaticFrame();
  } else if (!isPaused && !reducedMotion && !rafId) {
    rafId = requestAnimationFrame(renderFrame);
  }
}

function renderFrame() {
  if (!ctx || isPaused || reducedMotion) {
    rafId = null;
    return;
  }

  ctx.clearRect(0, 0, width, height);

  if (!isDay || currentMode === 'clear-night') {
    for (const star of stars) {
      star.alpha += star.speed;
      const op = (Math.sin(star.alpha) + 1) / 2 * 0.5 + 0.2;
      ctx.fillStyle = `rgba(255, 255, 255, ${op})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (currentMode === 'rain' || currentMode === 'thunder') {
    ctx.strokeStyle = 'rgba(180, 225, 255, 0.50)';
    ctx.lineWidth = 1.1;
    for (const p of particles) {
      p.y += p.speed;
      p.x -= 1.5;
      if (p.y > height) {
        p.y = -p.len;
        p.x = Math.random() * (width + 100);
      }
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 1.5, p.y + p.len);
      ctx.stroke();
    }
  }

  if (currentMode === 'snow') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    for (const s of particles) {
      s.sway += 0.02;
      s.y += s.speed;
      s.x += Math.sin(s.sway) * 0.8;
      if (s.y > height) {
        s.y = -5;
        s.x = Math.random() * width;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  rafId = requestAnimationFrame(renderFrame);
}

self.onmessage = function (e) {
  const { action, payload } = e.data;

  if (action === 'init') {
    canvas = payload.canvas;
    ctx = canvas.getContext('2d', { alpha: true });
    width = payload.width;
    height = payload.height;
    currentMode = payload.currentMode || 'clear-day';
    isDay = payload.isDay !== undefined ? payload.isDay : true;
    reducedMotion = payload.reducedMotion || false;

    initStars();
    setMode(currentMode, isDay);
  } else if (action === 'resize') {
    width = payload.width;
    height = payload.height;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
    initStars();
    setMode(currentMode, isDay);
  } else if (action === 'setMode') {
    setMode(payload.theme, payload.isDay);
  } else if (action === 'pause') {
    isPaused = true;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  } else if (action === 'resume') {
    if (isPaused && !reducedMotion) {
      isPaused = false;
      const hasParticles = (currentMode === 'rain' || currentMode === 'thunder' || currentMode === 'snow');
      if (hasParticles && !rafId) {
        rafId = requestAnimationFrame(renderFrame);
      } else {
        renderStaticFrame();
      }
    }
  }
};
