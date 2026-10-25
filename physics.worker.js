/**
 * BEST WEATHER — Dedicated Alpine Physics & Microclimate Web Worker (Task 3a)
 * Offloads heavy lapse-rate thermodynamics, solar radiation geometry (GTI),
 * and route weather downscaling calculations from the main UI thread.
 */

self.onmessage = function (e) {
  const { id, action, payload } = e.data;

  try {
    let result = null;

    if (action === 'computeSolarRadiation') {
      result = computeSolarRadiation(payload);
    } else if (action === 'computeFreeAirLayers') {
      result = computeFreeAirLayers(payload);
    } else if (action === 'computeAltitudeProfile') {
      result = computeAltitudeProfile(payload);
    } else if (action === 'computeAltitudeProfileFull') {
      result = computeAltitudeProfileFull(payload);
    } else if (action === 'computeRouteTimeline') {
      result = computeRouteTimeline(payload);
    }

    self.postMessage({ id, status: 'success', data: result });
  } catch (err) {
    self.postMessage({ id, status: 'error', error: err.message });
  }
};

/**
 * Calculates sun position and Global Tilted Irradiance
 */
function computeSolarRadiation({ lat, lon, dateMs, tilt, azimuth, cloudCover, shortwaveRadiation }) {
  const date = new Date(dateMs);
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const diff = date - startOfYear;
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

  // Deklination der Sonne in Radian
  const declination = 23.45 * Math.sin(((360 / 365) * (dayOfYear - 81) * Math.PI) / 180) * (Math.PI / 180);

  // Zeitkorrektur
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const solarTime = utcHours + (lon * 4) / 60;
  const hourAngle = (solarTime - 12) * 15 * (Math.PI / 180);

  const latRad = (lat * Math.PI) / 180;
  const sinSunAlt = Math.sin(latRad) * Math.sin(declination) + Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const sunAltRad = Math.asin(Math.max(-1, Math.min(1, sinSunAlt)));
  const sunAltitudeDeg = (sunAltRad * 180) / Math.PI;

  const isNight = sunAltitudeDeg <= 0;
  if (isNight) {
    return { sunAltitudeDeg, GTI: 0, isDirectSun: false, heatGainC: 0 };
  }

  // Einstrahlungsberechnung
  const cosIncidence = Math.sin(sunAltRad) * Math.cos((tilt * Math.PI) / 180) +
    Math.cos(sunAltRad) * Math.sin((tilt * Math.PI) / 180) * Math.cos(hourAngle - (azimuth * Math.PI) / 180);

  const incidenceFactor = Math.max(0, cosIncidence);
  const cloudTransmittance = Math.max(0.15, (100 - cloudCover * 0.75) / 100);
  const baseGTI = (shortwaveRadiation || 650) * incidenceFactor * cloudTransmittance;
  const heatGainC = Math.round((baseGTI / 150) * 10) / 10;

  return {
    sunAltitudeDeg: Math.round(sunAltitudeDeg * 10) / 10,
    GTI: Math.round(baseGTI),
    isDirectSun: incidenceFactor > 0.25 && cloudCover < 70,
    heatGainC
  };
}

/**
 * Interpolates pressure levels and identifies temperature inversions
 */
function computeFreeAirLayers({ elevation, hourly, hourIdx }) {
  const levels = [
    { hpa: 1000, approxZ: 110 },
    { hpa: 925, approxZ: 750 },
    { hpa: 850, approxZ: 1450 },
    { hpa: 700, approxZ: 3000 },
    { hpa: 600, approxZ: 4200 },
    { hpa: 500, approxZ: 5500 }
  ];

  let layerTemps = [];
  for (const lvl of levels) {
    const key = `temperature_${lvl.hpa}hPa`;
    const t = hourly[key] && hourly[key][hourIdx] !== undefined ? hourly[key][hourIdx] : null;
    if (t !== null) layerTemps.push({ hpa: lvl.hpa, z: lvl.approxZ, t });
  }

  // Inversionserkennung
  let hasInversion = false;
  let inversionDelta = 0;
  for (let i = 0; i < layerTemps.length - 1; i++) {
    const lower = layerTemps[i];
    const upper = layerTemps[i + 1];
    if (upper.t > lower.t) {
      hasInversion = true;
      inversionDelta = Math.max(inversionDelta, upper.t - lower.t);
    }
  }

  return {
    layerTemps,
    hasInversion,
    inversionDelta: Math.round(inversionDelta * 10) / 10
  };
}

function computeAltitudeProfile({ weatherRaw, elevation }) {
  const zGipfel = Math.max(1200, Math.round(elevation));
  const zTal = Math.max(300, Math.round(zGipfel * 0.45));
  const zMittel = Math.round((zGipfel + zTal) / 2);
  const zAtm = Math.round(zGipfel + 1200);

  return {
    zTal,
    zMittel,
    zGipfel,
    zAtm
  };
}

/**
 * Berechnet die tatsächliche atmosphärische Lapse-Rate (°C / 100m) aus den Druckflächen
 * temperature_850hPa, temperature_700hPa, temperature_500hPa.
 * Sign-Konvention: Normaler Temperaturrückgang mit der Höhe ist negativ (z. B. -0.65 °C/100m).
 * Inversion (Temperaturanstieg mit der Höhe) ist positiv (Lapse-Rate > 0).
 * Fallback auf -0.65 °C/100m nur wenn keine Druckflächen verfügbar sind.
 */
function calculatePressureLapseRate(h, hourIdx = 0, targetElevation = null) {
  if (!h) {
    return { lapseRatePer100m: -0.65, isInversion: false, isFallback: true };
  }

  const t850 = (h.temperature_850hPa && typeof h.temperature_850hPa[hourIdx] === 'number') ? h.temperature_850hPa[hourIdx] : null;
  const t700 = (h.temperature_700hPa && typeof h.temperature_700hPa[hourIdx] === 'number') ? h.temperature_700hPa[hourIdx] : null;
  const t500 = (h.temperature_500hPa && typeof h.temperature_500hPa[hourIdx] === 'number') ? h.temperature_500hPa[hourIdx] : null;

  const z850 = (h.geopotential_height_850hPa && typeof h.geopotential_height_850hPa[hourIdx] === 'number') ? h.geopotential_height_850hPa[hourIdx] : 1457;
  const z700 = (h.geopotential_height_700hPa && typeof h.geopotential_height_700hPa[hourIdx] === 'number') ? h.geopotential_height_700hPa[hourIdx] : 3012;
  const z500 = (h.geopotential_height_500hPa && typeof h.geopotential_height_500hPa[hourIdx] === 'number') ? h.geopotential_height_500hPa[hourIdx] : 5574;

  let lapseRate = null;

  if (targetElevation !== null) {
    if (targetElevation >= z700 && t700 !== null && t500 !== null) {
      const dz = Math.max(100, z500 - z700);
      lapseRate = ((t500 - t700) / dz) * 100;
    } else if (targetElevation < z700 && t850 !== null && t700 !== null) {
      const dz = Math.max(100, z700 - z850);
      lapseRate = ((t700 - t850) / dz) * 100;
    }
  }

  if (lapseRate === null) {
    if (t850 !== null && t700 !== null) {
      const dz = Math.max(100, z700 - z850);
      lapseRate = ((t700 - t850) / dz) * 100;
    } else if (t700 !== null && t500 !== null) {
      const dz = Math.max(100, z500 - z700);
      lapseRate = ((t500 - t700) / dz) * 100;
    } else if (t850 !== null && t500 !== null) {
      const dz = Math.max(100, z500 - z850);
      lapseRate = ((t500 - t850) / dz) * 100;
    }
  }

  if (lapseRate === null || isNaN(lapseRate)) {
    return {
      lapseRatePer100m: -0.65,
      isInversion: false,
      isFallback: true
    };
  }

  return {
    lapseRatePer100m: Math.round(lapseRate * 100) / 100,
    isInversion: lapseRate > 0,
    isFallback: false
  };
}

/**
 * Berechnet die Wet-Bulb-Temperatur (Kühlgrenztemperatur Tw in °C) nach Stull (2011)
 */
function computeWetBulbTemp(t, rh) {
  if (typeof t !== 'number' || isNaN(t)) return 0;
  const r = Math.max(1, Math.min(100, (typeof rh === 'number' && !isNaN(rh)) ? rh : 65));
  const tw = t * Math.atan(0.151977 * Math.pow(r + 8.313659, 0.5)) +
    Math.atan(t + r) -
    Math.atan(r - 1.676331) +
    0.00391838 * Math.pow(r, 1.5) * Math.atan(0.023101 * r) -
    4.686035;
  return Math.round(tw * 100) / 100;
}

/**
 * Berechnet die Schneefallgrenze auf Basis der Wet-Bulb-Temperatur (Tw = 1.0 °C)
 * anhand der Druckflächen (1000, 925, 850, 700, 600, 500 hPa) und 2m-Werte.
 */
function calculateWetBulbSnowLevel(h, hourIdx = 0, peakElevation = 2000) {
  if (!h) {
    return { snowLevelMeters: 2000, freezingLevelMeters: 2300, isFallback: true };
  }

  const dryFreezingLevel = (h.freezing_level_height && typeof h.freezing_level_height[hourIdx] === 'number')
    ? h.freezing_level_height[hourIdx]
    : 2500;

  const levels = [1000, 925, 850, 700, 600, 500];
  const layerPoints = [];

  const t2m = (h.temperature_2m && typeof h.temperature_2m[hourIdx] === 'number') ? h.temperature_2m[hourIdx] : null;
  const rh2m = (h.relative_humidity_2m && typeof h.relative_humidity_2m[hourIdx] === 'number') ? h.relative_humidity_2m[hourIdx] : 70;
  if (t2m !== null) {
    const tw2m = computeWetBulbTemp(t2m, rh2m);
    layerPoints.push({ z: Math.min(600, Math.round(peakElevation * 0.35)), t: t2m, rh: rh2m, tw: tw2m });
  }

  for (const lvl of levels) {
    const z = h[`geopotential_height_${lvl}hPa`]?.[hourIdx];
    const t = h[`temperature_${lvl}hPa`]?.[hourIdx];
    const rh = h[`relative_humidity_${lvl}hPa`]?.[hourIdx] || rh2m;
    if (typeof z === 'number' && typeof t === 'number') {
      const tw = computeWetBulbTemp(t, rh);
      layerPoints.push({ z, t, rh, tw });
    }
  }

  layerPoints.sort((a, b) => a.z - b.z);

  if (layerPoints.length < 2) {
    const surfaceT = t2m !== null ? t2m : 10;
    const surfaceTw = computeWetBulbTemp(surfaceT, rh2m);
    const snowDeltaZ = ((surfaceTw - 1.0) / 0.65) * 100;
    const estSnowLevel = Math.max(300, Math.round((peakElevation * 0.35) + snowDeltaZ));
    return {
      snowLevelMeters: estSnowLevel,
      freezingLevelMeters: dryFreezingLevel,
      isFallback: true
    };
  }

  let snowZ = null;
  if (layerPoints[0].tw <= 1.0) {
    snowZ = layerPoints[0].z;
  } else {
    for (let i = 0; i < layerPoints.length - 1; i++) {
      const p1 = layerPoints[i];
      const p2 = layerPoints[i + 1];
      if (p1.tw >= 1.0 && p2.tw <= 1.0) {
        const dTw = p1.tw - p2.tw;
        const frac = dTw > 0.01 ? (p1.tw - 1.0) / dTw : 0.5;
        snowZ = Math.round(p1.z + frac * (p2.z - p1.z));
        break;
      }
    }
  }

  if (snowZ === null) {
    const top = layerPoints[layerPoints.length - 1];
    if (top.tw > 1.0) {
      snowZ = Math.round(top.z + ((top.tw - 1.0) / 0.65) * 100);
    } else {
      snowZ = Math.round(layerPoints[0].z);
    }
  }

  snowZ = Math.max(200, Math.min(5000, snowZ));

  return {
    snowLevelMeters: snowZ,
    freezingLevelMeters: dryFreezingLevel,
    isFallback: false
  };
}

/**
 * Full 24-hour Alpine altitude profile interpolation across 4 key atmospheric levels
 */
function computeAltitudeProfileFull({ weatherData, peakElevation }) {
  const h = weatherData.hourly;
  if (!h || !h.time) return null;

  const valleyZ = Math.max(500, Math.min(1800, Math.round(peakElevation * 0.38)));
  const midZ = Math.round((peakElevation + valleyZ) / 2);
  const peakZ = Math.round(peakElevation);
  const highZ = Math.round(peakElevation + 800);

  const steps = [
    { name: 'Talboden', z: valleyZ, icon: '🏡', tpi: -25 },
    { name: 'Mittelstation', z: midZ, icon: '🌲', tpi: 0 },
    { name: 'Gipfel / Grat', z: peakZ, icon: '🏔️', tpi: 25 },
    { name: 'Freie Atmosphäre', z: highZ, icon: '🦅', tpi: 15 }
  ];

  const hourlyProfiles = [];
  for (let i = 0; i < Math.min(24, h.time.length); i++) {
    const timeStr = h.time[i];
    const { lapseRatePer100m, isInversion } = calculatePressureLapseRate(h, i, peakElevation);
    const { snowLevelMeters, freezingLevelMeters } = calculateWetBulbSnowLevel(h, i, peakElevation);

    const hourObj = {
      time: timeStr,
      hour: new Date(timeStr).getHours(),
      freezingLevel: freezingLevelMeters,
      snowLevel: snowLevelMeters,
      precip: h.precipitation ? h.precipitation[i] : 0,
      lapseRatePer100m,
      inversionActive: isInversion,
      levels: []
    };

    const levels = [1000, 925, 850, 700, 600, 500];
    const stack = levels.map(hpa => ({
      hpa,
      z: h[`geopotential_height_${hpa}hPa`]?.[i],
      temp: h[`temperature_${hpa}hPa`]?.[i],
      wind: h[`wind_speed_${hpa}hPa`]?.[i],
      dir: h[`wind_direction_${hpa}hPa`]?.[i],
      rh: h[`relative_humidity_${hpa}hPa`]?.[i]
    })).filter(l => l.z !== undefined && l.temp !== undefined);

    for (const step of steps) {
      let t = 0;
      let w = 0;
      let d = 250;
      const defaultWind = (h.wind_speed_10m && h.wind_speed_10m[i] !== undefined) ? h.wind_speed_10m[i] : 10;
      const defaultTemp = (h.temperature_2m && h.temperature_2m[i] !== undefined) ? h.temperature_2m[i] : 10;
      const defaultDir = (h.wind_direction_10m && h.wind_direction_10m[i] !== undefined) ? h.wind_direction_10m[i] : 210;
      let stepRh = (h.relative_humidity_2m && h.relative_humidity_2m[i] !== undefined) ? h.relative_humidity_2m[i] : 70;

      if (stack.length >= 2) {
        if (step.z < stack[0].z) {
          const low = stack[0];
          const dz = step.z - low.z;
          t = low.temp + (dz / 100) * lapseRatePer100m;
          w = (typeof low.wind === 'number') ? low.wind : (defaultWind * (1 + (step.z / 2000)));
          d = (typeof low.dir === 'number') ? low.dir : defaultDir;
          stepRh = (typeof low.rh === 'number') ? low.rh : stepRh;
        } else if (step.z > stack[stack.length - 1].z) {
          const up = stack[stack.length - 1];
          const dz = step.z - up.z;
          t = up.temp + (dz / 100) * lapseRatePer100m;
          w = (typeof up.wind === 'number') ? up.wind : (defaultWind * (1 + (step.z / 2000)));
          d = (typeof up.dir === 'number') ? up.dir : defaultDir;
          stepRh = (typeof up.rh === 'number') ? up.rh : stepRh;
        } else {
          let low = stack[0];
          let up = stack[stack.length - 1];
          for (let k = 0; k < stack.length - 1; k++) {
            if (step.z >= stack[k].z && step.z <= stack[k + 1].z) {
              low = stack[k];
              up = stack[k + 1];
              break;
            }
          }
          const weight = Math.max(0, Math.min(1, (step.z - low.z) / Math.max(1, up.z - low.z)));
          t = low.temp + weight * (up.temp - low.temp);
          const lowW = (typeof low.wind === 'number') ? low.wind : defaultWind;
          const upW = (typeof up.wind === 'number') ? up.wind : lowW;
          w = lowW + weight * (upW - lowW);
          const lowD = (typeof low.dir === 'number') ? low.dir : defaultDir;
          const upD = (typeof up.dir === 'number') ? up.dir : lowD;
          let diff = ((upD - lowD + 180) % 360) - 180;
          d = (lowD + weight * diff + 360) % 360;
          const lowRh = (typeof low.rh === 'number') ? low.rh : stepRh;
          const upRh = (typeof up.rh === 'number') ? up.rh : lowRh;
          stepRh = lowRh + weight * (upRh - lowRh);
        }
      } else {
        t = defaultTemp + ((step.z - valleyZ) / 100) * lapseRatePer100m;
        w = defaultWind * (1 + (step.z / 2000));
        d = (defaultDir + Math.min(65, (step.z / 4000) * 65)) % 360;
      }

      // Orographische Korrektur für Talboden / Hang / Gipfel (insbesondere bei Inversion)
      const windDampener = 1 / (1 + Math.max(0, w) / 16);
      if (isInversion) {
        if (step.tpi < -8) {
          // Talboden: Kaltluftsee sammelt sich
          const poolDepth = 1.5 + (lapseRatePer100m * 1.8) + (Math.abs(step.tpi) / 20);
          t -= Math.min(5.5, poolDepth) * windDampener;
        } else if (step.tpi > 8 && step.name.includes('Gipfel')) {
          // Grat / Gipfel: Liegt über der Inversions-Obergrenze, deutlich wärmer
          const ridgeWarmth = (lapseRatePer100m * 1.5) + (step.tpi / 35);
          t += Math.min(4.0, Math.max(0.2, ridgeWarmth));
        } else if (step.tpi === 0) {
          // Mittelstation / Hang: Warme Hangzone / Thermal Belt
          t += Math.min(2.5, Math.max(0.1, lapseRatePer100m * 1.1));
        }
      }

      // FÖHN- & TALWIND-HEURISTIK im Höhenprofil (nur bei peakElevation > 800 m)
      let stepFoehn = false;
      let stepFoehnNote = null;
      let stepWindNote = null;

      if (peakElevation > 800) {
        // Föhn: Bei Südwind (140..230°) oder Nordwind (320..40°), trockenadiabatischer Föhneffekt im Lee (Talboden & Mittelstation)
        const isSouthWind = (d >= 140 && d <= 230);
        const isNorthWind = (d >= 320 || d <= 40);
        const isDry = stepRh <= 60;
        const isWindy = w >= 16;

        if ((isSouthWind || isNorthWind) && isDry && isWindy) {
          if (step.z < peakElevation) {
            const foehnBoostT = Math.min(4.0, Math.max(1.8, 1.8 + (w / 35) * 1.5));
            const foehnBoostW = Math.min(25, Math.max(8, Math.round(w * 0.35 + 8)));
            t += foehnBoostT;
            w += foehnBoostW;
            stepRh = Math.max(15, stepRh - 20);
            stepFoehn = true;
            stepFoehnNote = `${isSouthWind ? 'Südföhn' : 'Nordföhn'} (+${Math.round(foehnBoostT * 10) / 10}°C)`;
            hourObj.foehnActive = true;
          }
        }

        // Talwind (Anabatic/Katabatic): Bei klarem Himmel (cloud_cover <= 45%)
        const cloudVal = (h.cloud_cover && h.cloud_cover[i] !== undefined) ? h.cloud_cover[i] : 50;
        if (!stepFoehn && cloudVal <= 45) {
          const hHour = hourObj.hour;
          if (hHour >= 8 && hHour <= 18 && (step.name.includes('Mittelstation') || step.name.includes('Talboden'))) {
            w += 8;
            t += 0.8;
            stepWindNote = 'Hangaufwind';
          } else if ((hHour < 6 || hHour > 20) && step.name.includes('Talboden')) {
            w += 6;
            t -= 1.2;
            stepWindNote = 'Hangabwind';
          }
        }
      }

      // Wet-Bulb Temperatur & präzise Schneefallgrenze
      const tw = computeWetBulbTemp(t, stepRh);
      let precipType = 'Regen';
      let precipIcon = '💧';
      let isSnow = false;
      if (tw <= 0.5 || t <= 0.0 || step.z >= hourObj.snowLevel) {
        precipType = 'Schnee';
        precipIcon = '❄️';
        isSnow = true;
      } else if (tw <= 1.8) {
        precipType = 'Schneeregen';
        precipIcon = '🌨️';
        isSnow = false;
      } else {
        precipType = 'Regen';
        precipIcon = '💧';
        isSnow = false;
      }
      
      // Windchill-Berechnung
      let felt = t;
      if (t <= 10 && w >= 5) {
        felt = 13.12 + (0.6215 * t) - (11.37 * Math.pow(w, 0.16)) + (0.3965 * t * Math.pow(w, 0.16));
      } else if (t > 10) {
        felt = t - (w * 0.04);
      }

      // Barometrischer Druck in dieser Höhe (hPa)
      const pressHpa = Math.round(1013.25 * Math.pow(1 - (0.0065 * step.z) / 288.15, 5.255));
      const gusts = Math.round(w * 1.35);
      const freezingDiff = Math.round(step.z - hourObj.snowLevel);
      const compassDirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      const dirIndex = Math.floor((Math.round(d) / 22.5) + 0.5) % 16;
      const dirLabel = compassDirs[dirIndex];

      hourObj.levels.push({
        name: step.name,
        icon: step.icon,
        z: step.z,
        temp: Math.round(t * 10) / 10,
        feltTemp: Math.round(felt),
        wetBulbTemp: Math.round(tw * 10) / 10,
        wind: Math.round(w),
        gusts: gusts,
        windDir: Math.round(d),
        windDirText: dirLabel,
        pressureHpa: pressHpa,
        freezingDiff: freezingDiff,
        precipType: precipType,
        precipIcon: precipIcon,
        isAboveFreezing: t > 0,
        isSnow: isSnow,
        foehnActive: stepFoehn,
        foehnNote: stepFoehnNote,
        windNote: stepWindNote
      });
    }

    hourlyProfiles.push(hourObj);
  }

  return hourlyProfiles;
}

function computeRouteTimeline({ parsedGPX, startTimeMs, speedKmh }) {
  return {
    pointCount: parsedGPX ? parsedGPX.pointCount : 0,
    speedKmh
  };
}
