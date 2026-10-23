/**
 * BEST WEATHER — Hardware-Accelerated 2D Canvas Spaghetti Meteogram (Task 10b)
 * Replaces heavy SVG string serialization with instantaneous 2D Canvas drawing,
 * anti-aliased cubic Bezier curve smoothing, and zero GC layout thrashing.
 */

export class MeteogramCanvas {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    // Check if canvas already exists or create one
    let canvas = this.container.querySelector('canvas.meteogram-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'meteogram-canvas';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      this.container.appendChild(canvas);
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  render(data) {
    if (!this.canvas || !this.ctx || !data) return;

    const {
      ecmwfData,
      gfsData,
      iconData,
      timestamps,
      metric,
      unit,
      minVal,
      maxVal,
      count
    } = data;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.container.getBoundingClientRect();
    const cssWidth = Math.max(300, rect.width || 900);
    const cssHeight = Math.max(180, rect.height || 240);

    this.canvas.width = cssWidth * dpr;
    this.canvas.height = cssHeight * dpr;

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);

    const padL = 44;
    const padR = 20;
    const padT = 24;
    const padB = 32;
    const plotW = cssWidth - padL - padR;
    const plotH = cssHeight - padT - padB;
    const range = Math.max(1, maxVal - minVal);

    const getX = (i) => padL + (i / (count - 1)) * plotW;
    const getY = (val) => padT + plotH - ((val - minVal) / range) * plotH;

    // Clear background
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // 1. Horizontale Gitterlinien & Y-Achsen-Labels
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    const ySteps = 4;
    for (let s = 0; s <= ySteps; s++) {
      const v = minVal + (s / ySteps) * range;
      const y = getY(v);

      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssWidth - padR, y);
      ctx.stroke();

      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(v)}${unit}`, padL - 6, y + 3);
    }
    ctx.setLineDash([]); // Reset line dash

    // 2. Vertikale Tages-Trennlinien & Beschriftungen
    const daysMap = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    ctx.textAlign = 'center';
    for (let i = 0; i < count; i += 24) {
      const x = getX(i);
      const date = new Date(timestamps[i]);
      const dayName = daysMap[date.getDay()];
      const dateNum = date.getDate();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();

      ctx.fillStyle = i === 0 ? '#38bdf8' : 'rgba(255, 255, 255, 0.65)';
      ctx.fillText(i === 0 ? 'Heute' : `${dayName} ${dateNum}.`, x, padT + plotH + 18);
    }

    // 3. Ensemble-Spannbreiten-Korridor (Min-Max-Fläche)
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = getX(i);
      const topV = Math.max(ecmwfData[i], gfsData[i], iconData[i]);
      const y = getY(topV);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = count - 1; i >= 0; i--) {
      const x = getX(i);
      const botV = Math.min(ecmwfData[i], gfsData[i], iconData[i]);
      const y = getY(botV);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
    ctx.fill();

    // 4. Helfer für geglättete Kurven
    const drawSmoothCurve = (dataArr, strokeStyle, lineWidth) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();

      for (let i = 0; i < count; i++) {
        const x = getX(i);
        const y = getY(dataArr[i]);

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          const prevX = getX(i - 1);
          const prevY = getY(dataArr[i - 1]);
          const cpX = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
        }
      }
      ctx.stroke();
    };

    // 5. Kurven zeichnen (ICON: grün, GFS: gelb/orange, ECMWF: blau/cyan)
    drawSmoothCurve(iconData, 'rgba(16, 185, 129, 0.85)', 1.5);
    drawSmoothCurve(gfsData, 'rgba(245, 158, 11, 0.85)', 1.5);
    drawSmoothCurve(ecmwfData, '#38bdf8', 2.2);

    ctx.restore();
  }
}
