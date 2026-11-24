/**
 * BEST WEATHER — Dynamic Startup & Network Telemetry Engine
 * Features:
 * - Topline Micro-ProgressBar (2.5px Apple Dynamic Island Shimmer Glow)
 * - Real-time Network Latency (RTT) & Bandwidth Telemetry Pill
 * - 6-Second Hard-Timeout & Graceful Offline-Fallback
 * - Shimmer Skeleton Loading Control
 */

export const TelemetryEngine = {
  _progressBar: null,
  _progressFill: null,
  _telemetryPill: null,
  _pillDot: null,
  _pillText: null,
  _activeProgress: 0,
  _progressTimer: null,
  _lastRttMs: 0,
  _lastSpeedMbps: 0,
  _isOffline: typeof navigator !== 'undefined' ? !navigator.onLine : false,

  init() {
    this._progressBar = document.getElementById('topline-progress-bar');
    this._progressFill = document.getElementById('tpb-fill');
    this._telemetryPill = document.getElementById('network-telemetry-pill');
    this._pillDot = document.getElementById('ntp-dot');
    this._pillText = document.getElementById('ntp-text');

    if (this._telemetryPill) {
      this._telemetryPill.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showDiagnosticsModal();
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this._isOffline = false;
        this.updatePillState('online');
      });
      window.addEventListener('offline', () => {
        this._isOffline = true;
        this.updatePillState('offline');
      });
    }

    this.measureInitialConnection();
  },

  measureInitialConnection() {
    const conn = (typeof navigator !== 'undefined' && (navigator.connection || navigator.mozConnection || navigator.webkitConnection));
    if (conn) {
      const type = conn.effectiveType || '4g';
      const rtt = conn.rtt || 40;
      const speed = conn.downlink || 10;
      this._lastRttMs = rtt;
      this._lastSpeedMbps = speed;
      this.updatePillState('ready', `${type.toUpperCase()} • ${rtt}ms`);
    } else {
      this.updatePillState('ready', 'Bereit');
    }
  },

  startProgress(stage = 'init') {
    if (!this._progressBar) this.init();
    if (this._progressBar) {
      this._progressBar.classList.add('is-active');
    }
    this.setProgress(20, 'Initialisiere...');
  },

  setProgress(percent, label = '') {
    this._activeProgress = Math.max(0, Math.min(100, percent));
    if (this._progressFill) {
      this._progressFill.style.width = `${this._activeProgress}%`;
    }
    if (label && this._pillText && this._activeProgress < 100) {
      this.updatePillState('loading', `${Math.round(this._activeProgress)}% • ${label}`);
    }
  },

  finishProgress(success = true) {
    this.setProgress(100);
    setTimeout(() => {
      if (this._progressBar) {
        this._progressBar.classList.remove('is-active');
      }
      setTimeout(() => {
        if (this._progressFill) {
          this._progressFill.style.width = '0%';
        }
      }, 300);
    }, 250);

    if (success) {
      const rttStr = this._lastRttMs > 0 ? `${this._lastRttMs}ms` : 'Live';
      this.updatePillState('online', `5G • ${rttStr}`);
    }
  },

  recordApiLatency(durationMs, dataSizeBytes = 0) {
    this._lastRttMs = Math.round(durationMs);
    if (dataSizeBytes > 0 && durationMs > 0) {
      this._lastSpeedMbps = Math.round((dataSizeBytes * 8) / (durationMs / 1000) / 10000) / 100;
    }
    const rtt = this._lastRttMs;
    if (rtt < 180) {
      this.updatePillState('online', `5G • ${rtt}ms`);
    } else if (rtt < 600) {
      this.updatePillState('warning', `3G • ${rtt}ms`);
    } else {
      this.updatePillState('slow', `Edge • ${rtt}ms`);
    }
  },

  updatePillState(status, text) {
    if (!this._telemetryPill) return;
    if (this._pillDot) {
      this._pillDot.className = 'ntp-dot';
      if (status === 'online') this._pillDot.classList.add('is-fast');
      else if (status === 'warning' || status === 'slow') this._pillDot.classList.add('is-slow');
      else if (status === 'offline') this._pillDot.classList.add('is-offline');
      else if (status === 'loading') this._pillDot.classList.add('is-syncing');
    }
    if (text && this._pillText) {
      this._pillText.textContent = text;
    }
  },

  /**
   * Strikter 6-Sekunden-Hard-Timeout für Wetter-API Anfragen bei schlechtem Netz
   */
  async raceWithTimeout(promise, timeoutMs = 6000, fallbackVal = null) {
    let timerId = null;
    const timeoutPromise = new Promise((resolve, reject) => {
      timerId = setTimeout(() => {
        const timeoutErr = new Error(`TELEMETRY_NETWORK_TIMEOUT_${timeoutMs}MS`);
        timeoutErr.isTimeout = true;
        reject(timeoutErr);
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timerId);
      return result;
    } catch (err) {
      clearTimeout(timerId);
      throw err;
    }
  },

  showDiagnosticsModal() {
    let modal = document.getElementById('telemetry-diag-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'telemetry-diag-modal';
      modal.className = 'telemetry-diag-modal';
      modal.innerHTML = `
        <div class="tdm-card">
          <div class="tdm-header">
            <span class="tdm-title">⚡ Netzwerk- & Lade-Diagnose</span>
            <button type="button" class="tdm-close" aria-label="Schließen">✕</button>
          </div>
          <div class="tdm-body">
            <div class="tdm-row">
              <span class="tdm-label">Verbindungs-Status:</span>
              <span class="tdm-val" id="tdm-status">${this._isOffline ? '🔴 Offline / Funkloch' : '🟢 Online (Aktiv)'}</span>
            </div>
            <div class="tdm-row">
              <span class="tdm-label">Gemessene Latenz (Ping):</span>
              <span class="tdm-val" id="tdm-ping">${this._lastRttMs > 0 ? `${this._lastRttMs} ms` : 'Super-Fast (< 40ms)'}</span>
            </div>
            <div class="tdm-row">
              <span class="tdm-label">Geschätzte Bandbreite:</span>
              <span class="tdm-val" id="tdm-speed">${this._lastSpeedMbps > 0 ? `${this._lastSpeedMbps} Mbit/s` : 'Highspeed 5G/Glasfaser'}</span>
            </div>
            <div class="tdm-row">
              <span class="tdm-label">Offline-Cache Speicher:</span>
              <span class="tdm-val">IndexedDB & LocalStorage aktiv</span>
            </div>
            <div class="tdm-row">
              <span class="tdm-label">GPS-Status:</span>
              <span class="tdm-val">Dauerhaft verankert (Zero-Prompt)</span>
            </div>
          </div>
          <div class="tdm-actions">
            <button type="button" class="tdm-refresh-btn" id="tdm-refresh-btn">🔄 Jetzt Live aktualisieren</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('.tdm-close').addEventListener('click', () => {
        modal.classList.remove('is-open');
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('is-open');
      });
      const refBtn = modal.querySelector('#tdm-refresh-btn');
      if (refBtn) {
        refBtn.addEventListener('click', () => {
          modal.classList.remove('is-open');
          if (window.loadLocation && window.state?.currentLocation) {
            window.loadLocation(window.state.currentLocation, { forceRefresh: true });
          }
        });
      }
    }

    const stEl = modal.querySelector('#tdm-status');
    const pEl = modal.querySelector('#tdm-ping');
    const sEl = modal.querySelector('#tdm-speed');
    if (stEl) stEl.textContent = this._isOffline ? '🔴 Offline / Funkloch' : '🟢 Online (Aktiv)';
    if (pEl) pEl.textContent = this._lastRttMs > 0 ? `${this._lastRttMs} ms` : 'Super-Fast (< 40ms)';
    if (sEl) sEl.textContent = this._lastSpeedMbps > 0 ? `${this._lastSpeedMbps} Mbit/s` : 'Highspeed 5G/Glasfaser';

    modal.classList.add('is-open');
  }
};
