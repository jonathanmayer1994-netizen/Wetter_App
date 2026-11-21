/**
 * BEST WEATHER — Intelligent Daily Report Synthesis Engine
 * Synthesizes alpine weather into an adaptive 2-line lock screen notification:
 * - Line 1: Condition • Min/Max Temperatures • Sunshine hours with daylight distribution
 * - Line 2: Elevation-aware snow line / precipitation & acute hazards (thunderstorms, hail, gusts, heat/UV)
 */

export const WMO_DESCRIPTIONS = {
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
  71: 'Leichter Schnee',
  73: 'Mäßiger Schneefall',
  75: 'Starker Schneefall',
  77: 'Schneegriesel',
  80: 'Regenschauer',
  81: 'Mäßige Regenschauer',
  82: 'Heftige Regenschauer',
  85: 'Schneeschauer',
  86: 'Starke Schneeschauer',
  95: 'Gewitter',
  96: 'Gewitter mit leichtem Hagel',
  99: 'Schweres Unwetter mit Hagel'
};

/**
 * Erstellt eine intelligente, alpine Wetter-Synthese für den „Täglichen Bericht“
 * Beinhaltet: Basis (WMO/Temp), Sonnenstunden mit Tagesgang, standortbezogene Schneefallgrenze
 * und akute Tageshighlights (Sommerhitze, Gewitter/Hagel, Sturmböen).
 */
export function buildDailyReport(deviceConfig, weather, timeInfo = {}) {
  const locName = deviceConfig.location?.name || 'Dein Standort';
  const locElevation = Number.isFinite(Number(deviceConfig.location?.elevation))
    ? Number(deviceConfig.location.elevation)
    : 520;

  const current = weather.current || {};
  const hourly = weather.hourly || {};
  const daily = weather.daily || {};
  const dateString = timeInfo.dateString || new Date().toISOString().slice(0, 10);

  // 1. Basis: WMO Beschreibung & Temperaturspanne
  const code = daily.weather_code?.[0] ?? current.weather_code ?? 0;
  let desc = WMO_DESCRIPTIONS[code] || 'Mäßig bewölkt';
  const maxT = Math.round(daily.temperature_2m_max?.[0] ?? 15);
  const minT = Math.round(daily.temperature_2m_min?.[0] ?? 5);

  // 2. Sonnenstunden & Verteilung über den Tag
  const rawSunSec = Number(daily.sunshine_duration?.[0] || 0);
  const sunHours = Math.round((rawSunSec / 3600) * 10) / 10;

  // Harmonisiere Beschreibung wenn trotz Schnee/Regen der Tag überwiegend sonnig ist
  const isPrecipCode = [71, 73, 75, 77, 85, 86, 51, 53, 55, 61, 63, 65, 80, 81].includes(code);
  if (sunHours >= 5.0 && isPrecipCode) {
    const isSnow = [71, 73, 75, 77, 85, 86].includes(code) || (daily.snowfall_sum?.[0] || 0) > 0;
    const hourlyP = hourly.precipitation || [];
    const daytimeP = hourlyP.slice(7, 17).reduce((a, b) => a + b, 0);
    if (daytimeP < 0.6) {
      desc = isSnow ? 'Sonnig, nachts Schnee' : 'Sonnig, nachts Regen';
    } else {
      desc = isSnow ? 'Sonne & Schnee' : 'Sonne & Schauer';
    }
  }

  let sunPhrase = '';
  const clouds = hourly.cloud_cover || [];
  const morningClouds = clouds.slice(6, 12);
  const afternoonClouds = clouds.slice(12, 18);
  const avgMorning = morningClouds.length ? morningClouds.reduce((a, b) => a + b, 0) / morningClouds.length : 50;
  const avgAfternoon = afternoonClouds.length ? afternoonClouds.reduce((a, b) => a + b, 0) / afternoonClouds.length : 50;

  if (sunHours >= 7 && avgMorning < 35 && avgAfternoon < 35) {
    sunPhrase = `☀️ ${Math.round(sunHours)}h Sonne ganztags`;
  } else if (sunHours >= 2.5 && avgMorning < 40 && avgAfternoon >= 60) {
    sunPhrase = `☀️ ${Math.round(sunHours)}h Sonne (vor allem vormittags)`;
  } else if (sunHours >= 2.5 && avgMorning >= 60 && avgAfternoon < 45) {
    sunPhrase = `☀️ ${Math.round(sunHours)}h Sonne (ab Mittag freundlich)`;
  } else if (sunHours >= 1.5) {
    sunPhrase = `☀️ ${Math.round(sunHours)}h Sonne`;
  } else {
    sunPhrase = `☁️ Kaum Sonne (${sunHours > 0 ? `<1h` : '0h'})`;
  }

  // 3. Standortbezogene Schneefallgrenze & Niederschlag
  const pop = Math.round(daily.precipitation_probability_max?.[0] ?? 0);
  const precipSum = Math.round((daily.precipitation_sum?.[0] || 0) * 10) / 10;
  const snowfallSum = Math.round((daily.snowfall_sum?.[0] || 0) * 10) / 10;

  let precipPhrase = '';
  const isPrecipExpected = pop >= 25 || precipSum >= 0.5;

  if (isPrecipExpected) {
    const isCold = minT <= 4 || maxT <= 9 || snowfallSum > 0;
    if (isCold) {
      const freezings = (hourly.freezing_level_height || []).slice(6, 18).filter(h => Number.isFinite(h));
      const avgFreezing = freezings.length ? (freezings.reduce((a, b) => a + b, 0) / freezings.length) : (maxT * 150 + locElevation);
      const rawSnowLine = Math.max(0, avgFreezing - 250);
      const snowLine = Math.round(rawSnowLine / 50) * 50;

      if (locElevation < (snowLine - 120)) {
        // Fall 1: Standort liegt im Tal deutlich unter der Schneefallgrenze
        precipPhrase = `🌧️ ${pop}% Regen im Tal • ❄️ Schnee in den Bergen ab ${snowLine.toLocaleString('de-DE')} m`;
      } else if (Math.abs(locElevation - snowLine) <= 120) {
        // Fall 2: Standort liegt an der Schneefallgrenze (Übergangsbereich)
        precipPhrase = `🌨️ ${pop}% Niederschlag • Vor Ort Schneeregen / nass (ab ${(snowLine + 100).toLocaleString('de-DE')} m weiß)`;
      } else {
        // Fall 3: Standort liegt über der Schneefallgrenze (Schnee vor Ort)
        precipPhrase = `❄️ ${pop}% Schneefall vor Ort${snowfallSum >= 1 ? ` (ca. ${Math.round(snowfallSum)} cm Neuschnee)` : ''}`;
      }
    } else {
      // Milder/warmer Regen
      precipPhrase = `🌧️ ${pop}% Regenrisiko${precipSum >= 1 ? ` (${precipSum} mm)` : ''}`;
    }
  } else {
    precipPhrase = `Trocken (${pop}% Regenrisiko)`;
  }

  // 4. Extreme & Tageshighlights (Unwetter, Hitze, Böen)
  const highlights = [];

  // Unwetter / Hagel (WMO 95, 96, 99)
  const dayCodes = (hourly.weather_code || []).slice(6, 22);
  const stormIdx = dayCodes.findIndex(c => [95, 96, 99].includes(c));
  if (stormIdx >= 0) {
    const stormHour = (stormIdx + 6) % 24;
    highlights.push(`⚡ Ab ca. ${String(stormHour).padStart(2, '0')} Uhr Gewitter- & Hagelrisiko!`);
  }

  // Sturm / Böen
  const maxGust = Math.round(daily.wind_gusts_10m_max?.[0] || 0);
  if (maxGust >= 50) {
    highlights.push(`💨 Böen bis ${maxGust} km/h`);
  }

  // Sommerhitze & UV
  if (maxT >= 30) {
    const uv = Math.round(daily.uv_index_max?.[0] || 0);
    highlights.push(`🔥 Hitze bis ${maxT}°C${uv >= 7 ? ` (UV ${uv})` : ''}`);
  }

  const line1 = `${desc} • ${minT}° bis ${maxT}°C • ${sunPhrase}`;
  let line2 = precipPhrase;
  if (highlights.length > 0) {
    line2 += ` • ${highlights.join(' • ')}`;
  }

  return {
    type: 'briefing',
    title: `📊 Täglicher Bericht — ${locName}`,
    body: `${line1}\n${line2}`,
    tag: `briefing-${dateString}`,
    data: { url: './', tab: 'tab-overview', type: 'briefing' }
  };
}
