/**
 * BEST WEATHER — Bento Quick-Metrics Detail Sheets & Modals
 * Transforms compact Bento tiles into rich, interactive deep-dive layers on tap.
 */

import { state } from '../core/state.js';
import { escapeHtml } from '../httpClient.js';
import { convertTemp, getTodayDailyIndex, getClosestHourlyIndex } from './overview.js';

let isInitialized = false;

export function initBentoSheets() {
  if (isInitialized) return;
  isInitialized = true;

  // 1. Delegated Click on Bento Tiles
  const bentoGrid = document.querySelector('.bento-grid');
  if (bentoGrid) {
    bentoGrid.addEventListener('click', (e) => {
      const tile = e.target.closest('.bento-item[data-bento]');
      if (!tile) return;
      const bentoType = tile.getAttribute('data-bento');
      if (bentoType) {
        openBentoSheet(bentoType);
      }
    });

    // Keyboard Accessibility (Enter / Space)
    bentoGrid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const tile = e.target.closest('.bento-item[data-bento]');
        if (!tile) return;
        e.preventDefault();
        const bentoType = tile.getAttribute('data-bento');
        if (bentoType) {
          openBentoSheet(bentoType);
        }
      }
    });
  }

  // 2. Close Modal Handlers
  const modal = document.getElementById('bento-detail-modal');
  if (modal) {
    const closeBtn1 = document.getElementById('bento-modal-close');
    const closeBtn2 = document.getElementById('bento-modal-close-btn');

    const closeModal = () => closeBentoSheet();

    if (closeBtn1) closeBtn1.addEventListener('click', closeModal);
    if (closeBtn2) closeBtn2.addEventListener('click', closeModal);

    // Backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        closeModal();
      }
    });

    // Touch Swipe Down Handler on Mobile
    let touchStartY = 0;
    const card = modal.querySelector('.bento-sheet-card');
    if (card) {
      card.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      card.addEventListener('touchend', (e) => {
        const touchEndY = e.changedTouches[0].clientY;
        if (touchEndY - touchStartY > 75) {
          // Swipe down detected
          closeModal();
        }
      }, { passive: true });
    }
  }
}

export function openBentoSheet(type) {
  const modal = document.getElementById('bento-detail-modal');
  const body = document.getElementById('bdm-body');
  const title = document.getElementById('bdm-title');
  const subtitle = document.getElementById('bdm-subtitle');
  const locBadge = document.getElementById('bdm-location-badge');

  if (!modal || !body) return;

  const w = state.weatherData;
  const m = state.microData;
  const hIdx = getClosestHourlyIndex(w?.hourly);
  const cur = w ? (w.current || (w.hourly ? {
    temperature_2m: w.hourly.temperature_2m[hIdx],
    relative_humidity_2m: w.hourly.relative_humidity_2m ? w.hourly.relative_humidity_2m[hIdx] : 70,
    wind_speed_10m: w.hourly.wind_speed_10m ? w.hourly.wind_speed_10m[hIdx] : 10,
    wind_direction_10m: w.hourly.wind_direction_10m ? w.hourly.wind_direction_10m[hIdx] : 0,
    wind_gusts_10m: w.hourly.wind_gusts_10m ? w.hourly.wind_gusts_10m[hIdx] : 15,
    uv_index: w.hourly.uv_index ? w.hourly.uv_index[hIdx] : 0,
    pressure_msl: w.hourly.pressure_msl ? w.hourly.pressure_msl[hIdx] : 1013,
    surface_pressure: w.hourly.surface_pressure ? w.hourly.surface_pressure[hIdx] : 1013
  } : {})) : {};

  const daily = w ? w.daily : null;
  const loc = state.currentLocation || { name: 'Mein Standort', elevation: 520 };

  if (locBadge) {
    locBadge.innerText = `📍 ${loc.name} (${loc.elevation || 520} m)`;
  }

  // Render metric-specific detail layout
  switch (type) {
    case 'wind':
      renderWindSheet(cur, loc, title, subtitle, body);
      break;
    case 'sun':
      renderSunSheet(daily, loc, title, subtitle, body);
      break;
    case 'uv':
      renderUvSheet(cur, loc, title, subtitle, body);
      break;
    case 'precip':
      renderPrecipSheet(cur, daily, w?.hourly, loc, m, title, subtitle, body);
      break;
    case 'humidity':
      renderHumiditySheet(cur, loc, title, subtitle, body);
      break;
    case 'pressure':
      renderPressureSheet(cur, loc, title, subtitle, body);
      break;
    default:
      body.innerHTML = '<p>Details werden geladen...</p>';
  }

  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
}

export function closeBentoSheet() {
  const modal = document.getElementById('bento-detail-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  document.body.classList.remove('modal-open');
}

/* =============================================================================
   1. WIND & BÖEN DETAIL SHEET
   ============================================================================= */
function renderWindSheet(cur, loc, titleEl, subtitleEl, bodyEl) {
  if (titleEl) titleEl.innerText = '💨 Wind & Böen — Detailanalyse';
  if (subtitleEl) subtitleEl.innerText = 'Windrose, orografische Grat-Verstärkung & Beaufort-Skala';

  const spd = Math.round(cur.wind_speed_10m || 0);
  const dir = Math.round(cur.wind_direction_10m || 0);
  const gusts = Math.round(cur.wind_gusts_10m || spd * 1.4);

  // Windrichtungs-Name
  const directions = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const dirName = directions[Math.round(dir / 22.5) % 16];

  // Beaufort
  let bft = 0;
  let bftLabel = 'Windstille';
  let bftDesc = 'Rauch steigt senkrecht empor.';
  if (spd >= 1) { bft = 1; bftLabel = 'Leiser Zug'; bftDesc = 'Windrichtung nur durch Rauchabtrift erkennbar.'; }
  if (spd >= 6) { bft = 2; bftLabel = 'Leichte Brise'; bftDesc = 'Wind im Gesicht spürbar, Blätter säuseln.'; }
  if (spd >= 12) { bft = 3; bftLabel = 'Schwache Brise'; bftDesc = 'Blätter und dünne Zweige bewegen sich.'; }
  if (spd >= 20) { bft = 4; bftLabel = 'Mäßige Brise'; bftDesc = 'Zweige bewegen sich, loses Papier wird aufgeweht.'; }
  if (spd >= 29) { bft = 5; bftLabel = 'Frische Brise'; bftDesc = 'Kleine Laubbäume schwanken, auf Seen Schaumkronen.'; }
  if (spd >= 39) { bft = 6; bftLabel = 'Starker Wind'; bftDesc = 'Dicke Äste bewegen sich, Pfeifen im Drahtzaun.'; }
  if (spd >= 50) { bft = 7; bftLabel = 'Steifer Wind'; bftDesc = 'Ganze Bäume schwanken, spürbarer Widerstand beim Gehen.'; }
  if (spd >= 62) { bft = 8; bftLabel = 'Stürmischer Wind'; bftDesc = 'Zweige brechen, Gehen im Freien erheblich erschwert.'; }
  if (spd >= 75) { bft = 9; bftLabel = 'Sturm'; bftDesc = 'Kleinere Schäden an Häusern, Dachziegel lösen sich.'; }
  if (spd >= 89) { bft = 10; bftLabel = 'Schwerer Sturm'; bftDesc = 'Bäume werden entwurzelt, bedeutende Schäden.'; }

  const isMountain = !!loc.isMountain;
  const alpineHint = isMountain
    ? '🏔️ <b>Alpiner Grateffekt:</b> Auf Bergrücken und Pässen können lokale Düseneffekte (Kanalisierung im Tal) die Böen um +30% bis +50% verstärken.'
    : '🏙️ <b>Städtischer Strömungseffekt:</b> In Straßenschluchten treten lokale Windspitzen durch den Bernoulli-Effekt auf.';

  bodyEl.innerHTML = `
    <div class="bdm-grid">
      <!-- 1. Live Kompass Scheibe -->
      <div class="bdm-hero-box compass-hero-box">
        <div class="bdm-compass-dial">
          <span class="cp-label n">N</span>
          <span class="cp-label e">O</span>
          <span class="cp-label s">S</span>
          <span class="cp-label w">W</span>
          <div class="cp-needle" style="transform: rotate(${dir}deg);">
            <div class="cp-needle-head"></div>
            <div class="cp-needle-tail"></div>
          </div>
          <div class="cp-center-dot"></div>
        </div>
        <div class="bdm-hero-meta">
          <div class="bdm-big-num">${spd} <small>km/h</small></div>
          <div class="bdm-sub-label">Aus Richtung <b>${dirName} (${dir}°)</b></div>
          <div class="bdm-pill-row">
            <span class="bdm-pill bdm-pill-warning">⚡ Böen bis ${gusts} km/h</span>
            <span class="bdm-pill">Beaufort ${bft} • ${bftLabel}</span>
          </div>
        </div>
      </div>

      <!-- 2. Beaufort Erklärung -->
      <div class="bdm-section-card">
        <div class="bsc-title">📊 BEAUFORT-WINDSTÄRKE &amp; WIRKUNG</div>
        <div class="bsc-content">
          <div class="bft-meter-bar">
            <div class="bft-meter-fill" style="width: ${Math.min(100, (spd / 75) * 100)}%;"></div>
          </div>
          <p class="bsc-text"><strong>Stufe ${bft} (${bftLabel}):</strong> ${bftDesc}</p>
        </div>
      </div>

      <!-- 3. Alpin & Outdoor Hinweis -->
      <div class="bdm-section-card">
        <div class="bsc-title">🧭 GELÄNDE- &amp; TOURENHINWEIS</div>
        <div class="bsc-content">
          <p class="bsc-text">${alpineHint}</p>
        </div>
      </div>
    </div>
  `;
}

/* =============================================================================
   2. SONNENSTAND & DÄMMERUNG DETAIL SHEET
   ============================================================================= */
function renderSunSheet(daily, loc, titleEl, subtitleEl, bodyEl) {
  if (titleEl) titleEl.innerText = '🌅 Sonnenstand & Dämmerungsphasen';
  if (subtitleEl) subtitleEl.innerText = 'Solarer Verlauf, Tageslichtdauer und Einstrahlungswinkel';

  let sunriseStr = '--:--';
  let sunsetStr = '--:--';
  let daylightStr = '-- h';
  let sunProgressPct = 50;
  let isSunUp = true;

  const todayIdx = getTodayDailyIndex(daily).idx;
  if (daily && daily.sunrise && daily.sunset && daily.sunrise.length > 0) {
    const rise = new Date(daily.sunrise[todayIdx] || daily.sunrise[0]);
    const set = new Date(daily.sunset[todayIdx] || daily.sunset[0]);
    const now = new Date();

    sunriseStr = rise.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    sunsetStr = set.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    const totalMin = (set.getTime() - rise.getTime()) / 60000;
    const elapsedMin = (now.getTime() - rise.getTime()) / 60000;
    daylightStr = `${(totalMin / 60).toFixed(1)} h Licht`;

    isSunUp = now >= rise && now <= set;
    sunProgressPct = Math.max(0, Math.min(100, (elapsedMin / totalMin) * 100));
  }

  // Calculate sun position on SVG parabola (viewBox 0 0 300 120)
  // Parabola from (20, 100) to (280, 100) with peak at (150, 20)
  const x = 20 + (sunProgressPct / 100) * 260;
  // normalized -1 at start, 0 at peak, 1 at end
  const normX = ((sunProgressPct / 100) * 2) - 1;
  const y = 20 + 80 * (normX * normX);

  bodyEl.innerHTML = `
    <div class="bdm-grid">
      <!-- 1. Goldener Sonnenbogen SVG -->
      <div class="bdm-hero-box sun-hero-box">
        <svg class="sun-arc-full-svg" viewBox="0 0 300 120">
          <defs>
            <linearGradient id="sunGlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#ff9f0a" />
              <stop offset="50%" stop-color="#ffd166" />
              <stop offset="100%" stop-color="#ff9f0a" />
            </linearGradient>
          </defs>
          <!-- Horizont-Linie -->
          <line x1="10" y1="100" x2="290" y2="100" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-dasharray="4,4" />
          
          <!-- Sonnenbahn -->
          <path d="M 20 100 Q 150 10 280 100" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3" />
          <path d="M 20 100 Q 150 10 280 100" fill="none" stroke="url(#sunGlow)" stroke-width="3.5" stroke-dasharray="350" stroke-dashoffset="${350 - (sunProgressPct / 100) * 350}" />

          <!-- Sonnen-Icon -->
          ${isSunUp ? `
            <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10" fill="#ffd166" filter="drop-shadow(0 0 8px rgba(255, 209, 102, 0.8))" />
            <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#ffffff" />
          ` : `
            <circle cx="280" cy="100" r="8" fill="rgba(255,255,255,0.3)" />
          `}
        </svg>

        <div class="sun-times-highlight">
          <div class="sth-col">
            <span class="sth-label">🌅 Sonnenaufgang</span>
            <strong class="sth-val">${sunriseStr} Uhr</strong>
          </div>
          <div class="sth-col center">
            <span class="sth-label">☀️ Status</span>
            <strong class="sth-val text-yellow">${isSunUp ? 'Tag aktiv' : 'Nacht / Dämmerung'}</strong>
          </div>
          <div class="sth-col">
            <span class="sth-label">🌇 Sonnenuntergang</span>
            <strong class="sth-val">${sunsetStr} Uhr</strong>
          </div>
        </div>
      </div>

      <!-- 2. Dämmerungsphasen & Dauer -->
      <div class="bdm-section-card">
        <div class="bsc-title">⏳ TAGESLICHT &amp; EFFEKTIVE DAUER</div>
        <div class="bsc-content">
          <div class="sun-phase-grid">
            <div class="sp-item">
              <span class="sp-icon">☀️</span>
              <span class="sp-label">Tageslichtdauer</span>
              <strong class="sp-val">${daylightStr}</strong>
            </div>
            <div class="sp-item">
              <span class="sp-icon">🕯️</span>
              <span class="sp-label">Bürgerliche Dämmerung</span>
              <strong class="sp-val">~32 Min.</strong>
            </div>
            <div class="sp-item">
              <span class="sp-icon">🏔️</span>
              <span class="sp-label">Hang-Exposition</span>
              <strong class="sp-val">Volle Süd-Besonnung</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =============================================================================
   3. UV-INDEX & HÖHENEXPOSITION DETAIL SHEET
   ============================================================================= */
function renderUvSheet(cur, loc, titleEl, subtitleEl, bodyEl) {
  if (titleEl) titleEl.innerText = '☀️ UV-Index & Höhenstrahlung';
  if (subtitleEl) subtitleEl.innerText = 'Atmosphärische UV-Intensität & Schutzzeit nach Hauttyp';

  const uv = cur.uv_index !== undefined ? Math.round(cur.uv_index) : 0;
  const elev = loc.elevation || 520;
  const altitudeBoostPct = Math.round((elev / 1000) * 11);

  let uvCategory = 'Gering';
  let uvColor = '#30d158';
  let protectionNeeded = 'Kein besonderer Schutz erforderlich.';
  let skinTimeMin = 'Über 60 Minuten';

  if (uv >= 3) {
    uvCategory = 'Mäßig';
    uvColor = '#ffd166';
    protectionNeeded = 'Sonnenschutz bei längerer Exposition empfohlen (Hut, Sonnencreme).';
    skinTimeMin = '30–45 Minuten (Hauttyp II)';
  }
  if (uv >= 6) {
    uvCategory = 'Hoch';
    uvColor = '#ff9f0a';
    protectionNeeded = 'Schutz dringend erforderlich! Schatten suchen, LSF 30+, Sonnenbrille UV400.';
    skinTimeMin = '20–30 Minuten (Hauttyp II)';
  }
  if (uv >= 8) {
    uvCategory = 'Sehr hoch';
    uvColor = '#ff453a';
    protectionNeeded = 'Intensive Bergsonne! Aufenthalt in der Mittagssonne meiden, LSF 50+.';
    skinTimeMin = '15–20 Minuten';
  }
  if (uv >= 11) {
    uvCategory = 'Extrem';
    uvColor = '#bf5af2';
    protectionNeeded = 'Gefährliche Strahlung! Ungeschützter Aufenthalt führt rasch zu Verbrennungen.';
    skinTimeMin = '< 10 Minuten';
  }

  bodyEl.innerHTML = `
    <div class="bdm-grid">
      <!-- 1. UV Hero Gauge -->
      <div class="bdm-hero-box uv-hero-box">
        <div class="uv-score-circle" style="border-color: ${uvColor}; color: ${uvColor};">
          <span class="usc-num">${uv}</span>
          <span class="usc-label">UV-INDEX</span>
        </div>
        <div class="uv-hero-text">
          <h3 class="uht-title" style="color: ${uvColor};">${uvCategory} Belastung</h3>
          <p class="uht-desc">${protectionNeeded}</p>
          <div class="uv-bar-gauge full-gauge">
            <div class="uv-pointer" style="left: ${Math.min(100, (uv / 11) * 100)}%;"></div>
          </div>
        </div>
      </div>

      <!-- 2. Alpiner Höhenzuschlag -->
      <div class="bdm-section-card">
        <div class="bsc-title">🏔️ ATMOSPHÄRISCHER HÖHENZUSCHLAG</div>
        <div class="bsc-content">
          <p class="bsc-text">
            Durch die dünnere Luftsäule auf <b>${elev.toLocaleString('de-DE')} m</b> ist die UV-Intensität um ca. <b class="text-accent">+${altitudeBoostPct}%</b> stärker als auf Meereshöhe.
            ${elev >= 1500 ? '<br>⚠️ <i>Schneefelder und helle Kalkwände reflektieren bis zu 80% des UV-Lichts zusätzlich.</i>' : ''}
          </p>
        </div>
      </div>

      <!-- 3. Schutzzeit-Tabelle nach Hauttyp -->
      <div class="bdm-section-card">
        <div class="bsc-title">🛡️ EIGENSCHUTZZEIT OHNE SONNENCREME</div>
        <div class="bsc-content">
          <div class="skin-type-grid">
            <div class="st-row"><span>Hauttyp I (Keltisch, rotblond)</span><strong>${uv >= 6 ? '~15 Min.' : '~25 Min.'}</strong></div>
            <div class="st-row"><span>Hauttyp II (Hellblond, hellhäutig)</span><strong>${uv >= 6 ? '~20 Min.' : '~35 Min.'}</strong></div>
            <div class="st-row"><span>Hauttyp III (Dunkelblond / Braun)</span><strong>${uv >= 6 ? '~30 Min.' : '~50 Min.'}</strong></div>
            <div class="st-row"><span>Hauttyp IV (Mediterran / Dunkel)</span><strong>${uv >= 6 ? '~45 Min.' : '> 60 Min.'}</strong></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =============================================================================
   4. NIEDERSCHLAG & SCHNEEFALLGRENZE DETAIL SHEET
   ============================================================================= */
function renderPrecipSheet(cur, daily, hourly, loc, micro, titleEl, subtitleEl, bodyEl) {
  if (titleEl) titleEl.innerText = '🌧️ Niederschlag & Schneefallgrenze';
  if (subtitleEl) subtitleEl.innerText = '24h Akkumulation, Schneefallgrenze und Niederschlagsphase';

  const todayIdx = getTodayDailyIndex(daily).idx;
  const hIdx = getClosestHourlyIndex(hourly);
  const pSum = (daily && daily.precipitation_sum && daily.precipitation_sum[todayIdx] != null) ? Number(daily.precipitation_sum[todayIdx]) : 0;
  const pop = (daily && daily.precipitation_probability_max && daily.precipitation_probability_max[todayIdx] != null) ? Math.round(daily.precipitation_probability_max[todayIdx]) : 0;
  
  const elev = loc.elevation || 520;
  const freezingLevel = (micro && micro.atmosphere && micro.atmosphere.freezingLevelMeters) ||
    (hourly && hourly.freezing_level_height ? hourly.freezing_level_height[hIdx] : 2200);
  const snowLevel = (micro && micro.atmosphere && micro.atmosphere.snowLevelMeters) || Math.max(0, freezingLevel - 300);

  let phase = 'Regen';
  if (elev >= snowLevel) phase = 'Schneefall / Flocken';
  else if (elev >= snowLevel - 200) phase = 'Schneeregen / Nassschnee';

  bodyEl.innerHTML = `
    <div class="bdm-grid">
      <!-- 1. Niederschlags Hero Box -->
      <div class="bdm-hero-box precip-hero-box">
        <div class="precip-stat-col">
          <div class="bdm-big-num text-cyan">${pSum.toFixed(1)} <small>mm</small></div>
          <span class="bdm-sub-label">24h Gesamtsumme</span>
        </div>
        <div class="precip-divider"></div>
        <div class="precip-stat-col">
          <div class="bdm-big-num text-accent">${pop}%</div>
          <span class="bdm-sub-label">Regenrisiko</span>
        </div>
      </div>

      <!-- 2. Schnee- & Nullgradgrenze -->
      <div class="bdm-section-card">
        <div class="bsc-title">❄️ SCHNEEFALL- &amp; NULLGRADGRENZE</div>
        <div class="bsc-content">
          <div class="snowline-stat-grid">
            <div class="sls-item">
              <span class="sls-label">Schneefallgrenze</span>
              <strong class="sls-val text-cyan">~${Math.round(snowLevel).toLocaleString('de-DE')} m</strong>
              <small class="sls-sub">Höhe des Übergangs</small>
            </div>
            <div class="sls-item">
              <span class="sls-label">Nullgradgrenze (0°C)</span>
              <strong class="sls-val text-accent">~${Math.round(freezingLevel).toLocaleString('de-DE')} m</strong>
              <small class="sls-sub">Freie Atmosphäre</small>
            </div>
          </div>
          <div class="sls-status-bar">
            <span>Standort (${elev} m): <b>${phase}</b></span>
          </div>
        </div>
      </div>
    </div>
  `;
}

/* =============================================================================
   5. FEUCHTIGKEIT & TAUPUNKT DETAIL SHEET
   ============================================================================= */
function renderHumiditySheet(cur, loc, titleEl, subtitleEl, bodyEl) {
  if (titleEl) titleEl.innerText = '💧 Luftfeuchte & Taupunkt';
  if (subtitleEl) subtitleEl.innerText = 'Kondensationspotenzial, Sättigung und Behaglichkeits-Index';

  const t = cur.temperature_2m || 10;
  const rh = Math.round(cur.relative_humidity_2m || 65);
  const dew = (t - ((100 - rh) / 5)).toFixed(1);
  const spread = (t - parseFloat(dew)).toFixed(1);

  let fogRisk = 'Gering';
  let fogClass = 'text-green';
  if (spread <= 1.5) {
    fogRisk = 'Sehr hoch (Nebel & Wolkenbildung am Hang)';
    fogClass = 'text-accent';
  } else if (spread <= 3.0) {
    fogRisk = 'Mäßig (Dunst & Talneigung)';
    fogClass = 'text-yellow';
  }

  bodyEl.innerHTML = `
    <div class="bdm-grid">
      <!-- 1. Feuchte & Taupunkt Hero -->
      <div class="bdm-hero-box humidity-hero-box">
        <div class="bdm-stat-pair">
          <div class="bsp-item">
            <span class="bsp-val">${rh}%</span>
            <span class="bsp-label">Relative Feuchte</span>
          </div>
          <div class="bsp-divider"></div>
          <div class="bsp-item">
            <span class="bsp-val text-cyan">${dew}°C</span>
            <span class="bsp-label">Berechneter Taupunkt</span>
          </div>
        </div>
      </div>

      <!-- 2. Spread & Kondensation -->
      <div class="bdm-section-card">
        <div class="bsc-title">🌫️ SPREAD (T − T_TAU) &amp; KONDENSATION</div>
        <div class="bsc-content">
          <p class="bsc-text">
            Temperatur-Taupunkt-Differenz (Spread): <b>Δ ${spread}°C</b>.<br>
            Nebel- &amp; Kondensationsneigung: <b class="${fogClass}">${fogRisk}</b>.
          </p>
        </div>
      </div>
    </div>
  `;
}

/* =============================================================================
   6. LUFTPDRUCK & BAROMETER DETAIL SHEET
   ============================================================================= */
function renderPressureSheet(cur, loc, titleEl, subtitleEl, bodyEl) {
  if (titleEl) titleEl.innerText = '⏲️ Luftdruck & Barometer-Tendenz';
  if (subtitleEl) subtitleEl.innerText = 'Meeresniveau-Druck (QNH) vs. Stationsdruck (QFE)';

  const qnh = Math.round(cur.pressure_msl || 1013);
  const qfe = Math.round(cur.surface_pressure || qnh);

  let trend = 'Stabil';
  let trendDesc = 'Gleichbleibender Druckverlauf in den letzten 3 Stunden.';
  if (qnh > 1020) trendDesc = 'Stabiles Hochdruckgebiet sorgt für absteigende Luftmassen und sonnige Abschnitte.';
  else if (qnh < 1005) trendDesc = 'Tiefdruckrinne begünstigt aufsteigende Luftmassen, Quellwolken und Schauer.';

  bodyEl.innerHTML = `
    <div class="bdm-grid">
      <!-- 1. Barometer Hero -->
      <div class="bdm-hero-box pressure-hero-box">
        <div class="bdm-stat-pair">
          <div class="bsp-item">
            <span class="bsp-val text-accent">${qnh} <small>hPa</small></span>
            <span class="bsp-label">Meeresniveau (QNH)</span>
          </div>
          <div class="bsp-divider"></div>
          <div class="bsp-item">
            <span class="bsp-val">${qfe} <small>hPa</small></span>
            <span class="bsp-label">Vor Ort (${loc.elevation || 520} m, QFE)</span>
          </div>
        </div>
      </div>

      <!-- 2. Barometrische Tendenz -->
      <div class="bdm-section-card">
        <div class="bsc-title">📈 BAROMETERTREND &amp; SYNOPTIK</div>
        <div class="bsc-content">
          <p class="bsc-text">
            <b>Tendenz:</b> ${trend}<br>
            ${trendDesc}
          </p>
        </div>
      </div>
    </div>
  `;
}

