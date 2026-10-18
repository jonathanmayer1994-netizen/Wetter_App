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
        z: h[`geopotential_height_${hpa}hPa`][idx],
        temp: h[`temperature_${hpa}hPa`][idx],
        windSpeed: h[`wind_speed_${hpa}hPa`][idx],
        windDir: h[`wind_direction_${hpa}hPa`][idx],
        rh: h[`relative_humidity_${hpa}hPa`][idx],
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
        z: h[`geopotential_height_${hpa}hPa`][i],
        temp: h[`temperature_${hpa}hPa`][i],
        wind: h[`wind_speed_${hpa}hPa`][i],
        dir: h[`wind_direction_${hpa}hPa`][i]
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
          t = h.temperature_2m[i] - ((step.z - valleyZ) * 0.0065);
          w = (h.wind_speed_10m ? h.wind_speed_10m[i] : 10) * (1 + (step.z / 2000));
        }

        const isSnow = step.z >= hourObj.freezingLevel;
        hourObj.levels.push({
          name: step.name,
          icon: step.icon,
          z: step.z,
          temp: Math.round(t * 10) / 10,
          wind: Math.round(w),
          precipType: isSnow ? 'Schnee' : 'Regen',
          isAboveFreezing: !isSnow
        });
      }

      hourlyProfiles.push(hourObj);
    }

    return hourlyProfiles;
  },

  interpolateWindDirection(dir1, dir2, weight) {
    const rad1 = (dir1 * Math.PI) / 180;
    const rad2 = (dir2 * Math.PI) / 180;
    const u = (1 - weight) * Math.sin(rad1) + weight * Math.sin(rad2);
    const v = (1 - weight) * Math.cos(rad1) + weight * Math.cos(rad2);
    return ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
  }
};
