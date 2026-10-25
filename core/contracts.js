/**
 * BEST WEATHER — Runtime Schema Validation & Contract Layer (Task 4a)
 * Sanitizes and normalizes third-party API payloads (Open-Meteo, RainViewer, LAWIS)
 * to guarantee complete type-safety and eliminate undefined/null runtime errors.
 */

/**
 * @typedef {Object} ValidatedLocation
 * @property {string} name
 * @property {number} lat
 * @property {number} lon
 * @property {number} elevation
 * @property {string} country
 * @property {boolean} isMountain
 */

/**
 * Validates and normalizes location coordinates and elevation
 * @param {any} raw
 * @returns {ValidatedLocation}
 */
export function validateLocation(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      name: 'München',
      lat: 48.1374,
      lon: 11.5755,
      elevation: 520,
      country: 'Deutschland',
      isMountain: false
    };
  }

  const lat = typeof raw.lat === 'number' && !isNaN(raw.lat) ? Math.max(-90, Math.min(90, raw.lat)) : 48.1374;
  const lon = typeof raw.lon === 'number' && !isNaN(raw.lon) ? Math.max(-180, Math.min(180, raw.lon)) : 11.5755;
  const elevation = typeof raw.elevation === 'number' && !isNaN(raw.elevation) ? Math.round(raw.elevation) : 520;
  const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : 'Unbekannter Ort';
  const country = typeof raw.country === 'string' ? raw.country : '';
  const isMountain = Boolean(raw.isMountain !== undefined ? raw.isMountain : elevation >= 1100);

  return {
    name,
    lat,
    lon,
    elevation,
    country,
    isMountain
  };
}

/**
 * Validates and normalizes current weather telemetry
 * @param {any} cur
 * @returns {Object}
 */
export function validateCurrentWeather(cur) {
  if (!cur || typeof cur !== 'object') {
    return {
      temperature_2m: 12.0,
      apparent_temperature: 11.5,
      relative_humidity_2m: 60,
      is_day: 1,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
      weather_code: 0,
      cloud_cover: 30,
      pressure_msl: 1013.2,
      surface_pressure: 955.0,
      wind_speed_10m: 12.0,
      wind_direction_10m: 240,
      wind_gusts_10m: 18.0,
      uv_index: 3.0
    };
  }

  return {
    temperature_2m: typeof cur.temperature_2m === 'number' && !isNaN(cur.temperature_2m) ? cur.temperature_2m : 12.0,
    apparent_temperature: typeof cur.apparent_temperature === 'number' && !isNaN(cur.apparent_temperature) ? cur.apparent_temperature : (cur.temperature_2m || 12.0),
    relative_humidity_2m: typeof cur.relative_humidity_2m === 'number' ? Math.max(0, Math.min(100, cur.relative_humidity_2m)) : 60,
    is_day: cur.is_day === 0 ? 0 : 1,
    precipitation: typeof cur.precipitation === 'number' ? Math.max(0, cur.precipitation) : 0,
    rain: typeof cur.rain === 'number' ? Math.max(0, cur.rain) : 0,
    showers: typeof cur.showers === 'number' ? Math.max(0, cur.showers) : 0,
    snowfall: typeof cur.snowfall === 'number' ? Math.max(0, cur.snowfall) : 0,
    weather_code: typeof cur.weather_code === 'number' && !isNaN(cur.weather_code) ? cur.weather_code : 0,
    cloud_cover: typeof cur.cloud_cover === 'number' ? Math.max(0, Math.min(100, cur.cloud_cover)) : 30,
    pressure_msl: typeof cur.pressure_msl === 'number' ? cur.pressure_msl : 1013.2,
    surface_pressure: typeof cur.surface_pressure === 'number' ? cur.surface_pressure : 955.0,
    wind_speed_10m: typeof cur.wind_speed_10m === 'number' ? Math.max(0, cur.wind_speed_10m) : 12.0,
    wind_direction_10m: typeof cur.wind_direction_10m === 'number' ? (cur.wind_direction_10m + 360) % 360 : 240,
    wind_gusts_10m: typeof cur.wind_gusts_10m === 'number' ? Math.max(0, cur.wind_gusts_10m) : 18.0,
    uv_index: typeof cur.uv_index === 'number' ? Math.max(0, cur.uv_index) : 3.0
  };
}

/**
 * Validates and normalizes hourly weather dataset
 * @param {any} hourly
 * @returns {Object|null}
 */
export function validateHourlyWeather(hourly) {
  if (!hourly || typeof hourly !== 'object' || !Array.isArray(hourly.time) || hourly.time.length === 0) {
    return null;
  }

  const length = hourly.time.length;
  const sanitizeArray = (arr, defaultValue = 0) => {
    if (!Array.isArray(arr)) return new Array(length).fill(defaultValue);
    return arr.map(v => (typeof v === 'number' && !isNaN(v) ? v : defaultValue));
  };

  return {
    time: hourly.time,
    temperature_2m: sanitizeArray(hourly.temperature_2m, 10.0),
    apparent_temperature: sanitizeArray(hourly.apparent_temperature, 10.0),
    relative_humidity_2m: sanitizeArray(hourly.relative_humidity_2m, 60),
    dew_point_2m: sanitizeArray(hourly.dew_point_2m, 3.0),
    precipitation: sanitizeArray(hourly.precipitation, 0),
    precipitation_probability: sanitizeArray(hourly.precipitation_probability, 0),
    weather_code: sanitizeArray(hourly.weather_code, 0),
    wind_speed_10m: sanitizeArray(hourly.wind_speed_10m, 10.0),
    wind_direction_10m: sanitizeArray(hourly.wind_direction_10m, 180),
    wind_gusts_10m: sanitizeArray(hourly.wind_gusts_10m, 15.0),
    pressure_msl: sanitizeArray(hourly.pressure_msl, 1013.0),
    surface_pressure: sanitizeArray(hourly.surface_pressure, 955.0),
    cloud_cover: sanitizeArray(hourly.cloud_cover, 50),
    uv_index: sanitizeArray(hourly.uv_index, 0),
    freezing_level_height: sanitizeArray(hourly.freezing_level_height, 2200),
    global_tilted_irradiance: sanitizeArray(hourly.global_tilted_irradiance, 0)
  };
}

/**
 * Validates multi-model ensemble comparisons (ECMWF vs GFS)
 * @param {any} mm
 * @returns {Object|null}
 */
export function validateMultiModel(mm) {
  if (!mm || typeof mm !== 'object' || !mm.ecmwf || !mm.gfs) {
    return null;
  }

  return {
    timestamp: mm.timestamp || new Date().toISOString(),
    consensusScore: typeof mm.consensusScore === 'number' ? Math.max(50, Math.min(99, mm.consensusScore)) : 82,
    consensusText: mm.consensusText || 'Gute Modell-Übereinstimmung',
    hourlyTime: Array.isArray(mm.hourlyTime) ? mm.hourlyTime : [],
    strategy: mm.strategy || null,
    weights: mm.weights || null,
    activeRegionalModel: mm.activeRegionalModel || null,
    regional: mm.regional || null,
    icon: mm.icon || null,
    weightedConsensus: mm.weightedConsensus || null,
    ecmwf: {
      name: mm.ecmwf.name || 'ECMWF IFS 0.25°',
      origin: mm.ecmwf.origin || 'Europäisches Zentrum für mittelfristige Wettervorhersage',
      currentTemp: typeof mm.ecmwf.currentTemp === 'number' ? mm.ecmwf.currentTemp : null,
      precip24h: typeof mm.ecmwf.precip24h === 'number' ? mm.ecmwf.precip24h : 0,
      maxWind24h: typeof mm.ecmwf.maxWind24h === 'number' ? mm.ecmwf.maxWind24h : 0,
      hourlyTemp: Array.isArray(mm.ecmwf.hourlyTemp) ? mm.ecmwf.hourlyTemp : [],
      hourlyPrecip: Array.isArray(mm.ecmwf.hourlyPrecip) ? mm.ecmwf.hourlyPrecip : [],
      hourlyWind: Array.isArray(mm.ecmwf.hourlyWind) ? mm.ecmwf.hourlyWind : []
    },
    gfs: {
      name: mm.gfs.name || 'GFS Seamless',
      origin: mm.gfs.origin || 'US NOAA',
      currentTemp: typeof mm.gfs.currentTemp === 'number' ? mm.gfs.currentTemp : null,
      precip24h: typeof mm.gfs.precip24h === 'number' ? mm.gfs.precip24h : 0,
      maxWind24h: typeof mm.gfs.maxWind24h === 'number' ? mm.gfs.maxWind24h : 0,
      hourlyTemp: Array.isArray(mm.gfs.hourlyTemp) ? mm.gfs.hourlyTemp : [],
      hourlyPrecip: Array.isArray(mm.gfs.hourlyPrecip) ? mm.gfs.hourlyPrecip : [],
      hourlyWind: Array.isArray(mm.gfs.hourlyWind) ? mm.gfs.hourlyWind : []
    }
  };
}
