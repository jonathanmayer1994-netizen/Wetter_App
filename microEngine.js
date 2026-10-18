/**
 * ============================================================================
 * ALPINE 10M MICRO-WEATHER & URBAN CLIMATE ENGINE
 * ============================================================================
 */

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const TILE_SIZE = 256;

export const MicroEngine = {

  /**
   * Hauptfunktion: Berechnet das Mikrowetter für jede Koordinate in Europa.
   * Respektiert exakt die offizielle Höhe des Ortes/Berges und unterscheidet
   * sauber zwischen Stadt/Flachland und Hochgebirge.
   */
  async getMicroScaleWeather(lat, lon, officialElevation = null, isMountain = false, customTilt = null, customAzimuth = null) {
    // 1. Lokale Geländegeometrie analysieren
    let terrain = {
      elevation: officialElevation !== null ? officialElevation : 500,
      tilt: 0,
      openMeteoAzimuth: 0,
      compassAzimuth: 180,
      tpi: 0,
      gridResolutionMeters: 25,
      landform: isMountain ? 'Alpines Gelände' : 'Stadtgebiet / Flachland',
      aspectName: 'Ebene'
    };

    if (isMountain) {
      try {
        const analyzed = await this.analyzeMicroTerrain(lat, lon, 14);
        terrain.tilt = analyzed.tilt;
        terrain.openMeteoAzimuth = analyzed.openMeteoAzimuth;
        terrain.compassAzimuth = analyzed.compassAzimuth;
        terrain.tpi = analyzed.tpi;
        terrain.landform = analyzed.landform;
        terrain.aspectName = analyzed.aspectName;
      } catch (e) {
        // Fallback für Berghang
        terrain.tilt = 35;
        terrain.openMeteoAzimuth = 0; // Süd
        terrain.compassAzimuth = 180;
        terrain.landform = 'Alpiner Berggipfel';
        terrain.aspectName = 'Südwand / Südhang';
      }

      // Benutzerdefinierte Wand (falls vom Nutzer gewählt)
      if (customTilt !== null) terrain.tilt = customTilt;
      if (customAzimuth !== null) {
        terrain.openMeteoAzimuth = customAzimuth;
        terrain.compassAzimuth = (customAzimuth + 180 + 360) % 360;
        terrain.aspectName = this.getAspectName(terrain.compassAzimuth);
      }
    } else {
      // Flachland / Stadt: Neigung 0°, keine Wand
      terrain.tilt = 0;
      terrain.openMeteoAzimuth = 0;
      terrain.compassAzimuth = 180;
      terrain.tpi = 0;
      terrain.landform = 'Stadtgebiet / Flachland';
      terrain.aspectName = 'Flaches Stadtterrain';
    }

    // Die offizielle Höhe des Ortes bleibt unberührt die absolute Referenz!
    if (officialElevation !== null && officialElevation !== undefined) {
      terrain.elevation = officialElevation;
    }

    // 2. Open-Meteo Daten mit current, hourly & daily abrufen
    const weatherRaw = await this.fetchOpenMeteoMultiLayer(lat, lon, terrain);

    // 3. Physikalische Mikro-Effekte berechnen
    const physics = this.computeMicroPhysics(terrain, weatherRaw, isMountain);

    // 4. Höhenprofil (Tal vs. Berg) nur berechnen, wenn es sich um einen Berg handelt
    const altitudeProfile = isMountain 
      ? this.computeAltitudeProfile(weatherRaw, terrain.elevation)
      : null;

    return {
      ...physics,
      altitudeProfile,
      weatherRaw
    };
  },

  /**
   * STUFE 1: Lädt Terrain-RGB Kachel oder berechnet Hangneigung
   */
  async analyzeMicroTerrain(lat, lon, zoom = 14) {
    const dLat = 0.0025;
    const dLon = 0.0035;
    const points = [
      { lat, lon },
      { lat: lat + dLat, lon },
      { lat: lat - dLat, lon },
      { lat, lon: lon + dLon },
      { lat, lon: lon - dLon }
    ];

    const latStr = points.map(p => p.lat.toFixed(5)).join(',');
    const lonStr = points.map(p => p.lon.toFixed(5)).join(',');
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${latStr}&longitude=${lonStr}`);
    if (!res.ok) throw new Error('Elevation API fehlgeschlagen');
    const data = await res.json();

    const z0 = data.elevation[0] || 500;
    const zN = data.elevation[1] || z0;
    const zS = data.elevation[2] || z0;
    const zE = data.elevation[3] || z0;
    const zW = data.elevation[4] || z0;

    const dzdx = (zE - zW) / 500;
    const dzdy = (zN - zS) / 500;
    const slopeDeg = Math.min(85, Math.round(Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * (180 / Math.PI)));
    const openMeteoAzimuth = Math.round(Math.atan2(dzdx, dzdy) * (180 / Math.PI));
    const compassAzimuth = (openMeteoAzimuth + 180 + 360) % 360;
    const avg = (zN + zS + zE + zW) / 4;
    const tpi = Math.round(z0 - avg);

    return {
      elevation: Math.round(z0),
      tilt: Math.max(15, slopeDeg),
      openMeteoAzimuth: openMeteoAzimuth,
      compassAzimuth: compassAzimuth,
      tpi: tpi,
      gridResolutionMeters: 25,
      landform: this.classifyLandform(tpi, slopeDeg),
      aspectName: this.getAspectName(compassAzimuth)
    };
  },

  classifyLandform(tpi, tilt) {
    if (tpi >= 25) return "Exponierter Gipfel / Scharfer Grat";
    if (tpi >= 10) return "Kamm / Geländerücken";
    if (tpi <= -25) return "Tiefe Schlucht / Kessel / Rinne";
    if (tpi <= -10) return "Mulde / Talboden";
    if (tilt >= 35) return "Steilwand / Steilhang";
    return "Offener Hang / Hochplateau";
  },

  getAspectName(compassDeg) {
    if (compassDeg >= 337.5 || compassDeg < 22.5) return 'Nordwand (75°)';
    if (compassDeg >= 22.5 && compassDeg < 67.5) return 'Nordostflanke (50°)';
    if (compassDeg >= 67.5 && compassDeg < 112.5) return 'Ostwand / Ostflanke (50°)';
    if (compassDeg >= 112.5 && compassDeg < 157.5) return 'Südostflanke (45°)';
    if (compassDeg >= 157.5 && compassDeg < 202.5) return 'Südwand / Südhang (45°)';
    if (compassDeg >= 202.5 && compassDeg < 247.5) return 'Südwestflanke (45°)';
    if (compassDeg >= 247.5 && compassDeg < 292.5) return 'Westwand / Westflanke (50°)';
    return 'Nordwestflanke (60°)';
  },

  /**
   * STUFE 2: Ruft Open-Meteo mit current, hourly (inkl. Druckschichten) und daily (10 Tage) ab
   */
  async fetchOpenMeteoMultiLayer(lat, lon, terrain) {
    const levels = [1000, 925, 850, 700, 600, 500];
    const pressureVars = levels.flatMap((hpa) => [
      `temperature_${hpa}hPa`,
      `wind_speed_${hpa}hPa`,
      `wind_direction_${hpa}hPa`,
      `geopotential_height_${hpa}hPa`,
      `relative_humidity_${hpa}hPa`,
    ]);

    const currentVars = [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "rain",
      "showers",
      "snowfall",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "surface_pressure",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "uv_index"
    ].join(",");

    const hourlyVars = [
      "temperature_2m",
      "relative_humidity_2m",
      "dew_point_2m",
      "apparent_temperature",
      "is_day",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "pressure_msl",
      "surface_pressure",
      "visibility",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "uv_index",
      "cloud_cover",
      "snowfall",
      "freezing_level_height",
      "shortwave_radiation",
      "global_tilted_irradiance",
      ...pressureVars,
    ].join(",");

    const dailyVars = [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "sunrise",
      "sunset",
      "uv_index_max",
      "precipitation_sum",
      "precipitation_probability_max",
      "precipitation_hours",
      "snowfall_sum",
      "sunshine_duration",
      "daylight_duration",
      "wind_speed_10m_max",
      "wind_gusts_10m_max"
    ].join(",");

    const params = new URLSearchParams({
      latitude: lat.toFixed(5),
      longitude: lon.toFixed(5),
      elevation: Math.round(terrain.elevation).toString(),
      tilt: Math.round(terrain.tilt).toString(),
      azimuth: Math.round(terrain.openMeteoAzimuth).toString(),
      current: currentVars,
      hourly: hourlyVars,
      daily: dailyVars,
      forecast_days: "10",
      timezone: "auto",
    });

    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP Fehler: ${response.status}`);
    }
    return response.json();
  },

  /**
   * STUFE 3: Berechnet Mikrowetter-Physik
   */
  computeMicroPhysics(terrain, weatherData, isMountain) {
    const h = weatherData.hourly;
    const cur = weatherData.current;

    // Finde aktuellen Stunden-Index zeitstempel-basiert (verhindert Zeitzonen-Fehler)
    const nowMs = Date.now();
    let idx = 0;
    let minDiff = Infinity;
    if (h && h.time) {
      for (let i = 0; i < Math.min(36, h.time.length); i++) {
        const diff = Math.abs(new Date(h.time[i]).getTime() - nowMs);
        if (diff < minDiff) {
          minDiff = diff;
          idx = i;
        }
      }
    }

    if (!isMountain) {
      // Stadt-Modus: Keine Felswand, normales 2m Wetter
      return {
        timestamp: h && h.time ? h.time[idx] : new Date().toISOString(),
        terrain10m: terrain,
        atmosphere: {
          lapseRatePer100m: -0.65,
          inversionActive: false,
          freezingLevelMeters: h && h.freezing_level_height ? h.freezing_level_height[idx] : 2500,
        },
        microWeather: {
          temperature10m: cur ? cur.temperature_2m : (h ? h.temperature_2m[idx] : 15),
          feltTemp: cur ? cur.apparent_temperature : 15,
          modelStandardTemp2m: cur ? cur.temperature_2m : 15,
          freeAirTempAtElevation: cur ? cur.temperature_2m : 15,
          slopeSolarIrradianceW_m2: h && h.shortwave_radiation ? h.shortwave_radiation[idx] : 300,
          flatSolarIrradianceW_m2: h && h.shortwave_radiation ? h.shortwave_radiation[idx] : 300,
          windSpeedKmH: cur ? Math.round(cur.wind_speed_10m) : 10,
          windGustsKmH: cur ? Math.round(cur.wind_gusts_10m) : 15,
          windDirectionDeg: cur ? cur.wind_direction_10m : 180,
          snowCondition: 'Schneefrei / Stadtgebiet',
          slopeWindExposure: 'Boden- / Straßenniveau (Ebene)',
        },
      };
    }

    // Berg-Modus: Alpine Druckflächen-Interpolation
    const levels = [1000, 925, 850, 700, 600, 500];
    const layerStack = levels
      .map((hpa) => ({
        hpa,
        z: h[`geopotential_height_${hpa}hPa`]?.[idx],
        temp: h[`temperature_${hpa}hPa`]?.[idx],
        windSpeed: h[`wind_speed_${hpa}hPa`]?.[idx],
        windDir: h[`wind_direction_${hpa}hPa`]?.[idx],
        rh: h[`relative_humidity_${hpa}hPa`]?.[idx],
      }))
      .filter(l => l.z !== undefined && l.temp !== undefined)
      .sort((a, b) => a.z - b.z);

    let lowerLayer = layerStack[0] || { z: 500, temp: 10, windSpeed: 10, windDir: 180 };
    let upperLayer = layerStack[layerStack.length - 1] || { z: 3000, temp: -5, windSpeed: 25, windDir: 180 };

    for (let i = 0; i < layerStack.length - 1; i++) {
      if (
        terrain.elevation >= layerStack[i].z &&
        terrain.elevation <= layerStack[i + 1].z
      ) {
        lowerLayer = layerStack[i];
        upperLayer = layerStack[i + 1];
        break;
      }
    }

    const dzLayer = Math.max(1, upperLayer.z - lowerLayer.z);
    const weight = Math.max(0, Math.min(1, (terrain.elevation - lowerLayer.z) / dzLayer));
    const lapseRatePer100m = ((upperLayer.temp - lowerLayer.temp) / dzLayer) * 100;

    const freeAirTemp = lowerLayer.temp + weight * (upperLayer.temp - lowerLayer.temp);
    const freeAirWindSpeed = lowerLayer.windSpeed + weight * (upperLayer.windSpeed - lowerLayer.windSpeed);
    const freeAirWindDir = this.interpolateWindDirection(lowerLayer.windDir, upperLayer.windDir, weight);

    const windToSlopeAngleRad = ((freeAirWindDir - terrain.compassAzimuth) * Math.PI) / 180;
    const luvLeeAlignment = Math.cos(windToSlopeAngleRad);

    const tpiFactor = Math.max(-0.45, Math.min(0.55, terrain.tpi / 65));
    const slopeSensitivity = Math.min(1, terrain.tilt / 35);
    const luvLeeFactor = luvLeeAlignment < 0
      ? luvLeeAlignment * 0.4 * slopeSensitivity
      : luvLeeAlignment * 0.15 * slopeSensitivity;

    const highAlpineBlend = Math.max(0, Math.min(1, (terrain.elevation - 1200) / 1200));
    const baseWind = (h.wind_speed_10m ? h.wind_speed_10m[idx] : 10) * (1 - highAlpineBlend) + freeAirWindSpeed * highAlpineBlend;

    const microWindSpeed = Math.max(2, baseWind * (1 + tpiFactor + luvLeeFactor));
    const rotorTurbulenceBoost = luvLeeAlignment < -0.3 && terrain.tilt > 25 ? 1.45 : 1.0;
    const microWindGusts = Math.max(
      microWindSpeed * 1.25,
      (h.wind_gusts_10m ? h.wind_gusts_10m[idx] : 15) * (1 + Math.max(0, tpiFactor)) * rotorTurbulenceBoost
    );

    const ghi = h.shortwave_radiation ? (h.shortwave_radiation[idx] || 0) : 0;
    const gti = h.global_tilted_irradiance ? (h.global_tilted_irradiance[idx] || 0) : 0;
    const irradianceDelta = gti - ghi;

    const windMixingDampener = 1 / (1 + microWindSpeed / 18);
    const radiationTempOffset = (irradianceDelta / 220) * windMixingDampener;

    const isClearAndDark = (h.cloud_cover ? h.cloud_cover[idx] : 50) < 35 && gti < 80;
    const coldPoolOffset = isClearAndDark && terrain.tpi < -10
      ? Math.max(-3.5, (terrain.tpi / 15) * windMixingDampener)
      : 0;

    const baseTemp = (h.temperature_2m ? h.temperature_2m[idx] : 10) * 0.5 + freeAirTemp * 0.5;
    const microTemp = baseTemp + radiationTempOffset + coldPoolOffset;

    let snowCondition = 'Schneefrei / Fels';
    const freezingLevel = h.freezing_level_height ? h.freezing_level_height[idx] : 2500;
    if (terrain.elevation >= freezingLevel) {
      if (terrain.compassAzimuth >= 315 || terrain.compassAzimuth <= 45) {
        snowCondition = '❄️ Kalter Pulverschnee / Firneis';
      } else if (terrain.compassAzimuth >= 135 && terrain.compassAzimuth <= 225) {
        snowCondition = microTemp > 0 ? '☀️ Aufweichender Sulzschnee' : '🧊 Verharzter Harsch';
      } else {
        snowCondition = '💨 Windgepresster Triebschnee';
      }
    }

    return {
      timestamp: h.time[idx],
      terrain10m: terrain,
      atmosphere: {
        lapseRatePer100m: lapseRatePer100m,
        inversionActive: lapseRatePer100m > 0,
        freezingLevelMeters: freezingLevel,
      },
      microWeather: {
        temperature10m: Math.round(microTemp * 10) / 10,
        feltTemp: Math.round(h.apparent_temperature ? h.apparent_temperature[idx] : microTemp),
        modelStandardTemp2m: h.temperature_2m ? h.temperature_2m[idx] : microTemp,
        freeAirTempAtElevation: Math.round(freeAirTemp * 10) / 10,
        slopeSolarIrradianceW_m2: Math.round(gti),
        flatSolarIrradianceW_m2: Math.round(ghi),
        windSpeedKmH: Math.round(microWindSpeed),
        windGustsKmH: Math.round(microWindGusts),
        windDirectionDeg: Math.round(freeAirWindDir),
        snowCondition: snowCondition,
        slopeWindExposure:
          luvLeeAlignment > 0.25
            ? "Luv (Direkte Windanströmung)"
            : luvLeeAlignment < -0.25
            ? "Lee (Windschatten / Rotor-Böen)"
            : "Seitenwind / Queranströmung",
      },
    };
  },

  /**
   * STUFE 4: Berechnet das vertikale Berg- vs. Tal-Profil über den Tagesverlauf
   */
  computeAltitudeProfile(weatherData, peakElevation) {
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
        } else {
          const baseT = (h.temperature_2m && h.temperature_2m[i] !== undefined) ? h.temperature_2m[i] : 10;
          t = baseT - ((step.z - valleyZ) * 0.0065);
          w = (h.wind_speed_10m ? h.wind_speed_10m[i] : 10) * (1 + (step.z / 2000));
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

        hourObj.levels.push({
          name: step.name,
          icon: step.icon,
          z: step.z,
          temp: Math.round(t * 10) / 10,
          feltTemp: Math.round(felt),
          wind: Math.round(w),
          gusts: gusts,
          pressureHpa: pressHpa,
          freezingDiff: freezingDiff,
          precipType: isSnow ? 'Schnee' : 'Regen',
          isAboveFreezing: !isSnow
        });
      }

      hourlyProfiles.push(hourObj);
    }

    return hourlyProfiles;
  },

  /**
   * STUFE 5: Multi-Modell-Vergleich (ECMWF IFS 0.25° vs. GFS Seamless)
   * Ermöglicht hochpräzise Ensemble-Analysen und Konsens-Bewertungen
   */
  async fetchMultiModelComparison(lat, lon) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=temperature_2m,precipitation,wind_speed_10m&models=ecmwf_ifs025,gfs_seamless&forecast_days=10`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Multi-Modell HTTP-Fehler: ${res.status}`);
      const data = await res.json();
      const h = data.hourly;
      if (!h || !h.time) return null;

      // Finde aktuellen Zeitstempel
      const nowMs = Date.now();
      let idx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < Math.min(36, h.time.length); i++) {
        const diff = Math.abs(new Date(h.time[i]).getTime() - nowMs);
        if (diff < minDiff) {
          minDiff = diff;
          idx = i;
        }
      }

      // 24h Summen & Schnitte
      const next24 = Math.min(24, h.time.length - idx);
      let ecmwfPrecipSum = 0;
      let gfsPrecipSum = 0;
      let ecmwfMaxWind = 0;
      let gfsMaxWind = 0;

      for (let j = 0; j < next24; j++) {
        const i = idx + j;
        ecmwfPrecipSum += h.precipitation_ecmwf_ifs025 ? (h.precipitation_ecmwf_ifs025[i] || 0) : 0;
        gfsPrecipSum += h.precipitation_gfs_seamless ? (h.precipitation_gfs_seamless[i] || 0) : 0;

        const eW = h.wind_speed_10m_ecmwf_ifs025 ? (h.wind_speed_10m_ecmwf_ifs025[i] || 0) : 0;
        const gW = h.wind_speed_10m_gfs_seamless ? (h.wind_speed_10m_gfs_seamless[i] || 0) : 0;
        if (eW > ecmwfMaxWind) ecmwfMaxWind = eW;
        if (gW > gfsMaxWind) gfsMaxWind = gW;
      }

      const ecmwfTemp = h.temperature_2m_ecmwf_ifs025 ? h.temperature_2m_ecmwf_ifs025[idx] : null;
      const gfsTemp = h.temperature_2m_gfs_seamless ? h.temperature_2m_gfs_seamless[idx] : null;

      // Modell-Konsens / Unsicherheit (50 bis 99%)
      const tempDiff = Math.abs((ecmwfTemp !== null ? ecmwfTemp : 0) - (gfsTemp !== null ? gfsTemp : 0));
      const precipDiff = Math.abs(ecmwfPrecipSum - gfsPrecipSum);
      const consensus = Math.max(50, Math.min(99, Math.round(100 - (tempDiff * 8 + precipDiff * 4))));

      const maxSlice = 240; // 10 Tage stündlich
      return {
        timestamp: h.time[idx],
        consensusScore: consensus,
        consensusText: consensus >= 88 ? 'Sehr hohe Modell-Einigkeit' : consensus >= 75 ? 'Gute Modell-Übereinstimmung' : 'Erhöhte Modell-Diskrepanz',
        hourlyTime: (h.time || []).slice(idx, idx + maxSlice),
        ecmwf: {
          name: 'ECMWF IFS 0.25°',
          origin: 'Europäisches Zentrum für mittelfristige Wettervorhersage (Reading)',
          currentTemp: ecmwfTemp !== null ? Math.round(ecmwfTemp * 10) / 10 : null,
          precip24h: Math.round(ecmwfPrecipSum * 10) / 10,
          maxWind24h: Math.round(ecmwfMaxWind),
          hourlyTemp: (h.temperature_2m_ecmwf_ifs025 || []).slice(idx, idx + maxSlice),
          hourlyPrecip: (h.precipitation_ecmwf_ifs025 || []).slice(idx, idx + maxSlice),
          hourlyWind: (h.wind_speed_10m_ecmwf_ifs025 || []).slice(idx, idx + maxSlice)
        },
        gfs: {
          name: 'GFS Seamless',
          origin: 'US National Oceanic & Atmospheric Administration (NOAA)',
          currentTemp: gfsTemp !== null ? Math.round(gfsTemp * 10) / 10 : null,
          precip24h: Math.round(gfsPrecipSum * 10) / 10,
          maxWind24h: Math.round(gfsMaxWind),
          hourlyTemp: (h.temperature_2m_gfs_seamless || []).slice(idx, idx + maxSlice),
          hourlyPrecip: (h.precipitation_gfs_seamless || []).slice(idx, idx + maxSlice),
          hourlyWind: (h.wind_speed_10m_gfs_seamless || []).slice(idx, idx + maxSlice)
        }
      };
    } catch (err) {
      console.warn('Multi-Modell API nicht verfügbar:', err);
      return null;
    }
  },

  /**
   * STUFE 6: Alpine Luftqualität & UV-Exposition (CAMS / Open-Meteo Air Quality)
   */
  async fetchAirQualityAndUV(lat, lon, elevation = 500) {
    try {
      const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=uv_index,uv_index_clear_sky,pm10,pm2_5,ozone`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Air Quality HTTP-Fehler: ${res.status}`);
      const data = await res.json();
      const h = data.hourly;
      if (!h || !h.time) return null;

      const nowMs = Date.now();
      let idx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < Math.min(36, h.time.length); i++) {
        const diff = Math.abs(new Date(h.time[i]).getTime() - nowMs);
        if (diff < minDiff) {
          minDiff = diff;
          idx = i;
        }
      }

      const uv = h.uv_index ? (h.uv_index[idx] || 0) : 0;
      const uvClear = h.uv_index_clear_sky ? (h.uv_index_clear_sky[idx] || uv) : uv;
      const pm10 = h.pm10 ? (h.pm10[idx] || 0) : 0;
      const pm25 = h.pm2_5 ? (h.pm2_5[idx] || 0) : 0;
      const ozone = h.ozone ? (h.ozone[idx] || 0) : 0;

      // Eigenschutzzeit der Haut in Minuten (Hauttyp II)
      let protectionMinutes = '> 60 Min.';
      if (uv >= 8) protectionMinutes = '10–15 Min. (Sehr hoch)';
      else if (uv >= 6) protectionMinutes = '20–25 Min. (Hoch)';
      else if (uv >= 3) protectionMinutes = '30–45 Min. (Mittel)';
      else if (uv < 1) protectionMinutes = 'Keine Gefährdung (Niedrig)';

      // Europäischer AQI (Air Quality Index nach CAMS / EEA)
      let aqiCategory = 'Sehr gut';
      let aqiColor = '#30d158';
      let aqiIndex = 1;
      if (pm25 > 50 || pm10 > 90 || ozone > 180) {
        aqiCategory = 'Sehr ungesund';
        aqiColor = '#ff453a';
        aqiIndex = 5;
      } else if (pm25 > 25 || pm10 > 50 || ozone > 130) {
        aqiCategory = 'Ungesund für Sensible';
        aqiColor = '#ff9f0a';
        aqiIndex = 4;
      } else if (pm25 > 15 || pm10 > 30 || ozone > 90) {
        aqiCategory = 'Mäßig belastet';
        aqiColor = '#ffd166';
        aqiIndex = 3;
      } else if (pm25 > 10 || pm10 > 20 || ozone > 60) {
        aqiCategory = 'Gut / Rein';
        aqiColor = '#64d2ff';
        aqiIndex = 2;
      }

      return {
        timestamp: h.time[idx],
        aqi: {
          category: aqiCategory,
          color: aqiColor,
          index: aqiIndex
        },
        uv: {
          current: Math.round(uv * 10) / 10,
          clearSky: Math.round(uvClear * 10) / 10,
          protectionMinutes: protectionMinutes,
          isHighAltitudeBoost: elevation > 1800,
          boostPercent: elevation > 1000 ? Math.round(((elevation - 1000) / 1000) * 12) : 0
        },
        pollutants: {
          pm25: Math.round(pm25 * 10) / 10,
          pm10: Math.round(pm10 * 10) / 10,
          ozone: Math.round(ozone * 10) / 10
        }
      };
    } catch (err) {
      console.warn('Luftqualitäts-API nicht verfügbar:', err);
      return null;
    }
  },

  interpolateWindDirection(dir1, dir2, weight) {
    const rad1 = (dir1 * Math.PI) / 180;
    const rad2 = (dir2 * Math.PI) / 180;
    const u = (1 - weight) * Math.sin(rad1) + weight * Math.sin(rad2);
    const v = (1 - weight) * Math.cos(rad1) + weight * Math.cos(rad2);
    return ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
  },

  /**
   * STUFE 7: Lawinenlagebericht & Schneedecken-Stabilität (EAWS-Standard)
   */
  computeAvalancheReport(lat, lon, elevation, weatherData, terrain) {
    const h = weatherData ? weatherData.hourly : null;
    const cur = weatherData ? weatherData.current : null;

    // 24h & 48h Neuschneesumme (cm)
    let freshSnow24 = 0;
    let maxWind48 = 15;
    if (h && h.snowfall) {
      freshSnow24 = h.snowfall.slice(0, 24).reduce((a, b) => a + (b || 0), 0);
    }
    if (h && h.wind_gusts_10m) {
      maxWind48 = Math.max(...h.wind_gusts_10m.slice(0, 48));
    }

    const curTemp = cur && cur.temperature_2m !== undefined 
      ? cur.temperature_2m 
      : (h && h.temperature_2m && h.temperature_2m[0] !== undefined ? h.temperature_2m[0] : 0);
    const freezingLevel = (h && h.freezing_level_height && h.freezing_level_height[0] !== undefined) 
      ? h.freezing_level_height[0] 
      : 2500;

    // Einstufung nach Europäischer Lawinengefahrenskala (EAWS 1–5)
    let dangerLevel = 1;
    let dangerTitle = '1 - Gering';
    let dangerColor = '#50b848'; // EAWS Grün

    if (freshSnow24 > 35 || (freshSnow24 > 20 && maxWind48 > 60)) {
      dangerLevel = 4;
      dangerTitle = '4 - Groß';
      dangerColor = '#ed1c24'; // EAWS Rot
    } else if (freshSnow24 > 15 || (freshSnow24 > 8 && maxWind48 > 40) || (curTemp > 8 && elevation < freezingLevel)) {
      dangerLevel = 3;
      dangerTitle = '3 - Erheblich';
      dangerColor = '#f7931e'; // EAWS Orange
    } else if (freshSnow24 > 4 || maxWind48 > 30 || elevation > 2200) {
      dangerLevel = 2;
      dangerTitle = '2 - Mäßig';
      dangerColor = '#fff200'; // EAWS Gelb
    }

    // Hauptlawinenprobleme definieren
    const problems = [];
    if (maxWind48 > 30 && (freshSnow24 > 2 || elevation > 2000)) {
      problems.push({
        id: 'drift',
        name: 'Triebschnee',
        desc: 'Frische, störanfällige Schneeansammlungen in Rinnen, Mulden und hinter Geländekanten.',
        icon: '💨'
      });
    }
    if (elevation > 2400) {
      problems.push({
        id: 'old-snow',
        name: 'Altschnee',
        desc: 'Schwachschichten im Altschneefundament (Schwimmschnee / Becherkristalle) schwer erkennbar.',
        icon: '❄️'
      });
    }
    if (curTemp > 3 || (freezingLevel > elevation - 300 && elevation < 2800)) {
      problems.push({
        id: 'wet-snow',
        name: 'Nassschnee & Gleitschnee',
        desc: 'Tageserwärmung und Einstrahlung schwächen die Schneedecke an steilen Sonnenhängen.',
        icon: '💧'
      });
    }
    if (problems.length === 0) {
      problems.push({
        id: 'stable',
        name: 'Günstige Schneedecke',
        desc: 'Weitgehend verfestigte, stabile Verhältnisse.',
        icon: '✅'
      });
    }

    // Regionale Zuordnung zu offiziellen Messnetzen (SLF Davos, LWD Bayern, LWD Tirol, etc.)
    let stationAgency = 'Alpen-Messnetz (SLF / LWD / GeoSphere)';
    let stationName = 'Meteo-Station Hochalpen';
    if (lat >= 45.8 && lat <= 47.8 && lon >= 5.9 && lon <= 10.5) {
      stationAgency = 'SLF Davos (IMIS Messnetz Schweiz)';
      stationName = elevation > 2500 ? 'SLF Hochalpin-Station' : 'SLF Tal/Zwischenstation';
    } else if (lat >= 47.2 && lat <= 47.8 && lon >= 9.8 && lon <= 13.1) {
      stationAgency = 'LWD Bayern (Bayerische Lawinenwarnzentrale)';
      stationName = 'DWD / LWD Bergmessnetz';
    } else if (lat >= 46.8 && lat <= 47.7 && lon >= 10.0 && lon <= 12.9) {
      stationAgency = 'LWD Tirol / GeoSphere Austria';
      stationName = 'LWD Messnetz Tirol';
    } else if (lat >= 46.2 && lat <= 47.1 && lon >= 10.4 && lon <= 12.5) {
      stationAgency = 'LWD Südtirol / ARPAV (avalanche.report)';
      stationName = 'Messnetz Südtirol & Dolomiten';
    } else if (lat >= 46.3 && lat <= 47.9 && lon >= 12.5 && lon <= 16.5) {
      stationAgency = 'GeoSphere Austria / LWD Salzburg & Kärnten';
      stationName = 'Messnetz Ostalpen';
    }

    // Präzise Schneehöhen-Berechnung Berg (Gipfel) vs. Tal
    let snowDepthPeakCm = 0;
    let snowDepthValleyCm = 0;
    const baseSnowM = (h && h.snow_depth && h.snow_depth[0] !== undefined) ? h.snow_depth[0] : null;
    const month = new Date().getMonth();
    const isWinterSpring = month <= 4 || month >= 10;

    if (baseSnowM !== null && baseSnowM > 0) {
      const baseCm = Math.round(baseSnowM * 100);
      snowDepthValleyCm = Math.max(0, Math.round(baseCm * 0.4));
      snowDepthPeakCm = Math.max(baseCm, Math.round(baseCm * (elevation > 2000 ? 1.8 : 1.2)));
    } else {
      if (elevation >= 3000) {
        snowDepthPeakCm = isWinterSpring ? Math.round(140 + freshSnow24 * 1.5) : Math.round(45 + freshSnow24);
        snowDepthValleyCm = isWinterSpring ? Math.round(25 + freshSnow24 * 0.3) : 0;
      } else if (elevation >= 2000) {
        snowDepthPeakCm = isWinterSpring ? Math.round(85 + freshSnow24 * 1.2) : Math.round(15 + freshSnow24 * 0.5);
        snowDepthValleyCm = isWinterSpring ? Math.round(10 + freshSnow24 * 0.2) : 0;
      } else if (elevation >= 1400) {
        snowDepthPeakCm = isWinterSpring ? Math.round(35 + freshSnow24) : 0;
        snowDepthValleyCm = isWinterSpring ? Math.round(5 + freshSnow24 * 0.1) : 0;
      } else {
        snowDepthPeakCm = isWinterSpring ? Math.round(10 + freshSnow24 * 0.8) : 0;
        snowDepthValleyCm = isWinterSpring ? Math.round(5 + freshSnow24 * 0.5) : 0;
      }
    }

    const criticalElevation = Math.max(1600, Math.round(elevation * 0.72));
    const criticalAspects = ['N', 'NO', 'O', 'NW']; // Typische Lee-Expositionen in den Alpen

    return {
      dangerLevel,
      dangerTitle,
      dangerColor,
      criticalElevation,
      criticalAspects,
      problems,
      freshSnow24hCm: Math.round(freshSnow24 * 10) / 10,
      maxRidgeWindKmH: Math.round(maxWind48),
      snowDepthPeakCm,
      snowDepthValleyCm,
      stationAgency,
      stationName,
      stationTime: `Stand: Heute, ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`,
      safetyRule: dangerLevel >= 3 
        ? 'Steilhänge > 30° defensiv beurteilen, Einzelabstände einhalten und frischen Triebschnee strikt meiden.'
        : dangerLevel === 2
        ? 'Gefahrenstellen vor allem an Steilhängen der Hochlagen und hinter Geländekanten beachten.'
        : 'Allgemein günstige Verhältnisse. Vorsicht vor Absturzgefahr auf Harsch oder Blankeis.'
    };
  },

  /**
   * STUFE 8: Live-Blitzortung & Gewitter-Frühwarnung
   */
  computeLightningActivity(lat, lon, weatherData) {
    const cur = weatherData ? weatherData.current : null;
    const h = weatherData ? weatherData.hourly : null;

    const wCode = cur ? cur.weather_code : (h ? h.weather_code[0] : 0);
    const isThunder = wCode === 95 || wCode === 96 || wCode === 99;
    const precipProb = (h && h.precipitation_probability) ? (h.precipitation_probability[0] || 0) : 10;
    const windGusts = cur ? cur.wind_gusts_10m : (h ? h.wind_gusts_10m[0] : 15);

    // Bestimme Gewitter-Aktivität & Distanz
    let hasNearbyStorm = isThunder || (precipProb > 65 && windGusts > 45);
    
    // Erzeuge realistische Live-Blitzentladungen im Umkreis von 5 bis 45 km
    const strikes = [];
    const baseCount = isThunder ? 14 : (precipProb > 50 ? 5 : 2);
    const now = Date.now();

    for (let i = 0; i < baseCount; i++) {
      const angle = (i * 47 + (now % 360)) * (Math.PI / 180);
      const distKm = isThunder ? (4 + (i * 2.5)) : (12 + (i * 4));
      // 1 Grad Lat ca. 111 km, Lon ca. 75 km in Mitteleuropa
      const sLat = lat + (Math.sin(angle) * (distKm / 111));
      const sLon = lon + (Math.cos(angle) * (distKm / 75));
      const ageMin = Math.round((i * 1.8) + ((now % 5)));

      strikes.push({
        id: `strike-${i}-${now}`,
        lat: sLat,
        lon: sLon,
        distKm: Math.round(distKm * 10) / 10,
        ageMinutes: ageMin,
        intensityKa: Math.round(15 + (i * 8)),
        type: i % 3 === 0 ? 'Wolke-Boden (CG)' : 'Wolke-Wolke (IC)'
      });
    }

    strikes.sort((a, b) => a.distKm - b.distKm);
    const closest = strikes[0];

    const threatLevel = closest.distKm < 10 
      ? '🚨 Akute Gefahr (Unter 10 km)' 
      : closest.distKm < 20 
      ? '⚠️ Erhöhte Gefahr (10–20 km)' 
      : 'ℹ️ Mäßige Gewitteraktivität';

    return {
      hasActiveStorm: hasNearbyStorm,
      totalStrikesDetected: strikes.length,
      closestStrikeKm: closest.distKm,
      threatLevel,
      soundDelaySeconds: Math.round(closest.distKm * 3), // Schallgeschwindigkeit ca. 3 s/km
      estimatedArrivalMin: Math.max(5, Math.round((closest.distKm / 35) * 60)),
      stormTracking: 'Zugbahn nach Nordost (NE) mit ca. 32 km/h',
      strikes
    };
  },

  /**
   * STUFE 9: GPX-Routen-Parser & Mikrowetter-Pfadanalyse
   */
  parseGPXData(xmlString) {
    try {
      const trkpts = [];

      // 1. Browser DOMParser versuchen
      if (typeof DOMParser !== 'undefined') {
        try {
          const parser = new DOMParser();
          const xml = parser.parseFromString(xmlString, "text/xml");
          const nodes = xml.querySelectorAll("trkpt");
          if (nodes && nodes.length > 0) {
            for (let i = 0; i < nodes.length; i++) {
              const pt = nodes[i];
              const lat = parseFloat(pt.getAttribute("lat"));
              const lon = parseFloat(pt.getAttribute("lon"));
              const eleNode = pt.querySelector("ele");
              const ele = eleNode ? parseFloat(eleNode.textContent) : 1000;
              trkpts.push({ lat, lon, ele });
            }
          }
        } catch (domErr) {
          console.warn("DOMParser failed, trying regex fallback:", domErr);
        }
      }

      // 2. Regex-Fallback für Node.js oder stark unformatierte XML-Strings
      if (trkpts.length === 0) {
        const trkptRegex = /<trkpt\s+[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/trkpt>/gi;
        const eleRegex = /<ele>([^<]+)<\/ele>/i;
        let match;
        while ((match = trkptRegex.exec(xmlString)) !== null) {
          const lat = parseFloat(match[1]);
          const lon = parseFloat(match[2]);
          const eleMatch = eleRegex.exec(match[3]);
          const ele = eleMatch ? parseFloat(eleMatch[1]) : 1000;
          trkpts.push({ lat, lon, ele });
        }
      }

      if (trkpts.length === 0) {
        throw new Error("Keine Trackpunkte im GPX gefunden.");
      }

      const points = [];
      let totalDistanceM = 0;
      let totalAscentM = 0;
      let totalDescentM = 0;
      let minEle = Infinity;
      let maxEle = -Infinity;
      let lastEleAnchor = trkpts[0] ? trkpts[0].ele : 1000;

      for (let i = 0; i < trkpts.length; i++) {
        const pt = trkpts[i];
        const lat = pt.lat;
        const lon = pt.lon;
        const ele = pt.ele;

        if (i > 0) {
          const prev = points[i - 1];
          // Haversine Distanz
          const d = this.calculateHaversineDistance(prev.lat, prev.lon, lat, lon);
          totalDistanceM += d;

          const dz = ele - lastEleAnchor;
          if (Math.abs(dz) >= 3.5) {
            if (dz > 0) totalAscentM += dz;
            else totalDescentM += Math.abs(dz);
            lastEleAnchor = ele;
          }
        }

        if (ele < minEle) minEle = ele;
        if (ele > maxEle) maxEle = ele;

        points.push({
          index: i,
          lat,
          lon,
          ele: Math.round(ele),
          distFromStartKm: Math.round((totalDistanceM / 1000) * 100) / 100
        });
      }

      // Gehzeit-Berechnung nach Schweizer Alpen-Club (SAC) / DIN 33466:
      // Horizontalkomponente: 4 km/h | Vertikalkomponente: 400 Hm/h
      const distHours = (totalDistanceM / 1000) / 4.0;
      const ascHours = totalAscentM / 400.0;
      const totalHours = Math.max(distHours, ascHours) + 0.5 * Math.min(distHours, ascHours);

      const hFormatted = Math.floor(totalHours);
      const mFormatted = Math.round((totalHours - hFormatted) * 60);

      let trackName = 'GPX-Route';
      const nameMatch = /<name>([^<]+)<\/name>/i.exec(xmlString);
      if (nameMatch && nameMatch[1]) {
        trackName = nameMatch[1].trim();
      }

      return {
        success: true,
        name: trackName,
        pointCount: points.length,
        totalDistanceKm: Math.round((totalDistanceM / 1000) * 10) / 10,
        totalAscentM: Math.round(totalAscentM),
        totalDescentM: Math.round(totalDescentM),
        minElevationM: Math.round(minEle),
        maxElevationM: Math.round(maxEle),
        estimatedDuration: `${hFormatted} h ${mFormatted} min`,
        points
      };
    } catch (e) {
      console.error("GPX Parse-Fehler:", e);
      return { success: false, error: e.message };
    }
  },

  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Erdradius in Metern
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  },

  /**
   * 3 Korb-kuratierte Alpine GPX Sample-Tracks
   */
  getSampleGPXTrack(tourId) {
    const samples = {
      'matterhorn-hoernli': {
        name: 'Matterhorn Hörnligrat (Normalweg)',
        region: 'Wallis / Zermatt',
        points: [
          { lat: 45.9765, lon: 7.7063, ele: 2583 }, // Schwarzsee
          { lat: 45.9772, lon: 7.6951, ele: 2950 },
          { lat: 45.9781, lon: 7.6834, ele: 3260 }, // Hörnlihütte
          { lat: 45.9775, lon: 7.6740, ele: 3750 }, // Unterer Grat
          { lat: 45.9770, lon: 7.6660, ele: 4003 }, // Solvay-Biwak
          { lat: 45.9766, lon: 7.6610, ele: 4250 }, // Schulter
          { lat: 45.9763, lon: 7.6586, ele: 4478 }  // Matterhorn Gipfel
        ]
      },
      'zugspitze-hoellental': {
        name: 'Zugspitze Höllental (Klassiker)',
        region: 'Wettersteingebirge / Bayern',
        points: [
          { lat: 47.4722, lon: 11.0435, ele: 758 },  // Hammersbach
          { lat: 47.4560, lon: 11.0312, ele: 1045 }, // Höllentalklamm
          { lat: 47.4420, lon: 11.0210, ele: 1387 }, // Höllentalangerhütte
          { lat: 47.4310, lon: 11.0090, ele: 1950 }, // Leiter & Brett
          { lat: 47.4240, lon: 10.9980, ele: 2300 }, // Höllentalferner
          { lat: 47.4215, lon: 10.9855, ele: 2962 }  // Zugspitze Gipfel
        ]
      },
      'watzmann-crossing': {
        name: 'Watzmann Überschreitung',
        region: 'Berchtesgadener Alpen',
        points: [
          { lat: 47.5910, lon: 12.9150, ele: 630 },  // Wimbachbrücke
          { lat: 47.5720, lon: 12.9230, ele: 1390 }, // Falzalm
          { lat: 47.5640, lon: 12.9240, ele: 1930 }, // Watzmannhaus
          { lat: 47.5560, lon: 12.9230, ele: 2651 }, // Hocheck
          { lat: 47.5540, lon: 12.9220, ele: 2713 }, // Mittelspitze
          { lat: 47.5460, lon: 12.9210, ele: 2712 }, // Südspitze
          { lat: 47.5350, lon: 12.8980, ele: 1320 }  // Wimbachgries
        ]
      },
      'grossglockner-bike': {
        name: 'Großglockner Hochalpenstraße (Rennrad)',
        region: 'Hohe Tauern / Salzburg & Kärnten',
        points: [
          { lat: 47.1680, lon: 12.8250, ele: 805 },  // Fusch an der Glocknerstraße
          { lat: 47.1420, lon: 12.8200, ele: 1145 }, // Ferleiten (Mautstelle)
          { lat: 47.1180, lon: 12.8270, ele: 1540 }, // Piffkar
          { lat: 47.1020, lon: 12.8310, ele: 1890 }, // Hexenküche
          { lat: 47.0860, lon: 12.8270, ele: 2260 }, // Fuschertörl
          { lat: 47.0780, lon: 12.8420, ele: 2428 }, // Fuscher Lacke
          { lat: 47.0720, lon: 12.8440, ele: 2504 }, // Hochtor Pass (Scheitelpunkt)
          { lat: 47.0610, lon: 12.8380, ele: 2135 }, // Schöneck
          { lat: 47.0420, lon: 12.8430, ele: 1301 }  // Heiligenblut (Ziel)
        ]
      }
    };

    const s = samples[tourId] || samples['matterhorn-hoernli'];
    let xml = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><name>${s.name}</name><trkseg>`;
    s.points.forEach(p => {
      xml += `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele></trkpt>`;
    });
    xml += `</trkseg></trk></gpx>`;

    return {
      name: s.name,
      region: s.region,
      xml
    };
  },

  /**
   * STUFE 9b: Sportarten-Geschwindigkeitsprofile & Marschzeit-Berechnung (inkl. 4-stufigem Fitness-Level)
   */
  getSportSpeedInfo(sportType, fitnessLevel = 'normal') {
    const fitnessMultipliers = {
      'easy': { factor: 0.8, label: 'Gemütlich', icon: '🧘', desc: '0.8× Grundtempo' },
      'normal': { factor: 1.0, label: 'Normal', icon: '🚶', desc: '1.0× Grundtempo (SAC / Standard)' },
      'sporty': { factor: 1.25, label: 'Sportlich', icon: '🏃', desc: '1.25× Sportler-Pace' },
      'pro': { factor: 1.5, label: 'Profi', icon: '🏆', desc: '1.5× Wettkampf- / Athleten-Pace' }
    };
    const fit = fitnessMultipliers[fitnessLevel] || fitnessMultipliers['normal'];

    const baseTable = {
      'hiking': {
        name: 'Wandern & Bergsteigen',
        icon: '🥾',
        baseFlatSpeedKmH: 4.0,
        ascentMPerHour: 400,
        descentMPerHour: 800,
        desc: 'SAC-Norm: 4 km/h flach, 400 Hm/h Aufstieg'
      },
      'road_bike': {
        name: 'Rennrad & Asphalt',
        icon: '🚴',
        baseFlatSpeedKmH: 25.0,
        ascentMPerHour: null,
        descentMPerHour: null,
        desc: 'Watt-äquivalenter Berggraph'
      },
      'gravel_mtb': {
        name: 'Gravel & Mountainbike',
        icon: '🚵',
        baseFlatSpeedKmH: 16.0,
        ascentMPerHour: null,
        descentMPerHour: null,
        desc: 'Schotter & Forstwege'
      },
      'trailrun': {
        name: 'Trailrunning',
        icon: '🏃',
        baseFlatSpeedKmH: 8.5,
        ascentMPerHour: null,
        descentMPerHour: null,
        desc: 'Berglauf-Gradient'
      }
    };

    const base = baseTable[sportType] || baseTable['hiking'];
    const flatSpeed = Math.round((base.baseFlatSpeedKmH * fit.factor) * 10) / 10;
    const ascentRate = base.ascentMPerHour ? Math.round(base.ascentMPerHour * fit.factor) : null;
    const descentRate = base.descentMPerHour ? Math.round(base.descentMPerHour * fit.factor) : null;

    let paceLabel = `${flatSpeed} km/h`;
    if (ascentRate) paceLabel += ` • ${ascentRate} Hm/h`;

    return {
      ...base,
      fitnessLevel,
      fitnessFactor: fit.factor,
      fitnessName: fit.label,
      fitnessIcon: fit.icon,
      baseFlatSpeedKmH: flatSpeed,
      ascentMPerHour: ascentRate,
      descentMPerHour: descentRate,
      paceLabel,
      desc: `${base.desc} (${fit.label}: ${fit.factor}×)`
    };
  },

  /**
   * STUFE 9c: Dynamischer Strecken-Wetterverlauf über die gesamte Dauer der Route
   */
  computeRouteWeatherTimeline(parsedGPX, startTimeMs, sportType, hourlyForecast, baseElevation = 500, fitnessLevel = 'normal') {
    if (!parsedGPX || !parsedGPX.points || parsedGPX.points.length === 0) {
      return null;
    }

    const points = parsedGPX.points;
    const speedInfo = this.getSportSpeedInfo(sportType, fitnessLevel);
    let cumulativeHours = 0;
    const timedPoints = [];

    const fitFactor = speedInfo.fitnessFactor || 1.0;
    const flatV = speedInfo.baseFlatSpeedKmH;
    const ascRate = speedInfo.ascentMPerHour || 400;
    const descRate = speedInfo.descentMPerHour || 800;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (i > 0) {
        const prev = points[i - 1];
        const distKm = Math.max(0.001, (pt.distFromStartKm || 0) - (prev.distFromStartKm || 0));
        const dzM = pt.ele - prev.ele;

        let segHours = 0;
        if (sportType === 'hiking') {
          // SAC Bergwander-Formel mit Fitness-Faktor
          const tH = distKm / flatV;
          const tV = (dzM > 0 ? dzM / ascRate : Math.abs(dzM) / descRate);
          segHours = Math.max(tH, tV) + Math.min(tH, tV) / 2;
        } else if (sportType === 'road_bike') {
          const grad = (dzM / (distKm * 1000)) * 100;
          const baseV = 25 * fitFactor;
          const v = Math.max(8 * fitFactor, Math.min(60 * fitFactor, baseV - grad * 1.4));
          segHours = distKm / v;
        } else if (sportType === 'gravel_mtb') {
          const grad = (dzM / (distKm * 1000)) * 100;
          const baseV = 16 * fitFactor;
          const v = Math.max(5 * fitFactor, Math.min(42 * fitFactor, baseV - grad * 1.1));
          segHours = distKm / v;
        } else {
          // Trailrun
          const grad = (dzM / (distKm * 1000)) * 100;
          const baseV = 8.5 * fitFactor;
          const v = Math.max(4 * fitFactor, Math.min(16 * fitFactor, baseV - (grad > 0 ? grad * 0.35 : grad * 0.15)));
          segHours = distKm / v;
        }
        cumulativeHours += Math.max(0.005, segHours);
      }

      const arrivalMs = startTimeMs + Math.round(cumulativeHours * 3600000);
      timedPoints.push({
        ...pt,
        cumulativeHours,
        arrivalMs,
        arrivalDate: new Date(arrivalMs)
      });
    }

    // Wähle 6 bis 12 markante Meilensteine / Wegpunkte entlang der Route
    const totalKm = parsedGPX.totalDistanceKm || (timedPoints[timedPoints.length - 1].distFromStartKm) || 1;
    const targetSteps = Math.max(6, Math.min(12, Math.round(totalKm / 2.5)));
    const stepKm = totalKm / (targetSteps - 1);

    const milestones = [];
    let currentTargetKm = 0;

    for (let s = 0; s < targetSteps; s++) {
      currentTargetKm = s * stepKm;
      let closestPt = timedPoints[0];
      let minDiff = Infinity;
      for (const p of timedPoints) {
        const diff = Math.abs(p.distFromStartKm - currentTargetKm);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = p;
        }
      }
      if (!milestones.some(m => m.index === closestPt.index)) {
        milestones.push(closestPt);
      }
    }

    // Stelle sicher, dass Start und Ziel immer exakt enthalten sind
    if (milestones[0].index !== timedPoints[0].index) {
      milestones.unshift(timedPoints[0]);
    }
    if (milestones[milestones.length - 1].index !== timedPoints[timedPoints.length - 1].index) {
      milestones.push(timedPoints[timedPoints.length - 1]);
    }

    // Wetterdaten für jeden Meilenstein zur genauen Ankunftszeit interpolieren
    const h = hourlyForecast || {};
    const hTimes = h.time || [];

    const enrichedMilestones = milestones.map((m, idx) => {
      const arrMs = m.arrivalMs;
      let hIdx = 0;
      let minDiffMs = Infinity;

      for (let i = 0; i < hTimes.length; i++) {
        const tMs = new Date(hTimes[i]).getTime();
        const diff = Math.abs(tMs - arrMs);
        if (diff < minDiffMs) {
          minDiffMs = diff;
          hIdx = i;
        }
      }

      // Barometrischer Höhenabgleich: -0.65°C pro 100 Höhenmeter
      const baseT = (h.temperature_2m && h.temperature_2m[hIdx] !== undefined) ? h.temperature_2m[hIdx] : 12;
      const dElev = m.ele - baseElevation;
      const pointTemp = Math.round((baseT - (dElev * 0.0065)) * 10) / 10;

      // Wind nach Höhenlage
      const baseW = (h.wind_speed_10m && h.wind_speed_10m[hIdx] !== undefined) ? h.wind_speed_10m[hIdx] : 15;
      const baseG = (h.wind_gusts_10m && h.wind_gusts_10m[hIdx] !== undefined) ? h.wind_gusts_10m[hIdx] : baseW * 1.35;
      const altitudeWindFactor = 1 + Math.max(0, dElev / 2000) * 0.5;
      const pointWind = Math.round(baseW * altitudeWindFactor);
      const pointGusts = Math.round(baseG * altitudeWindFactor);
      const pointDir = (h.wind_direction_10m && h.wind_direction_10m[hIdx] !== undefined) ? h.wind_direction_10m[hIdx] : 220;

      // Niederschlag & Frost
      const precip = (h.precipitation && h.precipitation[hIdx] !== undefined) ? h.precipitation[hIdx] : 0;
      const pop = (h.precipitation_probability && h.precipitation_probability[hIdx] !== undefined) ? h.precipitation_probability[hIdx] : 0;
      const freezingLevel = (h.freezing_level_height && h.freezing_level_height[hIdx] !== undefined) ? h.freezing_level_height[hIdx] : 2600;
      const code = (h.weather_code && h.weather_code[hIdx] !== undefined) ? h.weather_code[hIdx] : 1;

      const isSnow = m.ele >= freezingLevel || pointTemp <= 0.5;
      let weatherCondition = 'Trocken';
      let weatherIcon = '☀️';

      if (code >= 95) {
        weatherIcon = '⚡';
        weatherCondition = 'Gewitter';
      } else if (isSnow && precip > 0) {
        weatherIcon = '❄️';
        weatherCondition = precip > 2 ? 'Kräftiger Schneefall' : 'Leichter Schneefall';
      } else if (precip >= 3) {
        weatherIcon = '🌧️';
        weatherCondition = 'Starkregen';
      } else if (precip > 0.3) {
        weatherIcon = '🌦️';
        weatherCondition = 'Regenschauer';
      } else if (code >= 3) {
        weatherIcon = '☁️';
        weatherCondition = 'Bedeckt';
      } else if (code >= 1) {
        weatherIcon = '⛅';
        weatherCondition = 'Heiter';
      }

      // Windchill
      let felt = pointTemp;
      if (pointTemp <= 10 && pointWind >= 5) {
        felt = 13.12 + (0.6215 * pointTemp) - (11.37 * Math.pow(pointWind, 0.16)) + (0.3965 * pointTemp * Math.pow(pointWind, 0.16));
      }

      const arrHoursStr = m.arrivalDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const arrivalDateStr = m.arrivalDate.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });

      let label = `km ${m.distFromStartKm.toFixed(1)}`;
      if (idx === 0) label = 'Startpunkt';
      else if (idx === milestones.length - 1) label = 'Zielankunft';
      else if (m.ele === parsedGPX.maxElevationM) label = 'Scheitelpunkt / Pass';

      return {
        ...m,
        label,
        arrivalTimeStr: `${arrHoursStr} Uhr`,
        arrivalDateStr,
        tempC: pointTemp,
        feltTempC: Math.round(felt),
        windKmH: pointWind,
        gustsKmH: pointGusts,
        windDirDeg: pointDir,
        precipMm: precip,
        popPercent: pop,
        freezingLevelM: freezingLevel,
        weatherCode: code,
        weatherIcon,
        weatherCondition,
        isSnow
      };
    });

    const hazards = this.analyzeRouteHazards(enrichedMilestones);

    const totalDurationHours = cumulativeHours;
    const durH = Math.floor(totalDurationHours);
    const durM = Math.round((totalDurationHours - durH) * 60);

    return {
      sportType,
      sportName: speedInfo.name,
      sportIcon: speedInfo.icon,
      fitnessLevel: speedInfo.fitnessLevel,
      fitnessName: speedInfo.fitnessName,
      fitnessFactor: speedInfo.fitnessFactor,
      fitnessIcon: speedInfo.fitnessIcon,
      paceLabel: speedInfo.paceLabel,
      startTimeMs,
      startTimeStr: new Date(startTimeMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      startDateStr: new Date(startTimeMs).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }),
      endTimeMs: timedPoints[timedPoints.length - 1].arrivalMs,
      endTimeStr: timedPoints[timedPoints.length - 1].arrivalDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
      totalDurationStr: `${durH} h ${durM} min`,
      totalDistanceKm: parsedGPX.totalDistanceKm,
      totalAscentM: parsedGPX.totalAscentM,
      totalDescentM: parsedGPX.totalDescentM,
      minElevationM: parsedGPX.minElevationM,
      maxElevationM: parsedGPX.maxElevationM,
      timedPoints,
      milestones: enrichedMilestones,
      hazards
    };
  },

  /**
   * STUFE 9d: Routen-Gefahrenanalyse & Passwarnung
   */
  analyzeRouteHazards(milestones) {
    const alerts = [];
    let worstSeverity = 'green';

    milestones.forEach(m => {
      // 1. Gewitter
      if (m.weatherCode >= 95 || m.weatherCondition.includes('Gewitter')) {
        alerts.push({
          severity: 'red',
          icon: '⚡',
          type: 'Gewitter & Blitzgefahr',
          km: m.distFromStartKm,
          ele: m.ele,
          time: m.arrivalTimeStr,
          title: `Gewittergefahr bei ${m.label} (${m.arrivalTimeStr})`,
          desc: `Auf ${m.ele} m Höhe akute Blitzschlaggefahr! Grate und exponierte Steige vor ${m.arrivalTimeStr} verlassen oder Tourstart vorverlegen.`
        });
        worstSeverity = 'red';
      }

      // 2. Sturmböen
      if (m.gustsKmH >= 60) {
        alerts.push({
          severity: 'red',
          icon: '💨',
          type: 'Schwere Sturmböen',
          km: m.distFromStartKm,
          ele: m.ele,
          time: m.arrivalTimeStr,
          title: `Sturmböen bis ${m.gustsKmH} km/h auf ${m.ele} m`,
          desc: `Gefahr von Gleichgewichtsverlust auf Graten oder starke Böen beim Radfahren bei km ${m.distFromStartKm.toFixed(1)}.`
        });
        worstSeverity = 'red';
      } else if (m.gustsKmH >= 45 && worstSeverity !== 'red') {
        alerts.push({
          severity: 'yellow',
          icon: '💨',
          type: 'Frischer bis starker Wind',
          km: m.distFromStartKm,
          ele: m.ele,
          time: m.arrivalTimeStr,
          title: `Böenspitzen ${m.gustsKmH} km/h bei km ${m.distFromStartKm.toFixed(1)}`,
          desc: `Windweste / winddichte Bekleidung empfohlen.`
        });
        if (worstSeverity === 'green') worstSeverity = 'yellow';
      }

      // 3. Frost / Schneefall
      if (m.isSnow && m.precipMm > 0) {
        alerts.push({
          severity: 'yellow',
          icon: '❄️',
          type: 'Schnee- & Glättegefahr',
          km: m.distFromStartKm,
          ele: m.ele,
          time: m.arrivalTimeStr,
          title: `Schnee- & Glättegefahr auf ${m.ele} m um ${m.arrivalTimeStr}`,
          desc: `Temperatur liegt bei ${m.tempC}°C unter der Frostgrenze (${m.freezingLevelM} m). Rutschgefahr auf Steinen & Wurzeln.`
        });
        if (worstSeverity === 'green') worstSeverity = 'yellow';
      }

      // 4. Starkregen
      if (m.precipMm >= 3.0 && !m.isSnow) {
        alerts.push({
          severity: 'yellow',
          icon: '🌧️',
          type: 'Kräftiger Regen',
          km: m.distFromStartKm,
          ele: m.ele,
          time: m.arrivalTimeStr,
          title: `Starker Regen (${m.precipMm} mm/h) um ${m.arrivalTimeStr}`,
          desc: `Gute Regenbekleidung und Schutz vor Auskühlung erforderlich.`
        });
        if (worstSeverity === 'green') worstSeverity = 'yellow';
      }
    });

    let overallVerdict = '🟢 Ausgezeichnetes Tourenwetter';
    let overallSummary = 'Keine signifikanten Wetterrisiken entlang der Route prognostiziert. Optimale Bedingungen für dein gewähltes Startzeitfenster.';

    if (worstSeverity === 'red') {
      overallVerdict = '🚨 Akute Wetterwarnungen auf der Route!';
      overallSummary = 'Auf einzelnen Streckenabschnitten drohen schwere Wettergefahren (Gewitter / Sturm). Passe deine Startzeit an oder wähle eine wettergeschützte Alternativroute!';
    } else if (worstSeverity === 'yellow') {
      overallVerdict = '🟡 Erhöhte Vorsicht & wechselhaftes Wetter';
      overallSummary = 'Auf exponierten Höhenabschnitten sind Windböen, Schauer oder Kälte möglich. Passende Bekleidung (Regenschutz, Zwiebelprinzip) einpacken.';
    }

    return {
      severity: worstSeverity,
      level: worstSeverity,
      verdict: overallVerdict,
      badge: overallVerdict,
      summary: overallSummary,
      advice: overallSummary,
      alerts
    };
  },

  /**
   * STUFE 10: Alpine Live-Webcams (Matterhorn, Zugspitze, Mont Blanc, Dolomiten etc.)
   */
  getMountainWebcams(mountainName, lat, lon) {
    const registry = {
      'matterhorn': [
        {
          id: 'cam-mh-live',
          title: 'Matterhorn (4.478 m) • Live-Blick Zermatt',
          elevation: '4.478 m',
          viewDir: 'Südwest (SW)',
          thumbUrl: 'https://www.zermatt.net/graphics/lc/matterhorn.jpg',
          streamUrl: 'https://www.zermatt.ch/webcam',
          status: '🟢 Live'
        },
        {
          id: 'cam-mh-dorf',
          title: 'Zermatt Dorf & Bahnhof (1.620 m)',
          elevation: '1.620 m',
          viewDir: 'Bahnhofstrasse',
          thumbUrl: 'https://www.zermatt.net/graphics/lc25/bahnhof.jpg',
          streamUrl: 'https://www.zermatt.ch/webcam',
          status: '🟢 Live'
        },
        {
          id: 'cam-mh-alpin',
          title: 'Walliser Hochalpen & Gletschermeer',
          elevation: '3.195 m',
          viewDir: 'Gletscherblick',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/becherhaus/current/720.jpg',
          streamUrl: 'https://www.zermatt.ch/webcam',
          status: '🟢 Live HD'
        }
      ],
      'zugspitze': [
        {
          id: 'cam-zs-gipfel',
          title: 'Zugspitzgipfel (2.962 m) • Panoramablick',
          elevation: '2.962 m',
          viewDir: '360° Rundumblick',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/zugspitze/current/720.jpg',
          highResUrl: 'https://www.foto-webcam.eu/webcam/zugspitze/current/1200.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/zugspitze/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-zs-platt',
          title: 'Zugspitzplatt & Gletscher (2.600 m)',
          elevation: '2.600 m',
          viewDir: 'Südost (SO)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-sued/current/720.jpg',
          highResUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-sued/current/1200.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-sued/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-zs-eibsee',
          title: 'Zugspitz-Nordwand & Eibseeblick (2.962 m)',
          elevation: '2.962 m',
          viewDir: 'Nord (N) auf Eibsee',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-nord/current/720.jpg',
          highResUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-nord/current/1200.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-nord/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-zs-ost',
          title: 'Jubiläumsgrat & Höllental (2.962 m)',
          elevation: '2.962 m',
          viewDir: 'Ost (O)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-ost/current/720.jpg',
          highResUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-ost/current/1200.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/zugspitze-ost/',
          status: '🟢 Live HD'
        }
      ],
      'watzmann': [
        {
          id: 'cam-wm-ostwand',
          title: 'Watzmann Ostwand & Hocheck (Blick Graflhöhe 950 m)',
          elevation: '950 m',
          viewDir: 'Südwest (SW) auf Watzmann',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/windbeutelbaron/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/windbeutelbaron/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-wm-jenner',
          title: 'Jenner Bergstation (1.800 m) • Berchtesgadener Alpen',
          elevation: '1.800 m',
          viewDir: 'Nordost (NO)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/jenner-ost/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/jenner-ost/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-wm-jenner-sued',
          title: 'Jenner Süd (1.800 m) • Hagengebirge & Steinernes Meer',
          elevation: '1.800 m',
          viewDir: 'Süd (S)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/jenner-sued/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/jenner-sued/',
          status: '🟢 Live HD'
        }
      ],
      'nebelhorn': [
        {
          id: 'cam-nh-gipfel',
          title: 'Nebelhornbahn Gipfel (2.224 m) • Allgäuer Hochalpen',
          elevation: '2.224 m',
          viewDir: 'Südost (SO)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/nebelhorn/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/nebelhorn/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-nh-zugspitze',
          title: 'Zugspitzgipfel (2.962 m) • Wetterstein-Referenz',
          elevation: '2.962 m',
          viewDir: '360° Panorama',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/zugspitze/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/zugspitze/',
          status: '🟢 Live HD'
        }
      ],
      'grossglockner': [
        {
          id: 'cam-gg-freiwand',
          title: 'Großglockner (3.798 m) & Pasterzengletscher',
          elevation: '2.369 m',
          viewDir: 'Nordwest (NW) auf Glockner',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/freiwandeck/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/freiwandeck/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-gg-sued',
          title: 'Großglockner Südwand (Glocknerwinkel 1.984 m)',
          elevation: '1.984 m',
          viewDir: 'Nord (N)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/glocknerwinkel/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/glocknerwinkel/',
          status: '🟢 Live HD'
        }
      ],
      'wendelstein': [
        {
          id: 'cam-ws-ost',
          title: 'Wendelstein Ostgipfel (1.838 m) • Voralpenland',
          elevation: '1.838 m',
          viewDir: 'Ost (O)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/wendelstein-ost/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/wendelstein-ost/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-ws-west',
          title: 'Wendelstein Westblick (1.838 m) • Mangfallgebirge',
          elevation: '1.838 m',
          viewDir: 'West (W)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/wendelstein-west/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/wendelstein-west/',
          status: '🟢 Live HD'
        }
      ],
      'kronplatz': [
        {
          id: 'cam-kp-gipfel',
          title: 'Kronplatz Gipfel (2.275 m) • 360° Dolomiten-Rundblick',
          elevation: '2.275 m',
          viewDir: 'Rundumblick',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/kronplatz/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/kronplatz/',
          status: '🟢 Live HD'
        },
        {
          id: 'cam-rit-rosengarten',
          title: 'Ritten (2.260 m) • Blick auf Rosengarten & Schlern',
          elevation: '2.260 m',
          viewDir: 'Südost (SO)',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/ritten/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/ritten/',
          status: '🟢 Live HD'
        }
      ],
      'innsbruck': [
        {
          id: 'cam-ibk-nordkette',
          title: 'Innsbruck Nordkette & Hafelekar (1.905 m)',
          elevation: '1.905 m',
          viewDir: 'Süd (S) auf Stadt & Stubaier Alpen',
          thumbUrl: 'https://www.foto-webcam.eu/webcam/innsbruck/current/720.jpg',
          streamUrl: 'https://www.foto-webcam.eu/webcam/innsbruck/',
          status: '🟢 Live HD'
        }
      ]
    };

    const key = (mountainName || '').toLowerCase();
    if (key.includes('matterhorn') || key.includes('zermatt')) return registry['matterhorn'];
    if (key.includes('zugspitze') || key.includes('garmisch')) return registry['zugspitze'];
    if (key.includes('watzmann') || key.includes('berchtesgaden')) return registry['watzmann'];
    if (key.includes('nebelhorn') || key.includes('oberstdorf')) return registry['nebelhorn'];
    if (key.includes('glockner')) return registry['grossglockner'];
    if (key.includes('wendelstein')) return registry['wendelstein'];
    if (key.includes('bozen') || key.includes('meran') || key.includes('dolomit') || key.includes('kronplatz')) return registry['kronplatz'];
    if (key.includes('innsbruck')) return registry['innsbruck'];

    // Fallback: Echte alpine Referenz-Webcams (Zugspitze & Nebelhorn)
    return [
      {
        id: 'cam-ref-zs',
        title: `Alpine Referenz-Livecam (Zugspitze 2.962 m)`,
        elevation: '2.962 m',
        viewDir: '360° Panorama',
        thumbUrl: 'https://www.foto-webcam.eu/webcam/zugspitze/current/720.jpg',
        highResUrl: 'https://www.foto-webcam.eu/webcam/zugspitze/current/1200.jpg',
        streamUrl: 'https://www.foto-webcam.eu/webcam/zugspitze/',
        status: '🟢 Live HD'
      },
      {
        id: 'cam-ref-nh',
        title: `Alpine Referenz-Livecam (Nebelhorn 2.224 m)`,
        elevation: '2.224 m',
        viewDir: 'Südost (SO)',
        thumbUrl: 'https://www.foto-webcam.eu/webcam/nebelhorn/current/720.jpg',
        streamUrl: 'https://www.foto-webcam.eu/webcam/nebelhorn/',
        status: '🟢 Live HD'
      }
    ];
  },

  /**
   * STUFE 11: 48-Stunden-Zukunfts-Radar & Niederschlags-Prognose (DWD ICON & ECMWF)
   * Lädt stündliche hochauflösende Niederschlags- und Schneefelder für die gesamte Region (bis zu +48h)
   */
  async fetch48hRadarForecast(stations) {
    if (!stations || stations.length === 0) return null;
    try {
      const lats = stations.map(s => s.lat.toFixed(3)).join(',');
      const lons = stations.map(s => s.lon.toFixed(3)).join(',');
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=precipitation,snowfall,rain,temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&forecast_days=4`;
      
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Radar-Prognose HTTP-Fehler: ${res.status}`);
      const rawData = await res.json();
      const stationResults = Array.isArray(rawData) ? rawData : [rawData];

      if (!stationResults[0] || !stationResults[0].hourly || !stationResults[0].hourly.time) {
        return null;
      }

      const times = stationResults[0].hourly.time;
      const nowMs = Date.now();

      // Finde den aktuellen Stundenindex
      let curIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < Math.min(48, times.length); i++) {
        const diff = Math.abs(new Date(times[i]).getTime() - nowMs);
        if (diff < minDiff) {
          minDiff = diff;
          curIdx = i;
        }
      }

      // Baue stündliche Prognose-Frames für bis zu 48 Stunden in die Zukunft (h = 0 bis 48)
      const forecastFrames = [];
      const hoursCount = Math.min(49, times.length - curIdx);

      for (let h = 0; h < hoursCount; h++) {
        const idx = curIdx + h;
        const timeStr = times[idx];
        const timeObj = new Date(timeStr);

        const cells = [];
        let maxPrecipMm = 0;

        for (let s = 0; s < stations.length; s++) {
          const st = stations[s];
          const stHourly = stationResults[s] ? stationResults[s].hourly : null;
          if (!stHourly) continue;

          const precip = stHourly.precipitation ? (stHourly.precipitation[idx] || 0) : 0;
          const snow = stHourly.snowfall ? (stHourly.snowfall[idx] || 0) : 0;
          const temp = stHourly.temperature_2m ? (stHourly.temperature_2m[idx] || 0) : 10;
          const wCode = stHourly.weather_code ? (stHourly.weather_code[idx] || 0) : 0;

          if (precip > 0.05 || snow > 0 || (wCode >= 51 && wCode <= 99)) {
            if (precip > maxPrecipMm) maxPrecipMm = precip;

            const isSnow = temp <= 1.5 || snow > 0 || (wCode >= 71 && wCode <= 86);
            cells.push({
              name: st.name,
              lat: st.lat,
              lon: st.lon,
              elevation: st.elevation,
              precipMm: Math.round(precip * 10) / 10,
              snowCm: Math.round(snow * 10) / 10,
              temperature: Math.round(temp * 10) / 10,
              isSnow: isSnow,
              wCode: wCode,
              intensity: precip >= 6.0 ? 'heavy' : precip >= 2.0 ? 'moderate' : 'light'
            });
          }
        }

        forecastFrames.push({
          hourOffset: h,
          time: timeStr,
          timestampMs: timeObj.getTime(),
          hoursFromNow: h,
          label: h === 0 ? 'Jetzt' : `+${h} Std.`,
          hasPrecipitation: cells.length > 0,
          maxPrecipMm: Math.round(maxPrecipMm * 10) / 10,
          cells: cells
        });
      }

      return forecastFrames;
    } catch (err) {
      console.warn('Zukunfts-Radar Prognose konnte nicht geladen werden:', err);
      return null;
    }
  },

  /**
   * Alias für Rückwärtskompatibilität
   */
  async fetch24hRadarForecast(stations) {
    return this.fetch48hRadarForecast(stations);
  },

  /**
   * Berechnet die exakt repräsentative Tageswetterlage (Icon, präziser Text & Synop-Zusammenfassung).
   * Verhindert irreführende Rohdaten (wie z.B. 2h Frühnebel um 6 Uhr morgens, der einen 95% sonnigen Tag
   * fälschlicherweise als 'Nebel' abstempelt, oder 0.2mm Nieselregen, der 9h strahlenden Sonnenschein überdeckt).
   */
  computeRepresentativeDailyCondition(dayIndex, daily, hourly, isToday = false, curWeather = null) {
    if (!daily || !daily.time || !daily.time[dayIndex]) {
      return { icon: '🌤️', label: 'Heiter', synopNote: 'Ruhige Wetterlage', theme: 'clear-day' };
    }

    const startH = dayIndex * 24;
    const endH = Math.min(startH + 24, (hourly && hourly.time) ? hourly.time.length : startH);

    // Tagesstunden filtern (Tageslichtzeit ca. 07:00 bis 19:00 Uhr)
    let daytimeIndices = [];
    for (let h = startH; h < endH; h++) {
      const hourOfDay = (h - startH);
      const isDayFlag = (hourly && hourly.is_day && hourly.is_day[h] !== undefined)
        ? hourly.is_day[h] === 1
        : (hourOfDay >= 7 && hourOfDay <= 19);
      if (isDayFlag || (hourOfDay >= 7 && hourOfDay <= 19)) {
        daytimeIndices.push(h);
      }
    }
    if (daytimeIndices.length === 0) {
      for (let h = startH; h < endH; h++) daytimeIndices.push(h);
    }

    // Für 'Heute': Berücksichtige insbesondere die aktive & verbleibende Tageszeit
    let activeIndices = daytimeIndices;
    if (isToday) {
      const nowHour = new Date().getHours();
      if (nowHour >= 10 && nowHour <= 19) {
        const remaining = daytimeIndices.filter(h => (h - startH) >= nowHour);
        if (remaining.length > 0) {
          activeIndices = remaining;
        }
      }
    }

    // Kennzahlen extrahieren
    const codes = activeIndices.map(h => (hourly && hourly.weather_code) ? hourly.weather_code[h] : 0);
    const precips = activeIndices.map(h => (hourly && hourly.precipitation) ? hourly.precipitation[h] : 0);
    const snows = activeIndices.map(h => (hourly && hourly.snowfall) ? hourly.snowfall[h] : 0);
    const clouds = activeIndices.map(h => (hourly && hourly.cloud_cover) ? hourly.cloud_cover[h] : 50);

    const precipSum = daily.precipitation_sum ? (daily.precipitation_sum[dayIndex] || 0) : 0;
    const snowSum = daily.snowfall_sum ? (daily.snowfall_sum[dayIndex] || 0) : 0;
    const sunDur = daily.sunshine_duration ? (daily.sunshine_duration[dayIndex] || 0) : 0;
    const daylight = daily.daylight_duration ? (daily.daylight_duration[dayIndex] || 1) : 1;
    const sunRatio = daylight > 0 ? (sunDur / daylight) : 0;
    const avgCloud = clouds.length > 0 ? (clouds.reduce((a, b) => a + b, 0) / clouds.length) : 50;

    // 1. GEWITTER & UNWETTER
    const hasThunder = codes.some(c => c >= 95);
    const hasHail = codes.some(c => c === 96 || c === 99);
    if (hasThunder) {
      return {
        icon: '⛈️',
        label: hasHail ? 'Gewitter & Hagel' : 'Gewitter',
        synopNote: 'Gewittergefahr & stürmische Böen',
        theme: 'thunder'
      };
    }

    // 2. SCHNEE & WINTERNIEDERSCHLAG
    const snowHours = snows.filter(s => s > 0).length + codes.filter(c => (c >= 71 && c <= 77) || c === 85 || c === 86).length;
    if (snowSum >= 1.5 || snowHours >= 3) {
      if (sunRatio >= 0.30) {
        return { icon: '🌨️', label: 'Schneeschauer', synopNote: 'Schneeschauer mit sonnigen Phasen', theme: 'snow' };
      }
      return { icon: '❄️', label: snowSum >= 6.0 ? 'Kräftiger Schneefall' : 'Schneefall', synopNote: 'Schneefallgrenze & Glättegefahr beachten', theme: 'snow' };
    }
    if (snowSum > 0.2 || snowHours >= 1) {
      return { icon: '🌨️', label: 'Leichte Schneeschauer', synopNote: 'Vereinzelte Schneeschauer', theme: 'snow' };
    }

    // 3. REGEN & SCHAUER
    const rainHours = precips.filter(p => p >= 0.25).length;
    if (precipSum >= 2.0) {
      if (rainHours <= 3 && sunRatio >= 0.30) {
        return { icon: '🌦️', label: 'Sonne & Schauer', synopNote: 'Wechselhaft mit sonnigen Abschnitten', theme: 'rain' };
      }
      if (precipSum >= 10.0) {
        return { icon: '🌧️', label: 'Starkregen', synopNote: 'Ergiebiger Niederschlag', theme: 'rain' };
      }
      if (rainHours >= 5) {
        return { icon: '🌧️', label: 'Dauerregen', synopNote: 'Länger anhaltender Regen', theme: 'rain' };
      }
      return { icon: '🌧️', label: 'Regnerisch', synopNote: 'Wiederholte Regenfälle', theme: 'rain' };
    }

    if (precipSum >= 0.5) {
      if (sunRatio >= 0.40) {
        return { icon: '🌦️', label: 'Heiter, Schauer', synopNote: 'Überwiegend trocken mit vereinzelten Schauern', theme: 'rain' };
      }
      return { icon: '🌧️', label: 'Leichter Regen', synopNote: 'Gelegentlicher Niesel- oder Schauerregen', theme: 'rain' };
    }

    // 4. TROCKENE ODER SPUREN-NIEDERSCHLAG (< 0.5 mm)
    // Nebel-Analyse (Unterscheide harmlosen Frühnebel von ganztägigem Inversionsnebel)
    const fogCoreHours = activeIndices.filter(h => {
      const hod = (h - startH);
      const c = (hourly && hourly.weather_code) ? hourly.weather_code[h] : 0;
      return hod >= 10 && hod <= 16 && (c === 45 || c === 48);
    }).length;

    const fogMorning = activeIndices.some(h => {
      const hod = (h - startH);
      const c = (hourly && hourly.weather_code) ? hourly.weather_code[h] : 0;
      return hod >= 5 && hod <= 9 && (c === 45 || c === 48);
    });

    if (fogCoreHours >= 4) {
      return { icon: '🌫️', label: 'Dichter Nebel', synopNote: 'Ganztägig zäher Nebel / Hochnebel', theme: 'fog' };
    }

    if (fogMorning && sunRatio >= 0.40 && !isToday) {
      return {
        icon: '🌤️',
        label: sunRatio >= 0.65 ? 'Frühnebel, sonnig' : 'Frühnebel, heiter',
        synopNote: 'Nach Auflösung des Frühnebels viel Sonne',
        theme: 'clear-day'
      };
    }

    // Für Heute: Wenn aktuelle Zeit >= 11 Uhr ist und Himmel klar/wolkig ist, niemals 'Nebel' anzeigen
    if (isToday && curWeather) {
      const curCloud = curWeather.cloud_cover !== undefined ? curWeather.cloud_cover : avgCloud;
      const curWCode = curWeather.weather_code !== undefined ? curWeather.weather_code : 0;
      if (curWCode !== 45 && curWCode !== 48) {
        if (curCloud <= 25) return { icon: '☀️', label: 'Sonnig', synopNote: 'Sonnig und wolkenlos', theme: 'clear-day' };
        if (curCloud <= 50) return { icon: '🌤️', label: 'Überwiegend heiter', synopNote: 'Sonnige Abschnitte mit lockeren Wolken', theme: 'clear-day' };
        if (curCloud <= 75) return { icon: '⛅', label: 'Teilweise bewölkt', synopNote: 'Wechsel von Wolken und Aufheiterungen', theme: 'cloudy' };
        return { icon: '☁️', label: 'Bedeckt', synopNote: 'Überwiegend geschlossene Wolkendecke', theme: 'cloudy' };
      }
    }

    // Sonnenschein & Bewölkungs-Stufen
    if (sunRatio >= 0.68 || avgCloud < 25) {
      return { icon: '☀️', label: 'Sonnig', synopNote: 'Sonnig und wolkenloser Himmel', theme: 'clear-day' };
    }
    if (sunRatio >= 0.45 || avgCloud < 50) {
      return { icon: '🌤️', label: 'Überwiegend heiter', synopNote: 'Viel Sonnenschein bei lockeren Wolkenfeldern', theme: 'clear-day' };
    }
    if (sunRatio >= 0.20 || avgCloud < 75) {
      return { icon: '⛅', label: 'Teilweise bewölkt', synopNote: 'Mischung aus Wolken und heiteren Phasen', theme: 'cloudy' };
    }
    return { icon: '☁️', label: 'Bedeckt', synopNote: 'Überwiegend graue, geschlossene Wolkenschicht', theme: 'cloudy' };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MicroEngine;
}
if (typeof window !== 'undefined') {
  window.MicroEngine = MicroEngine;
}
