/**
 * BEST WEATHER — Verification Store (A.C.T.U.A.L. Engine)
 * Manages persistent storage of numerical model forecasts (Soll)
 * alongside real ground-truth measurements (Ist) and user ground-truth observations.
 */

import { AlpineStorage } from '../storage.js';

const FORECAST_PREFIX = 'bw_vfy_fc_';
const ACTUAL_PREFIX = 'bw_vfy_act_';
const CROWD_PREFIX = 'bw_vfy_crowd_';
const MAX_HOURS_HISTORY = 72; // 3 Tage rollierendes Archiv

export const VerificationStore = {
  /**
   * Generiert einen eindeutigen Schlüssel basierend auf Koordinaten (~1.1 km Genauigkeit)
   */
  getLocationKey(lat, lon) {
    if (lat === undefined || lon === undefined) return '0.00,0.00';
    return `${parseFloat(lat).toFixed(2)},${parseFloat(lon).toFixed(2)}`;
  },

  /**
   * Normalisiert Zeitstempel auf volle Stunden (ISO String "YYYY-MM-DDTHH:00:00Z")
   */
  normalizeHourKey(timeVal) {
    const d = new Date(timeVal);
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 13) + ':00:00.000Z';
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  },

  /**
   * Speichert Vorhersage-Snapshots (was die Modelle für diese Stunden berechnet haben)
   */
  saveForecastSnapshots(lat, lon, elevation, hourlyData, modelBreakdown = null) {
    if (!hourlyData || !Array.isArray(hourlyData.time)) return;
    const locKey = this.getLocationKey(lat, lon);
    const storeKey = `${FORECAST_PREFIX}${locKey}`;

    let store = AlpineStorage.safeGetItem(storeKey, {});
    if (typeof store !== 'object' || store === null) store = {};

    const nowIso = new Date().toISOString();
    const count = Math.min(48, hourlyData.time.length);

    for (let i = 0; i < count; i++) {
      const hourKey = this.normalizeHourKey(hourlyData.time[i]);
      const temp = hourlyData.temperature_2m ? hourlyData.temperature_2m[i] : null;
      const wind = hourlyData.wind_speed_10m ? hourlyData.wind_speed_10m[i] : null;
      const gusts = hourlyData.wind_gusts_10m ? hourlyData.wind_gusts_10m[i] : null;
      const precip = hourlyData.precipitation ? hourlyData.precipitation[i] : 0;
      const pop = hourlyData.precipitation_probability ? hourlyData.precipitation_probability[i] : 0;
      const code = hourlyData.weather_code ? hourlyData.weather_code[i] : 0;

      // Zusätzliche modellspezifische Werte falls vorhanden
      const modelDetail = {};
      if (modelBreakdown && modelBreakdown.models) {
        Object.keys(modelBreakdown.models).forEach((mKey) => {
          const m = modelBreakdown.models[mKey];
          if (m && m.hourly && m.hourly.time) {
            const mIdx = m.hourly.time.findIndex(t => this.normalizeHourKey(t) === hourKey);
            if (mIdx >= 0) {
              modelDetail[mKey] = {
                temp: m.hourly.temperature_2m ? m.hourly.temperature_2m[mIdx] : null,
                wind: m.hourly.wind_speed_10m ? m.hourly.wind_speed_10m[mIdx] : null,
                precip: m.hourly.precipitation ? m.hourly.precipitation[mIdx] : 0
              };
            }
          }
        });
      }

      // Nur überschreiben oder anlegen, wenn noch keine ältere Prognose vorliegt,
      // damit wir den echten Vorhersage-Lead-Time behalten (was früher vorhergesagt wurde)
      if (!store[hourKey]) {
        store[hourKey] = {
          hourKey,
          targetElevation: Math.round(elevation || 500),
          firstSavedAt: nowIso,
          consensus: {
            temp: temp !== null ? Math.round(temp * 10) / 10 : null,
            wind: wind !== null ? Math.round(wind) : null,
            gusts: gusts !== null ? Math.round(gusts) : null,
            precip: Math.round(precip * 10) / 10,
            pop: Math.round(pop),
            code
          },
          models: modelDetail
        };
      }
    }

    // Ältere Einträge als 72 Stunden bereinigen
    const cutoffMs = Date.now() - MAX_HOURS_HISTORY * 3600 * 1000;
    const pruned = {};
    Object.keys(store).forEach((k) => {
      const ms = new Date(k).getTime();
      if (!isNaN(ms) && ms >= cutoffMs) {
        pruned[k] = store[k];
      }
    });

    AlpineStorage.safeSetItem(storeKey, pruned);
  },

  /**
   * Speichert eine tatsächliche Messung (Ist-Wetter) von Stationen oder ERA5/Open-Meteo
   */
  saveActualObservation(lat, lon, obs) {
    if (!obs || !obs.timestamp) return;
    const locKey = this.getLocationKey(lat, lon);
    const storeKey = `${ACTUAL_PREFIX}${locKey}`;

    let store = AlpineStorage.safeGetItem(storeKey, {});
    if (typeof store !== 'object' || store === null) store = {};

    const hourKey = this.normalizeHourKey(obs.timestamp);

    store[hourKey] = {
      hourKey,
      recordedAt: new Date().toISOString(),
      source: obs.source || 'Station',
      network: obs.network || 'DWD/MeteoSwiss/ZAMG',
      stationName: obs.stationName || 'Bodenmessstation',
      stationElevation: obs.stationElevation || null,
      temp: obs.temp !== undefined ? Math.round(obs.temp * 10) / 10 : null,
      apparentTemp: obs.apparentTemp !== undefined ? Math.round(obs.apparentTemp * 10) / 10 : null,
      windSpeed: obs.windSpeed !== undefined ? Math.round(obs.windSpeed) : null,
      windGusts: obs.windGusts !== undefined ? Math.round(obs.windGusts) : null,
      precip: obs.precip !== undefined ? Math.round(obs.precip * 10) / 10 : 0,
      weatherCode: obs.weatherCode !== undefined ? obs.weatherCode : null,
      pressureHpa: obs.pressureHpa ? Math.round(obs.pressureHpa) : null
    };

    // Ältere Einträge bereinigen
    const cutoffMs = Date.now() - MAX_HOURS_HISTORY * 3600 * 1000;
    const pruned = {};
    Object.keys(store).forEach((k) => {
      const ms = new Date(k).getTime();
      if (!isNaN(ms) && ms >= cutoffMs) {
        pruned[k] = store[k];
      }
    });

    AlpineStorage.safeSetItem(storeKey, pruned);
  },

  /**
   * Speichert ein manuelles 1-Tap Ist-Wetter-Nutzerfeedback ("Crowd Ground Truth")
   */
  saveUserGroundTruth(lat, lon, condition, note = '') {
    const locKey = this.getLocationKey(lat, lon);
    const storeKey = `${CROWD_PREFIX}${locKey}`;

    let list = AlpineStorage.safeGetItem(storeKey, []);
    if (!Array.isArray(list)) list = [];

    const report = {
      id: `gt_${Date.now()}`,
      timestamp: new Date().toISOString(),
      condition, // 'clear' | 'partlyCloudy' | 'cloudy' | 'fog' | 'rain' | 'snow'
      note: String(note).slice(0, 100)
    };

    list.unshift(report);
    // Behalte maximal 10 Meldungen
    AlpineStorage.safeSetItem(storeKey, list.slice(0, 10));
    return report;
  },

  /**
   * Holt die jüngste Nutzermeldung (wenn jünger als maxAgeMinutes, Standard 3h)
   */
  getRecentUserGroundTruth(lat, lon, maxAgeMinutes = 180) {
    const locKey = this.getLocationKey(lat, lon);
    const storeKey = `${CROWD_PREFIX}${locKey}`;
    const list = AlpineStorage.safeGetItem(storeKey, []);
    if (!Array.isArray(list) || list.length === 0) return null;

    const latest = list[0];
    const ageMs = Date.now() - new Date(latest.timestamp).getTime();
    if (ageMs <= maxAgeMinutes * 60 * 1000) {
      return {
        ...latest,
        ageMinutes: Math.round(ageMs / 60000)
      };
    }
    return null;
  },

  /**
   * Führt Prognosen (Soll) und Messungen (Ist) für die letzten X Stunden tabellarisch zusammen
   */
  getAlignedVerificationHistory(lat, lon, hoursBack = 24) {
    const locKey = this.getLocationKey(lat, lon);
    const fcStore = AlpineStorage.safeGetItem(`${FORECAST_PREFIX}${locKey}`, {});
    const actStore = AlpineStorage.safeGetItem(`${ACTUAL_PREFIX}${locKey}`, {});

    const results = [];
    const nowMs = Date.now();
    const currentHourMs = Math.floor(nowMs / (3600 * 1000)) * (3600 * 1000);

    for (let h = hoursBack; h >= 0; h--) {
      const targetTimeMs = currentHourMs - h * 3600 * 1000;
      const hourKey = new Date(targetTimeMs).toISOString();
      const hourLabel = new Date(targetTimeMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const dateLabel = new Date(targetTimeMs).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

      const fc = fcStore[hourKey] || null;
      const act = actStore[hourKey] || null;

      results.push({
        timeMs: targetTimeMs,
        hourKey,
        hourLabel,
        dateLabel,
        isCurrent: h === 0,
        forecast: fc ? fc.consensus : null,
        modelsForecast: fc ? fc.models : null,
        actual: act || null
      });
    }

    return results;
  }
};
