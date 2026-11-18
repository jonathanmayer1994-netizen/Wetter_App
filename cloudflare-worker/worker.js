/**
 * BEST WEATHER — Native Edge Web Push Worker (Cloudflare Workers + KV + Cron)
 * Zero-Dependency RFC 8291 (aes128gcm) + RFC 8292 (VAPID ES256) Web Push Engine
 * for Apple APNs (iOS 16.4+ Lock Screen, iPadOS, macOS Notification Center).
 *
 * Privacy-First Architecture:
 * - Devices are identified EXCLUSIVELY by a client-generated anonymous RFC 4122 UUID v4.
 * - Zero device metadata (no User-Agent, no model, no OS, no IP stored).
 * - Strict field allowlist on PUT /api/devices/:uuid.
 * - Deduplicated Open-Meteo fetches per coordinate on 15-minute Cron Triggers.
 */

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_VAPID_PUBLIC_KEY = 'BFXeGAET8G6YxsiL0HvXELcaDIoZyeIgPYokZuqpueq3NFJs8xG7KsyvViif44MAxMkBI_OQ93OXewHGRhMSOmI';

const WMO_DESCRIPTIONS = {
  0: 'Klarer Himmel', 1: 'Überwiegend klar', 2: 'Teilweise bewölkt', 3: 'Bedeckt',
  45: 'Nebel', 48: 'Raureifnebel', 51: 'Leichter Nieselregen', 53: 'Mäßiger Nieselregen',
  55: 'Dichter Nieselregen', 56: 'Gefrierender Nieselregen', 57: 'Dichter gefrierender Nieselregen',
  61: 'Leichter Regen', 63: 'Mäßiger Regen', 65: 'Starker Regen',
  66: 'Leichter gefrierender Regen', 67: 'Starker gefrierender Regen',
  71: 'Leichter Schneefall', 73: 'Mäßiger Schneefall', 75: 'Starker Schneefall', 77: 'Schneegriesel',
  80: 'Leichte Regenschauer', 81: 'Mäßige Regenschauer', 82: 'Heftige Regenschauer',
  85: 'Leichte Schneeschauer', 86: 'Starke Schneeschauer',
  95: 'Gewitter', 96: 'Gewitter mit leichtem Hagel', 99: 'Schweres Unwetter mit Hagel'
};

// =============================================================================
// CRYPTO HELPERS (Base64URL, HKDF, RFC 8291 aes128gcm, RFC 8292 VAPID ES256)
// =============================================================================

export function base64UrlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str) {
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}

async function hkdf(salt, ikm, info, length) {
  const prk = await hmacSha256(salt, ikm);
  const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
  const t1 = await hmacSha256(prk, concatBytes(infoBytes, new Uint8Array([1])));
  return t1.slice(0, length);
}

/**
 * RFC 8291 / RFC 8188 Web Push Payload Encryption (aes128gcm)
 */
export async function encryptWebPushPayload(subscription, payloadObj) {
  const uaPublicBytes = base64UrlDecode(subscription.keys.p256dh);
  const authSecret = base64UrlDecode(subscription.keys.auth);
  const plaintext = new TextEncoder().encode(typeof payloadObj === 'string' ? payloadObj : JSON.stringify(payloadObj));

  // Ephemeral server P-256 keypair
  const serverKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey));
  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // ECDH shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, serverKeyPair.privateKey, 256));

  // RFC 8291 Key Derivation
  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info\0'), uaPublicBytes, asPublicBytes);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = await hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12);

  // AES-128-GCM Encrypt with RFC 8188 final record delimiter 0x02
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concatBytes(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  // RFC 8188 Header: salt (16) || rs (4, BE=4096) || idlen (1=65) || asPublicBytes (65)
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, rsBytes, new Uint8Array([asPublicBytes.length]), asPublicBytes);

  return concatBytes(header, ciphertext);
}

/**
 * RFC 8292 VAPID ES256 Authorization Header
 */
export async function createVapidJwt(endpoint, vapidPublicKeyB64, vapidPrivateKeyB64, subject = 'mailto:push@best-weather.app') {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claimsB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ aud, exp, sub: subject })));
  const signingInput = `${headerB64}.${claimsB64}`;

  const pubBytes = base64UrlDecode(vapidPublicKeyB64);
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) {
    throw new Error('Ungültiger VAPID Public Key (erwartet 65-Byte uncompressed P-256)');
  }
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(pubBytes.slice(1, 33)),
    y: base64UrlEncode(pubBytes.slice(33, 65)),
    d: vapidPrivateKeyB64
  };

  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(signingInput)));
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

/**
 * Sendet einen echten signierten & verschlüsselten Web Push an Apple APNs / FCM
 */
export async function sendWebPush(subscription, payloadObj, env, urgency = 'high') {
  const pubKey = env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;
  const privKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT || 'mailto:push@best-weather.app';

  if (!privKey) {
    throw new Error('VAPID_PRIVATE_KEY Secret ist im Cloudflare Worker nicht konfiguriert.');
  }

  const body = await encryptWebPushPayload(subscription, payloadObj);
  const jwt = await createVapidJwt(subscription.endpoint, pubKey, privKey, subject);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Urgency': urgency,
      'Authorization': `vapid t=${jwt}, k=${pubKey}`
    },
    body
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err = new Error(`APNs/Push Gateway HTTP ${res.status}: ${errText || res.statusText}`);
    err.statusCode = res.status;
    throw err;
  }

  return { ok: true, statusCode: res.status };
}

// =============================================================================
// PRIVACY-FIRST SANITIZATION & WEATHER EVALUATION
// =============================================================================

function sanitizeDevicePayload(uuid, raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Ungültiges JSON-Payload');
  const sub = raw.subscription && typeof raw.subscription === 'object' && typeof raw.subscription.endpoint === 'string'
    && raw.subscription.keys?.p256dh && raw.subscription.keys?.auth
    ? {
        endpoint: raw.subscription.endpoint,
        keys: { p256dh: String(raw.subscription.keys.p256dh), auth: String(raw.subscription.keys.auth) }
      }
    : null;

  const r = raw.rules || {};
  const l = raw.location || {};

  // Strikte Allowlist: KEINERLEI Geräteinformationen werden akzeptiert oder gespeichert!
  return {
    schemaVersion: 2,
    deviceId: uuid.toLowerCase(),
    enabled: raw.enabled !== false,
    subscription: sub,
    rules: {
      windAlert: Boolean(r.windAlert ?? true),
      windThreshold: Number(r.windThreshold) || 60,
      frostAlert: Boolean(r.frostAlert ?? true),
      frostThreshold: r.frostThreshold !== undefined ? Number(r.frostThreshold) : 0,
      briefingAlert: Boolean(r.briefingAlert ?? true),
      briefingTime: /^\d{2}:\d{2}$/.test(String(r.briefingTime || '')) ? String(r.briefingTime) : '07:00',
      severeAlert: Boolean(r.severeAlert ?? true),
      quietHoursStart: r.quietHoursStart !== undefined ? Number(r.quietHoursStart) : 22,
      quietHoursEnd: r.quietHoursEnd !== undefined ? Number(r.quietHoursEnd) : 6,
      bypassQuietHoursOnSevere: r.bypassQuietHoursOnSevere !== false
    },
    location: {
      name: String(l.name || 'München').slice(0, 80),
      lat: Number.isFinite(Number(l.lat)) ? Number(l.lat) : 48.137,
      lon: Number.isFinite(Number(l.lon)) ? Number(l.lon) : 11.575,
      elevation: Number.isFinite(Number(l.elevation)) ? Number(l.elevation) : 520,
      timezone: String(l.timezone || 'Europe/Berlin').slice(0, 60)
    },
    updatedAt: new Date().toISOString()
  };
}

function getLocalTimeInfo(tz, quietStart = 22, quietEnd = 6, now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = formatter.formatToParts(now);
  const get = (t) => parts.find(p => p.type === t)?.value;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(get('minute'), 10);
  const dateString = `${get('year')}-${get('month')}-${get('day')}`;
  const isQuietHours = quietStart > quietEnd
    ? (hour >= quietStart || hour < quietEnd)
    : (quietStart < quietEnd && hour >= quietStart && hour < quietEnd);
  return { tz, hour, minute, dateString, isQuietHours };
}

function evaluateDeviceAlerts(device, weather, state, timeInfo, nowMs) {
  const alerts = [];
  const rules = device.rules || {};
  const locName = device.location?.name || 'Dein Standort';
  const cur = weather.current || {};
  const hourly = weather.hourly || {};
  const daily = weather.daily || {};
  const h = timeInfo.hour;

  // 1. Morgen-Briefing (90-Minuten Toleranzfenster, 1x pro Tag)
  if (rules.briefingAlert) {
    const [th, tm] = String(rules.briefingTime || '07:00').split(':').map(n => parseInt(n, 10) || 0);
    const targetMin = th * 60 + tm;
    const nowMin = h * 60 + timeInfo.minute;
    if (nowMin >= targetMin && nowMin <= targetMin + 90 && state.lastBriefingDate !== timeInfo.dateString) {
      const code = daily.weather_code?.[0] ?? cur.weather_code ?? 0;
      const desc = WMO_DESCRIPTIONS[code] || 'Wechselhaft';
      const maxT = Math.round(daily.temperature_2m_max?.[0] ?? 15);
      const minT = Math.round(daily.temperature_2m_min?.[0] ?? 5);
      const pop = daily.precipitation_probability_max?.[0] ?? 0;
      alerts.push({
        type: 'briefing',
        title: `☀️ Guten Morgen aus ${locName}`,
        body: `Heute: ${desc} • ${minT}° bis ${maxT}° • Regenrisiko ${pop}%`,
        tag: `briefing-${timeInfo.dateString}`,
        data: { url: './', tab: 'tab-overview', type: 'briefing' }
      });
      state.lastBriefingDate = timeInfo.dateString;
    }
  }

  // 2. Akute Unwetter (WMO 95, 96, 99)
  let hasSevere = false;
  if (rules.severeAlert) {
    const nextCodes = (hourly.weather_code || []).slice(h, h + 3);
    const isSevere = [95, 96, 99].includes(cur.weather_code) || nextCodes.some(c => [95, 96, 99].includes(c));
    if (isSevere && (nowMs - (state.lastSevereAlertAt || 0)) >= 60 * 60 * 1000) {
      alerts.push({
        type: 'severe',
        title: `⚡ Akute Unwetterwarnung für ${locName}`,
        body: `Gewitter mit potentiellem Hagel oder Starkregen im Anzug! Bitte Schutz suchen.`,
        tag: `severe-${timeInfo.dateString}-${h}`,
        requireInteraction: true,
        data: { url: './', tab: 'tab-map', type: 'severe' }
      });
      state.lastSevereAlertAt = nowMs;
      hasSevere = true;
    }
  }

  // 3. Sturm & Böen
  if (rules.windAlert && !hasSevere) {
    const threshold = rules.windThreshold || 60;
    const nextGusts = (hourly.wind_gusts_10m || []).slice(h, h + 4);
    const maxGust = Math.round(Math.max(cur.wind_gusts_10m || 0, ...nextGusts));
    const cdActive = (nowMs - (state.lastWindAlertAt || 0)) < 3 * 60 * 60 * 1000;
    if (maxGust >= threshold && (!cdActive || maxGust >= (state.lastWindMax || 0) + 15)) {
      alerts.push({
        type: 'wind',
        title: `💨 Sturm- & Böenwarnung (${maxGust} km/h)`,
        body: `In ${locName} werden Böen bis ${maxGust} km/h erwartet (Schwelle: >${threshold} km/h).`,
        tag: `wind-${timeInfo.dateString}-${Math.floor(h / 3)}`,
        data: { url: './', tab: 'tab-map', type: 'wind' }
      });
      state.lastWindAlertAt = nowMs;
      state.lastWindMax = maxGust;
    }
  }

  // 4. Frost & Glätte
  if (rules.frostAlert && !hasSevere) {
    const nextTemps = (hourly.temperature_2m || []).slice(h, h + 6);
    const minTemp = Math.min(cur.temperature_2m ?? 99, ...nextTemps);
    const cdActive = (nowMs - (state.lastFrostAlertAt || 0)) < 6 * 60 * 60 * 1000;
    if (minTemp <= (rules.frostThreshold || 0) && (cur.temperature_2m ?? 99) > 1 && !cdActive) {
      alerts.push({
        type: 'frost',
        title: `❄️ Frost- & Glättewarnung`,
        body: `Temperaturen fallen in ${locName} auf ${minTemp.toFixed(1)}°C. Glättegefahr!`,
        tag: `frost-${timeInfo.dateString}-${Math.floor(h / 6)}`,
        data: { url: './', tab: 'tab-overview', type: 'frost' }
      });
      state.lastFrostAlertAt = nowMs;
    }
  }

  return alerts;
}

// =============================================================================
// CORS & HTTP HANDLER + CRON SCHEDULER
// =============================================================================

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

function jsonResponse(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({
        ok: true,
        service: 'best-weather-push',
        version: '2.32.0',
        vapidConfigured: Boolean(env.VAPID_PRIVATE_KEY),
        kvConfigured: Boolean(env.PUSH_KV)
      }, 200, origin);
    }

    const deviceMatch = url.pathname.match(/^\/api\/devices\/([0-9a-f-]+)(\/test)?$/i);
    if (!deviceMatch) {
      return jsonResponse({ error: 'Not Found' }, 404, origin);
    }

    const uuid = deviceMatch[1].toLowerCase();
    const isTestAction = Boolean(deviceMatch[2]);
    if (!UUID_V4_REGEX.test(uuid)) {
      return jsonResponse({ error: 'Ungültige anonyme UUID v4' }, 400, origin);
    }

    if (!env.PUSH_KV) {
      return jsonResponse({ error: 'PUSH_KV Binding fehlt im Worker' }, 500, origin);
    }

    // PUT /api/devices/:uuid -> Anonymes Geräte-Profil speichern
    if (request.method === 'PUT' && !isTestAction) {
      try {
        const raw = await request.json();
        const sanitized = sanitizeDevicePayload(uuid, raw);
        await env.PUSH_KV.put(`dev:${uuid}`, JSON.stringify(sanitized));
        return jsonResponse({ ok: true, deviceId: uuid, updatedAt: sanitized.updatedAt }, 200, origin);
      } catch (err) {
        return jsonResponse({ error: err.message }, 400, origin);
      }
    }

    // DELETE /api/devices/:uuid -> Nur dieses eine Gerät entfernen
    if (request.method === 'DELETE' && !isTestAction) {
      await env.PUSH_KV.delete(`dev:${uuid}`);
      await env.PUSH_KV.delete(`state:${uuid}`);
      return jsonResponse({ ok: true, deleted: uuid }, 200, origin);
    }

    // POST /api/devices/:uuid/test -> Sofortiger echter E2E Apple APNs Push vom Server!
    if (request.method === 'POST' && isTestAction) {
      const stored = await env.PUSH_KV.get(`dev:${uuid}`, 'json');
      if (!stored || !stored.subscription?.endpoint) {
        return jsonResponse({ error: 'Gerät nicht registriert oder keine aktive Push-Subscription gespeichert.' }, 404, origin);
      }
      try {
        const result = await sendWebPush(stored.subscription, {
          title: '🔔 Best Weather — Cloud-Push aktiv!',
          body: `Echter Server-Push über Apple APNs an ${stored.location?.name || 'deinen Standort'} (ID ${uuid.slice(0, 8)}…) erfolgreich zugestellt.`,
          tag: 'best-weather-e2e-test',
          data: { url: './', tab: 'tab-overview', type: 'test' }
        }, env, 'high');
        return jsonResponse({ ok: true, statusCode: result.statusCode }, 200, origin);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await env.PUSH_KV.delete(`dev:${uuid}`);
        }
        return jsonResponse({ error: err.message, statusCode: err.statusCode || 500 }, 502, origin);
      }
    }

    return jsonResponse({ error: 'Method Not Allowed' }, 405, origin);
  },

  async scheduled(event, env) {
    if (!env.PUSH_KV || !env.VAPID_PRIVATE_KEY) {
      console.error('Worker nicht vollständig konfiguriert (PUSH_KV oder VAPID_PRIVATE_KEY fehlt).');
      return;
    }

    const now = new Date();
    const nowMs = now.getTime();
    const weatherCache = new Map();

    // Alle anonymen dev:<uuid> Einträge aus KV laden (paginiert)
    let cursor;
    const keys = [];
    do {
      const list = await env.PUSH_KV.list({ prefix: 'dev:', cursor });
      keys.push(...list.keys);
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    for (const k of keys) {
      const device = await env.PUSH_KV.get(k.name, 'json');
      if (!device || !device.enabled || !device.subscription?.endpoint) continue;

      const uuid = device.deviceId;
      const loc = device.location || { name: 'München', lat: 48.137, lon: 11.575, timezone: 'Europe/Berlin' };
      const cacheKey = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)},${loc.timezone}`;

      let weather = weatherCache.get(cacheKey);
      if (!weather) {
        try {
          const tzParam = encodeURIComponent(loc.timezone || 'auto');
          const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,weather_code,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${tzParam}&forecast_days=2`;
          const res = await fetch(apiUrl, { headers: { 'User-Agent': 'BestWeather-EdgePush/2.32.0' } });
          if (!res.ok) continue;
          weather = await res.json();
          weatherCache.set(cacheKey, weather);
        } catch {
          continue;
        }
      }

      const timeInfo = getLocalTimeInfo(weather.timezone || loc.timezone, device.rules?.quietHoursStart ?? 22, device.rules?.quietHoursEnd ?? 6, now);
      if (timeInfo.isQuietHours) {
        const isExtreme = weather.current?.weather_code === 99 || (weather.current?.wind_gusts_10m || 0) >= 105;
        if (!(isExtreme && device.rules?.bypassQuietHoursOnSevere)) continue;
      }

      const stateKey = `state:${uuid}`;
      const devState = (await env.PUSH_KV.get(stateKey, 'json')) || {};
      const alerts = evaluateDeviceAlerts(device, weather, devState, timeInfo, nowMs);
      if (alerts.length === 0) continue;

      let stateChanged = false;
      for (const alert of alerts) {
        try {
          await sendWebPush(device.subscription, alert, env, alert.type === 'severe' ? 'high' : 'normal');
          stateChanged = true;
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await env.PUSH_KV.delete(k.name);
            await env.PUSH_KV.delete(stateKey);
            stateChanged = false;
            break;
          }
        }
      }

      if (stateChanged) {
        await env.PUSH_KV.put(stateKey, JSON.stringify(devState));
      }
    }
  }
};
