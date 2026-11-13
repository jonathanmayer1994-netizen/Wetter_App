/**
 * BEST WEATHER — High-Precision Solar Astronomy & Day/Night Terminator Engine
 * Computes exact solar altitude, subsolar coordinates, twilight phases,
 * and geographic night terminator curves for seamless 60 FPS timeline lighting.
 */

const RAD = Math.PI / 180.0;
const DEG = 180.0 / Math.PI;

/**
 * Computes high-precision solar position, elevation angle, and lighting factors.
 * Based on Meeus / NOAA solar ephemeris algorithms.
 *
 * @param {number|Date} dateOrTimestampMs - Target timestamp in milliseconds or Date
 * @param {number} lat - Latitude in degrees (-90 to +90)
 * @param {number} lon - Longitude in degrees (-180 to +180)
 * @returns {object} Solar calculation result
 */
export function getSolarPosition(dateOrTimestampMs, lat, lon) {
  const dt = (typeof dateOrTimestampMs === 'number') ? new Date(dateOrTimestampMs) : dateOrTimestampMs;
  const timeMs = dt.getTime();

  // Julian Day from UTC
  const jd = timeMs / 86400000.0 + 2440587.5;
  const T = (jd - 2451545.0) / 36525.0;

  // Geometric Mean Anomaly of the Sun
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) % 360.0;
  const mRad = (M < 0 ? M + 360.0 : M) * RAD;

  // Equation of the Center
  const C = Math.sin(mRad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
            Math.sin(2 * mRad) * (0.019993 - 0.000101 * T) +
            Math.sin(3 * mRad) * 0.000289;

  // Geometric Mean Longitude
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360.0;
  const sunLon = (L0 + C) % 360.0;
  const sunLonRad = (sunLon < 0 ? sunLon + 360.0 : sunLon) * RAD;

  // Mean Obliquity of the Ecliptic
  const eps0 = 23.0 + (26.0 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60.0) / 60.0;
  const eps = (eps0 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * RAD)) * RAD;

  // Declination (delta) & Right Ascension (alpha)
  const sinDec = Math.sin(eps) * Math.sin(sunLonRad);
  const decRad = Math.asin(sinDec);
  const decDeg = decRad * DEG;
  const cosDec = Math.cos(decRad);

  const raRad = Math.atan2(Math.cos(eps) * Math.sin(sunLonRad), Math.cos(sunLonRad));

  // Greenwich Mean Sidereal Time (GMST)
  const gmst0 = (280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000.0) % 360.0;
  const gmstDeg = gmst0 < 0 ? gmst0 + 360.0 : gmst0;
  const gmstRad = gmstDeg * RAD;

  // Subsolar Point on Earth
  let subSolarLon = (raRad - gmstRad) * DEG;
  subSolarLon = ((subSolarLon + 180.0) % 360.0) - 180.0;
  if (subSolarLon < -180.0) subSolarLon += 360.0;
  const subSolarLat = decDeg;

  // Local Hour Angle for specified lat/lon
  let H = gmstRad + (lon * RAD) - raRad;
  H = Math.atan2(Math.sin(H), Math.cos(H));

  // Solar Altitude (elevation angle above astronomical horizon)
  const phi = lat * RAD;
  const sinAlt = Math.sin(phi) * sinDec + Math.cos(phi) * cosDec * Math.cos(H);
  const clampedSinAlt = Math.max(-1.0, Math.min(1.0, sinAlt));
  const altitude = Math.asin(clampedSinAlt) * DEG;

  // Continuous Lighting Factor: 1.0 (Full Day) to 0.0 (Deep Night)
  // Transition window: +6 deg down to -8 deg (Civil to Nautical twilight)
  const normT = Math.max(0.0, Math.min(1.0, (altitude - (-8.0)) / 14.0));
  // Smooth Hermite interpolation (S-Curve)
  const lightFactor = normT * normT * (3.0 - 2.0 * normT);

  // Warmth factor: peaks at sunset / sunrise (golden hour / alpenglow) around 0 deg altitude
  // Gaussian bell curve centered around +0.5 deg with sigma ~ 3.5 deg
  const warmthDist = (altitude - 0.5) / 3.5;
  const warmthFactor = Math.max(0.0, Math.min(1.0, Math.exp(-0.5 * warmthDist * warmthDist)));

  // Solar Phase Classification & Iconography
  let phase = 'day';
  let icon = '☀️';
  let label = 'Tag';

  if (altitude > 6.0) {
    phase = 'day';
    icon = '☀️';
    label = 'Tag';
  } else if (altitude > 0.0) {
    phase = 'golden-hour';
    icon = '🌅';
    label = 'Goldene Stunde';
  } else if (altitude > -6.0) {
    phase = 'civil-twilight';
    icon = '🌅';
    label = 'Dämmerung';
  } else if (altitude > -12.0) {
    phase = 'nautical-twilight';
    icon = '🌙';
    label = 'Dämmerung';
  } else {
    phase = 'night';
    icon = '🌙';
    label = 'Nacht';
  }

  return {
    altitude,
    subSolarLat,
    subSolarLon,
    lightFactor,
    warmthFactor,
    phase,
    icon,
    label
  };
}

/**
 * Generates the geographic coordinates of the Solar Terminator polygon
 * enclosing the nocturnal hemisphere of the Earth.
 *
 * @param {number|Date} dateOrTimestampMs
 * @param {number} stepDeg - Longitude sampling step in degrees (default 3 deg)
 * @returns {Array<[number, number]>} Closed polygon coordinates [[lat, lon], ...]
 */
export function getTerminatorPolygon(dateOrTimestampMs, stepDeg = 3) {
  const solar = getSolarPosition(dateOrTimestampMs, 0, 0);
  const subLatRad = solar.subSolarLat * RAD;
  const subLonDeg = solar.subSolarLon;

  // Prevent divide by zero when sun is exactly on the equator
  let tanSubLat = Math.tan(subLatRad);
  if (Math.abs(tanSubLat) < 1e-7) {
    tanSubLat = (tanSubLat < 0 ? -1e-7 : 1e-7);
  }

  const ring = [];
  const startLon = -180;
  const endLon = 180;

  for (let lon = startLon; lon <= endLon; lon += stepDeg) {
    const deltaLonRad = (lon - subLonDeg) * RAD;
    const tanLat = -Math.cos(deltaLonRad) / tanSubLat;
    let lat = Math.atan(tanLat) * DEG;
    // Clamp to valid range (-85 to +85)
    lat = Math.max(-85.0, Math.min(85.0, lat));
    ring.push([lat, lon]);
  }

  // Enclose the dark hemisphere around the appropriate pole:
  // When subLat < 0 (Sun in Southern hemisphere): North pole is dark (lat = +85)
  // When subLat >= 0 (Sun in Northern hemisphere): South pole is dark (lat = -85)
  const darkPoleLat = subLatRad < 0 ? 85.0 : -85.0;

  ring.push([darkPoleLat, 180]);
  ring.push([darkPoleLat, -180]);
  ring.push(ring[0]);

  return ring;
}

/**
 * Returns RGBA color styles for the ambient lighting shader.
 *
 * @param {object} solar - Solar position object from getSolarPosition
 * @returns {object} { overlayColor, tileBrightness, tileContrast, tileSaturate }
 */
export function getSolarAtmosphereStyle(solar) {
  const lf = solar.lightFactor; // 1.0 (Day) -> 0.0 (Night)
  const wf = solar.warmthFactor; // 0.0 -> 1.0 (Twilight)

  // Darkness overlay opacity: 0 at full day, up to 0.68 at deep night
  const nightOpacity = (1.0 - lf) * 0.68;

  // Warmth overlay: golden glow during sunrise/sunset
  const warmthOpacity = wf * 0.26;

  // Tile filter adjustments for crisp day/night balance
  // Brightness: 1.0 (day) down to 0.62 (night)
  const tileBrightness = 0.62 + 0.38 * lf;
  // Contrast: 1.0 (day) to 1.15 (night) for better radar/label contrast
  const tileContrast = 1.0 + 0.15 * (1.0 - lf);
  // Saturation: slight boost in golden hour, slightly desaturated at night
  const tileSaturate = 0.85 + 0.15 * lf + 0.20 * wf;

  return {
    lightFactor: lf,
    warmthFactor: wf,
    nightOpacity,
    warmthOpacity,
    tileBrightness,
    tileContrast,
    tileSaturate,
    overlayColor: `rgba(6, 12, 26, ${nightOpacity.toFixed(3)})`,
    warmthColor: `rgba(255, 140, 50, ${warmthOpacity.toFixed(3)})`
  };
}

