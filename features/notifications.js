/**
 * BEST WEATHER — Push Notifications & GitLab REST API Dispatcher Module
 * Enterprise Web Push Engine for iOS 16.4+ (APNs) and macOS Notification Center.
 */

import { AlpineStorage } from '../storage.js';
import { state } from '../core/state.js';

export const DEFAULT_VAPID_PUBLIC_KEY = 'BFXeGAET8G6YxsiL0HvXELcaDIoZyeIgPYokZuqpueq3NFJs8xG7KsyvViif44MAxMkBI_OQ93OXewHGRhMSOmI';

const STORAGE_KEYS = {
  CONFIG: 'bw_push_config',
  GITLAB: 'bw_gitlab_config',
  SUBSCRIPTION: 'bw_push_subscription',
  DEVICE_UUID: 'bw_push_device_uuid'
};

export const DEVICE_VAR_PREFIX = 'WEATHER_PUSH_DEV_';
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Erzeugt eine rein zufällige kryptographische UUID v4 (RFC 4122).
 * Verwendet KEINERLEI Geräteinformationen (kein User-Agent, kein Modell, kein OS, kein Fingerprinting).
 */
export function generateAnonymousUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().toLowerCase();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 Variant
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Lädt oder erzeugt einmalig die stabile, rein anonyme Geräte-UUID für dieses Gerät.
 */
export function getOrCreateDeviceUuid() {
  const existing = AlpineStorage.safeGetItem(STORAGE_KEYS.DEVICE_UUID, null);
  if (typeof existing === 'string' && UUID_V4_REGEX.test(existing.trim())) {
    return existing.trim().toLowerCase();
  }
  const freshUuid = generateAnonymousUuid();
  AlpineStorage.safeSetItem(STORAGE_KEYS.DEVICE_UUID, freshUuid);
  return freshUuid;
}

/**
 * Leitet den konfliktfreien GitLab CI-Variablennamen ausschließlich aus der anonymen UUID ab.
 * Format: WEATHER_PUSH_DEV_<32 HEX CHARS> (strictly ^[A-Z0-9_]+$, 0 Gerätedaten).
 */
export function getDeviceVariableKey(deviceUuid = getOrCreateDeviceUuid()) {
  const cleanHex = String(deviceUuid || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (cleanHex.length !== 32) {
    const fallbackHex = getOrCreateDeviceUuid().replace(/-/g, '').toUpperCase();
    return `${DEVICE_VAR_PREFIX}${fallbackHex}`;
  }
  return `${DEVICE_VAR_PREFIX}${cleanHex}`;
}

export const SCHEDULE_PRESETS = {
  eco: {
    key: 'eco',
    name: 'Eco (06:00–22:00 Uhr, 100% Free-Tier Safe)',
    cron: '0 6,7,8,10,12,14,16,17,18,19,20,21 * * *',
    runsPerDay: 12,
    monthlyMinutes: 360,
    description: '12 Läufe/Tag verteilt auf 06:00 bis 21:00 Uhr. 22:00–06:00 Uhr Pause. Garantiert <= 400 Min./Monat.'
  },
  hourly: {
    key: 'hourly',
    name: 'Stündlich (06:00–22:00 Uhr)',
    cron: '0 6-21 * * *',
    runsPerDay: 16,
    monthlyMinutes: 480,
    description: '16 Läufe/Tag stündlich von 06:00 bis 21:00 Uhr. 22:00–06:00 Uhr Pause.'
  },
  highfreq: {
    key: 'highfreq',
    name: 'Alle 20 Min tagsüber (06:00–22:00 Uhr)',
    cron: '*/20 6-21 * * *',
    runsPerDay: 48,
    monthlyMinutes: 1440,
    description: '48 Läufe/Tag von 06:00 bis 21:40 Uhr. Ideal für eigenen Runner.'
  }
};

const DEFAULT_CONFIG = {
  enabled: false,
  windAlert: true,
  windThreshold: 60, // km/h
  frostAlert: true,
  frostThreshold: 0, // °C
  briefingAlert: true,
  briefingTime: '07:00',
  severeAlert: true,
  quietHoursStart: 22,
  quietHoursEnd: 6,
  bypassQuietHoursOnSevere: true,
  locationMode: 'gps', // 'gps' | 'fixed'
  lastSyncAt: 0
};

const DEFAULT_GITLAB = {
  host: 'https://gitlab.com',
  projectId: '',
  token: '',
  schedulePreset: 'eco', // 'eco' | 'hourly' | 'highfreq'
  lastSyncStatus: 'Bereit zur Synchronisation',
  lastSyncAt: 0
};

let currentConfig = { ...DEFAULT_CONFIG };
let currentGitLab = { ...DEFAULT_GITLAB };
let currentSubscription = null;
let savedFormSnapshot = null;

/**
 * Standard Web Push Helper: Konvertiert URL-safe Base64 String in Uint8Array
 */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Prüft Umgebungs-Support für Push Notifications
 */
export function checkPushSupport() {
  const hasSW = 'serviceWorker' in navigator;
  const hasPush = 'PushManager' in window;
  const hasNotification = 'Notification' in window;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = Boolean(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches);

  return {
    supported: hasSW && hasPush && hasNotification,
    hasSW,
    hasPush,
    hasNotification,
    isIOS,
    isStandalone,
    permission: hasNotification ? Notification.permission : 'unsupported'
  };
}

/**
 * Lädt persistierte Einstellungen
 */
export function loadNotificationState() {
  const savedConfig = AlpineStorage.safeGetItem(STORAGE_KEYS.CONFIG, null);
  if (savedConfig) {
    currentConfig = { ...DEFAULT_CONFIG, ...savedConfig };
  }

  const savedGitLab = AlpineStorage.safeGetItem(STORAGE_KEYS.GITLAB, null);
  if (savedGitLab) {
    currentGitLab = { ...DEFAULT_GITLAB, ...savedGitLab };
  }

  const savedSub = AlpineStorage.safeGetItem(STORAGE_KEYS.SUBSCRIPTION, null);
  if (savedSub) {
    currentSubscription = savedSub;
  }

  return { config: currentConfig, gitlab: currentGitLab, subscription: currentSubscription };
}

/**
 * Speichert Einstellungen lokal
 */
export function saveNotificationState() {
  AlpineStorage.safeSetItem(STORAGE_KEYS.CONFIG, currentConfig);
  AlpineStorage.safeSetItem(STORAGE_KEYS.GITLAB, currentGitLab);
  if (currentSubscription) {
    AlpineStorage.safeSetItem(STORAGE_KEYS.SUBSCRIPTION, currentSubscription);
  }
}

/**
 * Fordert System-Berechtigung an & registriert Push Subscription
 */
export async function enablePushNotifications() {
  const support = checkPushSupport();
  if (!support.supported) {
    if (support.isIOS && !support.isStandalone) {
      throw new Error('Auf iOS muss die App zuerst zum Home-Bildschirm hinzugefügt werden ("Zum Home-Bildschirm"), um Push-Nachrichten zu erlauben.');
    }
    throw new Error('Push-Benachrichtigungen werden von diesem Browser nicht vollständig unterstützt.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    currentConfig.enabled = false;
    saveNotificationState();
    updateUIElements();
    throw new Error('Berechtigung für Benachrichtigungen wurde abgelehnt.');
  }

  const reg = await navigator.serviceWorker.ready;
  if (!reg) {
    throw new Error('Service Worker nicht bereit.');
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const keyArray = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyArray
    });
  }

  currentSubscription = sub.toJSON();
  currentConfig.enabled = true;
  saveNotificationState();
  updateUIElements();

  // Stille automatische Hintergrund-Synchronisation mit GitLab CI falls eingerichtet
  if (currentGitLab.projectId && currentGitLab.token) {
    syncToGitLab().catch(err => console.debug('Hintergrund-Sync Info:', err.message));
  }

  return currentSubscription;
}

/**
 * Entfernt ausschließlich die eigene anonyme Geräte-Variable aus GitLab CI,
 * ohne andere verknüpfte Geräte zu beeinflussen.
 */
export async function deleteDeviceFromGitLab() {
  const host = (currentGitLab.host || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const projectId = (currentGitLab.projectId || '').trim();
  const token = (currentGitLab.token || '').trim();
  if (!projectId || !token) return { skipped: true };

  const deviceUuid = getOrCreateDeviceUuid();
  const varKey = getDeviceVariableKey(deviceUuid);
  const encodedId = encodeURIComponent(projectId);
  const variableUrl = `${host}/api/v4/projects/${encodedId}/variables/${encodeURIComponent(varKey)}`;

  const response = await fetch(variableUrl, {
    method: 'DELETE',
    headers: { 'PRIVATE-TOKEN': token }
  });

  if (response.status === 404) {
    return { ok: true, alreadyRemoved: true, variableKey: varKey };
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`GitLab DELETE Fehler (${response.status}): ${errorText || response.statusText}`);
  }
  return { ok: true, variableKey: varKey };
}

/**
 * Deaktiviert Push Notifications ausschließlich für dieses Gerät (anonyme UUID)
 */
export async function disablePushNotifications() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sub.unsubscribe();
    }
  } catch (err) {
    console.warn('Fehler beim Unsubscribe:', err);
  }

  currentConfig.enabled = false;
  currentSubscription = null;
  AlpineStorage.safeRemoveItem(STORAGE_KEYS.SUBSCRIPTION);
  saveNotificationState();
  updateUIElements();

  // Entferne nur die eigene Geräte-Variable auf GitLab (andere Geräte bleiben 100% unberührt)
  if (currentGitLab.projectId && currentGitLab.token) {
    deleteDeviceFromGitLab().catch(err => console.debug('Hintergrund-Cleanup Info:', err.message));
  }
}

/**
 * Sendet sofortigen lokalen Test-Push auf Mac / iOS
 */
export async function sendLocalTestPush() {
  const support = checkPushSupport();
  if (!support.hasNotification) {
    throw new Error('Notification API nicht verfügbar');
  }

  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') throw new Error('Berechtigung nicht erteilt');
  }

  const reg = await navigator.serviceWorker.ready;
  const locName = state.currentLocation?.name || 'München';
  const currentTemp = state.weatherData?.current?.temperature_2m !== undefined 
    ? `${Math.round(state.weatherData.current.temperature_2m)}°C` 
    : '12°C';

  await reg.showNotification(`🔔 Best Weather — Push-Test erfolgreich!`, {
    body: `Standort: ${locName} (${currentTemp}). Benachrichtigungen für Mac Sperrbildschirm & iOS Mitteilungszentrale sind aktiv.`,
    icon: './icon-192.png',
    badge: './favicon.png',
    tag: 'best-weather-test-alert',
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url: './',
      tab: 'tab-overview',
      timestamp: Date.now()
    }
  });

  return true;
}

/**
 * Erzeugt das streng anonyme Per-Device Sync-Payload (Schema v2).
 * Enthält ausschließlich die generierte Zufalls-UUID, Push-Subscription, Alarmregeln und Standort —
 * keinerlei Geräteinformationen (kein User-Agent, kein Modell, kein OS, kein Fingerprinting).
 */
export function buildDeviceSyncPayload() {
  const deviceUuid = getOrCreateDeviceUuid();
  let timezone = 'Europe/Berlin';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {}

  return {
    schemaVersion: 2,
    deviceId: deviceUuid,
    enabled: Boolean(currentConfig.enabled),
    subscription: currentSubscription,
    rules: {
      windAlert: Boolean(currentConfig.windAlert),
      windThreshold: Number(currentConfig.windThreshold) || 60,
      frostAlert: Boolean(currentConfig.frostAlert),
      frostThreshold: Number(currentConfig.frostThreshold) || 0,
      briefingAlert: Boolean(currentConfig.briefingAlert),
      briefingTime: currentConfig.briefingTime || '07:00',
      severeAlert: Boolean(currentConfig.severeAlert),
      locationMode: currentConfig.locationMode || 'gps',
      quietHoursStart: currentConfig.quietHoursStart ?? 22,
      quietHoursEnd: currentConfig.quietHoursEnd ?? 6,
      bypassQuietHoursOnSevere: currentConfig.bypassQuietHoursOnSevere ?? true
    },
    schedulePreset: currentGitLab.schedulePreset || 'eco',
    location: {
      name: state.currentLocation?.name || 'München',
      lat: state.currentLocation?.lat || 48.137,
      lon: state.currentLocation?.lon || 11.575,
      elevation: state.currentLocation?.elevation || 520,
      timezone
    },
    vapidPublicKey: DEFAULT_VAPID_PUBLIC_KEY,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Synchronisiert die individuellen Einstellungen & Subscription dieses Geräts
 * in seine eigene, konfliktfreie GitLab CI-Variable (WEATHER_PUSH_DEV_<UUID_HEX>).
 */
export async function syncToGitLab() {
  const host = (currentGitLab.host || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const projectId = (currentGitLab.projectId || '').trim();
  const token = (currentGitLab.token || '').trim();
  const deviceUuid = getOrCreateDeviceUuid();
  const varKey = getDeviceVariableKey(deviceUuid);

  if (!projectId) {
    throw new Error('Bitte gib deine GitLab Projekt-ID oder den Projektpfad ein.');
  }

  const configPayload = buildDeviceSyncPayload();
  const payloadString = JSON.stringify(configPayload);

  // Ohne Token bieten wir bequemen Direkt-Download / Clipboard Export
  if (!token) {
    currentGitLab.lastSyncStatus = 'Konfiguration lokal bereitgestellt (Kein GitLab Token angegeben)';
    currentGitLab.lastSyncAt = Date.now();
    saveNotificationState();
    updateUIElements();
    return {
      mode: 'manual',
      deviceId: deviceUuid,
      variableKey: varKey,
      json: payloadString,
      message: 'Lokale Konfiguration erstellt. Trage deinen GitLab Access Token ein, um sie direkt über die REST API zu übertragen.'
    };
  }

  const encodedId = encodeURIComponent(projectId);
  const variableUrl = `${host}/api/v4/projects/${encodedId}/variables/${encodeURIComponent(varKey)}`;

  // 1. Zuerst versuchen wir PUT (Aktualisieren der eigenen Geräte-Variable)
  let response = await fetch(variableUrl, {
    method: 'PUT',
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ value: payloadString })
  });

  // 2. Falls diese Geräte-Variable noch nicht existiert (404), neu anlegen per POST
  if (response.status === 404) {
    const createUrl = `${host}/api/v4/projects/${encodedId}/variables`;
    response = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: varKey,
        value: payloadString,
        protected: false,
        masked: false
      })
    });
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`GitLab REST API Fehler (${response.status}): ${errorText || response.statusText}`);
  }

  const result = await response.json().catch(() => ({}));
  currentGitLab.lastSyncStatus = 'Erfolgreich mit GitLab synchronisiert';
  currentGitLab.lastSyncAt = Date.now();
  currentConfig.lastSyncAt = Date.now();
  saveNotificationState();
  updateUIElements();

  return {
    mode: 'api',
    deviceId: deviceUuid,
    variableKey: varKey,
    result,
    message: `Erfolgreich in individueller Geräte-Variable (${varKey}) gespeichert!`
  };
}

/**
 * Triggert eine GitLab Pipeline manuell via REST API
 */
export async function triggerGitLabPipeline() {
  const host = (currentGitLab.host || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const projectId = (currentGitLab.projectId || '').trim();
  const token = (currentGitLab.token || '').trim();

  if (!projectId || !token) {
    throw new Error('Projekt-ID und GitLab Access Token sind erforderlich, um eine Pipeline zu starten.');
  }

  const encodedId = encodeURIComponent(projectId);
  const pipelineUrl = `${host}/api/v4/projects/${encodedId}/pipeline?ref=main`;

  const response = await fetch(pipelineUrl, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token
    }
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Pipeline-Start fehlgeschlagen (${response.status}): ${err || response.statusText}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Erstellt oder aktualisiert den Pipeline Schedule via GitLab REST API
 */
export async function createOrUpdateGitLabSchedule() {
  const host = (currentGitLab.host || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const projectId = (currentGitLab.projectId || '').trim();
  const token = (currentGitLab.token || '').trim();
  const presetKey = currentGitLab.schedulePreset || 'eco';
  const preset = SCHEDULE_PRESETS[presetKey] || SCHEDULE_PRESETS.eco;

  if (!projectId || !token) {
    throw new Error('Projekt-ID und GitLab Access Token sind erforderlich, um einen Schedule anzulegen.');
  }

  const encodedId = encodeURIComponent(projectId);
  const schedulesUrl = `${host}/api/v4/projects/${encodedId}/pipeline_schedules`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';

  // 1. Vorhandene Pipeline-Schedules abfragen
  const listRes = await fetch(schedulesUrl, {
    headers: { 'PRIVATE-TOKEN': token }
  });

  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => '');
    throw new Error(`Konnte Pipeline-Schedules nicht abrufen (${listRes.status}): ${errText || listRes.statusText}`);
  }

  const existingSchedules = await listRes.json().catch(() => []);
  const existingSchedule = Array.isArray(existingSchedules)
    ? existingSchedules.find(s => (s.description || '').toLowerCase().includes('best weather'))
    : null;

  const schedulePayload = {
    description: `Best Weather Push Dispatcher (${presetKey.toUpperCase()})`,
    ref: 'main',
    cron: preset.cron,
    cron_timezone: timezone,
    active: true
  };

  let res;
  if (existingSchedule && existingSchedule.id) {
    // 2. Schedule existiert -> per PUT aktualisieren
    const updateUrl = `${schedulesUrl}/${existingSchedule.id}`;
    res = await fetch(updateUrl, {
      method: 'PUT',
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(schedulePayload)
    });
  } else {
    // 3. Neuer Schedule -> per POST anlegen
    res = await fetch(schedulesUrl, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(schedulePayload)
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Fehler beim Speichern des Pipeline-Schedules (${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  currentGitLab.lastSyncStatus = `Schedule aktiv: ${presetKey.toUpperCase()} (${timezone})`;
  currentGitLab.lastSyncAt = Date.now();
  saveNotificationState();
  updateUIElements();

  return { ok: true, schedule: data, preset, timezone };
}

/**
 * Aktualisiert die visuelle Dimmung der Regel-Karten basierend auf deren Schalter
 */
export function updateRuleCardDimming() {
  const mapping = [
    { inputId: 'notif-rule-wind', itemId: 'notif-rule-item-wind' },
    { inputId: 'notif-rule-frost', itemId: 'notif-rule-item-frost' },
    { inputId: 'notif-rule-briefing', itemId: 'notif-rule-item-briefing' },
    { inputId: 'notif-rule-severe', itemId: 'notif-rule-item-severe' },
  ];
  for (const { inputId, itemId } of mapping) {
    const input = document.getElementById(inputId);
    const item = document.getElementById(itemId);
    if (input && item) {
      item.classList.toggle('is-disabled', !input.checked);
    }
  }
}

/**
 * Aktualisiert den interaktiven 24-Stunden Zeitstrahl mit Nadel und Zeitzone
 */
export function updateTimelineVisualizer() {
  const clockBadge = document.getElementById('notif-live-clock-badge');
  const tzLabel = document.getElementById('notif-live-tz-label');
  const indicator = document.getElementById('notif-timeline-indicator');

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  const now = new Date();

  let hour = now.getHours();
  let minute = now.getMinutes();

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? String(hour), 10);
    minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? String(minute), 10);
  } catch {}

  const isQuiet = (hour >= 22 || hour < 6);
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const totalMinutes = hour * 60 + minute;
  const percent = Math.min(100, Math.max(0, (totalMinutes / 1440) * 100));

  if (indicator) {
    indicator.style.left = `${percent.toFixed(2)}%`;
  }

  if (clockBadge) {
    if (isQuiet) {
      clockBadge.innerText = `🌙 Jetzt: ${timeStr} Uhr • Nachtruhe (Pause)`;
      clockBadge.className = 'ntc-current-badge badge-quiet';
    } else {
      clockBadge.innerText = `☀️ Jetzt: ${timeStr} Uhr • Aktiv (Alarme scharf)`;
      clockBadge.className = 'ntc-current-badge';
    }
  }

  if (tzLabel) {
    tzLabel.innerText = `Zeitzone: ${tz}`;
  }
}

/**
 * Synchronisiert die Preset-Karten mit dem Formular
 */
export function updatePresetCards(selectedPreset) {
  const select = document.getElementById('notif-gitlab-schedule');
  const currentKey = selectedPreset || (select ? select.value : null) || currentGitLab.schedulePreset || 'eco';
  const cards = document.querySelectorAll('.notif-preset-card');
  cards.forEach(card => {
    const isSel = card.dataset.preset === currentKey;
    card.classList.toggle('is-selected', isSel);
    card.setAttribute('aria-selected', isSel ? 'true' : 'false');
  });

  if (select && select.value !== currentKey) {
    select.value = currentKey;
  }
}

/**
 * UI State Refresh Helper
 */
function updateUIElements() {
  const statusBadge = document.getElementById('notif-status-badge');
  const masterToggle = document.getElementById('notif-master-toggle');
  const supportHint = document.getElementById('notif-support-hint');
  const syncStatusMsg = document.getElementById('notif-sync-status-msg');
  const headerBtn = document.getElementById('notif-settings-btn');

  const support = checkPushSupport();

  if (masterToggle) {
    masterToggle.checked = Boolean(currentConfig.enabled);
  }

  if (statusBadge) {
    if (currentConfig.enabled) {
      statusBadge.innerText = 'Aktiv';
      statusBadge.className = 'notif-status-badge badge-active';
    } else {
      statusBadge.innerText = 'Inaktiv';
      statusBadge.className = 'notif-status-badge badge-inactive';
    }
  }

  if (headerBtn) {
    headerBtn.classList.toggle('active-notif', Boolean(currentConfig.enabled));
    headerBtn.title = currentConfig.enabled 
      ? 'Benachrichtigungen aktiv (Push konfiguriert)' 
      : 'Push-Benachrichtigungen & GitLab-Sync konfigurieren';
  }

  if (supportHint) {
    if (support.isIOS && !support.isStandalone) {
      supportHint.style.display = 'block';
      supportHint.innerHTML = '📱 <strong>iOS Hinweis:</strong> Füge die App über das Teilen-Symbol <span style="font-size:1.1em">⎋</span> zu deinem <strong>Home-Bildschirm</strong> hinzu, um native Push-Mitteilungen auf dem Sperrbildschirm zu empfangen.';
    } else if (Notification.permission === 'denied') {
      supportHint.style.display = 'block';
      supportHint.innerHTML = '⚠️ <strong>Berechtigung verweigert:</strong> Benachrichtigungen wurden im Browser blockiert. Bitte in den Browser-/Systemeinstellungen aktivieren.';
    } else {
      supportHint.style.display = 'none';
    }
  }

  if (syncStatusMsg) {
    if (currentGitLab.lastSyncAt > 0) {
      const timeStr = new Date(currentGitLab.lastSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      syncStatusMsg.innerText = `${currentGitLab.lastSyncStatus} (${timeStr})`;
    } else {
      syncStatusMsg.innerText = currentGitLab.lastSyncStatus || 'Noch nicht synchronisiert';
    }
  }

  const uuidLabel = document.getElementById('notif-device-uuid-label');
  if (uuidLabel) {
    const deviceUuid = getOrCreateDeviceUuid();
    uuidLabel.innerText = `${deviceUuid.slice(0, 8)}…`;
    uuidLabel.title = `Anonyme Geräte-UUID: ${deviceUuid}`;
  }

  updateRuleCardDimming();
  updateTimelineVisualizer();
  updatePresetCards();
}

/**
 * Befüllt die Formularfelder aus dem aktuell persistierten Zustand
 */
function populateNotificationFormFromState() {
  const elWind = document.getElementById('notif-rule-wind');
  const elWindVal = document.getElementById('notif-rule-wind-val');
  const elFrost = document.getElementById('notif-rule-frost');
  const elBriefing = document.getElementById('notif-rule-briefing');
  const elBriefingTime = document.getElementById('notif-rule-briefing-time');
  const elSevere = document.getElementById('notif-rule-severe');

  const elHost = document.getElementById('notif-gitlab-host');
  const elProject = document.getElementById('notif-gitlab-project');
  const elToken = document.getElementById('notif-gitlab-token');
  const elSchedule = document.getElementById('notif-gitlab-schedule');

  if (elWind) elWind.checked = Boolean(currentConfig.windAlert);
  if (elWindVal) elWindVal.value = String(currentConfig.windThreshold || 60);
  if (elFrost) elFrost.checked = Boolean(currentConfig.frostAlert);
  if (elBriefing) elBriefing.checked = Boolean(currentConfig.briefingAlert);
  if (elBriefingTime) elBriefingTime.value = currentConfig.briefingTime || '07:00';
  if (elSevere) elSevere.checked = Boolean(currentConfig.severeAlert);

  if (elHost) elHost.value = currentGitLab.host || 'https://gitlab.com';
  if (elProject) elProject.value = currentGitLab.projectId || '';
  if (elToken) elToken.value = currentGitLab.token || '';
  if (elSchedule) elSchedule.value = currentGitLab.schedulePreset || 'eco';
}

/**
 * Erzeugt einen normalisierten Snapshot der aktuellen Formularwerte
 */
function getFormSnapshot() {
  const elWind = document.getElementById('notif-rule-wind');
  const elWindVal = document.getElementById('notif-rule-wind-val');
  const elFrost = document.getElementById('notif-rule-frost');
  const elBriefing = document.getElementById('notif-rule-briefing');
  const elBriefingTime = document.getElementById('notif-rule-briefing-time');
  const elSevere = document.getElementById('notif-rule-severe');

  const elHost = document.getElementById('notif-gitlab-host');
  const elProject = document.getElementById('notif-gitlab-project');
  const elToken = document.getElementById('notif-gitlab-token');
  const elSchedule = document.getElementById('notif-gitlab-schedule');

  return JSON.stringify({
    windAlert: elWind ? Boolean(elWind.checked) : Boolean(currentConfig.windAlert),
    windThreshold: elWindVal ? (parseInt(elWindVal.value, 10) || 60) : (currentConfig.windThreshold || 60),
    frostAlert: elFrost ? Boolean(elFrost.checked) : Boolean(currentConfig.frostAlert),
    briefingAlert: elBriefing ? Boolean(elBriefing.checked) : Boolean(currentConfig.briefingAlert),
    briefingTime: elBriefingTime ? (elBriefingTime.value || '07:00') : (currentConfig.briefingTime || '07:00'),
    severeAlert: elSevere ? Boolean(elSevere.checked) : Boolean(currentConfig.severeAlert),
    host: elHost ? elHost.value.trim() : (currentGitLab.host || 'https://gitlab.com'),
    projectId: elProject ? elProject.value.trim() : (currentGitLab.projectId || ''),
    token: elToken ? elToken.value.trim() : (currentGitLab.token || ''),
    schedulePreset: elSchedule ? elSchedule.value : (currentGitLab.schedulePreset || 'eco')
  });
}

/**
 * Prüft ob ungespeicherte Änderungen im Formular vorliegen
 */
export function hasUnsavedChanges() {
  if (savedFormSnapshot === null) return false;
  return getFormSnapshot() !== savedFormSnapshot;
}

/**
 * Markiert den Speichern-Button visuell bei ungespeicherten Änderungen
 */
function updateUnsavedIndicator() {
  const saveBtn = document.getElementById('notif-save-sync-btn');
  if (!saveBtn) return;
  saveBtn.classList.toggle('has-unsaved', hasUnsavedChanges());
}

/**
 * Öffnet / schließt den Unsaved-Changes-Bestätigungsdialog
 */
function openUnsavedChangesDialog() {
  const dialog = document.getElementById('notif-unsaved-dialog');
  if (!dialog) {
    forceCloseNotificationModal();
    return;
  }
  dialog.style.display = 'flex';
  const saveBtn = document.getElementById('notif-unsaved-save-btn');
  if (saveBtn) saveBtn.focus();
}

function closeUnsavedChangesDialog() {
  const dialog = document.getElementById('notif-unsaved-dialog');
  if (dialog) dialog.style.display = 'none';
}

function forceCloseNotificationModal() {
  closeUnsavedChangesDialog();
  const modal = document.getElementById('notif-modal-overlay');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-open');
  savedFormSnapshot = null;
}

/**
 * Speichert alle Formularänderungen persistent (inkl. stiller GitLab-Sync)
 */
async function persistNotificationForm() {
  readFormValues();
  saveNotificationState();
  savedFormSnapshot = getFormSnapshot();
  updateUnsavedIndicator();

  if (currentGitLab.projectId && currentGitLab.token) {
    await syncToGitLab();
    return { synced: true };
  }

  currentGitLab.lastSyncStatus = 'Lokal aktiv & gesichert';
  currentGitLab.lastSyncAt = Date.now();
  saveNotificationState();
  updateUIElements();
  return { synced: false };
}

/**
 * Verwirft ungespeicherte Formularänderungen und stellt den gespeicherten Zustand wieder her
 */
function discardNotificationChanges() {
  loadNotificationState();
  populateNotificationFormFromState();
  updateUIElements();
  savedFormSnapshot = getFormSnapshot();
  updateUnsavedIndicator();
}

/**
 * Modal Öffnen & Schließen
 */
export function openNotificationModal() {
  loadNotificationState();
  const modal = document.getElementById('notif-modal-overlay');
  if (!modal) return;

  closeUnsavedChangesDialog();
  populateNotificationFormFromState();
  updateUIElements();
  savedFormSnapshot = getFormSnapshot();
  updateUnsavedIndicator();

  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
}

export function closeNotificationModal(force = false) {
  if (force === true || !hasUnsavedChanges()) {
    forceCloseNotificationModal();
    return;
  }
  openUnsavedChangesDialog();
}

/**
 * Liest die Formulardaten aus
 */
function readFormValues() {
  const elWind = document.getElementById('notif-rule-wind');
  const elWindVal = document.getElementById('notif-rule-wind-val');
  const elFrost = document.getElementById('notif-rule-frost');
  const elBriefing = document.getElementById('notif-rule-briefing');
  const elBriefingTime = document.getElementById('notif-rule-briefing-time');
  const elSevere = document.getElementById('notif-rule-severe');

  const elHost = document.getElementById('notif-gitlab-host');
  const elProject = document.getElementById('notif-gitlab-project');
  const elToken = document.getElementById('notif-gitlab-token');
  const elSchedule = document.getElementById('notif-gitlab-schedule');

  if (elWind) currentConfig.windAlert = elWind.checked;
  if (elWindVal) currentConfig.windThreshold = parseInt(elWindVal.value, 10) || 60;
  if (elFrost) currentConfig.frostAlert = elFrost.checked;
  if (elBriefing) currentConfig.briefingAlert = elBriefing.checked;
  if (elBriefingTime) currentConfig.briefingTime = elBriefingTime.value || '07:00';
  if (elSevere) currentConfig.severeAlert = elSevere.checked;

  if (elHost) currentGitLab.host = elHost.value.trim();
  if (elProject) currentGitLab.projectId = elProject.value.trim();
  if (elToken) currentGitLab.token = elToken.value.trim();
  if (elSchedule) currentGitLab.schedulePreset = elSchedule.value;
}

/**
 * Initialisiert Event Listener für Notification Module
 */
export function initNotifications() {
  loadNotificationState();
  updateUIElements();

  // Header Icon Button
  const headerBtn = document.getElementById('notif-settings-btn');
  if (headerBtn) {
    headerBtn.addEventListener('click', () => {
      openNotificationModal();
    });
  }

  // Modal Close Buttons & Unsaved Changes Guard
  const closeBtn = document.getElementById('notif-modal-close');
  const closeBtnAction = document.getElementById('notif-modal-close-action');
  const overlay = document.getElementById('notif-modal-overlay');
  const unsavedDialog = document.getElementById('notif-unsaved-dialog');
  const unsavedSaveBtn = document.getElementById('notif-unsaved-save-btn');
  const unsavedDiscardBtn = document.getElementById('notif-unsaved-discard-btn');
  const unsavedCancelBtn = document.getElementById('notif-unsaved-cancel-btn');

  if (closeBtn) closeBtn.addEventListener('click', () => closeNotificationModal(false));
  if (closeBtnAction) closeBtnAction.addEventListener('click', () => closeNotificationModal(false));

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeNotificationModal(false);
    });
  }

  if (unsavedDialog) {
    unsavedDialog.addEventListener('click', (e) => {
      if (e.target === unsavedDialog) closeUnsavedChangesDialog();
    });
  }

  if (unsavedSaveBtn) {
    unsavedSaveBtn.addEventListener('click', async () => {
      unsavedSaveBtn.disabled = true;
      unsavedSaveBtn.innerText = '⏳ Speichere...';
      try {
        await persistNotificationForm();
      } catch (err) {
        console.warn('Sync notice:', err.message);
      } finally {
        unsavedSaveBtn.disabled = false;
        unsavedSaveBtn.innerText = '✓ Änderungen speichern';
        forceCloseNotificationModal();
      }
    });
  }

  if (unsavedDiscardBtn) {
    unsavedDiscardBtn.addEventListener('click', () => {
      discardNotificationChanges();
      forceCloseNotificationModal();
    });
  }

  if (unsavedCancelBtn) {
    unsavedCancelBtn.addEventListener('click', () => {
      closeUnsavedChangesDialog();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (unsavedDialog && unsavedDialog.style.display !== 'none') {
      closeUnsavedChangesDialog();
      return;
    }
    if (overlay && overlay.style.display !== 'none') {
      closeNotificationModal(false);
    }
  });

  // Master Switch
  const masterToggle = document.getElementById('notif-master-toggle');
  if (masterToggle) {
    masterToggle.addEventListener('change', async () => {
      try {
        if (masterToggle.checked) {
          await enablePushNotifications();
        } else {
          await disablePushNotifications();
        }
      } catch (err) {
        alert(err.message || 'Fehler beim Ändern der Benachrichtigungseinstellungen.');
        masterToggle.checked = Boolean(currentConfig.enabled);
        updateUIElements();
      }
    });
  }

  // Test Push Button
  const testBtn = document.getElementById('notif-test-btn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.innerText = '⏳ Sende Test...';
      try {
        await sendLocalTestPush();
        testBtn.innerText = '✓ Gesendet!';
        setTimeout(() => {
          testBtn.disabled = false;
          testBtn.innerText = '🧪 Test-Push senden';
        }, 2500);
      } catch (err) {
        alert('Test-Push fehlgeschlagen: ' + err.message);
        testBtn.disabled = false;
        testBtn.innerText = '🧪 Test-Push senden';
      }
    });
  }

  // Save & Sync Button (Native & Lautlos für Endnutzer)
  const saveSyncBtn = document.getElementById('notif-save-sync-btn');
  if (saveSyncBtn) {
    saveSyncBtn.addEventListener('click', async () => {
      saveSyncBtn.disabled = true;
      saveSyncBtn.innerText = '⏳ Speichere...';

      try {
        const res = await persistNotificationForm();
        saveSyncBtn.innerText = res.synced ? '✓ Gesichert & Synchronisiert!' : '✓ Einstellungen gesichert!';
        setTimeout(() => {
          saveSyncBtn.disabled = false;
          saveSyncBtn.innerText = '✓ Einstellungen sichern';
        }, 2000);
      } catch (err) {
        console.warn('Sync notice:', err.message);
        saveSyncBtn.disabled = false;
        saveSyncBtn.innerText = '✓ Einstellungen gesichert!';
        setTimeout(() => {
          saveSyncBtn.innerText = '✓ Einstellungen sichern';
        }, 2000);
      }
    });
  }

  // Schedule Provisioning Button
  const scheduleBtn = document.getElementById('notif-create-schedule-btn');
  if (scheduleBtn) {
    scheduleBtn.addEventListener('click', async () => {
      readFormValues();
      saveNotificationState();
      savedFormSnapshot = getFormSnapshot();
      updateUnsavedIndicator();

      scheduleBtn.disabled = true;
      scheduleBtn.innerText = '⏳ Richte Schedule ein...';

      try {
        const result = await createOrUpdateGitLabSchedule();
        scheduleBtn.innerText = '✓ Schedule aktiv!';
        alert(`GitLab Pipeline-Schedule erfolgreich eingerichtet!\n\nIntervall: ${result.preset.name}\nCron: ${result.preset.cron}\nZeitzone: ${result.timezone}\n\nDer Job prüft tagsüber von 06:00 bis 22:00 Uhr die Wetterdaten und pausiert nachts automatisch (22:00-06:00 Uhr).`);
        setTimeout(() => {
          scheduleBtn.disabled = false;
          scheduleBtn.innerText = '📅 Pipeline-Schedule einrichten';
        }, 3000);
      } catch (err) {
        alert('Schedule-Einrichtung fehlgeschlagen: ' + err.message);
        scheduleBtn.disabled = false;
        scheduleBtn.innerText = '📅 Pipeline-Schedule einrichten';
      }
    });
  }

  // Pipeline Trigger Button
  const triggerBtn = document.getElementById('notif-trigger-pipeline-btn');
  if (triggerBtn) {
    triggerBtn.addEventListener('click', async () => {
      readFormValues();
      triggerBtn.disabled = true;
      triggerBtn.innerText = '⏳ Starte Pipeline...';

      try {
        const pipelineData = await triggerGitLabPipeline();
        triggerBtn.innerText = `✓ Pipeline #${pipelineData.id || ''} gestartet!`;
        setTimeout(() => {
          triggerBtn.disabled = false;
          triggerBtn.innerText = '⚡ Pipeline jetzt starten';
        }, 3000);
      } catch (err) {
        alert('Fehler beim Starten der Pipeline: ' + err.message);
        triggerBtn.disabled = false;
        triggerBtn.innerText = '⚡ Pipeline jetzt starten';
      }
    });
  }

  // Quick-Nav Pills Smooth Scroll
  document.querySelectorAll('.notif-nav-pill[data-scroll-to]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.dataset.scrollTo;
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Preset Cards Live Preview (ohne Auto-Save, sodass Verwerfen / Speichern sauber greift)
  document.querySelectorAll('.notif-preset-card[data-preset]').forEach(card => {
    const handleSelect = () => {
      updatePresetCards(card.dataset.preset);
      updateUnsavedIndicator();
    };
    card.addEventListener('click', handleSelect);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect();
      }
    });
  });

  const elScheduleSelect = document.getElementById('notif-gitlab-schedule');
  if (elScheduleSelect) {
    elScheduleSelect.addEventListener('change', () => {
      updatePresetCards(elScheduleSelect.value);
      updateUnsavedIndicator();
    });
  }

  // Token Visibility Eye Toggle
  const tokenEyeBtn = document.getElementById('notif-token-toggle-eye');
  const tokenField = document.getElementById('notif-gitlab-token');
  if (tokenEyeBtn && tokenField) {
    tokenEyeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isPass = tokenField.type === 'password';
      tokenField.type = isPass ? 'text' : 'password';
      tokenEyeBtn.innerText = isPass ? '🙈' : '👁️';
      tokenEyeBtn.title = isPass ? 'Token verbergen' : 'Token anzeigen';
      tokenEyeBtn.setAttribute('aria-label', isPass ? 'Token verbergen' : 'Token anzeigen');
    });
  }

  // Live UI Preview & Unsaved-Changes Tracking (kein vorzeitiges Auto-Save)
  const formFieldIds = [
    'notif-rule-wind', 'notif-rule-wind-val',
    'notif-rule-frost', 'notif-rule-briefing', 'notif-rule-briefing-time',
    'notif-rule-severe', 'notif-gitlab-host', 'notif-gitlab-project', 'notif-gitlab-token'
  ];
  formFieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const handleDirty = () => {
        updateRuleCardDimming();
        updateUnsavedIndicator();
      };
      el.addEventListener('change', handleDirty);
      if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'password' || el.type === 'url' || el.type === 'time')) {
        el.addEventListener('input', handleDirty);
      }
    }
  });

  // Service Worker Messages (z. B. wenn eine Notification angeklickt wird)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'NOTIFICATION_OPENED' && event.data?.tab) {
        if (window.switchTab) {
          window.switchTab(event.data.tab);
        }
      }
    });
  }
}

// Global Bindings für Tests und Integration
window.openNotificationModal = openNotificationModal;
window.closeNotificationModal = closeNotificationModal;
window.hasUnsavedNotificationChanges = hasUnsavedChanges;
window.getPushDeviceUuid = getOrCreateDeviceUuid;
window.getPushDeviceVariableKey = () => getDeviceVariableKey(getOrCreateDeviceUuid());
window.buildDeviceSyncPayload = buildDeviceSyncPayload;
window.deleteDeviceFromGitLab = deleteDeviceFromGitLab;
window.enablePushNotifications = enablePushNotifications;
window.disablePushNotifications = disablePushNotifications;
window.sendLocalTestPush = sendLocalTestPush;
window.syncToGitLab = syncToGitLab;
window.createOrUpdateGitLabSchedule = createOrUpdateGitLabSchedule;
window.SCHEDULE_PRESETS = SCHEDULE_PRESETS;
