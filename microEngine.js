/**
 * ============================================================================
 * ALPINE 10M MICRO-WEATHER ENGINE (Terrain-RGB + Open-Meteo Pressure Levels)
 * ============================================================================
 */

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const TILE_SIZE = 256;

export const MicroEngine = {

  /**
   * Hauptfunktion: Berechnet das 10-Meter-Mikrowetter für jede Koordinate
   */
  async getMicroScaleAlpineWeather(lat, lon, zoom = 14, customTilt = null, customAzimuth = null) {
    // 1. Lokale 10m-Geländegeometrie aus AWS Terrain Tiles berechnen
    let terrain;
    try {
      terrain = await this.analyzeMicroTerrain(lat, lon, zoom);
    } catch (e) {
      console.warn('AWS Terrain Tile fallback zu Elevation API:', e);
      terrain = await this.fallbackTerrainAnalysis(lat, lon);
    }

    // Falls der Nutzer eine spezifische Wand ausgewählt hat (z. B. Nordwand, Südwand):
    if (customTilt !== null) terrain.tilt = customTilt;
    if (customAzimuth !== null) {
      terrain.openMeteoAzimuth = customAzimuth;
      terrain.compassAzimuth = (customAzimuth + 180 + 360) % 360;
    }

    // 2. Open-Meteo Daten (inkl. Druckschichten & geneigter Solarstrahlung) abrufen
    const weatherRaw = await this.fetchOpenMeteoMultiLayer(lat, lon, terrain);

    // 3. Druckschichten-Interpolation & 10m-Mikrophysik anwenden
    const physics = this.computeMicroPhysics(terrain, weatherRaw);

    // 4. Höhenprofil (Tal vs. Mittelstation vs. Gipfel) für verschiedene Stunden berechnen
    const altitudeProfile = this.computeAltitudeProfile(weatherRaw, terrain.elevation);

    return {
      ...physics,
      altitudeProfile,
      weatherRaw
    };
  },

  /**
   * STUFE 1: Lädt die Terrain-RGB-Kachel und berechnet Höhe, Tilt, Azimuth & TPI
   */
  async analyzeMicroTerrain(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const latRad = (lat * Math.PI) / 180;

    const xFloat = ((lon + 180) / 360) * n;
    const yFloat = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

    const tileX = Math.floor(xFloat);
    const tileY = Math.floor(yFloat);

    const px = Math.floor((xFloat - tileX) * TILE_SIZE);
    const py = Math.floor((yFloat - tileY) * TILE_SIZE);

    const metersPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos(latRad)) / (TILE_SIZE * n);

    const tileUrl = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tileX}/${tileY}.png`;
    const imageData = await this.loadTileImageData(tileUrl);

    const getElevationAtPixel = (x, y) => {
      const clampedX = Math.max(0, Math.min(TILE_SIZE - 1, Math.round(x)));
      const clampedY = Math.max(0, Math.min(TILE_SIZE - 1, Math.round(y)));
      const idx = (clampedY * TILE_SIZE + clampedX) * 4;

      const r = imageData[idx];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];

      return r * 256 + g + b / 256 - 32768;
    };

    const centerElevation = getElevationAtPixel(px, py);

    const step = 2;
    const deltaDist = step * metersPerPixel;

    const zNW = getElevationAtPixel(px - step, py - step);
    const zN  = getElevationAtPixel(px,        py - step);
    const zNE = getElevationAtPixel(px + step, py - step);
    const zW  = getElevationAtPixel(px - step, py);
    const zE  = getElevationAtPixel(px + step, py);
    const zSW = getElevationAtPixel(px - step, py + step);
    const zS  = getElevationAtPixel(px,        py + step);
    const zSE = getElevationAtPixel(px + step, py + step);

    const dzdx = (zNE + 2 * zE + zSE - (zNW + 2 * zW + zSW)) / (8 * deltaDist);
    const dzdy = (zNW + 2 * zN + zNE - (zSW + 2 * zS + zSE)) / (8 * deltaDist);

    const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
    const tiltDeg = slopeRad * (180 / Math.PI);

    const openMeteoAzimuth = Math.atan2(dzdx, dzdy) * (180 / Math.PI);
    const compassAzimuth = (openMeteoAzimuth + 180 + 360) % 360;

    const radiusPixelsOuter = Math.round(250 / metersPerPixel);
    const radiusPixelsInner = Math.round(125 / metersPerPixel);
    let sumSurrounding = 0;
    const sampleCount = 16;

    for (let i = 0; i < sampleCount; i++) {
      const angle = (i * 2 * Math.PI) / sampleCount;
      const r = i % 2 === 0 ? radiusPixelsOuter : radiusPixelsInner;
      const sampleX = px + Math.cos(angle) * r;
      const sampleY = py + Math.sin(angle) * r;
      sumSurrounding += getElevationAtPixel(sampleX, sampleY);
    }

    const meanSurroundingElevation = sumSurrounding / sampleCount;
    const tpi = centerElevation - meanSurroundingElevation;

    return {
      elevation: Math.round(centerElevation * 10) / 10,
      tilt: Math.round(tiltDeg * 10) / 10,
      openMeteoAzimuth: Math.round(openMeteoAzimuth * 10) / 10,
      compassAzimuth: Math.round(compassAzimuth),
      tpi: Math.round(tpi * 10) / 10,
      gridResolutionMeters: Math.round(deltaDist * 10) / 10,
      landform: this.classifyLandform(tpi, tiltDeg),
      aspectName: this.getAspectName(compassAzimuth)
    };
  },

  /**
   * Fallback-Analyse falls AWS Terrain-PNG durch CORS im Browser blockiert wird
   */
  async fallbackTerrainAnalysis(lat, lon) {
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
      tilt: Math.max(10, slopeDeg),
      openMeteoAzimuth: openMeteoAzimuth,
      compassAzimuth: compassAzimuth,
      tpi: tpi,
      gridResolutionMeters: 25,
      landform: this.classifyLandform(tpi, slopeDeg),
      aspectName: this.getAspectName(compassAzimuth)
    };
  },

  loadTileImageData(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "Anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = TILE_SIZE;
        canvas.height = TILE_SIZE;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
      };
      img.onerror = (err) => reject(new Error(`Terrain-Tile Fehler: ${url}`));
      img.src = url;
    });
  },

  classifyLandform(tpi, tilt) {
    if (tpi >= 25) return "Exponierter Gipfel / Scharfer Grat";
    if (tpi >= 10) return "Kamm / Geländerücken";
    if (tpi <= -25) return "Tiefe Schlucht / Kessel / Rinne";
    if (tpi <= -10) return "Mulde / Talboden";
    if (tilt >= 35) return "Steilwand / Steilhang";
    return "Offener Hang / Hochebene";
  },

  getAspectName(compassDeg) {
    if (compassDeg >= 337.5 || compassDeg < 22.5) return 'Nordwand';
    if (compassDeg >= 22.5 && compassDeg < 67.5) return 'Nordostwand';
    if (compassDeg >= 67.5 && compassDeg < 112.5) return 'Ostwand / Ostflanke';
    if (compassDeg >= 112.5 && compassDeg < 157.5) return 'Südostwand';
    if (compassDeg >= 157.5 && compassDeg < 202.5) return 'Südwand / Südhang';
    if (compassDeg >= 202.5 && compassDeg < 247.5) return 'Südwestwand';
    if (compassDeg >= 247.5 && compassDeg < 292.5) return 'Westwand / Westflanke';
    return 'Nordwestwand';
  },

  /**
   * STUFE 2: Ruft Open-Meteo ab
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

    const hourlyVars = [
      "temperature_2m",
      "relative_humidity_2m",
      "dew_point_2m",
      "apparent_temperature",
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
      "wind_speed_10m_max",
      "wind_gusts_10m_max"
    ].join(",");

    const params = new URLSearchParams({
      latitude: lat.toFixed(5),
      longitude: lon.toFixed(5),
      elevation: Math.round(terrain.elevation).toString(),
      tilt: Math.round(terrain.tilt).toString(),
      azimuth: Math.round(terrain.openMeteoAzimuth).toString(),
      hourly: hourlyVars,
      daily: dailyVars,
      models: "best_match",
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
   * STUFE 3: Kombiniert Druckschichten mit 10m-Mikrotopografie
   */
  computeMicroPhysics(terrain, weatherData) {
    const h = weatherData.hourly;
    const nowIso = new Date().toISOString().slice(0, 13);
    let idx = h.time.findIndex((t) => t.startsWith(nowIso));
    if (idx === -1) idx = 0;

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

    let lowerLayer = layerStack[0];
    let upperLayer = layerStack[layerStack.length - 1];

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
    const baseWind = h.wind_speed_10m[idx] * (1 - highAlpineBlend) + freeAirWindSpeed * highAlpineBlend;

    const microWindSpeed = Math.max(2, baseWind * (1 + tpiFactor + luvLeeFactor));
    const rotorTurbulenceBoost = luvLeeAlignment < -0.3 && terrain.tilt > 25 ? 1.45 : 1.0;
    const microWindGusts = Math.max(
      microWindSpeed * 1.25,
      h.wind_gusts_10m[idx] * (1 + Math.max(0, tpiFactor)) * rotorTurbulenceBoost
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

    const baseTemp = h.temperature_2m[idx] * 0.5 + freeAirTemp * 0.5;
    const microTemp = baseTemp + radiationTempOffset + coldPoolOffset;

    let snowCondition = 'Apert / Schneefrei';
    if (terrain.elevation > (h.freezing_level_height ? h.freezing_level_height[idx] : 2000)) {
      if (terrain.compassAzimuth >= 315 || terrain.compassAzimuth <= 45) {
        snowCondition = 'Kalter Pulverschnee / Firneis';
      } else if (terrain.compassAzimuth >= 135 && terrain.compassAzimuth <= 225) {
        snowCondition = microTemp > 0 ? 'Aufweichender Nassschnee / Sulz' : 'Verharzter Harsch';
      } else {
        snowCondition = 'Windgepresster Triebschnee';
      }
    }

    return {
      timestamp: h.time[idx],
      terrain10m: terrain,
      atmosphere: {
        lapseRatePer100m: lapseRatePer100m,
        inversionActive: lapseRatePer100m > 0,
        freezingLevelMeters: h.freezing_level_height ? h.freezing_level_height[idx] : 2500,
      },
      microWeather: {
        temperature10m: Math.round(microTemp * 10) / 10,
        feltTemp: Math.round(h.apparent_temperature ? h.apparent_temperature[idx] : microTemp),
        modelStandardTemp2m: h.temperature_2m[idx],
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
    if (!h) return null;

    // Wir bestimmen 4 vertikale Stufen:
    // Tal (z.B. 600m), Mittelstation (z.B. 1500m), Gipfel (peakElevation), Hochgrat (peak + 600m)
    const valleyZ = Math.min(800, Math.round(peakElevation * 0.3));
    const midZ = Math.round((peakElevation + valleyZ) / 2);
    const peakZ = Math.round(peakElevation);
    const highZ = Math.round(peakElevation + 800);

    const steps = [
      { name: 'Talboden', z: valleyZ, icon: '🏡' },
      { name: 'Mittelstation', z: midZ, icon: '🌲' },
      { name: 'Gipfel / Grat', z: peakZ, icon: '🏔️' },
      { name: 'Freie Atmosphäre', z: highZ, icon: '🦅' }
    ];

    // Erstelle ein Profil für jede der nächsten 24 Stunden
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
          w = h.wind_speed_10m[i] * (1 + (step.z / 2000));
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
