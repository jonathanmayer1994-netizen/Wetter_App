/**
 * BEST WEATHER — Forecast Verification & Ground-Truth UI (A.C.T.U.A.L. Engine)
 * Renders the interactive "Prognose vs. Realität" dashboard, the 24h Soll/Ist comparison
 * chart, model accuracy scorecards, alpine orographic alerts, and 1-tap user ground-truth.
 */

import { state } from '../core/state.js';
import { VerificationStore, CROWD_CONDITIONS } from '../core/verificationStore.js';
import { ActualEngine } from '../core/actualEngine.js';
import { escapeHtml } from '../httpClient.js';
import { WMO_CODES } from '../core/constants.js';

let onReloadCallback = null;

export function initVerificationHandlers(options = {}) {
  if (options.onReload) onReloadCallback = options.onReload;
}

export function setupVerificationUI() {
  renderVerificationDashboard();
  setupCrowdGroundTruthControls();
}

/**
 * Rendert das vollständige Verifikations-Dashboard
 */
export function renderVerificationDashboard() {
  const container = document.getElementById('verification-dashboard-section');
  if (!container) return;

  const existingDetails = document.getElementById('verification-card');
  const wasOpen = existingDetails ? existingDetails.hasAttribute('open') : false;

  const data = state.actualVerification;
  const loc = state.currentLocation;

  if (!data || !data.verified) {
    container.innerHTML = `
      <section class="glass-card verification-card">
        <div class="card-header">
          <div class="card-title">
            <span class="card-icon">⚖️</span>
            <span>PROGNOSE VS. REALITÄT (IST-ABGLEICH)</span>
          </div>
          <span class="card-tag">Wird abgeglichen...</span>
        </div>
        <div class="vfy-loading-box">
          <span class="vfy-spinner">⏳</span>
          <p>Vergleiche Modell-Vorhersagen mit den Messstationen von DWD, MeteoSwiss &amp; GeoSphere...</p>
        </div>
      </section>
    `;
    return;
  }

  const { groundTruthStation, liveDelta, modelEvaluation, history24h, orographicInsights, userReport } = data;

  // 1. Station-Info-Text
  let stationDesc = 'Satelliten- & Radar-Nowcast Reanalyse';
  if (groundTruthStation) {
    stationDesc = `📍 Verifiziert mit ${escapeHtml(groundTruthStation.network)}: ${escapeHtml(groundTruthStation.name)} (${groundTruthStation.distanceKm} km entfernt${groundTruthStation.elevation ? ` • ${groundTruthStation.elevation} m` : ''}) • Stand ${escapeHtml(groundTruthStation.recordedAtStr)} Uhr`;
  }

  // 2. Delta Kacheln Werte
  const tempSign = liveDelta.tempDelta > 0 ? '+' : '';
  const windSign = liveDelta.windDelta > 0 ? '+' : '';
  const tempDeltaFormatted = `${tempSign}${liveDelta.tempDelta}°C`;
  const windDeltaFormatted = `${windSign}${liveDelta.windDelta} km/h`;

  // 3. WMO Wetterzustand Name (Tag/Nacht-bewusst)
  const isDayNow = (state.weatherData && state.weatherData.current && state.weatherData.current.is_day !== undefined)
    ? state.weatherData.current.is_day === 1
    : (new Date().getHours() >= 6 && new Date().getHours() <= 20);
  const actualWmo = WMO_CODES[liveDelta.actualCode] || { label: 'Bedeckt', icon: '☁️', iconNight: '☁️' };
  const forecastWmo = WMO_CODES[liveDelta.forecastCode] || { label: 'Bedeckt', icon: '☁️', iconNight: '☁️' };
  const actualWmoIcon = isDayNow ? actualWmo.icon : (actualWmo.iconNight || actualWmo.icon);
  const forecastWmoIcon = isDayNow ? forecastWmo.icon : (forecastWmo.iconNight || forecastWmo.icon);

  // 4. Orographie-Alerts HTML
  let orographicAlertsHtml = '';
  if (orographicInsights && orographicInsights.length > 0) {
    orographicAlertsHtml = `
      <div class="vfy-alerts-wrapper">
        ${orographicInsights.map(al => `
          <div class="vfy-alert-item ${al.severity}">
            <span class="vai-icon">${al.icon}</span>
            <div class="vai-text">
              <strong class="vai-title">${escapeHtml(al.title)}</strong>
              <p class="vai-desc">${escapeHtml(al.desc)}</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // 5. Modell Scorecard HTML
  let scorecardHtml = '';
  if (modelEvaluation && modelEvaluation.models) {
    const sortedModels = Object.keys(modelEvaluation.models).map(k => ({
      key: k,
      ...modelEvaluation.models[k]
    })).sort((a, b) => b.score - a.score);

    scorecardHtml = `
      ${modelEvaluation.synopticRegime ? `
        <div class="vfy-regime-banner" style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:0.82rem;">
          <span>${modelEvaluation.synopticRegime.icon} <strong>Wetterlage:</strong> ${escapeHtml(modelEvaluation.synopticRegime.name)}</span>
          <span style="color:#64d2ff;font-weight:600;">${escapeHtml(modelEvaluation.synopticRegime.badge)}</span>
        </div>
      ` : ''}
      <div class="vfy-scorecard-grid">
        ${sortedModels.map(m => `
          <div class="vfy-model-card ${m.isWinner ? 'is-winner' : ''}">
            <div class="vmc-header">
              <span class="vmc-name">${escapeHtml(m.name)}</span>
              ${m.isWinner ? '<span class="vmc-winner-badge">🏆 Höchste Trefferquote</span>' : ''}
            </div>
            <div class="vmc-score-row">
              <div class="vmc-score-circle">
                <strong>${m.score}%</strong>
                <small>Score</small>
              </div>
              <div class="vmc-meta">
                <span class="vmc-mae">Ø Abweichung: <b>${m.maeTemp}°C</b></span>
                <span class="vmc-weight">Dynamisches Gewicht: <b>${Math.round(m.weight * 100)}%</b></span>
              </div>
            </div>
            <div class="vmc-progress-bar">
              <div class="vmc-progress-fill" style="width: ${m.score}%; background: ${m.score >= 85 ? '#30d158' : (m.score >= 70 ? '#ffd166' : '#ff9f0a')}"></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // 6. User Feedback Status & Kacheln
  const activeConditionKey = userReport ? userReport.condition : null;
  const conditionsList = Object.keys(CROWD_CONDITIONS).map(k => CROWD_CONDITIONS[k]);

  const buttonsHtml = conditionsList.map(cond => {
    const isSelected = (activeConditionKey === cond.key);
    return `
      <button type="button"
              class="vcb-btn${isSelected ? ' is-selected' : ''}"
              data-condition="${cond.key}"
              aria-pressed="${isSelected ? 'true' : 'false'}"
              title="${escapeHtml(cond.desc)}">
        ${isSelected ? '<span class="vcb-check-badge" aria-hidden="true">✓</span>' : ''}
        <span class="vcb-icon">${cond.icon}</span>
        <span class="vcb-label">${escapeHtml(cond.label)}</span>
      </button>
    `;
  }).join('');

  let crowdFeedbackCardHtml = '';
  if (userReport) {
    const reportCond = CROWD_CONDITIONS[userReport.condition] || { label: userReport.label || userReport.condition, icon: userReport.icon || '📍', desc: '' };
    const ageMin = userReport.ageMinutes !== undefined ? userReport.ageMinutes : 0;
    const timeText = ageMin <= 0 ? 'gerade eben' : (ageMin === 1 ? 'vor 1 Minute' : `vor ${ageMin} Minuten`);
    const locName = loc ? loc.name : 'diesem Ort';
    const elevText = loc && loc.elevation ? ` (${Math.round(loc.elevation)} m)` : '';

    crowdFeedbackCardHtml = `
      <div class="vcb-confirmation-card is-active" id="vcb-confirmation-card" role="status">
        <div class="vcc-header-row">
          <div class="vcc-status-badge">
            <span class="vcc-pulse-dot" aria-hidden="true"></span>
            <span class="vcc-status-text">✓ Feedback erfolgreich erfasst &amp; aktiv</span>
          </div>
          <span class="vcc-time-badge">⏱️ ${timeText}</span>
        </div>
        <div class="vcc-body">
          <div class="vcc-icon-pill" aria-hidden="true">${reportCond.icon}</div>
          <div class="vcc-text-col">
            <div class="vcc-title">
              Du hast <b>${escapeHtml(reportCond.label)}</b> vor Ort gemeldet
            </div>
            <div class="vcc-sub">
              Echtzeit-Kompensation für <b>${escapeHtml(locName)}</b>${elevText} aktiv. Alpine Prognosemodelle und Nowcast-Parameter wurden unmittelbar kalibriert.
            </div>
          </div>
        </div>
        <div class="vcc-footer-row">
          <button type="button" class="vcc-reset-btn" id="vcc-reset-btn" title="Meldung zurücksetzen" aria-label="Meldung zurücksetzen">
            ✕ Meldung aufheben
          </button>
        </div>
      </div>
    `;
  } else {
    crowdFeedbackCardHtml = `
      <div class="vcb-hint-row" id="vcb-hint-row">
        <span class="vcb-hint-icon">💡</span>
        <span class="vcb-hint-text">Tippe auf deine aktuelle Wetterlage, um die Vorhersage für alle Tourengeher in Echtzeit zu kalibrieren.</span>
      </div>
      <div class="vcb-feedback-msg" id="vcb-feedback-msg" style="display:none;" role="status"></div>
    `;
  }

  const winnerModel = modelEvaluation && modelEvaluation.models && modelEvaluation.winnerKey ? modelEvaluation.models[modelEvaluation.winnerKey] : null;

  container.innerHTML = `
    <details class="glass-card verification-accordion" id="verification-card"${wasOpen ? ' open' : ''}>
      <summary class="verification-summary">
        <div class="vs-summary-left">
          <span class="vs-summary-icon">⚖️</span>
          <div class="vs-summary-text">
            <div class="vs-headline">
              <span class="vs-title">PROGNOSE VS. REALITÄT (IST-ABGLEICH)</span>
              <span class="card-tag vfy-live-tag">🟢 KI-Kalibriert</span>
            </div>
            <div class="vs-metrics-pill">
              <span class="vs-stat-num">Real <b>${liveDelta.actualTemp !== null ? liveDelta.actualTemp : '--'}°</b> vs. Modell <b>${liveDelta.forecastTemp !== null ? liveDelta.forecastTemp : '--'}°</b></span>
              <span class="vt-badge ${Math.abs(liveDelta.tempDelta) <= 1.0 ? 'badge-good' : 'badge-diff'}">Δ ${tempDeltaFormatted}</span>
              ${winnerModel ? `<span class="vs-best-model">· 🏆 ${escapeHtml(winnerModel.name)} (${winnerModel.score}%)</span>` : ''}
            </div>
          </div>
        </div>
        <div class="vs-summary-right">
          <span class="vs-toggle-btn">Details <span class="vs-arrow">▾</span></span>
        </div>
      </summary>

      <div class="verification-details-body">
        <!-- Ground Truth Station Banner -->
        <div class="vfy-station-banner">
          <span class="vsb-text">${stationDesc}</span>
        </div>

        <!-- 3 Hero Vergleichs-Kacheln -->
        <div class="vfy-hero-grid">
          <!-- 1. Temperatur Kachel -->
          <div class="vfy-tile">
            <div class="vt-label-row">
              <span class="vt-label">🌡️ Temperatur</span>
              <span class="vt-badge ${Math.abs(liveDelta.tempDelta) <= 1.0 ? 'badge-good' : 'badge-diff'}">
                Δ ${tempDeltaFormatted}
              </span>
            </div>
            <div class="vt-comparison">
              <div class="vt-col">
                <span class="vt-val-num text-accent">${liveDelta.actualTemp !== null ? liveDelta.actualTemp : '--'}°</span>
                <span class="vt-val-sub">Real gemessen</span>
              </div>
              <div class="vt-divider">vs</div>
              <div class="vt-col">
                <span class="vt-val-num text-muted">${liveDelta.forecastTemp !== null ? liveDelta.forecastTemp : '--'}°</span>
                <span class="vt-val-sub">Modell-Prognose</span>
              </div>
            </div>
            <span class="vt-hint ${liveDelta.statusClass}">${escapeHtml(liveDelta.summaryText)}</span>
          </div>

          <!-- 2. Wind Kachel -->
          <div class="vfy-tile">
            <div class="vt-label-row">
              <span class="vt-label">💨 Wind &amp; Böen</span>
              <span class="vt-badge ${Math.abs(liveDelta.windDelta) <= 8 ? 'badge-good' : 'badge-diff'}">
                Δ ${windDeltaFormatted}
              </span>
            </div>
            <div class="vt-comparison">
              <div class="vt-col">
                <span class="vt-val-num">${liveDelta.actualWind !== null ? liveDelta.actualWind : '--'}</span>
                <span class="vt-val-sub">km/h Ist</span>
              </div>
              <div class="vt-divider">vs</div>
              <div class="vt-col">
                <span class="vt-val-num text-muted">${liveDelta.forecastWind !== null ? liveDelta.forecastWind : '--'}</span>
                <span class="vt-val-sub">km/h Prognose</span>
              </div>
            </div>
            <span class="vt-hint">Gratwind ${liveDelta.actualWind >= 35 ? 'aktiv' : 'im Normalbereich'}</span>
          </div>

          <!-- 3. Wetterlage Kachel -->
          <div class="vfy-tile">
            <div class="vt-label-row">
              <span class="vt-label">⛅ Wetterlage</span>
              <span class="vt-badge badge-neutral">Zustand</span>
            </div>
            <div class="vt-comparison">
              <div class="vt-col">
                <span class="vt-icon">${actualWmoIcon}</span>
                <span class="vt-val-sub">${escapeHtml(actualWmo.label)}</span>
              </div>
              <div class="vt-divider">vs</div>
              <div class="vt-col">
                <span class="vt-icon opacity-75">${forecastWmoIcon}</span>
                <span class="vt-val-sub">${escapeHtml(forecastWmo.label)}</span>
              </div>
            </div>
            <span class="vt-hint">${liveDelta.actualPrecip > 0 ? `${liveDelta.actualPrecip} mm Niederschlag` : 'Aktuell trocken'}</span>
          </div>
        </div>

        <!-- Orographische Diskrepanz-Warnungen (z.B. Föhn, Kaltluftsee) -->
        ${orographicAlertsHtml}

        <!-- 24h Soll/Ist-Verlaufschart -->
        <div class="vfy-chart-section">
          <div class="vcs-header">
            <span class="vcs-title">📈 24H-VERLAUF: PROGNOSE (SOLL) VS. REALITÄT (IST)</span>
            <div class="vcs-legend">
              <span class="vcs-leg-item"><span class="vcs-dot actual"></span> Reale Messung (Ist)</span>
              <span class="vcs-leg-item"><span class="vcs-dot forecast"></span> Modell-Prognose (Soll)</span>
            </div>
          </div>
          <div class="vfy-svg-container" id="vfy-svg-container">
            <svg id="vfy-chart-svg" class="vfy-chart-svg" viewBox="0 0 800 200" preserveAspectRatio="none">
              <!-- Dynamisch generiertes 24h-Chart -->
            </svg>
            <div class="vfy-tooltip" id="vfy-tooltip" style="display:none;"></div>
          </div>
        </div>

        <!-- Modell-Scorecard ("Wer hat aktuell recht?") -->
        <div class="vfy-section-title">
          <span>🏆 MODELL-TREFFSICHERHEIT &amp; BAYESIANISCHES ENSEMBLE-GEWICHT</span>
        </div>
        ${scorecardHtml}

        <!-- 1-Tap Ist-Wetter Ground-Truth Melden -->
        <div class="vfy-crowd-box">
          <div class="vcb-header">
            <div class="vcb-title">
              <span>📍 Wetter vor Ort anders? Jetzt 1-Tap Feedback geben</span>
            </div>
            <span class="vcb-sub">Kalibriert das alpine Mikroklima unmittelbar für alle Tourengeher</span>
          </div>
          <div class="vcb-buttons-row${activeConditionKey ? ' has-selected' : ''}" id="vcb-buttons-row">
            ${buttonsHtml}
          </div>
          ${crowdFeedbackCardHtml}
        </div>

        <!-- Ausklappbare Experten-Details (Kalman-Decay & Formeln) -->
        <details class="vfy-expert-details">
          <summary class="ved-summary">
            <span>🔬 Details zur adaptiven KI-Kalibrierung &amp; Kalman-Filterung</span>
            <span class="ved-arrow">▾</span>
          </summary>
          <div class="ved-content">
            <div class="ved-grid">
              <div class="ved-card">
                <strong>Kalman Bias-Decay (0–12h)</strong>
                <p>Aktiver Bias von <b>${tempDeltaFormatted}</b> wird mit einer alpinen Halbwertszeit von <i>τ</i> = 4,0 h kontinuierlich in die nächsten Stunden hineingerechnet.</p>
              </div>
              <div class="ved-card">
                <strong>Bayesian Model Averaging (BMA)</strong>
                <p>Das präziseste Modell (<b>${escapeHtml(modelEvaluation.winnerName)}</b>) steuert automatisch <b>${Math.round((modelEvaluation.models[modelEvaluation.winnerKey]?.weight || 0.5) * 100)}%</b> des Vorhersage-Konsenses.</p>
              </div>
            </div>
          </div>
        </details>
      </div>
    </details>
  `;

  // Render SVG Chart
  renderVerificationSVG(history24h);
}

/**
 * Rendert das 24h-Verifikations-Chart mit Soll- und Ist-Kurven
 */
export function renderVerificationSVG(history) {
  const svg = document.getElementById('vfy-chart-svg');
  if (!svg || !Array.isArray(history) || history.length < 2) return;

  const W = 800;
  const H = 200;
  const padL = 40;
  const padR = 25;
  const padT = 25;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Finde Min / Max Temperaturen
  let minT = Infinity;
  let maxT = -Infinity;

  history.forEach(pt => {
    if (pt.actual && pt.actual.temp !== null) {
      minT = Math.min(minT, pt.actual.temp);
      maxT = Math.max(maxT, pt.actual.temp);
    }
    if (pt.forecast && pt.forecast.temp !== null) {
      minT = Math.min(minT, pt.forecast.temp);
      maxT = Math.max(maxT, pt.forecast.temp);
    }
  });

  if (minT === Infinity) {
    minT = 0;
    maxT = 15;
  }
  minT = Math.floor(minT - 1.5);
  maxT = Math.ceil(maxT + 1.5);
  const rangeT = Math.max(2, maxT - minT);

  const getX = (idx) => padL + (idx / (history.length - 1)) * plotW;
  const getY = (tVal) => padT + plotH - ((tVal - minT) / rangeT) * plotH;

  const actualPoints = [];
  const forecastPoints = [];

  history.forEach((pt, idx) => {
    const x = getX(idx);
    if (pt.actual && pt.actual.temp !== null) {
      actualPoints.push({ x, y: getY(pt.actual.temp), pt, idx });
    }
    if (pt.forecast && pt.forecast.temp !== null) {
      forecastPoints.push({ x, y: getY(pt.forecast.temp), pt, idx });
    }
  });

  const actualPolyline = actualPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const forecastPolyline = forecastPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Punkte für interaktiven Hover
  let interactionDots = '';
  actualPoints.forEach(p => {
    const fcMatch = forecastPoints.find(f => f.idx === p.idx);
    const fcTemp = fcMatch ? fcMatch.pt.forecast.temp : null;
    const diffStr = fcTemp !== null ? (p.pt.actual.temp - fcTemp).toFixed(1) : '0';

    interactionDots += `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#30d158" stroke="#ffffff" stroke-width="1.5" class="vfy-interactive-dot" data-time="${p.pt.hourLabel}" data-actual="${p.pt.actual.temp}" data-forecast="${fcTemp}" data-diff="${diffStr}" />
    `;
  });

  svg.innerHTML = `
    <!-- Rasterlinien & Achsen -->
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
    <line x1="${padL}" y1="${padT + plotH / 2}" x2="${W - padR}" y2="${padT + plotH / 2}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3" />

    <!-- Y-Achse Beschriftung -->
    <text x="${padL - 8}" y="${padT + 4}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="end" font-family="monospace">${maxT}°</text>
    <text x="${padL - 8}" y="${padT + plotH / 2 + 3}" fill="rgba(255,255,255,0.3)" font-size="9" text-anchor="end" font-family="monospace">${Math.round((maxT + minT) / 2)}°</text>
    <text x="${padL - 8}" y="${padT + plotH}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="end" font-family="monospace">${minT}°</text>

    <!-- X-Achse Zeitpunkte -->
    <text x="${padL}" y="${H - 10}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="start">${history[0].hourLabel} (-24h)</text>
    <text x="${padL + plotW / 2}" y="${H - 10}" fill="rgba(255,255,255,0.4)" font-size="9" text-anchor="middle">-12h</text>
    <text x="${W - padR}" y="${H - 10}" fill="#30d158" font-size="10" font-weight="700" text-anchor="end">Jetzt (${history[history.length - 1].hourLabel})</text>

    <!-- Kurve 1: Prognose (Gestrichelt, Cyan/Blau) -->
    ${forecastPoints.length > 1 ? `
      <polyline points="${forecastPolyline}" fill="none" stroke="#0a84ff" stroke-width="2.2" stroke-dasharray="4 3" stroke-linecap="round" opacity="0.85" />
    ` : ''}

    <!-- Kurve 2: Reale Messung (Durchgezogen leuchtend Grün) -->
    ${actualPoints.length > 1 ? `
      <polyline points="${actualPolyline}" fill="none" stroke="#30d158" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    ` : ''}

    <!-- Interaktive Messpunkte -->
    ${interactionDots}
  `;

  // Hover / Touch Event auf Chart
  setupChartHoverTooltip(svg);
}

function setupChartHoverTooltip(svg) {
  const tooltip = document.getElementById('vfy-tooltip');
  if (!tooltip || !svg || svg._hoverListenersBound) return;
  svg._hoverListenersBound = true;

  svg.addEventListener('pointermove', (e) => {
    const dot = e.target.closest('.vfy-interactive-dot');
    if (dot) {
      const time = dot.dataset.time;
      const actual = dot.dataset.actual;
      const forecast = dot.dataset.forecast;
      const diff = parseFloat(dot.dataset.diff);
      const sign = diff > 0 ? '+' : '';

      tooltip.style.display = 'block';
      tooltip.innerHTML = `
        <strong>⏱️ ${time} Uhr</strong>
        <div>Gemessen (Ist): <b style="color:#30d158;">${actual}°C</b></div>
        <div>Prognose (Soll): <b style="color:#0a84ff;">${forecast !== 'null' ? forecast + '°C' : '--'}</b></div>
        <div style="margin-top:2px; font-size:11px;">Abweichung: <b style="color:${Math.abs(diff) <= 0.8 ? '#30d158' : '#ffd166'}">${sign}${diff}°C</b></div>
      `;

      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      tooltip.style.left = `${Math.max(10, Math.min(rect.width - 150, x + 10))}px`;
      tooltip.style.top = `${Math.max(10, y - 55)}px`;
    }
  });

  svg.addEventListener('pointerleave', () => {
    tooltip.style.display = 'none';
  });
}

/**
 * 1-Tap Feedback Knöpfe für Nutzer mit direkter visueller Bestätigung
 */
export function setupCrowdGroundTruthControls() {
  const container = document.getElementById('verification-dashboard-section');
  if (!container) return;

  // Verhindere mehrfaches Registrieren des globalen Delegated-Listeners
  if (container._crowdListenerAttached) return;
  container._crowdListenerAttached = true;

  container.addEventListener('click', (e) => {
    // 1. Klick auf eine Wetterlagen-Kachel
    const btn = e.target.closest('.vcb-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();

      const condition = btn.dataset.condition;
      const loc = state.currentLocation;
      if (!loc || !condition) return;

      // 1. Sofort in VerificationStore persistieren
      const report = VerificationStore.saveUserGroundTruth(loc.lat, loc.lon, condition);

      // 2. Sofort im State spiegeln
      if (state.actualVerification) {
        state.actualVerification.userReport = report;
      }

      // 3. Sofortige mikroklimatische Kalibrierung in ActualEngine & State
      if (state.weatherData && state.weatherData.current) {
        ActualEngine.applyUserGroundTruthAdjustment(state.weatherData.current, state.weatherData.hourly, report);
      }

      // 4. Accordion-Zustand offen halten & Dashboard re-rendern
      const card = document.getElementById('verification-card');
      if (card) card.setAttribute('open', '');

      renderVerificationDashboard();

      // 5. Asynchrones Neuladen für Konsistenz anstoßen
      if (onReloadCallback) {
        onReloadCallback(loc);
      }
      return;
    }

    // 2. Klick auf 'Meldung aufheben' (Reset)
    const resetBtn = e.target.closest('#vcc-reset-btn');
    if (resetBtn) {
      e.preventDefault();
      e.stopPropagation();

      const loc = state.currentLocation;
      if (!loc) return;

      // 1. Aus Storage entfernen & State leeren
      VerificationStore.clearUserGroundTruth(loc.lat, loc.lon);
      if (state.actualVerification) {
        state.actualVerification.userReport = null;
      }

      // 2. Accordion-Zustand offen halten & Dashboard re-rendern
      const card = document.getElementById('verification-card');
      if (card) card.setAttribute('open', '');

      renderVerificationDashboard();

      // 3. Asynchrones Neuladen anstoßen
      if (onReloadCallback) {
        onReloadCallback(loc);
      }
    }
  });
}

