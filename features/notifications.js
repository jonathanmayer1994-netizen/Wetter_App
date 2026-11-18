/**
 * BEST WEATHER — All-in-GitLab Push Notifications & OAuth 2.0 PKCE Engine
 * Enterprise Web Push Engine for iOS 16.4+ (APNs Lock Screen) & macOS Notification Center.
 *
 * Privacy-First Multi-Device Architecture:
 * - Each Apple device is identified EXCLUSIVELY by a locally generated anonymous RFC 4122 UUID v4
 *   stored in its own conflict-free GitLab CI variable: WEATHER_PUSH_DEV_<UUID_HEX>
 * - Zero device metadata (no User-Agent, no model, no OS, no hardware fingerprinting)
 * - GitLab OAuth 2.0 + PKCE (RFC 7636) for 1-Tap Face ID / Touch ID sign-in with automatic token refresh
 * - Automatic GitLab Pipeline Schedule provisioning & 15-second E2E Server->APNs test push
 */

import { AlpineStorage } from '../storage.js';
import { state } from '../core/state.js';

export const DEFAULT_VAPID_PUBLIC_KEY = 'BFXeGAET8G6YxsiL0HvXELcaDIoZyeIgPYokZuqpueq3NFJs8xG7KsyvViif44MAxMkBI_OQ93OXewHGRhMSOmI';

// Öffentliche GitLab OAuth 2.0 PKCE Defaults (kein Secret — 100% sicher im Client-Code!)
export const DEFAULT_GITLAB_OAUTH = {
  host: 'https://gitlab.com',
  clientId: 'b0340e0fe4da7489c6eb92afa8d95351ae235bcc426ae2bad6a2739c4f5bfab5',
  projectId: '89124873'
};

const STORAGE_KEYS = {
  CONFIG: 'bw_push_config',
  GITLAB: 'bw_gitlab_config',
  OAUTH: 'bw_gitlab_oauth',
  OAUTH_PKCE: 'bw_gitlab_oauth_pkce',
  SUBSCRIPTION: 'bw_push_subscription',
  DEVICE_UUID: 'bw_push_device_uuid'
};

export const DEVICE_VAR_PREFIX = 'WEATHER_PUSH_DEV_';
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SCHEDULE_PRESETS = {
  eco: {
    key: 'eco',
    name: 'Eco (06:00–22:00 Uhr, 100% Free-Tier Safe)',
    cron: '0 6,7,8,10,12,14,16,17,18,19,20,21 * * *',
    runsPerDay: 12,
    monthlyMinutes: 120,
    description: '12 Läufe/Tag verteilt auf 06:00 bis 21:00 Uhr. 22:00–06:00 Uhr Pause (~120 Compute-Min./Monat).'
  },
  hourly: {
    key: 'hourly',
    name: 'Stündlich (06:00–22:00 Uhr)',
    cron: '0 6-21 * * *',
    runsPerDay: 16,
    monthlyMinutes: 160,
    description: '16 Läufe/Tag stündlich von 06:00 bis 21:00 Uhr. 22:00–06:00 Uhr Pause (~160 Compute-Min./Monat, 100% Free-Tier Safe).'
  },
  highfreq: {
    key: 'highfreq',
    name: 'Alle 20 Min tagsüber (06:00–22:00 Uhr)',
    cron: '*/20 6-21 * * *',
    runsPerDay: 48,
    monthlyMinutes: 480,
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
  locationMode: 'gps',
  lastSyncAt: 0
};

const DEFAULT_GITLAB = {
  host: DEFAULT_GITLAB_OAUTH.host,
  clientId: DEFAULT_GITLAB_OAUTH.clientId,
  projectId: DEFAULT_GITLAB_OAUTH.projectId,
  token: '', // Optionaler Fallback Personal Access Token (glpat-...)
  schedulePreset: 'eco',
  lastSyncStatus: 'Nicht mit GitLab verbunden',
  lastSyncAt: 0
};

let currentConfig = { ...DEFAULT_CONFIG };
let currentGitLab = { ...DEFAULT_GITLAB };
let currentOAuth = null; // { accessToken, refreshToken, expiresAt, tokenType, scope, connectedAt }
let currentSubscription = null;
let savedFormSnapshot = null;

// =============================================================================
// CRYPTO & ANONYMOUS UUID v4 IDENTITY (ZERO DEVICE METADATA)
// =============================================================================

function base64UrlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return window.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
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

// =============================================================================
// GITLAB OAUTH 2.0 + PKCE (RFC 7636 — 1-TAP FACE ID / TOUCH ID LOGIN)
// =============================================================================

export function getOAuthRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

export function generatePkceVerifier() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function computePkceChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function generateOAuthState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Ermittelt die effektive GitLab-Projekt-ID oder den Projektpfad.
 * Priorität:
 * 1. Vom Nutzer explizit im Formular/State eingetragen (currentGitLab.projectId)
 * 2. DEFAULT_GITLAB_OAUTH.projectId (z. B. durch scripts/setup_gitlab.py vorkonfiguriert)
 * 3. Vollautomatische Auto-Discovery auf GitLab Pages (https://<user>.gitlab.io/<repo>/)
 */
export function getEffectiveProjectId() {
  const explicit = (currentGitLab.projectId || DEFAULT_GITLAB_OAUTH.projectId || '').trim();
  if (explicit) return explicit;

  if (typeof window !== 'undefined' && window.location) {
    const hostname = (window.location.hostname || '').toLowerCase();
    if (hostname.endsWith('.gitlab.io')) {
      const namespace = hostname.replace(/\.gitlab\.io$/, '');
      const pathParts = (window.location.pathname || '').replace(/^\/+|\/+$/g, '').split('/');
      const repo = pathParts[0];
      if (namespace && repo) {
        return `${namespace}/${repo}`;
      }
    }
  }
  return '';
}

/**
 * Ermittelt den aktuellen GitLab-Authentifizierungsmodus:
 * 'oauth' (OAuth 2.0 PKCE), 'pat' (Fallback Access Token) oder 'disconnected'
 */
export function getGitLabAuthMode() {
  const projectId = getEffectiveProjectId();
  if (!projectId) return 'disconnected';
  if (currentOAuth && currentOAuth.accessToken) return 'oauth';
  if ((currentGitLab.token || '').trim()) return 'pat';
  return 'disconnected';
}

export function getActiveBackendMode() {
  const authMode = getGitLabAuthMode();
  return authMode === 'disconnected' ? 'local-only' : `gitlab-${authMode}`;
}

/**
 * Startet den offiziellen GitLab OAuth 2.0 + PKCE Flow (1-Tipp Anmeldung via Face ID / Touch ID)
 */
export async function startGitLabOAuthLogin() {
  readFormValues();
  const host = (currentGitLab.host || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const clientId = (currentGitLab.clientId || DEFAULT_GITLAB_OAUTH.clientId || '').trim();
  const projectId = getEffectiveProjectId();

  if (!projectId) {
    throw new Error('Bitte trage zuerst deine GitLab Projekt-ID oder deinen Projektpfad ein (z. B. benutzer/wetter_app).');
  }
  if (!clientId) {
    throw new Error('Bitte trage zuerst deine öffentliche GitLab OAuth Application ID (Client ID) ein.');
  }

  saveNotificationState();

  const verifier = generatePkceVerifier();
  const challenge = await computePkceChallenge(verifier);
  const oauthState = generateOAuthState();
  const redirectUri = getOAuthRedirectUri();

  AlpineStorage.safeSetItem(STORAGE_KEYS.OAUTH_PKCE, {
    verifier,
    state: oauthState,
    redirectUri,
    host,
    clientId,
    projectId,
    createdAt: Date.now()
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'api',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: oauthState
  });

  window.location.assign(`${host}/oauth/authorize?${params.toString()}`);
}

/**
 * Verarbeitet automatisch den GitLab OAuth 2.0 + PKCE Redirect Callback beim App-Start
 */
export async function handleGitLabOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const oauthError = params.get('error');

  if (!code && !oauthError) return { handled: false };

  const cleanUrl = getOAuthRedirectUri();
  const cleanupUrl = () => {
    try {
      window.history.replaceState({}, document.title, cleanUrl);
    } catch {}
  };

  if (oauthError) {
    AlpineStorage.safeRemoveItem(STORAGE_KEYS.OAUTH_PKCE);
    cleanupUrl();
    const desc = params.get('error_description') || oauthError;
    console.warn('GitLab OAuth abgebrochen/Fehler:', desc);
    return { handled: true, error: desc };
  }

  const pkce = AlpineStorage.safeGetItem(STORAGE_KEYS.OAUTH_PKCE, null);
  AlpineStorage.safeRemoveItem(STORAGE_KEYS.OAUTH_PKCE);
  cleanupUrl();

  if (!pkce || !pkce.verifier || !pkce.state || pkce.state !== returnedState) {
    console.error('GitLab OAuth PKCE State-Prüfung fehlgeschlagen (CSRF-Schutz).');
    return { handled: true, error: 'Ungültiger OAuth-Sicherheitsstatus. Bitte erneut anmelden.' };
  }

  if (Date.now() - (pkce.createdAt || 0) > 15 * 60 * 1000) {
    return { handled: true, error: 'OAuth-Anmeldung abgelaufen (>15 Min.). Bitte erneut anmelden.' };
  }

  const tokenUrl = `${pkce.host}/oauth/token`;
  const body = new URLSearchParams({
    client_id: pkce.clientId,
    code,
    grant_type: 'authorization_code',
    redirect_uri: pkce.redirectUri,
    code_verifier: pkce.verifier
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error(`GitLab OAuth Token-Austausch fehlgeschlagen (${res.status}): ${errTxt || res.statusText}`);
  }

  const tokenData = await res.json();
  currentOAuth = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    expiresAt: Date.now() + ((Number(tokenData.expires_in) || 7200) * 1000),
    tokenType: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || 'api',
    connectedAt: Date.now()
  };

  currentGitLab.host = pkce.host;
  currentGitLab.clientId = pkce.clientId;
  currentGitLab.projectId = pkce.projectId;
  currentGitLab.lastSyncStatus = 'Mit GitLab verbunden (OAuth PKCE)';
  currentGitLab.lastSyncAt = Date.now();
  saveNotificationState();
  updateUIElements();

  // Vollautomatischer Erst-Sync + Schedule-Einrichtung direkt nach OAuth Login!
  try {
    await syncAndProvisionGitLab();
  } catch (err) {
    console.warn('Auto-Sync nach OAuth Info:', err.message);
  }

  return { handled: true, ok: true };
}

/**
 * Erneuert ein ablaufendes GitLab OAuth Access Token lautlos über das Refresh Token
 */
export async function refreshGitLabOAuthToken() {
  if (!currentOAuth || !currentOAuth.refreshToken) {
    throw new Error('GitLab-Sitzung abgelaufen. Bitte kurz erneut mit GitLab verbinden.');
  }

  const host = (currentGitLab.host || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const clientId = (currentGitLab.clientId || DEFAULT_GITLAB_OAUTH.clientId || '').trim();
  if (!clientId) {
    throw new Error('GitLab OAuth Client ID fehlt für Token-Erneuerung.');
  }

  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: currentOAuth.refreshToken,
    grant_type: 'refresh_token',
    redirect_uri: getOAuthRedirectUri()
  });

  const res = await fetch(`${host}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    disconnectGitLabOAuth();
    throw new Error(`GitLab OAuth Refresh fehlgeschlagen (${res.status}). Bitte erneut verbinden.`);
  }

  const tokenData = await res.json();
  currentOAuth = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || currentOAuth.refreshToken,
    expiresAt: Date.now() + ((Number(tokenData.expires_in) || 7200) * 1000),
    tokenType: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || currentOAuth.scope || 'api',
    connectedAt: currentOAuth.connectedAt || Date.now()
  };
  saveNotificationState();
  return currentOAuth;
}

/**
 * Trennt die GitLab OAuth-Verbindung lokal auf diesem Gerät
 */
export function disconnectGitLabOAuth() {
  currentOAuth = null;
  AlpineStorage.safeRemoveItem(STORAGE_KEYS.OAUTH);
  currentGitLab.lastSyncStatus = 'GitLab-Verbindung getrennt';
  currentGitLab.lastSyncAt = 0;
  saveNotificationState();
  updateUIElements();
}

/**
 * Zentraler GitLab REST API Client mit automatischem OAuth PKCE Refresh & PAT-Fallback
 */
async function gitlabApiFetch(apiPath, options = {}, allowRetry = true) {
  const host = (currentGitLab.host || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const authMode = getGitLabAuthMode();

  if (authMode === 'disconnected') {
    throw new Error('Nicht mit GitLab verbunden. Bitte zuerst per „Mit GitLab verbinden“ anmelden.');
  }

  const headers = { ...(options.headers || {}) };

  if (authMode === 'oauth') {
    // Proaktiver Auto-Refresh 2 Minuten vor Ablauf
    if (currentOAuth.expiresAt && Date.now() >= (currentOAuth.expiresAt - 120_000) && currentOAuth.refreshToken) {
      await refreshGitLabOAuthToken();
    }
    headers['Authorization'] = `Bearer ${currentOAuth.accessToken}`;
  } else {
    headers['PRIVATE-TOKEN'] = (currentGitLab.token || '').trim();
  }

  const response = await fetch(`${host}/api/v4${apiPath}`, {
    ...options,
    headers
  });

  // Bei abgelaufenem OAuth Token einmalig automatisch refreshen & wiederholen
  if (response.status === 401 && authMode === 'oauth' && allowRetry && currentOAuth?.refreshToken) {
    await refreshGitLabOAuthToken();
    return gitlabApiFetch(apiPath, options, false);
  }

  return response;
}

// =============================================================================
// PUSH SUPPORT & PERSISTENCE
// =============================================================================

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

export function loadNotificationState() {
  const savedConfig = AlpineStorage.safeGetItem(STORAGE_KEYS.CONFIG, null);
  if (savedConfig) {
    currentConfig = { ...DEFAULT_CONFIG, ...savedConfig };
  }

  const savedGitLab = AlpineStorage.safeGetItem(STORAGE_KEYS.GITLAB, null);
  if (savedGitLab) {
    currentGitLab = { ...DEFAULT_GITLAB, ...savedGitLab };
    if (!currentGitLab.clientId && DEFAULT_GITLAB_OAUTH.clientId) {
      currentGitLab.clientId = DEFAULT_GITLAB_OAUTH.clientId;
    }
    if (!currentGitLab.projectId && DEFAULT_GITLAB_OAUTH.projectId) {
      currentGitLab.projectId = DEFAULT_GITLAB_OAUTH.projectId;
    }
  }

  const savedOAuth = AlpineStorage.safeGetItem(STORAGE_KEYS.OAUTH, null);
  currentOAuth = (savedOAuth && savedOAuth.accessToken) ? savedOAuth : null;

  const savedSub = AlpineStorage.safeGetItem(STORAGE_KEYS.SUBSCRIPTION, null);
  if (savedSub) {
    currentSubscription = savedSub;
  }

  return { config: currentConfig, gitlab: currentGitLab, oauth: currentOAuth, subscription: currentSubscription };
}

export function saveNotificationState() {
  AlpineStorage.safeSetItem(STORAGE_KEYS.CONFIG, currentConfig);
  AlpineStorage.safeSetItem(STORAGE_KEYS.GITLAB, currentGitLab);
  if (currentOAuth) {
    AlpineStorage.safeSetItem(STORAGE_KEYS.OAUTH, currentOAuth);
  }
  if (currentSubscription) {
    AlpineStorage.safeSetItem(STORAGE_KEYS.SUBSCRIPTION, currentSubscription);
  }
}

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

  if (getGitLabAuthMode() !== 'disconnected') {
    syncAndProvisionGitLab().catch(err => console.debug('GitLab Auto-Sync Info:', err.message));
  }

  return currentSubscription;
}

/**
 * Entfernt ausschließlich die eigene anonyme Geräte-Variable aus GitLab CI,
 * ohne andere verknüpfte Geräte zu beeinflussen.
 */
export async function deleteDeviceFromGitLab() {
  if (getGitLabAuthMode() === 'disconnected') return { skipped: true };

  const projectId = getEffectiveProjectId();
  const deviceUuid = getOrCreateDeviceUuid();
  const varKey = getDeviceVariableKey(deviceUuid);
  const encodedId = encodeURIComponent(projectId);

  const response = await gitlabApiFetch(`/projects/${encodedId}/variables/${encodeURIComponent(varKey)}`, {
    method: 'DELETE'
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

  if (getGitLabAuthMode() !== 'disconnected') {
    deleteDeviceFromGitLab().catch(err => console.debug('GitLab Cleanup Info:', err.message));
  }
}

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
    body: `Standort: ${locName} (${currentTemp}). Lokale System-Benachrichtigung funktioniert.`,
    icon: './icon-192.png',
    badge: './favicon.png',
    tag: 'best-weather-test-alert',
    renotify: true,
    data: {
      url: './',
      tab: 'tab-overview',
      timestamp: Date.now()
    }
  });

  return true;
}

// =============================================================================
// ANONYMOUS PER-DEVICE GITLAB SYNC, AUTO-SCHEDULE & 15s E2E SERVER TEST-PUSH
// =============================================================================

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
 * Hilfsfunktion: Upsert einer GitLab CI Project Variable (PUT -> POST bei 404)
 */
async function upsertGitLabVariable(projectId, key, value, { protectedVar = false, masked = false } = {}) {
  const encodedId = encodeURIComponent(projectId);
  let response = await gitlabApiFetch(`/projects/${encodedId}/variables/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, protected: protectedVar, masked })
  });

  if (response.status === 404) {
    response = await gitlabApiFetch(`/projects/${encodedId}/variables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, protected: protectedVar, masked })
    });
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`GitLab Variable ${key} Fehler (${response.status}): ${errorText || response.statusText}`);
  }
  return await response.json().catch(() => ({}));
}

/**
 * Synchronisiert die individuellen Einstellungen & Subscription dieses Geräts
 * in seine eigene, konfliktfreie GitLab CI-Variable (WEATHER_PUSH_DEV_<UUID_HEX>).
 */
export async function syncToGitLab() {
  const projectId = getEffectiveProjectId();
  const deviceUuid = getOrCreateDeviceUuid();
  const varKey = getDeviceVariableKey(deviceUuid);

  if (!projectId) {
    throw new Error('Bitte gib deine GitLab Projekt-ID oder den Projektpfad ein.');
  }

  const configPayload = buildDeviceSyncPayload();
  const payloadString = JSON.stringify(configPayload);

  if (getGitLabAuthMode() === 'disconnected') {
    currentGitLab.lastSyncStatus = 'Nicht mit GitLab verbunden (nur lokal)';
    currentGitLab.lastSyncAt = 0;
    saveNotificationState();
    updateUIElements();
    return {
      mode: 'manual',
      deviceId: deviceUuid,
      variableKey: varKey,
      json: payloadString,
      message: 'Bitte verbinde dich mit GitLab (OAuth), um Cloud-Push zu aktivieren.'
    };
  }

  const result = await upsertGitLabVariable(projectId, varKey, payloadString, {
    protectedVar: false,
    masked: false
  });

  // Falls PAT vorhanden: sichere ihn optional maskiert als PUSH_STATE_API_TOKEN für runner-übergreifende State-Persistenz
  if (getGitLabAuthMode() === 'pat' && (currentGitLab.token || '').trim().length >= 8) {
    upsertGitLabVariable(projectId, 'PUSH_STATE_API_TOKEN', currentGitLab.token.trim(), {
      protectedVar: false,
      masked: true
    }).catch(() => {});
  }

  currentGitLab.lastSyncStatus = getGitLabAuthMode() === 'oauth'
    ? 'GitLab OAuth aktiv & synchronisiert'
    : 'GitLab CI aktiv & synchronisiert';
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
 * Vollautomatische Komplett-Synchronisation:
 * 1. Speichert eigene anonyme Geräte-UUID-Variable (WEATHER_PUSH_DEV_<UUID_HEX>)
 * 2. Legt/aktualisiert automatisch den aktiven GitLab Pipeline-Schedule
 */
export async function syncAndProvisionGitLab() {
  const syncRes = await syncToGitLab();
  if (syncRes.mode !== 'api') return { synced: false, syncRes };

  let scheduleRes = null;
  try {
    scheduleRes = await createOrUpdateGitLabSchedule();
  } catch (err) {
    console.warn('Auto-Schedule Hinweis:', err.message);
  }
  return { synced: true, syncRes, scheduleRes };
}

/**
 * Startet eine GitLab Pipeline via REST API (optional mit PUSH_TEST_DEVICE_ID für sofortigen E2E-Test)
 */
export async function triggerGitLabPipeline(variables = []) {
  const projectId = getEffectiveProjectId();
  if (!projectId || getGitLabAuthMode() === 'disconnected') {
    throw new Error('Bitte zuerst mit GitLab verbinden, um eine Pipeline zu starten.');
  }

  const encodedId = encodeURIComponent(projectId);
  const body = { ref: 'main' };
  if (Array.isArray(variables) && variables.length > 0) {
    body.variables = variables;
  }

  const response = await gitlabApiFetch(`/projects/${encodedId}/pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Pipeline-Start fehlgeschlagen (${response.status}): ${err || response.statusText}`);
  }

  return await response.json();
}

/**
 * Echter 15-Sekunden End-to-End Test-Push direkt aus GitLab CI -> Apple APNs -> dieses Gerät!
 */
export async function triggerGitLabTestPush() {
  if (!currentSubscription?.endpoint) {
    throw new Error('Bitte aktiviere zuerst oben den Schalter „Push-Mitteilungen erlauben“.');
  }
  const deviceUuid = getOrCreateDeviceUuid();
  await syncToGitLab();
  const pipeline = await triggerGitLabPipeline([
    { key: 'PUSH_TEST_DEVICE_ID', value: deviceUuid }
  ]);
  return { ok: true, pipelineId: pipeline.id, webUrl: pipeline.web_url, deviceId: deviceUuid };
}

/**
 * Erstellt oder aktualisiert den Pipeline Schedule via GitLab REST API
 */
export async function createOrUpdateGitLabSchedule() {
  const projectId = getEffectiveProjectId();
  const presetKey = currentGitLab.schedulePreset || 'eco';
  const preset = SCHEDULE_PRESETS[presetKey] || SCHEDULE_PRESETS.eco;

  if (!projectId || getGitLabAuthMode() === 'disconnected') {
    throw new Error('Bitte zuerst mit GitLab verbinden, um den Zeitplan einzurichten.');
  }

  const encodedId = encodeURIComponent(projectId);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';

  const listRes = await gitlabApiFetch(`/projects/${encodedId}/pipeline_schedules`);
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
    res = await gitlabApiFetch(`/projects/${encodedId}/pipeline_schedules/${existingSchedule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedulePayload)
    });
  } else {
    res = await gitlabApiFetch(`/projects/${encodedId}/pipeline_schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedulePayload)
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Fehler beim Speichern des Pipeline-Schedules (${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json().catch(() => ({}));
  currentGitLab.lastSyncStatus = `GitLab aktiv • Zeitplan ${presetKey.toUpperCase()}`;
  currentGitLab.lastSyncAt = Date.now();
  saveNotificationState();
  updateUIElements();

  return { ok: true, schedule: data, preset, timezone };
}

// =============================================================================
// UI RENDERING, SNAPSHOTS & UNSAVED CHANGES DIALOG
// =============================================================================

export function updateRuleCardDimming() {
  const pairs = [
    ['notif-rule-wind', 'notif-rule-item-wind'],
    ['notif-rule-frost', 'notif-rule-item-frost'],
    ['notif-rule-briefing', 'notif-rule-item-briefing'],
    ['notif-rule-severe', 'notif-rule-item-severe']
  ];
  for (const [inputId, itemId] of pairs) {
    const input = document.getElementById(inputId);
    const item = document.getElementById(itemId);
    if (input && item) {
      item.classList.toggle('is-disabled', !input.checked);
    }
  }
}

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
    if (hour === 24) hour = 0;
    minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? String(minute), 10);
  } catch {}

  const isQuiet = (hour >= 22 || hour < 6);
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const totalMinutes = hour * 60 + minute;
  const percent = Math.min(100, Math.max(0, (totalMinutes / 1440) * 100));

  if (indicator) indicator.style.left = `${percent.toFixed(2)}%`;

  if (clockBadge) {
    if (isQuiet) {
      clockBadge.innerText = `🌙 Jetzt: ${timeStr} Uhr • Nachtruhe (Pause)`;
      clockBadge.className = 'ntc-current-badge badge-quiet';
    } else {
      clockBadge.innerText = `☀️ Jetzt: ${timeStr} Uhr • Aktiv (Alarme scharf)`;
      clockBadge.className = 'ntc-current-badge';
    }
  }

  if (tzLabel) tzLabel.innerText = `Zeitzone: ${tz}`;
}

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

function updateUIElements() {
  const statusBadge = document.getElementById('notif-status-badge');
  const masterToggle = document.getElementById('notif-master-toggle');
  const supportHint = document.getElementById('notif-support-hint');
  const syncStatusMsg = document.getElementById('notif-sync-status-msg');
  const headerBtn = document.getElementById('notif-settings-btn');

  const support = checkPushSupport();
  const authMode = getGitLabAuthMode();
  const isConnected = authMode !== 'disconnected';

  if (masterToggle) {
    masterToggle.checked = Boolean(currentConfig.enabled);
  }

  if (statusBadge) {
    if (currentConfig.enabled && isConnected) {
      statusBadge.innerText = 'Aktiv • Cloud';
      statusBadge.className = 'notif-status-badge badge-active';
    } else if (currentConfig.enabled) {
      statusBadge.innerText = 'Lokal';
      statusBadge.className = 'notif-status-badge badge-active';
    } else {
      statusBadge.innerText = 'Inaktiv';
      statusBadge.className = 'notif-status-badge badge-inactive';
    }
  }

  if (headerBtn) {
    headerBtn.classList.toggle('active-notif', Boolean(currentConfig.enabled));
    headerBtn.title = currentConfig.enabled
      ? 'Benachrichtigungen aktiv'
      : 'Push-Benachrichtigungen & GitLab konfigurieren';
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
    if (!isConnected) {
      syncStatusMsg.innerText = 'Nur lokal gespeichert — bitte mit GitLab verbinden';
      syncStatusMsg.classList.add('status-warning');
      syncStatusMsg.classList.remove('status-ok');
    } else if (currentGitLab.lastSyncAt > 0) {
      const timeStr = new Date(currentGitLab.lastSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      syncStatusMsg.innerText = `${currentGitLab.lastSyncStatus} (${timeStr})`;
      syncStatusMsg.classList.remove('status-warning');
      syncStatusMsg.classList.add('status-ok');
    } else {
      syncStatusMsg.innerText = 'Mit GitLab verbunden — bitte Einstellungen sichern';
      syncStatusMsg.classList.remove('status-warning');
      syncStatusMsg.classList.add('status-ok');
    }
  }

  // OAuth Connect / Disconnect UI controls
  const oauthConnectBtn = document.getElementById('notif-gitlab-oauth-btn');
  const oauthDisconnectBtn = document.getElementById('notif-gitlab-disconnect-btn');
  const oauthStatusEl = document.getElementById('notif-oauth-status-badge');
  const redirectUriCode = document.getElementById('notif-oauth-redirect-uri');

  if (redirectUriCode) {
    redirectUriCode.innerText = getOAuthRedirectUri();
  }
  if (oauthStatusEl) {
    if (authMode === 'oauth') {
      oauthStatusEl.innerText = '🟢 OAuth 2.0 PKCE verbunden (Auto-Refresh aktiv)';
      oauthStatusEl.className = 'notif-oauth-status is-connected';
    } else if (authMode === 'pat') {
      oauthStatusEl.innerText = '🟢 Mit GitLab Access Token verbunden';
      oauthStatusEl.className = 'notif-oauth-status is-connected';
    } else {
      oauthStatusEl.innerText = '⚪ Noch nicht mit GitLab verbunden';
      oauthStatusEl.className = 'notif-oauth-status';
    }
  }
  if (oauthConnectBtn) {
    oauthConnectBtn.style.display = authMode === 'oauth' ? 'none' : 'inline-flex';
  }
  if (oauthDisconnectBtn) {
    oauthDisconnectBtn.style.display = authMode === 'oauth' ? 'inline-flex' : 'none';
  }

  // Ehrliches Backend-Verbindungs-Banner
  const backendBanner = document.getElementById('notif-backend-status-banner');
  if (backendBanner) {
    if (!isConnected) {
      backendBanner.style.display = 'flex';
      backendBanner.className = 'notif-backend-banner is-warning';
      backendBanner.innerHTML = `
        <span class="nbb-icon" aria-hidden="true">🦊</span>
        <div class="nbb-content">
          <div class="nbb-title">GitLab Cloud-Push noch nicht verbunden</div>
          <div class="nbb-desc">Verbinde dieses Gerät mit 1 Tipp per <strong>GitLab OAuth (Face ID / Touch ID)</strong>, damit Alarme &amp; Morgen-Briefing zuverlässig im Sperrbildschirm ankommen.</div>
          <div class="nbb-actions">
            <button type="button" class="action-btn action-btn-primary nbb-connect-btn" id="nbb-quick-oauth-btn">🦊 Mit GitLab verbinden</button>
          </div>
        </div>
      `;
      const quickBtn = document.getElementById('nbb-quick-oauth-btn');
      if (quickBtn) {
        quickBtn.addEventListener('click', async () => {
          const clientId = (currentGitLab.clientId || DEFAULT_GITLAB_OAUTH.clientId || '').trim();
          const projectId = getEffectiveProjectId();
          if (!clientId || !projectId) {
            const devAcc = document.getElementById('notif-section-gitlab');
            if (devAcc) {
              devAcc.open = true;
              devAcc.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            const projField = document.getElementById('notif-gitlab-project');
            if (projField && !projectId) projField.focus();
            else {
              const cidField = document.getElementById('notif-gitlab-client-id');
              if (cidField) cidField.focus();
            }
            return;
          }
          try {
            await startGitLabOAuthLogin();
          } catch (err) {
            alert(err.message);
          }
        });
      }
    } else {
      const modeText = authMode === 'oauth' ? 'GitLab OAuth 2.0 PKCE' : 'GitLab REST API';
      backendBanner.style.display = 'flex';
      backendBanner.className = 'notif-backend-banner is-connected';
      backendBanner.innerHTML = `
        <span class="nbb-icon" aria-hidden="true">🟢</span>
        <div class="nbb-content">
          <div class="nbb-title">${modeText} verbunden &amp; aktiv</div>
          <div class="nbb-desc">Dieses Gerät synchronisiert automatisch unter seiner eigenen anonymen UUID inkl. aktivem GitLab Zeitplan.</div>
        </div>
      `;
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

function populateNotificationFormFromState() {
  const elWind = document.getElementById('notif-rule-wind');
  const elWindVal = document.getElementById('notif-rule-wind-val');
  const elFrost = document.getElementById('notif-rule-frost');
  const elBriefing = document.getElementById('notif-rule-briefing');
  const elBriefingTime = document.getElementById('notif-rule-briefing-time');
  const elSevere = document.getElementById('notif-rule-severe');

  const elHost = document.getElementById('notif-gitlab-host');
  const elClientId = document.getElementById('notif-gitlab-client-id');
  const elProject = document.getElementById('notif-gitlab-project');
  const elToken = document.getElementById('notif-gitlab-token');
  const elSchedule = document.getElementById('notif-gitlab-schedule');

  if (elWind) elWind.checked = Boolean(currentConfig.windAlert);
  if (elWindVal) elWindVal.value = String(currentConfig.windThreshold || 60);
  if (elFrost) elFrost.checked = Boolean(currentConfig.frostAlert);
  if (elBriefing) elBriefing.checked = Boolean(currentConfig.briefingAlert);
  if (elBriefingTime) elBriefingTime.value = currentConfig.briefingTime || '07:00';
  if (elSevere) elSevere.checked = Boolean(currentConfig.severeAlert);

  const effectiveProject = getEffectiveProjectId();
  if (elHost) elHost.value = currentGitLab.host || 'https://gitlab.com';
  if (elClientId) elClientId.value = currentGitLab.clientId || DEFAULT_GITLAB_OAUTH.clientId || '';
  if (elProject) {
    elProject.value = currentGitLab.projectId || DEFAULT_GITLAB_OAUTH.projectId || '';
    if (!elProject.value && effectiveProject) {
      elProject.placeholder = `${effectiveProject} (automatisch erkannt)`;
    }
  }
  if (elToken) elToken.value = currentGitLab.token || '';
  if (elSchedule) elSchedule.value = currentGitLab.schedulePreset || 'eco';
}

function getFormSnapshot() {
  const elWind = document.getElementById('notif-rule-wind');
  const elWindVal = document.getElementById('notif-rule-wind-val');
  const elFrost = document.getElementById('notif-rule-frost');
  const elBriefing = document.getElementById('notif-rule-briefing');
  const elBriefingTime = document.getElementById('notif-rule-briefing-time');
  const elSevere = document.getElementById('notif-rule-severe');

  const elHost = document.getElementById('notif-gitlab-host');
  const elClientId = document.getElementById('notif-gitlab-client-id');
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
    clientId: elClientId ? elClientId.value.trim() : (currentGitLab.clientId || ''),
    projectId: elProject ? elProject.value.trim() : (currentGitLab.projectId || ''),
    token: elToken ? elToken.value.trim() : (currentGitLab.token || ''),
    schedulePreset: elSchedule ? elSchedule.value : (currentGitLab.schedulePreset || 'eco')
  });
}

export function hasUnsavedChanges() {
  if (savedFormSnapshot === null) return false;
  return getFormSnapshot() !== savedFormSnapshot;
}

function updateUnsavedIndicator() {
  const saveBtn = document.getElementById('notif-save-sync-btn');
  if (!saveBtn) return;
  saveBtn.classList.toggle('has-unsaved', hasUnsavedChanges());
}

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
 * Speichert alle Formularänderungen persistent + auto-provisioniert GitLab Device-Variable & Schedule
 */
async function persistNotificationForm() {
  readFormValues();
  saveNotificationState();
  savedFormSnapshot = getFormSnapshot();
  updateUnsavedIndicator();

  if (getGitLabAuthMode() !== 'disconnected') {
    const res = await syncAndProvisionGitLab();
    return { synced: res.synced, mode: getGitLabAuthMode() };
  }

  currentGitLab.lastSyncStatus = 'Nur lokal gespeichert — bitte mit GitLab verbinden';
  currentGitLab.lastSyncAt = 0;
  saveNotificationState();
  updateUIElements();
  return { synced: false, mode: 'local-only' };
}

function discardNotificationChanges() {
  loadNotificationState();
  populateNotificationFormFromState();
  updateUIElements();
  savedFormSnapshot = getFormSnapshot();
  updateUnsavedIndicator();
}

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

function readFormValues() {
  const elWind = document.getElementById('notif-rule-wind');
  const elWindVal = document.getElementById('notif-rule-wind-val');
  const elFrost = document.getElementById('notif-rule-frost');
  const elBriefing = document.getElementById('notif-rule-briefing');
  const elBriefingTime = document.getElementById('notif-rule-briefing-time');
  const elSevere = document.getElementById('notif-rule-severe');

  const elHost = document.getElementById('notif-gitlab-host');
  const elClientId = document.getElementById('notif-gitlab-client-id');
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
  if (elClientId) currentGitLab.clientId = elClientId.value.trim();
  if (elProject) currentGitLab.projectId = elProject.value.trim();
  if (elToken) currentGitLab.token = elToken.value.trim();
  if (elSchedule) currentGitLab.schedulePreset = elSchedule.value;
}

// =============================================================================
// INITIALIZATION & EVENT LISTENERS
// =============================================================================

export function initNotifications() {
  loadNotificationState();
  updateUIElements();

  // Prüfe automatisch, ob gerade ein GitLab OAuth 2.0 PKCE Callback (?code=...&state=...) eingetroffen ist
  handleGitLabOAuthCallback()
    .then(res => {
      if (res && res.handled && res.ok) {
        openNotificationModal();
      } else if (res && res.handled && res.error) {
        alert('GitLab-Anmeldung: ' + res.error);
      }
    })
    .catch(err => {
      console.error('OAuth Callback Fehler:', err);
      alert('GitLab OAuth-Fehler: ' + err.message);
    });

  // Header Icon Button
  const headerBtn = document.getElementById('notif-settings-btn');
  if (headerBtn) {
    headerBtn.addEventListener('click', () => openNotificationModal());
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
    unsavedCancelBtn.addEventListener('click', () => closeUnsavedChangesDialog());
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

  // OAuth Connect / Disconnect / Copy Redirect URI Buttons
  const oauthConnectBtn = document.getElementById('notif-gitlab-oauth-btn');
  if (oauthConnectBtn) {
    oauthConnectBtn.addEventListener('click', async () => {
      try {
        await startGitLabOAuthLogin();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  const oauthDisconnectBtn = document.getElementById('notif-gitlab-disconnect-btn');
  if (oauthDisconnectBtn) {
    oauthDisconnectBtn.addEventListener('click', () => {
      disconnectGitLabOAuth();
    });
  }

  const copyRedirectBtn = document.getElementById('notif-copy-redirect-btn');
  if (copyRedirectBtn) {
    copyRedirectBtn.addEventListener('click', async () => {
      const uri = getOAuthRedirectUri();
      try {
        await navigator.clipboard.writeText(uri);
        copyRedirectBtn.innerText = '✓ Kopiert';
        setTimeout(() => { copyRedirectBtn.innerText = '📋 Kopieren'; }, 1800);
      } catch {
        prompt('Redirect URI kopieren:', uri);
      }
    });
  }

  // Test Push Button (Echter 15s GitLab -> Apple APNs E2E Test wenn verbunden, sonst lokaler Test)
  const testBtn = document.getElementById('notif-test-btn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.innerText = '⏳ Sende Test...';
      try {
        readFormValues();
        if (getGitLabAuthMode() !== 'disconnected' && currentSubscription?.endpoint) {
          const res = await triggerGitLabTestPush();
          testBtn.innerText = `✓ GitLab Push #${res.pipelineId || ''} (~15s)`;
        } else {
          await sendLocalTestPush();
          testBtn.innerText = '✓ Lokaler Test gesendet!';
        }
        setTimeout(() => {
          testBtn.disabled = false;
          testBtn.innerText = '🧪 Test-Push senden';
        }, 3000);
      } catch (err) {
        alert('Test-Push fehlgeschlagen: ' + err.message);
        testBtn.disabled = false;
        testBtn.innerText = '🧪 Test-Push senden';
      }
    });
  }

  // Save & Auto-Provision Button
  const saveSyncBtn = document.getElementById('notif-save-sync-btn');
  if (saveSyncBtn) {
    saveSyncBtn.addEventListener('click', async () => {
      saveSyncBtn.disabled = true;
      saveSyncBtn.innerText = '⏳ Speichere...';

      try {
        const res = await persistNotificationForm();
        saveSyncBtn.innerText = res.synced ? '✓ Gesichert & mit GitLab synchronisiert!' : '✓ Lokal gesichert (GitLab nicht verbunden)';
        setTimeout(() => {
          saveSyncBtn.disabled = false;
          saveSyncBtn.innerText = '✓ Einstellungen sichern';
        }, 2500);
      } catch (err) {
        console.warn('GitLab Sync Fehler:', err.message);
        alert('GitLab Sync-Fehler: ' + err.message);
        saveSyncBtn.disabled = false;
        saveSyncBtn.innerText = '✓ Einstellungen sichern';
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
        alert(`GitLab Pipeline-Schedule aktiv!\n\nIntervall: ${result.preset.name}\nCron: ${result.preset.cron}\nZeitzone: ${result.timezone}`);
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
    'notif-rule-severe', 'notif-gitlab-host', 'notif-gitlab-client-id', 'notif-gitlab-project', 'notif-gitlab-token'
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

  // Service Worker Messages
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

// Global Bindings für Tests & Integration
window.openNotificationModal = openNotificationModal;
window.closeNotificationModal = closeNotificationModal;
window.hasUnsavedNotificationChanges = hasUnsavedChanges;
window.getEffectiveProjectId = getEffectiveProjectId;
window.getGitLabAuthMode = getGitLabAuthMode;
window.getActiveBackendMode = getActiveBackendMode;
window.getPushDeviceUuid = getOrCreateDeviceUuid;
window.getPushDeviceVariableKey = () => getDeviceVariableKey(getOrCreateDeviceUuid());
window.buildDeviceSyncPayload = buildDeviceSyncPayload;
window.startGitLabOAuthLogin = startGitLabOAuthLogin;
window.disconnectGitLabOAuth = disconnectGitLabOAuth;
window.computePkceChallenge = computePkceChallenge;
window.generatePkceVerifier = generatePkceVerifier;
window.getOAuthRedirectUri = getOAuthRedirectUri;
window.deleteDeviceFromGitLab = deleteDeviceFromGitLab;
window.triggerGitLabTestPush = triggerGitLabTestPush;
window.enablePushNotifications = enablePushNotifications;
window.disablePushNotifications = disablePushNotifications;
window.sendLocalTestPush = sendLocalTestPush;
window.syncToGitLab = syncToGitLab;
window.syncAndProvisionGitLab = syncAndProvisionGitLab;
window.createOrUpdateGitLabSchedule = createOrUpdateGitLabSchedule;
window.SCHEDULE_PRESETS = SCHEDULE_PRESETS;
