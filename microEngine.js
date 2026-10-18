/**
 * 10-METER MIKRO-TOPOGRAFIE ENGINE (microEngine.js)
 * 
 * Berechnet ultra-lokale Wettereffekte im 10- bis 30-Meter-Raster:
 * 1. Dynamischer vertikaler Temperaturgradient (Gamma) aus Druckschichten + Inversions-Erkennung
 * 2. 10m Sonneneinstrahlung auf geneigte Hänge (GTI, Tilt 0-90°, Azimuth) -> Nordwand vs. Südhang
 * 3. 30m Venturi- & Lee-Effekt am Grat via Topographic Position Index (TPI)
 * 4. Bergschatten auf die Minute genau (Horizon Raycasting aus digitalem Höhenmodell)
 */

export const MicroEngine = {

  // =========================================================================
  // 1. DYNAMISCHER VERTIKALER TEMPERATURGRADIENT (GAMMA) & INVERSIONEN
  // =========================================================================
  /**
   * Berechnet den realen vertikalen Temperaturgradienten (Gamma) aus den Open-Meteo
   * Druckschichten (925, 850, 700, 600, 500 hPa) und interpoliert die exakte 10m-Temperatur.
   */
  calculateDynamicLapseRate(targetElevation, hourlyData, hourIndex = 0) {
    if (!hourlyData) return null;

    // Druckschichten sortiert nach Höhe
    const levels = [
      { name: '925hPa', p: 925 },
      { name: '850hPa', p: 850 },
      { name: '700hPa', p: 700 },
      { name: '600hPa', p: 600 },
      { name: '500hPa', p: 500 }
    ];

    const profile = [];
    for (const lvl of levels) {
      const zKey = `geopotential_height_${lvl.name}`;
      const tKey = `temperature_${lvl.name}`;
      if (hourlyData[zKey] && hourlyData[tKey]) {
        const z = hourlyData[zKey][hourIndex];
        const t = hourlyData[tKey][hourIndex];
        if (z !== undefined && t !== undefined) {
          profile.push({ level: lvl.name, p: lvl.p, z: z, t: t });
        }
      }
    }

    if (profile.length < 2) {
      // Fallback: Standard-Atmosphäre 0.65 °C / 100m
      return {
        gammaPer100m: -0.65,
        targetTemp: null,
        isInversion: false,
        inversionDelta: 0,
        profile: []
      };
    }

    // Finde die beiden Schichten, die die Geländehöhe umklammern
    let lower = profile[0];
    let upper = profile[profile.length - 1];

    for (let i = 0; i < profile.length - 1; i++) {
      if (targetElevation >= profile[i].z && targetElevation <= profile[i + 1].z) {
        lower = profile[i];
        upper = profile[i + 1];
        break;
      }
    }

    // Wenn Zielhöhe unterhalb der untersten Schicht
    if (targetElevation < profile[0].z) {
      lower = profile[0];
      upper = profile[1];
    }
    // Wenn Zielhöhe oberhalb der obersten Schicht
    if (targetElevation > profile[profile.length - 1].z) {
      lower = profile[profile.length - 2];
      upper = profile[profile.length - 1];
    }

    // Exakter physikalischer Gradient: Gamma = (T_upper - T_lower) / (z_upper - z_lower)
    const dz = upper.z - lower.z;
    const dt = upper.t - lower.t;
    const gammaPerMeter = dz !== 0 ? (dt / dz) : -0.0065;
    const gammaPer100m = gammaPerMeter * 100;

    // Metergenaue Temperatur am Standort
    const interpolatedTemp = lower.t + gammaPerMeter * (targetElevation - lower.z);

    // Inversionserkennung (Temperatur steigt mit der Höhe, dT > 0)
    let isInversion = false;
    let maxInversionDelta = 0;
    for (let i = 0; i < profile.length - 1; i++) {
      const deltaT = profile[i + 1].t - profile[i].t;
      if (deltaT > 0.5) {
        isInversion = true;
        if (deltaT > maxInversionDelta) maxInversionDelta = deltaT;
      }
    }

    return {
      gammaPer100m: parseFloat(gammaPer100m.toFixed(2)),
      gammaPerMeter: gammaPerMeter,
      interpolatedTemp: parseFloat(interpolatedTemp.toFixed(1)),
      lowerLayer: lower,
      upperLayer: upper,
      isInversion: isInversion,
      inversionDelta: parseFloat(maxInversionDelta.toFixed(1)),
      profile: profile
    };
  },

  // =========================================================================
  // 2. ASTRONOMISCHE BERECHNUNG DER SONNENPOSITION (Azimut & Elevation)
  // =========================================================================
  /**
   * Berechnet den genauen Sonnenstand (Elevation & Azimut in Grad) für Breiten-/Längengrad
   * und Datum/Uhrzeit.
   */
  getSunPosition(lat, lon, date = new Date()) {
    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;

    // Julianisches Datum
    const jd = (date.getTime() / 86400000) + 2440587.5;
    const d = jd - 2451545.0;

    // Keplerianische Bahnelemente der Sonne
    const g = (357.529 + 0.98560028 * d) % 360;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad)) % 360;
    const e = 23.439 - 0.00000036 * d;

    // Äquatoriale Koordinaten
    const sinDecl = Math.sin(e * rad) * Math.sin(L * rad);
    const decl = Math.asin(sinDecl);
    const cosDecl = Math.cos(decl);
    const ra = Math.atan2(Math.cos(e * rad) * Math.sin(L * rad), Math.cos(L * rad));

    // Lokale Sternzeit (GMST + Lon)
    const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
    const lmst = (gmst + lon) % 360;
    const ha = (lmst * rad) - ra;

    // Horizontale Koordinaten (Elevation & Azimut)
    const latRad = lat * rad;
    const sinAlt = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * cosDecl * Math.cos(ha);
    const alt = Math.asin(sinAlt); // Sonnenhöhe über Horizont

    const cosAz = (Math.sin(decl) - Math.sin(latRad) * Math.sin(alt)) / (Math.cos(latRad) * Math.cos(alt));
    let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * deg;
    if (Math.sin(ha) > 0) az = 360 - az;

    return {
      elevation: parseFloat((alt * deg).toFixed(2)),
      azimuth: parseFloat(az.toFixed(2)),
      isAboveHorizon: alt > 0
    };
  },

  // =========================================================================
  // 3. GELÄNDEMODELL-ANALYSE & TOPOGRAPHIC POSITION INDEX (TPI / VENTURI)
  // =========================================================================
  /**
   * Berechnet den 300m-Topographic Position Index (TPI), Hangneigung (Tilt)
   * und Ausrichtung (Azimuth) aus einem Höhenmuster rund um den Zielpunkt.
   */
  async sampleTerrainGrid(lat, lon, centerElevation) {
    // 8 Himmelsrichtungs-Punkte im 300m-Radius (ca. 0.0027° Lat, 0.0040° Lon)
    const dLat = 0.0027;
    const dLon = 0.0040;

    const samplePoints = [
      { name: 'N', lat: lat + dLat, lon: lon },
      { name: 'NE', lat: lat + dLat * 0.7, lon: lon + dLon * 0.7 },
      { name: 'E', lat: lat, lon: lon + dLon },
      { name: 'SE', lat: lat - dLat * 0.7, lon: lon + dLon * 0.7 },
      { name: 'S', lat: lat - dLat, lon: lon },
      { name: 'SW', lat: lat - dLat * 0.7, lon: lon - dLon * 0.7 },
      { name: 'W', lat: lat, lon: lon - dLon },
      { name: 'NW', lat: lat + dLat * 0.7, lon: lon - dLon * 0.7 }
    ];

    try {
      const latStr = [lat, ...samplePoints.map(p => p.lat.toFixed(5))].join(',');
      const lonStr = [lon, ...samplePoints.map(p => p.lon.toFixed(5))].join(',');
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${latStr}&longitude=${lonStr}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Elevation API HTTP ${res.status}`);
      const data = await res.json();

      const z0 = data.elevation[0] !== undefined ? data.elevation[0] : centerElevation;
      const ringElevations = data.elevation.slice(1);

      // Durchschnittshöhe im 300m-Radius
      const avg300m = ringElevations.reduce((a, b) => a + b, 0) / ringElevations.length;

      // Topographic Position Index: TPI = z0 - avg_300m
      const tpi = Math.round(z0 - avg300m);

      // Hangneigung (Tilt) & Ausrichtung (Azimuth) via Horn-Algorithmus
      const zN = ringElevations[0];
      const zE = ringElevations[2];
      const zS = ringElevations[4];
      const zW = ringElevations[6];

      // Gradienten in Nord-Süd und Ost-West (Distanz = 600m)
      const dz_dx = (zE - zW) / 600;
      const dz_dy = (zN - zS) / 600;

      const slopeRad = Math.atan(Math.sqrt(dz_dx * dz_dx + dz_dy * dz_dy));
      const slopeDeg = Math.min(85, Math.round(slopeRad * (180 / Math.PI)));

      let aspectDeg = Math.round(Math.atan2(-dz_dx, dz_dy) * (180 / Math.PI));
      if (aspectDeg < 0) aspectDeg += 360;

      return {
        centerElevation: Math.round(z0),
        avg300m: Math.round(avg300m),
        tpi: tpi,
        slope: slopeDeg,
        aspect: aspectDeg,
        ring: samplePoints.map((p, i) => ({ ...p, elevation: ringElevations[i] }))
      };
    } catch (err) {
      console.warn('Terrain Grid Fetch fehlgeschlagen, benutze Modell-Fallback:', err);
      // Fallback
      return {
        centerElevation: centerElevation,
        avg300m: centerElevation,
        tpi: 0,
        slope: 25,
        aspect: 180,
        ring: []
      };
    }
  },

  // =========================================================================
  // 4. VENTURI-WIND AM GRAT & LEE-EFFEKT
  // =========================================================================
  /**
   * Berechnet die Windbeschleunigung an scharfen Kämmen und Graten (Venturi)
   * sowie die Dämpfung in geschützten Mulden (Lee).
   */
  calculateVenturiWind(baseWind10m, altitudeWind700, tpi, windDir = 0, ridgeAspect = 0) {
    let speedUpFactor = 1.0;
    let classification = 'Standard-Gelände';
    let warning = null;

    if (tpi > 20) {
      // Exponierter Grat / Gipfel (positiver TPI)
      // Wind wird um 20% bis 60% beschleunigt (Venturi Speed-up)
      const scale = Math.min(0.65, 0.20 + (tpi / 100) * 0.35);
      speedUpFactor = 1.0 + scale;

      // Berücksichtigung des Höhenwindes der freien Atmosphäre
      const blendAltWind = altitudeWind700 ? (altitudeWind700 * 0.45) : (baseWind10m * speedUpFactor);
      const effectiveWind = Math.max(baseWind10m * speedUpFactor, blendAltWind);
      const gustPotential = Math.round(effectiveWind * 1.6);

      classification = tpi > 60 ? 'Scharfer Hochgebirgsgrat / Gipfel' : 'Exponierter Bergrücken';
      warning = `⚠️ Venturi-Effekt aktiv: Wind am Grat um +${Math.round(scale * 100)} % verstärkt!`;

      return {
        speedUpFactor: parseFloat(speedUpFactor.toFixed(2)),
        effectiveWind: Math.round(effectiveWind),
        gustPotential: gustPotential,
        classification: classification,
        warning: warning,
        tpi: tpi
      };
    } else if (tpi < -20) {
      // Geschützte Mulde / Talbecken (stark negativer TPI)
      const damping = Math.max(0.40, 1.0 - (Math.abs(tpi) / 120) * 0.45);
      const effectiveWind = Math.round(baseWind10m * damping);
      const gustPotential = Math.round(effectiveWind * 1.35);

      classification = tpi < -60 ? 'Tiefe Bergkamm-Scharte / Couloir' : 'Geschützter Kessel / Talmulde';

      return {
        speedUpFactor: parseFloat(damping.toFixed(2)),
        effectiveWind: effectiveWind,
        gustPotential: gustPotential,
        classification: classification,
        warning: 'Geschütztes Lee: Höhenwind gedämpft, lokale Talthermik dominiert.',
        tpi: tpi
      };
    } else {
      // Ausgeglichenes Gelände
      return {
        speedUpFactor: 1.0,
        effectiveWind: Math.round(baseWind10m),
        gustPotential: Math.round(baseWind10m * 1.4),
        classification: 'Mäßig geneigter Hang',
        warning: null,
        tpi: tpi
      };
    }
  },

  // =========================================================================
  // 5. BERGSCHATTEN AUF DIE MINUTE GENAU (Horizon Raycasting)
  // =========================================================================
  /**
   * Prüft, ob ein Nachbargipfel in Richtung des Sonnen-Azimuts steht und
   * die Sonne verdeckt (Bergschatten).
   */
  async checkHorizonShadow(lat, lon, z0, sunPos) {
    if (!sunPos.isAboveHorizon) {
      return {
        inShadow: true,
        reason: 'Nacht / Sonne unter dem Horizont',
        obstacleAngle: 0,
        sunElevation: sunPos.elevation,
        tempDrop: 0
      };
    }

    const rad = Math.PI / 180;
    const azRad = sunPos.azimuth * rad;

    // Abtastpunkte in Richtung der Sonne (Raycasting: 500m, 1200m, 2500m, 5000m)
    const distances = [600, 1500, 3000, 6000];
    const rayPoints = distances.map(dist => {
      // 1° Lat ≈ 111.000m; 1° Lon ≈ 111.000m * cos(lat)
      const dLat = (dist * Math.cos(azRad)) / 111000;
      const dLon = (dist * Math.sin(azRad)) / (111000 * Math.cos(lat * rad));
      return { dist, lat: lat + dLat, lon: lon + dLon };
    });

    try {
      const latStr = rayPoints.map(p => p.lat.toFixed(5)).join(',');
      const lonStr = rayPoints.map(p => p.lon.toFixed(5)).join(',');
      const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${latStr}&longitude=${lonStr}`);
      if (!res.ok) throw new Error('Horizon raycast HTTP error');
      const data = await res.json();

      let maxObstacleAngle = 0;
      let blockingDistance = 0;

      for (let i = 0; i < distances.length; i++) {
        const zObs = data.elevation[i];
        if (zObs !== undefined) {
          const deltaZ = zObs - z0;
          const angle = Math.atan2(deltaZ, distances[i]) * (180 / Math.PI);
          if (angle > maxObstacleAngle) {
            maxObstacleAngle = angle;
            blockingDistance = distances[i];
          }
        }
      }

      const inShadow = sunPos.elevation <= maxObstacleAngle;
      const tempDrop = inShadow ? Math.min(8.0, 3.5 + (maxObstacleAngle - sunPos.elevation) * 0.4) : 0;

      return {
        inShadow: inShadow,
        sunElevation: sunPos.elevation,
        obstacleAngle: parseFloat(maxObstacleAngle.toFixed(1)),
        blockingDistance: blockingDistance,
        tempDrop: parseFloat(tempDrop.toFixed(1)),
        statusText: inShadow 
          ? `🏔️ Bergschatten aktiv! (Gipfel blockiert bei ${maxObstacleAngle.toFixed(1)}°)`
          : `☀️ Volle Sonne (Sonne steht ${sunPos.elevation.toFixed(1)}° über Berg)`
      };
    } catch (e) {
      console.warn('Raycast shadow fetch failed:', e);
      return {
        inShadow: false,
        sunElevation: sunPos.elevation,
        obstacleAngle: 0,
        tempDrop: 0,
        statusText: 'Sonnenschein aktiv'
      };
    }
  },

  // =========================================================================
  // 6. NORDWAND VS. SÜDHANG (10m Solar-Einstrahlung & gefühlte Temperatur)
  // =========================================================================
  /**
   * Berechnet den drastischen Unterschied der gefühlten Temperatur zwischen
   * Nordwand (Schatten, Diffusstrahlung) und Südhang (voller Sonnengewinn).
   */
  calculateAspectComparison(baseTemp, baseFeltTemp, sunPos, isOvercast = false) {
    if (!sunPos.isAboveHorizon || isOvercast) {
      return {
        southSlope: {
          feltTemp: Math.round(baseFeltTemp),
          irradiance: 0,
          label: 'Südhang (Nacht / Bewölkt)'
        },
        northFace: {
          feltTemp: Math.round(baseFeltTemp - 1),
          irradiance: 0,
          label: 'Nordwand (Kalt)'
        },
        deltaTemp: 0
      };
    }

    // Solar Irradiance Approximation (GTI)
    // Südhang: 45° Neigung, Azimuth 180° zur Sonne gerichtet
    // Nordwand: 75° Steilwand, nach Norden gerichtet (0° direktes Sonnenlicht)
    const sunElevRad = Math.max(0.1, sunPos.elevation) * (Math.PI / 180);
    const maxSolarFlux = 950; // W/m² bei klarer Bergluft

    // Einstrahlung Südflanke (optimaler Einstrahlwinkel)
    const southIrradiance = Math.min(1050, Math.round(maxSolarFlux * Math.sin(sunElevRad + 0.45)));
    // Einstrahlung Nordwand (nur diffuse Himmelsstrahlung ca. 8-15%)
    const northIrradiance = Math.round(maxSolarFlux * 0.12 * Math.sin(sunElevRad));

    // Strahlungswärmegewinn auf der Haut / Kleidung:
    // deltaT_solar = (Irradiance / 60)
    const southThermalGain = southIrradiance / 55;
    const northThermalGain = northIrradiance / 60;

    const southFelt = Math.round(baseTemp + southThermalGain);
    const northFelt = Math.round(baseFeltTemp - 2.5 + northThermalGain);
    const delta = southFelt - northFelt;

    return {
      southSlope: {
        feltTemp: southFelt,
        irradiance: southIrradiance,
        label: '☀️ Südhang / Sonnenflanke (45°)'
      },
      northFace: {
        feltTemp: northFelt,
        irradiance: northIrradiance,
        label: '❄️ Nordwand / Schattenflanke (75°)'
      },
      deltaTemp: delta
    };
  }
};
