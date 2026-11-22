#!/usr/bin/env node
/**
 * BEST WEATHER — Enterprise Multi-Device GitLab CI Push Notification Dispatcher
 * Privacy-First Option 1 Architecture:
 * - Each device is identified EXCLUSIVELY by its locally generated anonymous RFC 4122 UUID v4
 *   in its own conflict-free GitLab CI variable: WEATHER_PUSH_DEV_<UUID_HEX>
 * - ZERO device metadata (no User-Agent, no model, no OS, no hardware fingerprinting)
 * - 100% independent rules, quiet hours, timezone, location, APNs subscription & anti-spam cooldowns per UUID
 * - Deduplicated Open-Meteo weather fetches per unique coordinate
 * - Fault-isolated delivery with automatic 410 Gone subscription expiry handling
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDailyReport, WMO_DESCRIPTIONS } from '../core/dailyReportEngine.js';

// Standard VAPID Fallback Keys
const DEFAULT_VAPID_PUBLIC_KEY = 'BFXeGAET8G6YxsiL0HvXELcaDIoZyeIgPYokZuqpueq3NFJs8xG7KsyvViif44MAxMkBI_OQ93OXewHGRhMSOmI';
const DEFAULT_VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '16Ovl5NMFksNazSkQceNN5LVKUigugt_J3ZSA37fXXA';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:push@best-weather.app';
const STATE_FILE_PATH = path.resolve('.dispatcher-state.json');

export const DEVICE_VAR_PREFIX = 'WEATHER_PUSH_DEV_';
const STALE_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage

/**
 * Kurze, anonyme Darstellung einer UUID für Logs (z. B. "9a7c4e12")
 */
function shortDeviceId(deviceId) {
  return String(deviceId || 'unknown').slice(0, 8);
}

/**
 * Erstellt einen frischen Cooldown-State für ein einzelnes Gerät
 */
function createEmptyDeviceState(nowMs = Date.now()) {
  return {
    lastSeenAt: nowMs,
    lastBriefingDate: null,
    lastWindAlertAt: 0,
    lastWindMax: 0,
    lastFrostAlertAt: 0,
    lastSevereAlertAt: 0,
    expired: false,
    expiredAt: null,
    lastConfigUpdatedAt: null
  };
}

/**
 * Lädt die persistierte Multi-Device Dispatcher-State-Datei (Anti-Spam & Cooldowns pro UUID)
 */
export function loadState(stateFilePath = STATE_FILE_PATH, env = process.env) {
  let raw = null;

  if (env.WEATHER_PUSH_STATE) {
    try {
      raw = JSON.parse(env.WEATHER_PUSH_STATE);
    } catch {
      // Ignore env parse failure and fallback to file
    }
  }

  if (!raw && fs.existsSync(stateFilePath)) {
    try {
      const data = fs.readFileSync(stateFilePath, 'utf8');
      raw = JSON.parse(data);
    } catch (err) {
      console.warn('⚠️ State-Datei beschädigt oder unlesbar, erstelle neuen State:', err.message);
    }
  }

  if (!raw || typeof raw !== 'object') {
    return {
      version: '2.31.0',
      lastRunAt: null,
      devices: {}
    };
  }

  // Migration von Legacy-Single-Device-State (v2.30.0) in v2.31.0 Multi-Device-Format
  if (!raw.devices || typeof raw.devices !== 'object') {
    const migrated = {
      version: '2.31.0',
      lastRunAt: raw.lastRunAt || null,
      devices: {}
    };
    if (raw.lastBriefingDate || raw.lastWindAlertAt || raw.lastFrostAlertAt || raw.lastSevereAlertAt) {
      migrated.devices.legacy = {
        ...createEmptyDeviceState(),
        lastBriefingDate: raw.lastBriefingDate || null,
        lastWindAlertAt: raw.lastWindAlertAt || 0,
        lastWindMax: raw.lastWindMax || 0,
        lastFrostAlertAt: raw.lastFrostAlertAt || 0,
        lastSevereAlertAt: raw.lastSevereAlertAt || 0
      };
    }
    return migrated;
  }

  return {
    version: '2.31.0',
    lastRunAt: raw.lastRunAt || null,
    devices: raw.devices
  };
}

/**
 * Holt oder initialisiert den isolierten State für eine bestimmte Geräte-UUID
 */
export function getOrInitDeviceState(globalState, deviceId, configUpdatedAt = null, nowMs = Date.now()) {
  if (!globalState.devices || typeof globalState.devices !== 'object') {
    globalState.devices = {};
  }
  if (!globalState.devices[deviceId]) {
    globalState.devices[deviceId] = createEmptyDeviceState(nowMs);
  }
  const devState = globalState.devices[deviceId];
  devState.lastSeenAt = nowMs;

  // Wenn sich das Gerät nach einem 410 Gone mit einer neuen Subscription/Konfiguration neu synchronisiert hat
  if (devState.expired && configUpdatedAt && configUpdatedAt !== devState.lastConfigUpdatedAt) {
    devState.expired = false;
    devState.expiredAt = null;
  }
  if (configUpdatedAt) {
    devState.lastConfigUpdatedAt = configUpdatedAt;
  }
  return devState;
}

/**
 * Entfernt verwaiste Geräte-States, die seit >30 Tagen nicht mehr vorhanden sind
 */
export function pruneStaleDeviceStates(globalState, activeDeviceIds, nowMs = Date.now()) {
  if (!globalState.devices) return;
  const activeSet = new Set(activeDeviceIds);
  for (const [id, st] of Object.entries(globalState.devices)) {
    if (!activeSet.has(id) && nowMs - (st.lastSeenAt || 0) > STALE_DEVICE_TTL_MS) {
      delete globalState.devices[id];
    }
  }
}

/**
 * Speichert den Multi-Device Dispatcher-State lokal (.dispatcher-state.json Cache)
 */
export function saveState(state, stateFilePath = STATE_FILE_PATH) {
  try {
    state.version = '2.33.0';
    state.lastRunAt = new Date().toISOString();
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
    console.log(`💾 Multi-Device Dispatcher-State lokal gecacht (${Object.keys(state.devices || {}).length} Gerät(e)).`);
  } catch (err) {
    console.warn('⚠️ Konnte State nicht auf Dateisystem schreiben:', err.message);
  }
}

/**
 * Persistiert den Multi-Device Cooldown-State atomar in die GitLab CI-Variable WEATHER_PUSH_STATE,
 * sodass Cooldowns & Morgen-Briefings über alle GitLab Shared Runners 100% erhalten bleiben.
 */
export async function persistStateToGitLab(state, env = process.env, fetchImpl = fetch) {
  const apiBase = (env.CI_API_V4_URL || '').trim().replace(/\/+$/, '');
  const projectId = (env.CI_PROJECT_ID || '').trim();
  const token = (env.PUSH_STATE_API_TOKEN || '').trim();

  if (!apiBase || !projectId || !token) {
    return { persisted: false, reason: 'no-api-token' };
  }

  const compactJson = JSON.stringify({
    version: '2.33.0',
    lastRunAt: state.lastRunAt || new Date().toISOString(),
    devices: state.devices || {}
  });

  const encodedProject = encodeURIComponent(projectId);
  const varKey = 'WEATHER_PUSH_STATE';
  const putUrl = `${apiBase}/projects/${encodedProject}/variables/${varKey}`;

  try {
    let res = await fetchImpl(putUrl, {
      method: 'PUT',
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value: compactJson })
    });

    if (res.status === 404) {
      const postUrl = `${apiBase}/projects/${encodedProject}/variables`;
      res = await fetchImpl(postUrl, {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key: varKey,
          value: compactJson,
          protected: false,
          masked: false
        })
      });
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`⚠️ GitLab State-Sync (${res.status}): ${txt || res.statusText}`);
      return { persisted: false, status: res.status };
    }

    console.log('☁️ Multi-Device State atomar in GitLab CI-Variable $WEATHER_PUSH_STATE gesichert.');
    return { persisted: true };
  } catch (err) {
    console.warn('⚠️ GitLab State-Sync fehlgeschlagen (Cache-Fallback aktiv):', err.message);
    return { persisted: false, error: err.message };
  }
}

/**
 * Normalisiert ein geparstes Geräte-Profil (streng ohne Geräteinformationen)
 */
function normalizeDeviceConfig(parsed, fallbackId, sourceKey) {
  if (!parsed || typeof parsed !== 'object') return null;

  const deviceId = (typeof parsed.deviceId === 'string' && parsed.deviceId.trim())
    ? parsed.deviceId.trim().toLowerCase()
    : fallbackId;

  const rules = parsed.rules && typeof parsed.rules === 'object' ? parsed.rules : {};
  const loc = parsed.location && typeof parsed.location === 'object' ? parsed.location : {};

  return {
    schemaVersion: parsed.schemaVersion || 2,
    deviceId,
    sourceKey,
    enabled: parsed.enabled !== false,
    subscription: parsed.subscription && parsed.subscription.endpoint ? parsed.subscription : null,
    rules: {
      windAlert: Boolean(rules.windAlert ?? true),
      windThreshold: Number(rules.windThreshold) || 60,
      frostAlert: Boolean(rules.frostAlert ?? true),
      frostThreshold: rules.frostThreshold !== undefined ? Number(rules.frostThreshold) : 0,
      briefingAlert: Boolean(rules.briefingAlert ?? true),
      briefingTime: rules.briefingTime || '07:00',
      severeAlert: Boolean(rules.severeAlert ?? true),
      quietHoursStart: rules.quietHoursStart !== undefined ? Number(rules.quietHoursStart) : 22,
      quietHoursEnd: rules.quietHoursEnd !== undefined ? Number(rules.quietHoursEnd) : 6,
      bypassQuietHoursOnSevere: rules.bypassQuietHoursOnSevere !== false
    },
    location: {
      name: loc.name || 'München',
      lat: Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : 48.137,
      lon: Number.isFinite(Number(loc.lon)) ? Number(loc.lon) : 11.575,
      elevation: Number.isFinite(Number(loc.elevation)) ? Number(loc.elevation) : 520,
      timezone: loc.timezone || 'Europe/Berlin'
    },
    vapidPublicKey: parsed.vapidPublicKey || DEFAULT_VAPID_PUBLIC_KEY,
    updatedAt: parsed.updatedAt || null
  };
}

/**
 * Lädt alle individuellen Geräte-Konfigurationen aus allen WEATHER_PUSH_DEV_* CI-Variablen.
 * Rückwärtskompatibel mit Legacy $WEATHER_PUSH_CONFIG und lokaler Testdatei config/push-config.json.
 */
export function loadDeviceConfigs(env = process.env, options = {}) {
  const devicesById = new Map();
  const seenEndpoints = new Set();

  // 1. Primär (Option 1): Alle individuellen WEATHER_PUSH_DEV_<UUID_HEX> Projektvariablen
  const devKeys = Object.keys(env)
    .filter(k => k.startsWith(DEVICE_VAR_PREFIX) && env[k])
    .sort();

  for (const key of devKeys) {
    try {
      const parsed = JSON.parse(env[key]);
      const suffixId = key.slice(DEVICE_VAR_PREFIX.length).toLowerCase() || 'unknown';
      const normalized = normalizeDeviceConfig(parsed, suffixId, key);
      if (!normalized) continue;

      const existing = devicesById.get(normalized.deviceId);
      if (!existing || (normalized.updatedAt && (!existing.updatedAt || normalized.updatedAt > existing.updatedAt))) {
        devicesById.set(normalized.deviceId, normalized);
      }
      if (normalized.subscription?.endpoint) {
        seenEndpoints.add(normalized.subscription.endpoint);
      }
    } catch (err) {
      console.warn(`⚠️ Ungültiges JSON in Variable $${key} übersprungen:`, err.message);
    }
  }

  // 2. Rückwärtskompatibilität: Legacy $WEATHER_PUSH_CONFIG (nur falls noch nicht über UUID-Variable vorhanden)
  if (env.WEATHER_PUSH_CONFIG) {
    try {
      const parsed = JSON.parse(env.WEATHER_PUSH_CONFIG);
      const normalized = normalizeDeviceConfig(parsed, 'legacy', 'WEATHER_PUSH_CONFIG');
      if (normalized) {
        const ep = normalized.subscription?.endpoint;
        if (!devicesById.has(normalized.deviceId) && (!ep || !seenEndpoints.has(ep))) {
          devicesById.set(normalized.deviceId, normalized);
          if (ep) seenEndpoints.add(ep);
        }
      }
    } catch (err) {
      console.warn('⚠️ Ungültiges JSON in Legacy $WEATHER_PUSH_CONFIG:', err.message);
    }
  }

  // 3. Lokaler Fallback für Trockentests (wenn keine CI-Variablen gesetzt sind)
  if (devicesById.size === 0 && !options.disableLocalFallback) {
    const localConfigPath = options.localConfigPath || path.resolve('config/push-config.json');
    if (fs.existsSync(localConfigPath)) {
      try {
        const content = fs.readFileSync(localConfigPath, 'utf8');
        const parsed = JSON.parse(content);
        const normalized = normalizeDeviceConfig(parsed, 'local-fallback', localConfigPath);
        if (normalized) {
          devicesById.set(normalized.deviceId, normalized);
        }
      } catch (err) {
        console.warn(`⚠️ Fehler beim Lesen von ${localConfigPath}:`, err.message);
      }
    }
  }

  return Array.from(devicesById.values());
}

/**
 * Prüft ob eine gegebene Stunde in das Ruhezeitfenster [quietStart, quietEnd) fällt
 */
function isHourInQuietWindow(hour, quietStart = 22, quietEnd = 6) {
  if (quietStart === quietEnd) return false;
  if (quietStart > quietEnd) {
    // Über Nacht (z. B. 22:00 bis 06:00)
    return hour >= quietStart || hour < quietEnd;
  }
  return hour >= quietStart && hour < quietEnd;
}

/**
 * Ermittelt die exakte lokale Uhrzeit und Ruhezeit-Informationen für die Zeitzone des Geräts
 */
export function getLocalTimeInfo(timeZoneName, quietStart = 22, quietEnd = 6, now = new Date()) {
  const tz = timeZoneName || 'Europe/Berlin';

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const getPart = (type) => parts.find(p => p.type === type)?.value;

    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');
    let hour = parseInt(getPart('hour'), 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(getPart('minute'), 10);
    const dateString = `${year}-${month}-${day}`;
    const formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    const isQuietHours = isHourInQuietWindow(hour, quietStart, quietEnd);

    return {
      tz,
      hour,
      minute,
      dateString,
      formattedTime,
      isQuietHours
    };
  } catch (err) {
    console.warn(`Fehler bei Zeitzonenberechnung (${tz}):`, err.message);
    const fallbackHour = (now.getUTCHours() + 1) % 24;
    return {
      tz: 'UTC+1',
      hour: fallbackHour,
      minute: now.getMinutes(),
      dateString: now.toISOString().slice(0, 10),
      formattedTime: `${String(fallbackHour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      isQuietHours: isHourInQuietWindow(fallbackHour, quietStart, quietEnd)
    };
  }
}

/**
 * Resilienter HTTP-Client mit Exponential Backoff & Timeout
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let attempt = 0;
  let delay = 1000;

  while (attempt < maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'BestWeather-GitLabDispatcher/2.31.0',
          ...(options.headers || {})
        }
      });
      clearTimeout(timeout);

      if (res.ok) {
        return await res.json();
      }

      if (res.status >= 500 || res.status === 429) {
        console.warn(`[HTTP Retry ${attempt}/${maxRetries}] Server antwortete mit Status ${res.status}. Warte ${delay}ms...`);
      } else {
        throw new Error(`Open-Meteo API Fehler: HTTP ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      clearTimeout(timeout);
      if (attempt >= maxRetries) {
        throw new Error(`Netzwerkfehler nach ${maxRetries} Versuchen: ${err.message}`);
      }
      console.warn(`[HTTP Retry ${attempt}/${maxRetries}] ${err.message}. Warte ${delay}ms...`);
    }

    await new Promise(r => setTimeout(r, delay));
    delay = delay * 2 + Math.floor(Math.random() * 300);
  }
}

/**
 * Fragt Open-Meteo Wetterdaten für Koordinaten ab
 */
async function fetchWeatherData(lat, lon, preferredTz) {
  const tzParam = encodeURIComponent(preferredTz || 'auto');
  const hourlyParams = 'temperature_2m,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_gusts_10m,cloud_cover,freezing_level_height,sunshine_duration,uv_index';
  const dailyParams = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset,sunshine_duration,uv_index_max,snowfall_sum';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_gusts_10m&hourly=${hourlyParams}&daily=${dailyParams}&timezone=${tzParam}&forecast_days=2`;

  return await fetchWithRetry(url);
}

/**
 * Bewertet Wetterkriterien individuell für EIN Gerät mit seinem isolierten State & Cooldowns
 */
export function evaluateAlertRules(deviceConfig, weather, deviceState, timeInfo, nowMs = Date.now()) {
  const alerts = [];
  const rules = deviceConfig.rules || {};
  const locName = deviceConfig.location?.name || 'Dein Standort';

  const current = weather.current || {};
  const hourly = weather.hourly || {};
  const daily = weather.daily || {};
  const currentHour = timeInfo.hour;

  // 1. REGEL: Täglicher Bericht (Morgen-Briefing)
  // Apple APNs Store-and-Forward Puffer & Aktives Morgen-Zustellungsfenster:
  // Nutzer schalten nachts oft den Flugmodus ein und wachen zu unregelmäßigen Zeiten auf (05:00 - 09:30).
  // APNs verwirft Web-Push-Nachrichten in der Offline-Queue häufig nach 30-60 Minuten Inaktivität.
  // Lösung: Während des gesamten Morgenfensters (ab 05:00 Uhr bzw. Wunschzeit bis 10:00 Uhr)
  // wird der Tagesbericht bei jedem Runner-Lauf (im Mindestabstand von 45 Min.) mit identischem
  // Collapse-Key ('bw-briefing') und Tag ('briefing-YYYY-MM-DD') aktualisiert.
  // - Ist das iPhone noch im Flugmodus: APNs aktualisiert die Queue mit der frischen Nachricht (nie abgelaufen!).
  // - Sobald das iPhone online geht: Die Nachricht wird sofort zugestellt & bleibt im Notification Center.
  // - Ist das iPhone schon online: Die Notification wird dank collapse-id lautlos in-place aktualisiert (kein Doppel-Spam).
  if (rules.briefingAlert) {
    const [rawH, rawM] = String(rules.briefingTime || '06:00').split(':');
    const targetHour = Number.isFinite(parseInt(rawH, 10)) ? parseInt(rawH, 10) : 6;
    const targetMin = Number.isFinite(parseInt(rawM, 10)) ? parseInt(rawM, 10) : 0;
    const targetTotalMin = targetHour * 60 + targetMin;
    const currentTotalMin = currentHour * 60 + (timeInfo.minute || 0);

    const isAppleSub = Boolean(deviceConfig.subscription?.endpoint?.includes('push.apple.com'));
    const earliestDepositMin = isAppleSub ? Math.min(targetTotalMin, 5 * 60) : targetTotalMin;
    const latestDepositMin = Math.max(targetTotalMin + 180, 10 * 60); // Morgenfenster bis mind. 10:00 Uhr

    const inMorningWindow = currentTotalMin >= earliestDepositMin && currentTotalMin < latestDepositMin;
    const lastBriefingAt = deviceState.lastBriefingAt || 0;
    const minIntervalMs = 45 * 60 * 1000; // Mindestens 45 Minuten Pause zwischen Queue-Refreshes
    const intervalPassed = (nowMs - lastBriefingAt) >= minIntervalMs;
    const alreadySentToday = deviceState.lastBriefingDate === timeInfo.dateString;

    if (inMorningWindow && intervalPassed) {
      const dailyReportAlert = buildDailyReport(deviceConfig, weather, timeInfo);
      alerts.push(dailyReportAlert);
      deviceState.lastBriefingDate = timeInfo.dateString;
      deviceState.lastBriefingAt = nowMs;
      deviceState.lastBriefingCount = (deviceState.lastBriefingCount || 0) + 1;
    } else if (!inMorningWindow && !alreadySentToday && currentTotalMin < 11 * 60 && intervalPassed) {
      // Fallback für verspätete Cron-Läufe bis 11:00 Uhr falls morgens kein Lauf stattfand
      const dailyReportAlert = buildDailyReport(deviceConfig, weather, timeInfo);
      alerts.push(dailyReportAlert);
      deviceState.lastBriefingDate = timeInfo.dateString;
      deviceState.lastBriefingAt = nowMs;
      deviceState.lastBriefingCount = (deviceState.lastBriefingCount || 0) + 1;
    }
  }

  // 2. REGEL: Akute Unwetter- / Extremwetterwarnung (WMO 95, 96, 99)
  let hasSevereAlert = false;
  if (rules.severeAlert) {
    const curCode = current.weather_code;
    const nextCodes = (hourly.weather_code || []).slice(currentHour, currentHour + 3);
    const isSevere = [95, 96, 99].includes(curCode) || nextCodes.some(c => [95, 96, 99].includes(c));

    const severeCooldown = 60 * 60 * 1000; // 60 Min.
    const isCooldownActive = (nowMs - (deviceState.lastSevereAlertAt || 0)) < severeCooldown;

    if (isSevere && !isCooldownActive) {
      alerts.push({
        type: 'severe',
        isEmergency: true,
        title: `⚡ Akute Unwetterwarnung für ${locName}`,
        body: `Gewitter mit potentiellem Hagel oder Starkregen im Anzug! Bitte Schutz suchen.`,
        tag: `severe-${timeInfo.dateString}-${currentHour}`,
        requireInteraction: true,
        data: { url: './', tab: 'tab-map', type: 'severe' }
      });
      deviceState.lastSevereAlertAt = nowMs;
      hasSevereAlert = true;
    }
  }

  // 3. REGEL: Sturm- & Böenwarnung (individueller Schwellenwert je Gerät, nachts stumm)
  if (rules.windAlert && !hasSevereAlert && !timeInfo.isQuietHours) {
    const threshold = rules.windThreshold || 60;
    const nextGusts = (hourly.wind_gusts_10m || []).slice(currentHour, currentHour + 4);
    const maxGust = Math.round(Math.max(current.wind_gusts_10m || 0, ...nextGusts));

    const windCooldown = 3 * 60 * 60 * 1000; // 3 Stunden
    const isWindCooldownActive = (nowMs - (deviceState.lastWindAlertAt || 0)) < windCooldown;
    const isSignificantIncrease = maxGust >= ((deviceState.lastWindMax || 0) + 15);

    if (maxGust >= threshold && (!isWindCooldownActive || isSignificantIncrease)) {
      alerts.push({
        type: 'wind',
        title: `💨 Sturm- & Böenwarnung (${maxGust} km/h)`,
        body: `In ${locName} werden stürmische Böen von bis zu ${maxGust} km/h erwartet (Schwelle: >${threshold} km/h).`,
        tag: `wind-${timeInfo.dateString}-${Math.floor(currentHour / 3)}`,
        data: { url: './', tab: 'tab-map', type: 'wind' }
      });
      deviceState.lastWindAlertAt = nowMs;
      deviceState.lastWindMax = maxGust;
    }
  }

  // 4. REGEL: Frost- & Glättewarnung (nachts stumm)
  if (rules.frostAlert && !hasSevereAlert && !timeInfo.isQuietHours) {
    const nextTemps = (hourly.temperature_2m || []).slice(currentHour, currentHour + 6);
    const minUpcomingTemp = Math.min(current.temperature_2m ?? 99, ...nextTemps);

    const frostCooldown = 6 * 60 * 60 * 1000; // 6 Stunden
    const isFrostCooldownActive = (nowMs - (deviceState.lastFrostAlertAt || 0)) < frostCooldown;

    if (minUpcomingTemp <= (rules.frostThreshold || 0) && (current.temperature_2m ?? 99) > 1 && !isFrostCooldownActive) {
      alerts.push({
        type: 'frost',
        title: `❄️ Frost- & Glättewarnung`,
        body: `Temperaturen fallen in Kürze auf ${minUpcomingTemp.toFixed(1)}°C. Glättegefahr auf Straßen und Gehwegen!`,
        tag: `frost-${timeInfo.dateString}-${Math.floor(currentHour / 6)}`,
        data: { url: './', tab: 'tab-overview', type: 'frost' }
      });
      deviceState.lastFrostAlertAt = nowMs;
    }
  }

  return alerts;
}

/**
 * Sendet Push-Benachrichtigung via VAPID Web Push an die individuelle Geräte-Subscription
 */
async function dispatchPushNotification(subscription, payload, vapidKeys) {
  let webpush;
  try {
    webpush = (await import('web-push')).default;
  } catch {
    // web-push nicht installiert (z.B. im Offline-Dry-Run)
  }

  if (!webpush) {
    console.log(`[DRY-RUN / MOCK PUSH] Sende an Endpoint: ${subscription.endpoint?.slice(0, 45)}...`);
    return { ok: true, mocked: true };
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT,
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  const isApple = Boolean(subscription.endpoint && subscription.endpoint.includes('push.apple.com'));
  const nowSec = Math.floor(Date.now() / 1000);
  const expirationSec = nowSec + 86400; // 24 Stunden Haltezeit im APNs Store-and-Forward Puffer

  const isBriefing = payload.type === 'briefing' || payload.tag?.includes('briefing');
  const collapseKey = isBriefing ? 'bw-briefing' : (payload.tag ? String(payload.tag).slice(0, 32) : 'bw-alert');

  // Apple APNs Spezifikation für Web Push:
  // - apns-push-type: 'alert' (Zwingend für Benachrichtigungen mit Anzeige im Sperrbildschirm / Notification Center)
  // - apns-priority: '10' (Sofortige Zustellung, weckt das iPhone auf sobald Internet da ist)
  // - apns-collapse-id: 'bw-briefing' (Aktualisiert offline im APNs Puffer & online lautlos im Notification Center)
  // - apns-expiration: Epoch-Zeitstempel (Hält die Nachricht in der Warteschlange, wenn iPhone im Flugmodus ist)
  // - TTL: 86400 (RFC 8030 Web Push Time-To-Live in Sekunden)
  // - Topic: 'bw-briefing' (RFC 8030 standard collapse topic)
  // - urgency: 'high'
  const pushOptions = {
    TTL: 86400,
    urgency: 'high',
    topic: collapseKey,
    headers: {
      Topic: collapseKey,
      ...(isApple ? {
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-collapse-id': collapseKey,
        'apns-expiration': String(expirationSec)
      } : {})
    }
  };

  const res = await webpush.sendNotification(subscription, JSON.stringify(payload), pushOptions);
  return { ok: true, statusCode: res.statusCode };
}

/**
 * Verarbeitet alle registrierten anonymen UUID-Geräte komplett isoliert voneinander
 * mit Koordinaten-Deduplizierung für Open-Meteo.
 */
export async function processAllDevices(devices, globalState, deps = {}) {
  const weatherFetcher = deps.fetchWeatherData || fetchWeatherData;
  const pushSender = deps.dispatchPushNotification || dispatchPushNotification;
  const now = deps.now instanceof Date ? deps.now : new Date();
  const nowMs = now.getTime();

  const weatherCache = new Map();
  const summary = {
    totalDevices: devices.length,
    evaluatedDevices: 0,
    alertsTriggered: 0,
    pushesSent: 0,
    pushesFailed: 0,
    skippedDisabled: 0,
    skippedQuietHours: 0,
    skippedExpired: 0,
    weatherFetches: 0
  };

  for (const device of devices) {
    const idTag = shortDeviceId(device.deviceId);
    const devState = getOrInitDeviceState(globalState, device.deviceId, device.updatedAt, nowMs);

    if (!device.enabled) {
      summary.skippedDisabled++;
      console.log(`⏸️ [UUID ${idTag}…] Deaktiviert — übersprungen.`);
      continue;
    }

    if (devState.expired) {
      summary.skippedExpired++;
      console.log(`⚠️ [UUID ${idTag}…] Subscription abgelaufen (410 Gone) — wartet auf Re-Sync.`);
      continue;
    }

    const lat = device.location.lat;
    const lon = device.location.lon;
    const locName = device.location.name;
    const preferredTz = device.location.timezone || 'Europe/Berlin';
    const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)},${preferredTz}`;

    let weatherData;
    try {
      if (weatherCache.has(cacheKey)) {
        weatherData = weatherCache.get(cacheKey);
      } else {
        console.log(`📍 [Open-Meteo] Lade Wetter für ${locName} (${lat.toFixed(2)}, ${lon.toFixed(2)}, ${preferredTz})`);
        weatherData = await weatherFetcher(lat, lon, preferredTz);
        weatherCache.set(cacheKey, weatherData);
        summary.weatherFetches++;
      }
    } catch (err) {
      console.error(`❌ [UUID ${idTag}…] Wetterabruf für ${locName} fehlgeschlagen:`, err.message);
      summary.pushesFailed++;
      continue;
    }

    const stationTz = weatherData.timezone || preferredTz;
    const quietStart = device.rules?.quietHoursStart ?? 22;
    const quietEnd = device.rules?.quietHoursEnd ?? 6;
    const timeInfo = getLocalTimeInfo(stationTz, quietStart, quietEnd, now);

    if (timeInfo.isQuietHours) {
      const curCode = weatherData.current?.weather_code;
      const isExtremeEmergency = curCode === 99 || (weatherData.current?.wind_gusts_10m || 0) >= 105;
      const allowEmergencyBypass = Boolean(device.rules?.bypassQuietHoursOnSevere);

      // Erlaube Vorbereitung/Refresh des Täglichen Berichts ab 05:00 Uhr morgens für den APNs Store-and-Forward Puffer
      const [rawH, rawM] = String(device.rules?.briefingTime || '06:00').split(':');
      const targetTotalMin = (parseInt(rawH, 10) || 6) * 60 + (parseInt(rawM, 10) || 0);
      const currentTotalMin = timeInfo.hour * 60 + (timeInfo.minute || 0);
      const earliestDepositMin = Math.min(targetTotalMin, 5 * 60);
      const isMorningWindow = currentTotalMin >= earliestDepositMin && currentTotalMin < 10 * 60;
      const minIntervalPassed = (nowMs - (devState.lastBriefingAt || 0)) >= 45 * 60 * 1000;
      const isMorningBriefingDeposit = Boolean(device.rules?.briefingAlert && isMorningWindow && minIntervalPassed);

      if (!(isExtremeEmergency && allowEmergencyBypass) && !isMorningBriefingDeposit) {
        summary.skippedQuietHours++;
        console.log(`🌙 [UUID ${idTag}…] Ruhezeit aktiv (${timeInfo.formattedTime} Uhr ${timeInfo.tz}) — übersprungen.`);
        continue;
      }
      if (isExtremeEmergency && allowEmergencyBypass) {
        console.log(`🚨 [UUID ${idTag}…] EXTREM-UNWETTER! Ruhezeit für Gefahrenalarm umgangen.`);
      } else if (isMorningBriefingDeposit) {
        console.log(`🌅 [UUID ${idTag}…] Vorbereitung/Refresh Tagesbericht im APNs Store-and-Forward Puffer (${timeInfo.formattedTime} Uhr, Refresh #${(devState.lastBriefingCount || 0) + 1}).`);
      }
    }

    summary.evaluatedDevices++;
    const triggeredAlerts = evaluateAlertRules(device, weatherData, devState, timeInfo, nowMs);

    if (triggeredAlerts.length === 0) {
      console.log(`✓ [UUID ${idTag}…] ${locName} (${timeInfo.formattedTime}): Kein Alarm ausgelöst.`);
      continue;
    }

    summary.alertsTriggered += triggeredAlerts.length;

    if (!device.subscription || !device.subscription.endpoint) {
      console.log(`ℹ️ [UUID ${idTag}…] ${triggeredAlerts.length} Alarm(e) ausgelöst, aber keine aktive Push-Subscription hinterlegt.`);
      continue;
    }

    const vapidKeys = {
      publicKey: device.vapidPublicKey || DEFAULT_VAPID_PUBLIC_KEY,
      privateKey: DEFAULT_VAPID_PRIVATE_KEY
    };

    for (const alert of triggeredAlerts) {
      try {
        const res = await pushSender(device.subscription, alert, vapidKeys);
        summary.pushesSent++;
        console.log(`✓ [UUID ${idTag}…] Push [${alert.type.toUpperCase()}] versendet (Status: ${res?.statusCode || 'OK'}).`);
      } catch (err) {
        summary.pushesFailed++;
        console.error(`❌ [UUID ${idTag}…] Fehler beim Push-Versand:`, err.message);
        if (err.statusCode === 410 || err.statusCode === 404) {
          devState.expired = true;
          devState.expiredAt = now.toISOString();
          console.warn(`⚠️ [UUID ${idTag}…] Subscription abgelaufen (${err.statusCode}) — für künftige Läufe pausiert.`);
          break; // Keine weiteren Alerts an diese abgelaufene Subscription senden
        }
      }
    }
  }

  pruneStaleDeviceStates(globalState, devices.map(d => d.deviceId), nowMs);
  return summary;
}

/**
 * Sendet einen sofortigen E2E-Test-Push direkt aus GitLab CI an eine einzelne anonyme Geräte-UUID
 * (ausgelöst über Pipeline-Variable PUSH_TEST_DEVICE_ID). Überspringt Ruhezeit & Cooldowns.
 */
export async function dispatchTestPushForDevice(devices, targetDeviceId, deps = {}) {
  const pushSender = deps.dispatchPushNotification || dispatchPushNotification;
  const normalizedTarget = String(targetDeviceId || '').trim().toLowerCase();
  const device = devices.find(d => d.deviceId === normalizedTarget);

  if (!device) {
    console.error(`❌ Test-Push: Keine Geräte-Variable für UUID ${shortDeviceId(normalizedTarget)}… gefunden.`);
    return { ok: false, reason: 'device-not-found' };
  }
  if (!device.subscription || !device.subscription.endpoint) {
    console.error(`❌ Test-Push: Gerät ${shortDeviceId(normalizedTarget)}… hat keine aktive Web-Push-Subscription.`);
    return { ok: false, reason: 'no-subscription' };
  }

  const vapidKeys = {
    publicKey: device.vapidPublicKey || DEFAULT_VAPID_PUBLIC_KEY,
    privateKey: DEFAULT_VAPID_PRIVATE_KEY
  };

  const locName = device.location?.name || 'deinen Standort';
  const payload = {
    type: 'test',
    title: '🔔 Best Weather — GitLab Cloud-Push aktiv!',
    body: `Echter Server-Push direkt aus GitLab CI über Apple APNs für ${locName} (ID ${shortDeviceId(device.deviceId)}…) zugestellt.`,
    tag: `best-weather-e2e-${Date.now()}`,
    data: { url: './', tab: 'tab-overview', type: 'test' }
  };

  const res = await pushSender(device.subscription, payload, vapidKeys);
  console.log(`✅ [E2E TEST] GitLab -> APNs Push an UUID ${shortDeviceId(device.deviceId)}… erfolgreich zugestellt (Status: ${res?.statusCode || 'OK'})!`);
  return { ok: true, deviceId: device.deviceId, statusCode: res?.statusCode || 201 };
}

/**
 * Main CLI Entrypoint
 */
async function main() {
  const startTime = Date.now();
  console.log('=============================================================================');
  console.log('⚡ BEST WEATHER — All-in-GitLab Multi-Device Push Dispatcher (v2.33.0)');
  console.log(`⏰ System-Start (UTC): ${new Date().toISOString()}`);
  console.log('=============================================================================');

  const devices = loadDeviceConfigs(process.env);
  const state = loadState();

  // E2E Test-Push Modus (sofortiger Server -> Apple APNs Test für 1 Gerät)
  if (process.env.PUSH_TEST_DEVICE_ID) {
    console.log(`🧪 E2E Test-Push-Modus aktiv für UUID ${shortDeviceId(process.env.PUSH_TEST_DEVICE_ID)}…`);
    const testRes = await dispatchTestPushForDevice(devices, process.env.PUSH_TEST_DEVICE_ID);
    if (!testRes.ok) {
      process.exit(1);
    }
    console.log(`🏁 E2E Test-Push abgeschlossen in ${Date.now() - startTime}ms.`);
    return;
  }

  if (devices.length === 0) {
    console.log('ℹ️ Keine registrierten Geräte-Variablen ($WEATHER_PUSH_DEV_*) gefunden.');
    console.log('   Öffne die App auf einem Gerät -> 🔔 Einstellungen -> Mit GitLab verbinden & Push aktivieren.');
    saveState(state);
    return;
  }

  console.log(`🔑 ${devices.length} anonyme Geräte-UUID(s) geladen (0 Geräteinformationen gespeichert).`);

  const summary = await processAllDevices(devices, state);
  saveState(state);
  await persistStateToGitLab(state, process.env);

  console.log('-----------------------------------------------------------------------------');
  console.log(`📊 Zusammenfassung: ${summary.totalDevices} Gerät(e) | ${summary.weatherFetches} Open-Meteo Abruf(e) | ${summary.alertsTriggered} Alarm(e) | ${summary.pushesSent} Push(es) gesendet | ${summary.skippedQuietHours} Ruhezeit | ${summary.pushesFailed} Fehler`);
  console.log(`🏁 Dispatcher abgeschlossen in ${Date.now() - startTime}ms.`);
}

// Nur automatisch ausführen, wenn direkt per CLI gestartet (ermöglicht saubere Unit-Tests via import)
const isDirectCli = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectCli) {
  main().catch((err) => {
    console.error('Unerwarteter Fehler im Dispatcher:', err);
    process.exit(1);
  });
}
