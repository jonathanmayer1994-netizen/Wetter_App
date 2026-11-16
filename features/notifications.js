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
  SUBSCRIPTION: 'bw_push_subscription'
};

const DEFAULT_CONFIG = {
  enabled: false,
  rainAlert: true,
  rainThreshold: 50, // %
  windAlert: true,
  windThreshold: 60, // km/h
  frostAlert: true,
  frostThreshold: 0, // °C
  briefingAlert: true,
  briefingTime: '07:00',
  severeAlert: true,
  locationMode: 'gps', // 'gps' | 'fixed'
  lastSyncAt: 0
};

const DEFAULT_GITLAB = {
  host: 'https://gitlab.com',
  projectId: '',
  token: '',
  variableKey: 'WEATHER_PUSH_CONFIG',
  lastSyncStatus: 'Bereit zur Synchronisation',
  lastSyncAt: 0
};

let currentConfig = { ...DEFAULT_CONFIG };
let currentGitLab = { ...DEFAULT_GITLAB };
let currentSubscription = null;

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
  return currentSubscription;
}

/**
 * Deaktiviert Push Notifications
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
 * Synchronisiert Einstellungen & Subscription via GitLab REST API (Option 1)
 */
export async function syncToGitLab() {
  const host = (currentGitLab.host || 'https://gitlab.com').trim().replace(/\/+$/, '');
  const projectId = (currentGitLab.projectId || '').trim();
  const token = (currentGitLab.token || '').trim();
  const varKey = (currentGitLab.variableKey || 'WEATHER_PUSH_CONFIG').trim();

  if (!projectId) {
    throw new Error('Bitte gib deine GitLab Projekt-ID oder den Projektpfad ein.');
  }

  const locationPayload = {
    name: state.currentLocation?.name || 'München',
    lat: state.currentLocation?.lat || 48.137,
    lon: state.currentLocation?.lon || 11.575,
    elevation: state.currentLocation?.elevation || 520
  };

  const configPayload = {
    subscription: currentSubscription,
    rules: {
      rainAlert: currentConfig.rainAlert,
      rainThreshold: currentConfig.rainThreshold,
      windAlert: currentConfig.windAlert,
      windThreshold: currentConfig.windThreshold,
      frostAlert: currentConfig.frostAlert,
      frostThreshold: currentConfig.frostThreshold,
      briefingAlert: currentConfig.briefingAlert,
      briefingTime: currentConfig.briefingTime,
      severeAlert: currentConfig.severeAlert,
      locationMode: currentConfig.locationMode
    },
    location: locationPayload,
    vapidPublicKey: DEFAULT_VAPID_PUBLIC_KEY,
    updatedAt: new Date().toISOString()
  };

  const payloadString = JSON.stringify(configPayload);

  // Ohne Token bieten wir bequemen Direkt-Download / Clipboard Export
  if (!token) {
    currentGitLab.lastSyncStatus = 'Konfiguration lokal bereitgestellt (Kein GitLab Token angegeben)';
    currentGitLab.lastSyncAt = Date.now();
    saveNotificationState();
    updateUIElements();
    return {
      mode: 'manual',
      json: payloadString,
      message: 'Lokale Konfiguration erstellt. Trage deinen GitLab Access Token ein, um sie direkt über die REST API zu übertragen.'
    };
  }

  const encodedId = encodeURIComponent(projectId);
  const variableUrl = `${host}/api/v4/projects/${encodedId}/variables/${encodeURIComponent(varKey)}`;

  // 1. Zuerst versuchen wir PUT (Aktualisieren der bestehenden Project Variable)
  let response = await fetch(variableUrl, {
    method: 'PUT',
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ value: payloadString })
  });

  // 2. Falls Variable noch nicht existiert (404), neu anlegen per POST
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

  return { mode: 'api', result, message: 'Erfolgreich in GitLab Project Variable gespeichert!' };
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
}

/**
 * Modal Öffnen & Schließen
 */
export function openNotificationModal() {
  loadNotificationState();
  const modal = document.getElementById('notif-modal-overlay');
  if (!modal) return;

  // Felder befüllen
  const elRain = document.getElementById('notif-rule-rain');
  const elWind = document.getElementById('notif-rule-wind');
  const elWindVal = document.getElementById('notif-rule-wind-val');
  const elFrost = document.getElementById('notif-rule-frost');
  const elBriefing = document.getElementById('notif-rule-briefing');
  const elBriefingTime = document.getElementById('notif-rule-briefing-time');
  const elSevere = document.getElementById('notif-rule-severe');

  const elHost = document.getElementById('notif-gitlab-host');
  const elProject = document.getElementById('notif-gitlab-project');
  const elToken = document.getElementById('notif-gitlab-token');

  if (elRain) elRain.checked = currentConfig.rainAlert;
  if (elWind) elWind.checked = currentConfig.windAlert;
  if (elWindVal) elWindVal.value = String(currentConfig.windThreshold || 60);
  if (elFrost) elFrost.checked = currentConfig.frostAlert;
  if (elBriefing) elBriefing.checked = currentConfig.briefingAlert;
  if (elBriefingTime) elBriefingTime.value = currentConfig.briefingTime || '07:00';
  if (elSevere) elSevere.checked = currentConfig.severeAlert;

  if (elHost) elHost.value = currentGitLab.host || 'https://gitlab.com';
  if (elProject) elProject.value = currentGitLab.projectId || '';
  if (elToken) elToken.value = currentGitLab.token || '';

  updateUIElements();
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
}

export function closeNotificationModal() {
  const modal = document.getElementById('notif-modal-overlay');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-open');
}

/**
 * Liest die Formulardaten aus
 */
function readFormValues() {
  const elRain = document.getElementById('notif-rule-rain');
  const elWind = document.getElementById('notif-rule-wind');
  const elWindVal = document.getElementById('notif-rule-wind-val');
  const elFrost = document.getElementById('notif-rule-frost');
  const elBriefing = document.getElementById('notif-rule-briefing');
  const elBriefingTime = document.getElementById('notif-rule-briefing-time');
  const elSevere = document.getElementById('notif-rule-severe');

  const elHost = document.getElementById('notif-gitlab-host');
  const elProject = document.getElementById('notif-gitlab-project');
  const elToken = document.getElementById('notif-gitlab-token');

  if (elRain) currentConfig.rainAlert = elRain.checked;
  if (elWind) currentConfig.windAlert = elWind.checked;
  if (elWindVal) currentConfig.windThreshold = parseInt(elWindVal.value, 10) || 60;
  if (elFrost) currentConfig.frostAlert = elFrost.checked;
  if (elBriefing) currentConfig.briefingAlert = elBriefing.checked;
  if (elBriefingTime) currentConfig.briefingTime = elBriefingTime.value || '07:00';
  if (elSevere) currentConfig.severeAlert = elSevere.checked;

  if (elHost) currentGitLab.host = elHost.value.trim();
  if (elProject) currentGitLab.projectId = elProject.value.trim();
  if (elToken) currentGitLab.token = elToken.value.trim();
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

  // Modal Close Buttons
  const closeBtn = document.getElementById('notif-modal-close');
  const closeBtnAction = document.getElementById('notif-modal-close-action');
  const overlay = document.getElementById('notif-modal-overlay');

  if (closeBtn) closeBtn.addEventListener('click', closeNotificationModal);
  if (closeBtnAction) closeBtnAction.addEventListener('click', closeNotificationModal);

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeNotificationModal();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') {
      closeNotificationModal();
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

  // Save & Sync Button
  const saveSyncBtn = document.getElementById('notif-save-sync-btn');
  if (saveSyncBtn) {
    saveSyncBtn.addEventListener('click', async () => {
      readFormValues();
      saveNotificationState();

      saveSyncBtn.disabled = true;
      saveSyncBtn.innerText = '⏳ Synchronisiere mit GitLab...';

      try {
        const res = await syncToGitLab();
        saveSyncBtn.innerText = '✓ Gespeichert & Synchronisiert!';
        if (res.mode === 'manual') {
          // Falls kein Token angegeben wurde, Option zum Kopieren
          navigator.clipboard?.writeText(res.json).catch(() => {});
          alert(res.message + '\n\nKonfigurations-JSON wurde in deine Zwischenablage kopiert!');
        }
        setTimeout(() => {
          saveSyncBtn.disabled = false;
          saveSyncBtn.innerText = '💾 Speichern & mit GitLab syncen';
        }, 2500);
      } catch (err) {
        alert('GitLab Sync fehlgeschlagen: ' + err.message);
        saveSyncBtn.disabled = false;
        saveSyncBtn.innerText = '💾 Speichern & mit GitLab syncen';
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
window.enablePushNotifications = enablePushNotifications;
window.disablePushNotifications = disablePushNotifications;
window.sendLocalTestPush = sendLocalTestPush;
window.syncToGitLab = syncToGitLab;
