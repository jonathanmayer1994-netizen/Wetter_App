/**
 * BEST WEATHER — Notification Storage & History Engine (24h Retention)
 * Shared IndexedDB Store across Service Worker (Background Push) and PWA UI Window.
 */

const DB_NAME = 'best-weather-db';
const DB_VERSION = 1;
const STORE_NAME = 'notifications';
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 Stunden

/**
 * Öffnet die IndexedDB mit Migration & ObjectStore Erstellung
 */
export function openNotifDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB wird von diesem Browser nicht unterstützt'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('read', 'read', { unique: false });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Bereinigt alte Mitteilungen (> 24h)
 */
async function pruneOldRecords(db) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const cutoff = Date.now() - RETENTION_MS;
      const range = IDBKeyRange.upperBound(cutoff);
      const req = index.openCursor(range);
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => resolve();
    } catch (_) {
      resolve();
    }
  });
}

/**
 * Speichert eine empfangene Mitteilung (Push oder lokaler Test)
 */
export async function saveNotification(entry) {
  try {
    const db = await openNotifDB();
    await pruneOldRecords(db);

    const record = {
      id: entry.id || `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: String(entry.title || 'Wetter-Benachrichtigung'),
      body: String(entry.body || ''),
      icon: entry.icon || './icon-192.png',
      badge: entry.badge || './favicon.png',
      tag: entry.tag || 'best-weather-alert',
      type: entry.type || 'alert',
      data: entry.data || {},
      timestamp: Number(entry.timestamp || Date.now()),
      read: Boolean(entry.read)
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve();
      putReq.onerror = (e) => reject(e.target.error);
    });

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('best-weather:notif-updated', { detail: { record } }));
    }
    return record;
  } catch (err) {
    console.warn('[NotificationStore] Speichern fehlgeschlagen:', err);
    return null;
  }
}

/**
 * Liefert alle Benachrichtigungen der letzten 24 Stunden, absteigend nach Zeit sortiert
 */
export async function getNotifications() {
  try {
    const db = await openNotifDB();
    await pruneOldRecords(db);

    return new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const list = req.result || [];
        const cutoff = Date.now() - RETENTION_MS;
        const valid = list
          .filter((item) => item.timestamp >= cutoff)
          .sort((a, b) => b.timestamp - a.timestamp);
        resolve(valid);
      };
      req.onerror = () => resolve([]);
    });
  } catch (err) {
    console.warn('[NotificationStore] Lesen fehlgeschlagen:', err);
    return [];
  }
}

/**
 * Markiert eine Nachricht als gelesen
 */
export async function markNotificationAsRead(id) {
  if (!id) return;
  try {
    const db = await openNotifDB();
    await new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.read = true;
          store.put(item);
        }
        resolve();
      };
      getReq.onerror = () => resolve();
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('best-weather:notif-updated'));
    }
  } catch (_) {}
}

/**
 * Markiert alle Nachrichten als gelesen
 */
export async function markAllNotificationsAsRead() {
  try {
    const db = await openNotifDB();
    await new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const item = cursor.value;
          if (!item.read) {
            item.read = true;
            cursor.update(item);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => resolve();
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('best-weather:notif-updated'));
    }
  } catch (_) {}
}

/**
 * Löscht die gesamte Historie
 */
export async function clearAllNotifications() {
  try {
    const db = await openNotifDB();
    await new Promise((resolve) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('best-weather:notif-updated'));
    }
  } catch (_) {}
}

/**
 * Ermittelt die Anzahl ungelesener Nachrichten der letzten 24h
 */
export async function getUnreadNotificationCount() {
  const list = await getNotifications();
  return list.filter((n) => !n.read).length;
}

/**
 * Hilfsfunktion: Formatiert Zeitstempel lesbar auf Deutsch
 */
export function formatNotifRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 60) return 'Gerade eben';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min.`;

  const d = new Date(timestamp);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');

  const isToday = new Date().toDateString() === d.toDateString();
  if (isToday) {
    return `Heute, ${hours}:${minutes} Uhr`;
  }

  const yesterday = new Date(now - 86400000);
  const isYesterday = yesterday.toDateString() === d.toDateString();
  if (isYesterday) {
    return `Gestern, ${hours}:${minutes} Uhr`;
  }

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}., ${hours}:${minutes} Uhr`;
}

/**
 * Mapping für visuelle Badges je nach Benachrichtigungstyp
 */
export function getNotifTypeMeta(type = '', tag = '') {
  const norm = String(type || tag).toLowerCase();
  if (norm.includes('briefing') || norm.includes('morgen')) {
    return { label: 'Morgen-Briefing', icon: '☀️', className: 'nfc-type-briefing' };
  }
  if (norm.includes('storm') || norm.includes('sturm') || norm.includes('wind')) {
    return { label: 'Sturmwarnung', icon: '💨', className: 'nfc-type-storm' };
  }
  if (norm.includes('frost') || norm.includes('ice') || norm.includes('schnee')) {
    return { label: 'Frostwarnung', icon: '❄️', className: 'nfc-type-frost' };
  }
  if (norm.includes('extreme') || norm.includes('unwetter') || norm.includes('hazard')) {
    return { label: 'Extremwetter', icon: '⚡', className: 'nfc-type-extreme' };
  }
  if (norm.includes('test')) {
    return { label: 'Test-Push', icon: '🧪', className: 'nfc-type-test' };
  }
  return { label: 'Wetterwarnung', icon: '🔔', className: 'nfc-type-alert' };
}
