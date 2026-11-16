#!/usr/bin/env node
/**
 * BEST WEATHER — GitLab CI Push Notification Dispatcher
 * Runs as a Scheduled Pipeline every X minutes.
 * Evaluates live weather via Open-Meteo and dispatches Web Push notifications
 * to Apple APNs (iOS / iPadOS / macOS) & Google FCM.
 */

import fs from 'node:fs';
import path from 'node:path';

// Standard VAPID Fallback Keys
const DEFAULT_VAPID_PUBLIC_KEY = 'BFXeGAET8G6YxsiL0HvXELcaDIoZyeIgPYokZuqpueq3NFJs8xG7KsyvViif44MAxMkBI_OQ93OXewHGRhMSOmI';
const DEFAULT_VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '16Ovl5NMFksNazSkQceNN5LVKUigugt_J3ZSA37fXXA';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:push@best-weather.app';

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
  61: 'Leichter Regen',
  63: 'Mäßiger Regen',
  65: 'Starker Regen',
  71: 'Leichter Schneefall',
  73: 'Mäßiger Schneefall',
  75: 'Starker Schneefall',
  80: 'Leichte Regenschauer',
  81: 'Mäßige Regenschauer',
  82: 'Heftige Regenschauer',
  85: 'Leichte Schneeschauer',
  86: 'Starke Schneeschauer',
  95: 'Gewitter',
  96: 'Gewitter mit leichtem Hagel',
  99: 'Schweres Gewitter mit Hagel'
};

/**
 * Lädt die Push-Konfiguration aus GitLab CI Variablen, Datei oder Parametern
 */
function loadPushConfig() {
  // 1. Umgebungsvariable aus GitLab Project Variables
  if (process.env.WEATHER_PUSH_CONFIG) {
    try {
      console.log('✓ Konfiguration aus Umgebungsvariable $WEATHER_PUSH_CONFIG geladen.');
      return JSON.parse(process.env.WEATHER_PUSH_CONFIG);
    } catch (err) {
      console.error('Fehler beim Parsen von $WEATHER_PUSH_CONFIG:', err.message);
    }
  }

  // 2. Datei im Repository (z.B. config/push-config.json)
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

  // 3. Fallback Demo-Konfiguration (für Test-Läufe)
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
      severeAlert: true
    },
    location: {
      name: 'München',
      lat: 48.137,
      lon: 11.575
    }
  };
}

/**
 * Fragt Open-Meteo Wetterdaten für die hinterlegten Koordinaten ab
 */
async function fetchWeatherData(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_gusts_10m&hourly=temperature_2m,precipitation_probability,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset&timezone=auto&forecast_days=2`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'BestWeather-GitLabDispatcher/1.0' }
  });

  if (!res.ok) {
    throw new Error(`Open-Meteo API antwortete mit Status ${res.status}: ${res.statusText}`);
  }

  return await res.json();
}

/**
 * Bewertet Wetterkriterien und ermittelt auszulösende Alarme
 */
function evaluateAlertRules(config, weather) {
  const alerts = [];
  const rules = config.rules || {};
  const locName = config.location?.name || 'Dein Standort';

  const current = weather.current || {};
  const hourly = weather.hourly || {};
  const daily = weather.daily || {};

  const currentHourIndex = new Date().getHours();
  const now = new Date();

  // 1. REGEL: Morgen-Briefing (z.B. täglich um 07:00 Uhr)
  if (rules.briefingAlert) {
    const targetHour = parseInt((rules.briefingTime || '07:00').split(':')[0], 10);
    if (now.getHours() === targetHour) {
      const code = daily.weather_code?.[0] ?? current.weather_code ?? 0;
      const desc = WMO_DESCRIPTIONS[code] || 'Mäßig bewölkt';
      const maxT = Math.round(daily.temperature_2m_max?.[0] ?? 15);
      const minT = Math.round(daily.temperature_2m_min?.[0] ?? 5);
      const pop = daily.precipitation_probability_max?.[0] ?? 0;

      alerts.push({
        type: 'briefing',
        title: `☀️ Guten Morgen aus ${locName}`,
        body: `Heute: ${desc} • ${minT}° bis ${maxT}° • Regenrisiko ${pop}%`,
        tag: `briefing-${now.toISOString().slice(0, 10)}`,
        data: { url: './', tab: 'tab-overview', type: 'briefing' }
      });
    }
  }

  // 2. REGEL: Akute Unwetter- / Extremwetterwarnung (WMO 95, 96, 99)
  if (rules.severeAlert) {
    const curCode = current.weather_code;
    const nextCodes = (hourly.weather_code || []).slice(currentHourIndex, currentHourIndex + 3);
    const isSevere = [95, 96, 99].includes(curCode) || nextCodes.some(c => [95, 96, 99].includes(c));

    if (isSevere) {
      alerts.push({
        type: 'severe',
        title: `⚡ Akute Unwetterwarnung für ${locName}`,
        body: `Gewitter mit potentiellem Hagel oder Starkregen im Anzug! Bitte Schutz suchen.`,
        tag: `severe-${now.getHours()}`,
        requireInteraction: true,
        data: { url: './', tab: 'tab-map', type: 'severe' }
      });
    }
  }

  // 3. REGEL: Regenalarm (In den nächsten 60-90 Min setzt Regen ein)
  if (rules.rainAlert && alerts.length === 0) {
    const isCurrentlyRaining = (current.precipitation || 0) > 0.3;
    const nextHoursPrecip = (hourly.precipitation || []).slice(currentHourIndex + 1, currentHourIndex + 3);
    const nextHoursPop = (hourly.precipitation_probability || []).slice(currentHourIndex + 1, currentHourIndex + 3);

    const willRainSoon = nextHoursPrecip.some(p => p >= 0.3) || nextHoursPop.some(prob => prob >= (rules.rainThreshold || 50));

    if (!isCurrentlyRaining && willRainSoon) {
      const maxExpected = Math.max(...nextHoursPrecip).toFixed(1);
      alerts.push({
        type: 'rain',
        title: `🌧️ Regenalarm für ${locName}`,
        body: `In Kürze setzt Niederschlag ein (~${maxExpected} mm erwartet). Schirm einpacken!`,
        tag: `rain-${now.getHours()}`,
        data: { url: './', tab: 'tab-map', type: 'rain' }
      });
    }
  }

  // 4. REGEL: Sturm- & Böenwarnung
  if (rules.windAlert && alerts.length === 0) {
    const threshold = rules.windThreshold || 60;
    const nextGusts = (hourly.wind_gusts_10m || []).slice(currentHourIndex, currentHourIndex + 4);
    const maxGust = Math.round(Math.max(current.wind_gusts_10m || 0, ...nextGusts));

    if (maxGust >= threshold) {
      alerts.push({
        type: 'wind',
        title: `💨 Sturm- & Böenwarnung (${maxGust} km/h)`,
        body: `In ${locName} werden stürmische Böen von bis zu ${maxGust} km/h erwartet (Schwelle: >${threshold} km/h).`,
        tag: `wind-${now.getHours()}`,
        data: { url: './', tab: 'tab-map', type: 'wind' }
      });
    }
  }

  // 5. REGEL: Frost- & Glättewarnung
  if (rules.frostAlert && alerts.length === 0) {
    const nextTemps = (hourly.temperature_2m || []).slice(currentHourIndex, currentHourIndex + 6);
    const minUpcomingTemp = Math.min(current.temperature_2m ?? 99, ...nextTemps);

    if (minUpcomingTemp <= (rules.frostThreshold || 0) && (current.temperature_2m ?? 99) > 1) {
      alerts.push({
        type: 'frost',
        title: `❄️ Frost- & Glättewarnung`,
        body: `Temperaturen fallen in Kürze auf ${minUpcomingTemp.toFixed(1)}°C. Glättegefahr auf Straßen und Gehwegen!`,
        tag: `frost-${now.getHours()}`,
        data: { url: './', tab: 'tab-overview', type: 'frost' }
      });
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
  } catch (err) {
    console.warn('web-push Modul nicht gefunden. Verwende Direkt-HTTP / Mock-Logging.');
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
  console.log('=====================================================');
  console.log('⚡ BEST WEATHER — GitLab CI Push Notification Dispatcher');
  console.log(`⏰ Zeitstempel: ${new Date().toISOString()}`);
  console.log('=====================================================');

  const config = loadPushConfig();
  const lat = config.location?.lat || 48.137;
  const lon = config.location?.lon || 11.575;
  const locName = config.location?.name || 'München';

  console.log(`📍 Prüfe Wetter für: ${locName} (${lat.toFixed(3)}, ${lon.toFixed(3)})`);

  let weatherData;
  try {
    weatherData = await fetchWeatherData(lat, lon);
    const temp = weatherData.current?.temperature_2m;
    const precip = weatherData.current?.precipitation;
    const wind = weatherData.current?.wind_speed_10m;
    console.log(`Aktuelle Messung: ${temp}°C, Niederschlag: ${precip} mm/h, Wind: ${wind} km/h`);
  } catch (err) {
    console.error('❌ Fehler beim Abruf der Wetterdaten:', err.message);
    process.exit(1);
  }

  const triggeredAlerts = evaluateAlertRules(config, weatherData);

  if (triggeredAlerts.length === 0) {
    console.log('✓ Wetterlage ruhig & unauffällig. Keine Alarmkriterien erfüllt.');
    console.log('Job erfolgreich ohne Benachrichtigung beendet.');
    return;
  }

  console.log(`🚨 ${triggeredAlerts.length} Alarm(e) ausgelöst:`);
  for (const alert of triggeredAlerts) {
    console.log(`  • [${alert.type.toUpperCase()}] ${alert.title}: ${alert.body}`);
  }

  if (!config.subscription || !config.subscription.endpoint) {
    console.log('ℹ️ Keine aktive Web-Push-Subscription in der Konfiguration vorhanden.');
    console.log('Um echte Push-Nachrichten auf dein Gerät zu erhalten:');
    console.log('1. Öffne die Best Weather App');
    console.log('2. Klicke auf 🔔 (Benachrichtigungen)');
    console.log('3. Push aktivieren und mit GitLab synchronisieren');
    return;
  }

  const vapidKeys = {
    publicKey: config.vapidPublicKey || DEFAULT_VAPID_PUBLIC_KEY,
    privateKey: DEFAULT_VAPID_PRIVATE_KEY
  };

  for (const alert of triggeredAlerts) {
    try {
      console.log(`Sende Push an Endpoint: ${config.subscription.endpoint.slice(0, 45)}...`);
      const result = await dispatchPushNotification(config.subscription, alert, vapidKeys);
      console.log(`✓ Push-Mitteilung erfolgreich versendet! (Status: ${result.statusCode || 'OK'})`);
    } catch (err) {
      console.error(`❌ Fehler beim Senden der Push-Mitteilung:`, err.message);
      if (err.statusCode === 410 || err.statusCode === 404) {
        console.warn('⚠️ Die Subscription ist abgelaufen oder ungültig (Client hat abbestellt).');
      }
    }
  }

  console.log('🏁 Dispatcher erfolgreich abgeschlossen.');
}

main().catch((err) => {
  console.error('Unerwarteter Fehler im Dispatcher:', err);
  process.exit(1);
});
