#!/usr/bin/env node
/**
 * BEST WEATHER — Enterprise GitLab CI Push Notification Dispatcher
 * Runs as a Scheduled Pipeline (Option B: 06:00–22:00 active, 22:00–06:00 quiet hours).
 * Evaluates live weather via Open-Meteo with stateful anti-spam cooldowns and
 * dispatches Web Push notifications to Apple APNs (iOS / iPadOS / macOS) & Google FCM.
 */

import fs from 'node:fs';
import path from 'node:path';

// Standard VAPID Fallback Keys
const DEFAULT_VAPID_PUBLIC_KEY = 'BFXeGAET8G6YxsiL0HvXELcaDIoZyeIgPYokZuqpueq3NFJs8xG7KsyvViif44MAxMkBI_OQ93OXewHGRhMSOmI';
const DEFAULT_VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '16Ovl5NMFksNazSkQceNN5LVKUigugt_J3ZSA37fXXA';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:push@best-weather.app';
const STATE_FILE_PATH = path.resolve('.dispatcher-state.json');

// WMO Weather Codes Übersetzung
const WMO_DESCRIPTIONS = {
  0: 'Klarer Himmel',
  1: 'Überwiegend klar',
  2: 'Teilweise bewölkt',
  3: 'Bedeckt',
  45: 'Nebel',
  48: 'Raureifnebel',
  51: 'Leichter Nieselregen',
  53: 'Mäßiger Nieselregen',
  55: 'Dichter Nieselregen',
  56: 'Gefrierender Nieselregen',
  57: 'Dichter gefrierender Nieselregen',
  61: 'Leichter Regen',
  63: 'Mäßiger Regen',
  65: 'Starker Regen',
  66: 'Leichter gefrierender Regen',
  67: 'Starker gefrierender Regen',
  71: 'Leichter Schneefall',
  73: 'Mäßiger Schneefall',
  75: 'Starker Schneefall',
  77: 'Schneegriesel',
  80: 'Leichte Regenschauer',
  81: 'Mäßige Regenschauer',
  82: 'Heftige Regenschauer',
  85: 'Leichte Schneeschauer',
  86: 'Starke Schneeschauer',
  95: 'Gewitter',
  96: 'Gewitter mit leichtem Hagel',
  99: 'Schweres Unwetter mit Hagel'
};

/**
 * Lädt die persistierte Dispatcher-State-Datei (Anti-Spam & Cooldowns)
 */
function loadState() {
  if (process.env.WEATHER_PUSH_STATE) {
    try {
      return JSON.parse(process.env.WEATHER_PUSH_STATE);
    } catch {
      // Ignore env parse failure and fallback to file
    }
  }

  if (fs.existsSync(STATE_FILE_PATH)) {
    try {
      const data = fs.readFileSync(STATE_FILE_PATH, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.warn('⚠️ State-Datei beschädigt oder unlesbar, erstelle neuen State:', err.message);
    }
  }

  return {
    version: '2.30.0',
    lastRunAt: null,
    lastBriefingDate: null,
    lastRainAlertAt: 0,
    lastWindAlertAt: 0,
    lastWindMax: 0,
    lastFrostAlertAt: 0,
    lastSevereAlertAt: 0
  };
}

/**
 * Speichert den Dispatcher-State für nachfolgende Pipeline-Läufe
 */
function saveState(state) {
  try {
    state.lastRunAt = new Date().toISOString();
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf8');
    console.log('💾 Dispatcher-State erfolgreich persistiert (.dispatcher-state.json).');
  } catch (err) {
    console.warn('⚠️ Konnte State nicht auf Dateisystem schreiben:', err.message);
  }
}

/**
 * Lädt die Push-Konfiguration aus GitLab CI Variablen, Datei oder Parametern
 */
function loadPushConfig() {
  if (process.env.WEATHER_PUSH_CONFIG) {
    try {
      console.log('✓ Konfiguration aus Umgebungsvariable $WEATHER_PUSH_CONFIG geladen.');
      return JSON.parse(process.env.WEATHER_PUSH_CONFIG);
    } catch (err) {
      console.error('Fehler beim Parsen von $WEATHER_PUSH_CONFIG:', err.message);
    }
  }

  const localConfigPath = path.resolve('config/push-config.json');
  if (fs.existsSync(localConfigPath)) {
    try {
      const content = fs.readFileSync(localConfigPath, 'utf8');
      console.log(`✓ Konfiguration aus Datei ${localConfigPath} geladen.`);
      return JSON.parse(content);
    } catch (err) {
      console.error(`Fehler beim Lesen von ${localConfigPath}:`, err.message);
    }
  }

  console.log('ℹ️ Keine produktive $WEATHER_PUSH_CONFIG gefunden. Verwende Default-Konfiguration für Testlauf.');
  return {
    subscription: null,
    rules: {
      rainAlert: true,
      rainThreshold: 50,
      windAlert: true,
      windThreshold: 60,
      frostAlert: true,
      frostThreshold: 0,
      briefingAlert: true,
      briefingTime: '07:00',
      severeAlert: true,
      bypassQuietHoursOnSevere: true
    },
    location: {
      name: 'München',
      lat: 48.137,
      lon: 11.575,
      timezone: 'Europe/Berlin'
    }
  };
}

/**
 * Ermittelt die exakte lokale Uhrzeit und Ruhezeit-Informationen für die Zeitzone des Nutzers
 */
function getLocalTimeInfo(timeZoneName) {
  const tz = timeZoneName || 'Europe/Berlin';
  const now = new Date();

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
    const hour = parseInt(getPart('hour'), 10);
    const minute = parseInt(getPart('minute'), 10);
    const dateString = `${year}-${month}-${day}`;
    const formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    // Option B: Pause strikt zwischen 22:00 und 06:00 Uhr lokaler Zeit
    // 22:00:00 bis 05:59:59 ist Ruhezeit
    const isQuietHours = (hour >= 22 || hour < 6);

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
    const fallbackHour = (now.getUTCHours() + 1) % 24; // Default UTC+1
    return {
      tz: 'UTC+1',
      hour: fallbackHour,
      minute: now.getMinutes(),
      dateString: now.toISOString().slice(0, 10),
      formattedTime: `${String(fallbackHour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      isQuietHours: (fallbackHour >= 22 || fallbackHour < 6)
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
          'User-Agent': 'BestWeather-GitLabDispatcher/2.30.0',
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
 * Fragt Open-Meteo Wetterdaten für die hinterlegten Koordinaten ab
 */
async function fetchWeatherData(lat, lon, preferredTz) {
  const tzParam = encodeURIComponent(preferredTz || 'auto');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset&timezone=${tzParam}&forecast_days=2`;

  return await fetchWithRetry(url);
}

/**
 * Bewertet Wetterkriterien unter Berücksichtigung von State & Cooldowns
 */
function evaluateAlertRules(config, weather, state, timeInfo) {
  const alerts = [];
  const rules = config.rules || {};
  const locName = config.location?.name || 'Dein Standort';
  const nowMs = Date.now();

  const current = weather.current || {};
  const hourly = weather.hourly || {};
  const daily = weather.daily || {};
  const currentHour = timeInfo.hour;

  // 1. REGEL: Morgen-Briefing (Exakt 1x täglich zwischen 06:00 und 09:00 Uhr)
  if (rules.briefingAlert) {
    const targetHour = parseInt((rules.briefingTime || '07:00').split(':')[0], 10);
    const alreadySentToday = state.lastBriefingDate === timeInfo.dateString;

    if (currentHour === targetHour && !alreadySentToday) {
      const code = daily.weather_code?.[0] ?? current.weather_code ?? 0;
      const desc = WMO_DESCRIPTIONS[code] || 'Mäßig bewölkt';
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

  // 2. REGEL: Akute Unwetter- / Extremwetterwarnung (WMO 95, 96, 99)
  if (rules.severeAlert) {
    const curCode = current.weather_code;
    const nextCodes = (hourly.weather_code || []).slice(currentHour, currentHour + 3);
    const isSevere = [95, 96, 99].includes(curCode) || nextCodes.some(c => [95, 96, 99].includes(c));

    // Cooldown: Unwetter maximal 1x pro 60 Minuten wiederholen
    const severeCooldown = 60 * 60 * 1000;
    const isCooldownActive = (nowMs - (state.lastSevereAlertAt || 0)) < severeCooldown;

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
      state.lastSevereAlertAt = nowMs;
    }
  }

  // 3. REGEL: Regenalarm (Nowcasting: In den nächsten 60-90 Min setzt Regen ein)
  if (rules.rainAlert && alerts.length === 0) {
    const isCurrentlyRaining = (current.precipitation || 0) > 0.3;
    const nextHoursPrecip = (hourly.precipitation || []).slice(currentHour + 1, currentHour + 3);
    const nextHoursPop = (hourly.precipitation_probability || []).slice(currentHour + 1, currentHour + 3);
    const willRainSoon = nextHoursPrecip.some(p => p >= 0.3) || nextHoursPop.some(prob => prob >= (rules.rainThreshold || 50));

    // Cooldown: 3 Stunden (180 Minuten) zwischen Regenalarmen
    const rainCooldown = 3 * 60 * 60 * 1000;
    const isRainCooldownActive = (nowMs - (state.lastRainAlertAt || 0)) < rainCooldown;

    if (!isCurrentlyRaining && willRainSoon && !isRainCooldownActive) {
      const maxExpected = Math.max(...nextHoursPrecip, 0.5).toFixed(1);
      alerts.push({
        type: 'rain',
        title: `🌧️ Regenalarm für ${locName}`,
        body: `In Kürze setzt Niederschlag ein (~${maxExpected} mm erwartet). Schirm einpacken!`,
        tag: `rain-${timeInfo.dateString}-${Math.floor(currentHour / 3)}`,
        data: { url: './', tab: 'tab-map', type: 'rain' }
      });
      state.lastRainAlertAt = nowMs;
    }
  }

  // 4. REGEL: Sturm- & Böenwarnung
  if (rules.windAlert && alerts.length === 0) {
    const threshold = rules.windThreshold || 60;
    const nextGusts = (hourly.wind_gusts_10m || []).slice(currentHour, currentHour + 4);
    const maxGust = Math.round(Math.max(current.wind_gusts_10m || 0, ...nextGusts));

    // Cooldown: 3 Stunden, außer Böen nehmen um >= 15 km/h zu
    const windCooldown = 3 * 60 * 60 * 1000;
    const isWindCooldownActive = (nowMs - (state.lastWindAlertAt || 0)) < windCooldown;
    const isSignificantIncrease = maxGust >= ((state.lastWindMax || 0) + 15);

    if (maxGust >= threshold && (!isWindCooldownActive || isSignificantIncrease)) {
      alerts.push({
        type: 'wind',
        title: `💨 Sturm- & Böenwarnung (${maxGust} km/h)`,
        body: `In ${locName} werden stürmische Böen von bis zu ${maxGust} km/h erwartet (Schwelle: >${threshold} km/h).`,
        tag: `wind-${timeInfo.dateString}-${Math.floor(currentHour / 3)}`,
        data: { url: './', tab: 'tab-map', type: 'wind' }
      });
      state.lastWindAlertAt = nowMs;
      state.lastWindMax = maxGust;
    }
  }

  // 5. REGEL: Frost- & Glättewarnung
  if (rules.frostAlert && alerts.length === 0) {
    const nextTemps = (hourly.temperature_2m || []).slice(currentHour, currentHour + 6);
    const minUpcomingTemp = Math.min(current.temperature_2m ?? 99, ...nextTemps);

    // Cooldown: 6 Stunden
    const frostCooldown = 6 * 60 * 60 * 1000;
    const isFrostCooldownActive = (nowMs - (state.lastFrostAlertAt || 0)) < frostCooldown;

    if (minUpcomingTemp <= (rules.frostThreshold || 0) && (current.temperature_2m ?? 99) > 1 && !isFrostCooldownActive) {
      alerts.push({
        type: 'frost',
        title: `❄️ Frost- & Glättewarnung`,
        body: `Temperaturen fallen in Kürze auf ${minUpcomingTemp.toFixed(1)}°C. Glättegefahr auf Straßen und Gehwegen!`,
        tag: `frost-${timeInfo.dateString}-${Math.floor(currentHour / 6)}`,
        data: { url: './', tab: 'tab-overview', type: 'frost' }
      });
      state.lastFrostAlertAt = nowMs;
    }
  }

  return alerts;
}

/**
 * Sendet Push-Benachrichtigung via VAPID Web Push
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
    console.log(`[PAYLOAD]:`, JSON.stringify(payload, null, 2));
    return { ok: true, mocked: true };
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT,
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );

  const res = await webpush.sendNotification(subscription, JSON.stringify(payload));
  return { ok: true, statusCode: res.statusCode };
}

/**
 * Main Runner Function
 */
async function main() {
  const startTime = Date.now();
  console.log('=============================================================================');
  console.log('⚡ BEST WEATHER — Enterprise Push Notification Dispatcher (Option B)');
  console.log(`⏰ System-Start (UTC): ${new Date().toISOString()}`);
  console.log('=============================================================================');

  const config = loadPushConfig();
  const state = loadState();

  const lat = config.location?.lat || 48.137;
  const lon = config.location?.lon || 11.575;
  const locName = config.location?.name || 'München';
  const preferredTz = config.location?.timezone || 'Europe/Berlin';

  // 1. ZUERST: Wetterdaten abrufen (inkl. exakter Zeitzone der Wetterstation)
  console.log(`📍 Prüfe Wetter für: ${locName} (${lat.toFixed(3)}, ${lon.toFixed(3)})`);
  let weatherData;
  try {
    weatherData = await fetchWeatherData(lat, lon, preferredTz);
    const temp = weatherData.current?.temperature_2m;
    const precip = weatherData.current?.precipitation;
    const wind = weatherData.current?.wind_speed_10m;
    console.log(`✓ Aktuelle Messung: ${temp}°C, Niederschlag: ${precip} mm/h, Wind: ${wind} km/h`);
  } catch (err) {
    console.error('❌ Fehler beim Abruf der Wetterdaten:', err.message);
    process.exit(1);
  }

  // 2. ZEITZONEN- & RUHEZEIT-ANALYSE (OPTION B: 22:00 - 06:00 UHR)
  const stationTz = weatherData.timezone || preferredTz;
  const timeInfo = getLocalTimeInfo(stationTz);
  console.log(`🕒 Lokale Stationszeit: ${timeInfo.formattedTime} Uhr (${timeInfo.tz})`);

  if (timeInfo.isQuietHours) {
    console.log(`🌙 [OPTION B: RUHEZEIT AKTIV] 22:00 - 06:00 Uhr Ortszeit (${timeInfo.formattedTime} Uhr).`);
    
    // Notfall-Bypass Check: Falls akutes Hagelunwetter (WMO 99) vorliegt und Bypass erlaubt ist
    const curCode = weatherData.current?.weather_code;
    const isExtremeEmergency = curCode === 99 || (weatherData.current?.wind_gusts_10m || 0) >= 105;
    const allowEmergencyBypass = Boolean(config.rules?.bypassQuietHoursOnSevere);

    if (isExtremeEmergency && allowEmergencyBypass) {
      console.log('🚨 EXTREM-UNWETTER ERKANNT! Ruhezeit wird für lebenswichtigen Gefahrenalarm ausnahmsweise umgangen.');
    } else {
      console.log('🛌 Dispatcher beendet die Pipeline ohne Benachrichtigung zum Schutz der Nachtruhe.');
      console.log(`⏱️ Job-Laufzeit: ${Date.now() - startTime}ms (Compute-Minuten gespart).`);
      saveState(state);
      return;
    }
  } else {
    console.log(`☀️ [OPTION B: AKTIVITÄTSFENSTER] 06:00 - 22:00 Uhr Ortszeit (${timeInfo.formattedTime} Uhr). Alarme aktiv.`);
  }

  // 3. REGEL-EVALUATION MIT ANTI-SPAM COOLDOWNS
  const triggeredAlerts = evaluateAlertRules(config, weatherData, state, timeInfo);

  if (triggeredAlerts.length === 0) {
    console.log('✓ Wetterlage ruhig & unauffällig (oder Cooldown aktiv). Keine Benachrichtigung erforderlich.');
    saveState(state);
    console.log(`🏁 Dispatcher beendet in ${Date.now() - startTime}ms.`);
    return;
  }

  console.log(`🚨 ${triggeredAlerts.length} Alarm(e) ausgelöst:`);
  for (const alert of triggeredAlerts) {
    console.log(`  • [${alert.type.toUpperCase()}] ${alert.title}: ${alert.body}`);
  }

  // 4. SUBSCRIPTION VERIFIZIERUNG & DISPATCH
  const subscriptions = [];
  if (config.subscription && config.subscription.endpoint) {
    subscriptions.push(config.subscription);
  }
  if (Array.isArray(config.subscriptions)) {
    for (const s of config.subscriptions) {
      if (s?.endpoint && !subscriptions.some(existing => existing.endpoint === s.endpoint)) {
        subscriptions.push(s);
      }
    }
  }

  if (subscriptions.length === 0) {
    console.log('ℹ️ Keine aktive Web-Push-Subscription in der Konfiguration vorhanden.');
    console.log('   Öffne die Best Weather App -> 🔔 Einstellungen -> Push aktivieren & mit GitLab syncen.');
    saveState(state);
    return;
  }

  const vapidKeys = {
    publicKey: config.vapidPublicKey || DEFAULT_VAPID_PUBLIC_KEY,
    privateKey: DEFAULT_VAPID_PRIVATE_KEY
  };

  for (const sub of subscriptions) {
    for (const alert of triggeredAlerts) {
      try {
        console.log(`Sende Web Push an: ${sub.endpoint.slice(0, 48)}...`);
        const result = await dispatchPushNotification(sub, alert, vapidKeys);
        console.log(`✓ Push-Mitteilung erfolgreich versendet! (Status: ${result.statusCode || 'OK'})`);
      } catch (err) {
        console.error(`❌ Fehler beim Senden:`, err.message);
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.warn('⚠️ Subscription ist abgelaufen oder ungültig (Client hat abgemeldet).');
        }
      }
    }
  }

  saveState(state);
  console.log(`🏁 Dispatcher erfolgreich abgeschlossen in ${Date.now() - startTime}ms.`);
}

main().catch((err) => {
  console.error('Unerwarteter Fehler im Dispatcher:', err);
  process.exit(1);
});
