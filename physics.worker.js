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
    { name: 'Talboden', z: valleyZ, icon: '🏡' },
    { name: 'Mittelstation', z: midZ, icon: '🌲' },
    { name: 'Gipfel / Grat', z: peakZ, icon: '🏔️' },
    { name: 'Freie Atmosphäre', z: highZ, icon: '🦅' }
  ];

  const hourlyProfiles = [];
  for (let i = 0; i < Math.min(24, h.time.length); i++) {
    const timeStr = h.time[i];
    const hourObj = {
      time: timeStr,
      hour: new Date(timeStr).getHours(),
      freezingLevel: h.freezing_level_height ? h.freezing_level_height[i] : 2500,
      precip: h.precipitation ? h.precipitation[i] : 0,
      levels: []
    };

    const levels = [1000, 925, 850, 700, 600, 500];
    const stack = levels.map(hpa => ({
      hpa,
      z: h[`geopotential_height_${hpa}hPa`]?.[i],
      temp: h[`temperature_${hpa}hPa`]?.[i],
      wind: h[`wind_speed_${hpa}hPa`]?.[i],
      dir: h[`wind_direction_${hpa}hPa`]?.[i]
    })).filter(l => l.z !== undefined && l.temp !== undefined);

    for (const step of steps) {
      let t = 0;
      let w = 0;
      let d = 250;
      if (stack.length >= 2) {
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
        w = low.wind + weight * (up.wind - low.wind);
        if (low.dir !== undefined && up.dir !== undefined) {
          let diff = ((up.dir - low.dir + 180) % 360) - 180;
          d = (low.dir + weight * diff + 360) % 360;
        } else if (low.dir !== undefined) {
          d = low.dir;
        }
      } else {
        const baseT = (h.temperature_2m && h.temperature_2m[i] !== undefined) ? h.temperature_2m[i] : 10;
        t = baseT - ((step.z - valleyZ) * 0.0065);
        w = (h.wind_speed_10m ? h.wind_speed_10m[i] : 10) * (1 + (step.z / 2000));
        const baseDir = (h.wind_direction_10m && h.wind_direction_10m[i] !== undefined) ? h.wind_direction_10m[i] : 210;
        d = (baseDir + Math.min(65, (step.z / 4000) * 65)) % 360;
      }

      const isSnow = step.z >= hourObj.freezingLevel;
      
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
      const freezingDiff = Math.round(step.z - hourObj.freezingLevel);
      const compassDirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      const dirIndex = Math.floor((Math.round(d) / 22.5) + 0.5) % 16;
      const dirLabel = compassDirs[dirIndex];

      hourObj.levels.push({
        name: step.name,
        icon: step.icon,
        z: step.z,
        temp: Math.round(t * 10) / 10,
        feltTemp: Math.round(felt),
        wind: Math.round(w),
        gusts: gusts,
        windDir: Math.round(d),
        windDirText: dirLabel,
        pressureHpa: pressHpa,
        freezingDiff: freezingDiff,
        precipType: isSnow ? 'Schnee' : 'Regen',
        isAboveFreezing: !isSnow
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
