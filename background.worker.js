/**
 * BEST WEATHER — Atmospheric Background Worker (Task 5b)
 * Runs off the main UI thread via OffscreenCanvas.
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
  for (let i = 0; i < 65; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * (height * 0.6),
      radius: 0.8 + Math.random() * 1.5,
      alpha: Math.random(),
      speed: 0.01 + Math.random() * 0.02
    });
  }
}

function setMode(theme, day) {
  currentMode = theme;
  isDay = day;
  particles = [];

  if (theme === 'rain' || theme === 'thunder') {
    const count = Math.min(70, Math.floor(width / 14));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        len: 14 + Math.random() * 14,
        speed: 14 + Math.random() * 8
      });
    }
  } else if (theme === 'snow') {
    const count = Math.min(50, Math.floor(width / 18));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1.5 + Math.random() * 2.5,
        speed: 1 + Math.random() * 1.5,
        sway: Math.random() * Math.PI * 2
      });
    }
  }
}

function renderFrame() {
  if (!ctx || isPaused || reducedMotion) return;

  ctx.clearRect(0, 0, width, height);

  if (!isDay || currentMode === 'clear-night') {
    for (const star of stars) {
      star.alpha += star.speed;
      const op = (Math.sin(star.alpha) + 1) / 2 * 0.7 + 0.1;
      ctx.fillStyle = `rgba(255, 255, 255, ${op})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (currentMode === 'rain' || currentMode === 'thunder') {
    ctx.strokeStyle = 'rgba(180, 225, 255, 0.55)';
    ctx.lineWidth = 1.2;
    for (const p of particles) {
      p.y += p.speed;
      p.x -= 2;
      if (p.y > height) {
        p.y = -p.len;
        p.x = Math.random() * (width + 100);
      }
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 2, p.y + p.len);
      ctx.stroke();
    }
  }

  if (currentMode === 'snow') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (const s of particles) {
      s.sway += 0.02;
      s.y += s.speed;
      s.x += Math.sin(s.sway) * 1;
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
    ctx = canvas.getContext('2d');
    width = payload.width;
    height = payload.height;
    currentMode = payload.currentMode || 'clear-day';
    isDay = payload.isDay !== undefined ? payload.isDay : true;
    reducedMotion = payload.reducedMotion || false;

    initStars();
    setMode(currentMode, isDay);

    if (!reducedMotion) {
      renderFrame();
    }
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
      renderFrame();
    }
  }
};
