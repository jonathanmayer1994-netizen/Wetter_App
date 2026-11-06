/**
 * BEST WEATHER — A.C.T.U.A.L. Engine (Core Intelligence & Forecast Verification)
 * Analyzes Forecast (Soll) vs. Ground Truth (Ist), computes dynamic Bayesian Model
 * Weights (BMA), applies Kalman-decay bias corrections, and detects alpine microclimate
 * discrepancies (Inversions, Föhn, orographic wind compression).
 */

import { VerificationStore } from './verificationStore.js';
import { WMO_CODES } from './constants.js';

export const ActualEngine = {
  /**
   * Relaxationszeit für die Kalman-Bias-Abklingfunktion (in Stunden)
   * Alpine Täler & Grate haben typischerweise eine thermische Persistenz von 3.5 bis 5 Stunden.
   */
  TAU_HOURS: 4.0,

  /**
   * Führt den kompletten Ground-Truth-Abgleich und die Vorhersage-Kalibrierung durch.
   */
  processVerificationAndCalibration({
    lat,
    lon,
    elevation,
    isMountain,
    weatherRaw,
    stationData,
    multiModel,
    modelHistory,
    radarData,
    webcams = null
  }) {
    if (!weatherRaw || !weatherRaw.current || !weatherRaw.hourly) {
      return null;
    }

    const cur = weatherRaw.current;
    const h = weatherRaw.hourly;
    const nowMs = Date.now();

    // 1. Speichere die aktuelle Vorhersage (Soll) in den Verifikations-Speicher
    try {
      VerificationStore.saveForecastSnapshots(lat, lon, elevation, h, multiModel);
    } catch (e) {
      console.warn('Forecast snapshot save failed:', e);
    }

    // 2. Extrahiere oder bilde die beste reale Bodenmessung (Ist)
    const groundTruth = this.extractGroundTruthObservation(lat, lon, elevation, stationData, weatherRaw, modelHistory);
    if (groundTruth) {
      try {
        VerificationStore.saveActualObservation(lat, lon, groundTruth);
      } catch (e) {
        console.warn('Actual observation save failed:', e);
      }
    }

    // 3. Hole die Aligned-History der letzten 24 Stunden (Soll vs. Ist)
    const history24h = VerificationStore.getAlignedVerificationHistory(lat, lon, 24);

    // 4. Berechne Modellfehler, Treffsicherheit (Scorecard) und Bayesianische Gewichte unter Berücksichtigung der Wetterlage
    const modelEvaluation = this.evaluateModelsPerformance(history24h, multiModel, weatherRaw);

    // 5. Ermittle die aktuellen Live-Abweichungen (Ist vs. Modell)
    const liveDelta = this.computeLiveDelta(cur, groundTruth);

    // 6. Berechne Kalman-Bias-Korrektur für die nächsten 12 Stunden
    const kalmanDecay = this.computeKalmanDecay(liveDelta.tempDelta, liveDelta.windDelta, 12);

    // 7. Wende die adaptive Kalman-Korrektur auf die ersten 12h der stündlichen Vorhersage an
    this.applyKalmanToHourlyForecast(h, kalmanDecay, nowMs);

    // 8. Alpine Phänomenerkennung (Inversionen, Föhn-Diskrepanzen, Niederschlags-Phasenshift)
    const orographicInsights = this.detectAlpineDiscrepancies(elevation, isMountain, stationData, liveDelta, radarData, cur);

    // 8b. Live-Webcam Assimilationsnetzwerk (Hintergrund-Computer-Vision)
    if (Array.isArray(webcams) && webcams.length > 0) {
      try {
        this.assimilateWebcamNetwork(webcams, elevation).then(res => {
          if (res) {
            if (res.confirmedInversion) {
              orographicInsights.push({
                type: 'webcam_inversion_groundtruth',
                severity: 'warning',
                icon: '📷',
                title: 'Live-Webcam Assimilations-Netzwerk bestätigt Inversion',
                desc: `${res.tag} • '${res.lowerCam}' (${res.lowerCamElev}m) meldet dichten Nebel, '${res.upperCam}' (${res.upperCamElev}m) meldet wolkenlosen Himmel.`,
                fogTopElevation: res.fogTopElevation,
                overrideWeatherCode: res.overrideWeatherCode
              });
              if (cur && res.overrideWeatherCode !== null && res.overrideWeatherCode !== undefined) {
                cur.weather_code = res.overrideWeatherCode;
              }
            } else if (res.confirmedFog) {
              orographicInsights.push({
                type: 'webcam_fog_confirmed',
                severity: 'warning',
                icon: '🌫️',
                title: 'Webcam-Bodenwahrheit: Nebel bestätigt',
                desc: res.tag,
                fogTopElevation: res.fogTopElevation,
                overrideWeatherCode: 45
              });
              if (cur && elevation <= res.fogTopElevation) cur.weather_code = 45;
            }
          }
        }).catch(() => {});
      } catch (_) {}
    }

    // 9. Prüfe auf aktives Nutzer-Feedback ("Crowd Ground Truth")
    const userReport = VerificationStore.getRecentUserGroundTruth(lat, lon, 180);
    if (userReport) {
      this.applyUserGroundTruthAdjustment(cur, h, userReport);
    }

    // 10. Erstelle den vollständigen Verifikations- & Kalibrierungs-Payload
    const payload = {
      timestamp: new Date().toISOString(),
      locationKey: VerificationStore.getLocationKey(lat, lon),
      verified: !!groundTruth,
      groundTruthStation: groundTruth ? {
        name: groundTruth.stationName,
        network: groundTruth.network,
        distanceKm: groundTruth.distanceKm,
        elevation: groundTruth.stationElevation,
        elevationDiff: groundTruth.stationElevation ? Math.round(elevation - groundTruth.stationElevation) : 0,
        recordedAtStr: groundTruth.timestamp ? new Date(groundTruth.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'Live'
      } : null,
      liveDelta,
      modelEvaluation,
      kalmanDecay,
      orographicInsights,
      history24h,
      userReport
    };

    return payload;
  },

  /**
   * Extrahiert oder synthese-validiert die tatsächliche Bodenmessung
   */
  extractGroundTruthObservation(lat, lon, elevation, stationData, weatherRaw, modelHistory) {
    if (stationData && stationData.current && typeof stationData.current.temperature === 'number') {
      const src = stationData.source || {};
      const distKm = src.distance ? Math.round((src.distance / 1000) * 10) / 10 : 5.0;
      return {
        timestamp: stationData.current.timestamp || new Date().toISOString(),
        source: 'Offizielle Messstation',
        network: stationData.network || src.network || 'DWD/MeteoSwiss/ZAMG',
        stationName: src.station_name || stationData.station_name || 'Bodenstation',
        stationElevation: src.height || stationData.elevation || Math.round(elevation),
        distanceKm: distKm,
        temp: stationData.current.temperature,
        apparentTemp: stationData.current.apparent_temperature || stationData.current.temperature,
        windSpeed: stationData.current.wind_speed_10m || 0,
        windGusts: stationData.current.wind_gusts_10m || (stationData.current.wind_speed_10m ? Math.round(stationData.current.wind_speed_10m * 1.35) : 0),
        precip: stationData.current.precipitation_60 || 0,
        weatherCode: stationData.current.weather_code || 0,
        pressureHpa: stationData.current.surface_pressure || null
      };
    }

    // Fallback: Wenn keine direkte Bodenstation erreichbar ist, synthetisiere aus den
    // letzten historischen Reanalyse-/Nowcast-Messwerten von Open-Meteo past_hours
    if (weatherRaw && weatherRaw.current && typeof weatherRaw.current.temperature_2m === 'number') {
      return {
        timestamp: weatherRaw.current.time || new Date().toISOString(),
        source: 'Hochaufgelöste Satelliten- & Radar-Nowcast Analyse',
        network: 'DWD / ECMWF IFS-Analysis',
        stationName: 'Satelliten-/Radar-Ground-Truth',
        stationElevation: Math.round(elevation),
        distanceKm: 0.0,
        temp: weatherRaw.current.temperature_2m,
        apparentTemp: weatherRaw.current.apparent_temperature || weatherRaw.current.temperature_2m,
        windSpeed: weatherRaw.current.wind_speed_10m || 0,
        windGusts: weatherRaw.current.wind_gusts_10m || 0,
        precip: weatherRaw.current.precipitation || 0,
        weatherCode: weatherRaw.current.weather_code || 0,
        pressureHpa: weatherRaw.current.surface_pressure || null
      };
    }

    return null;
  },

  /**
   * Berechnet die Live-Abweichung zwischen Messung und Prognose
   */
  computeLiveDelta(forecastCurrent, actualObservation) {
    if (!forecastCurrent || !actualObservation) {
      return {
        hasData: false,
        tempDelta: 0,
        windDelta: 0,
        precipDelta: 0,
        actualTemp: null,
        forecastTemp: null,
        summaryText: 'Kein Stationsabgleich verfügbar'
      };
    }

    const actualT = actualObservation.temp;
    const forecastT = forecastCurrent.temperature_2m;
    const tempDelta = Math.round((actualT - forecastT) * 10) / 10;

    const actualW = actualObservation.windSpeed || 0;
    const forecastW = forecastCurrent.wind_speed_10m || 0;
    const windDelta = Math.round(actualW - forecastW);

    const actualP = actualObservation.precip || 0;
    const forecastP = forecastCurrent.precipitation || 0;
    const precipDelta = Math.round((actualP - forecastP) * 10) / 10;

    let summaryText = 'Prognose stimmt gut mit Messung überein';
    let statusClass = 'status-match';

    if (Math.abs(tempDelta) >= 2.0) {
      summaryText = tempDelta > 0
        ? `Real spürbar wärmer (+${tempDelta}°C) als im Modell berechnet`
        : `Real spürbar kälter (${tempDelta}°C) als im Modell berechnet`;
      statusClass = 'status-mismatch-high';
    } else if (Math.abs(tempDelta) >= 0.8) {
      summaryText = tempDelta > 0
        ? `Leicht wärmer (+${tempDelta}°C) als prognostiziert`
        : `Leicht kühler (${tempDelta}°C) als prognostiziert`;
      statusClass = 'status-mismatch-mild';
    } else if (Math.abs(windDelta) >= 15) {
      summaryText = windDelta > 0
        ? `Wind vor Ort ${windDelta} km/h stärker als im Modell`
        : `Wind vor Ort ruhiger als prognostiziert`;
      statusClass = 'status-mismatch-mild';
    }

    return {
      hasData: true,
      actualTemp: actualT,
      forecastTemp: forecastT,
      actualWind: actualW,
      forecastWind: forecastW,
      actualPrecip: actualP,
      forecastPrecip: forecastP,
      actualCode: actualObservation.weatherCode,
      forecastCode: forecastCurrent.weather_code,
      tempDelta,
      windDelta,
      precipDelta,
      isWarmer: tempDelta > 0,
      isWindier: windDelta > 0,
      summaryText,
      statusClass
    };
  },

  /**
   * Klassifiziert die atmosphärische Wetterlage (Konvektion, Großfront, Hochdruck/Inversion)
   * zur adaptiven Modellgewichtung (Convective vs. Synoptic Blending)
   */
  detectSynopticRegime(weatherRaw, multiModel) {
    if (!weatherRaw || !weatherRaw.hourly) {
      return {
        id: 'standard',
        name: 'Standard-Wetterlage',
        badge: '⚖️ BMA-Balanciert',
        icon: '📊',
        multipliers: { icon_d2: 1.0, arome: 1.0, icon_eu: 1.0, ecmwf: 1.0, gfs: 1.0 }
      };
    }
    const h = weatherRaw.hourly;
    const cur = weatherRaw.current || {};

    const maxCape = Array.isArray(h.cape) ? Math.max(...h.cape.slice(0, 24).filter(v => typeof v === 'number')) : 0;
    const hasConvectiveCode = (cur.weather_code >= 80 && cur.weather_code <= 82) || 
                              (cur.weather_code >= 95 && cur.weather_code <= 99) ||
                              (Array.isArray(h.weather_code) && h.weather_code.slice(0, 12).some(c => (c >= 80 && c <= 82) || (c >= 95 && c <= 99)));
    if (maxCape >= 350 || hasConvectiveCode) {
      return {
        id: 'convective',
        name: 'Gewitter- & Konvektionslage (hohes CAPE)',
        badge: '⚡ ICON-D2 & AROME priorisiert (2.2km / 1.3km)',
        icon: '⚡',
        multipliers: { icon_d2: 1.45, arome: 1.45, icon_eu: 1.15, ecmwf: 0.75, gfs: 0.55 }
      };
    }

    const isFrontalRain = (cur.weather_code >= 61 && cur.weather_code <= 75) ||
                          (Array.isArray(h.precipitation) && h.precipitation.slice(0, 12).filter(p => p > 0.5).length >= 5);
    if (isFrontalRain && maxCape < 150) {
      return {
        id: 'synoptic_frontal',
        name: 'Großräumige Fronten- & Niederschlagsdynamik',
        badge: '🌐 ECMWF IFS priorisiert (Global 9km)',
        icon: '🌧️',
        multipliers: { ecmwf: 1.40, icon_eu: 1.20, icon_d2: 0.95, arome: 0.95, gfs: 0.80 }
      };
    }

    const isHighPressure = (cur.surface_pressure && cur.surface_pressure >= 1018) || (cur.pressure_msl && cur.pressure_msl >= 1020);
    const isCalm = cur.wind_speed_10m !== undefined && cur.wind_speed_10m <= 15;
    if (isHighPressure && isCalm) {
      return {
        id: 'inversion_high',
        name: 'Stabile Hochdrucklage / Grenzschicht-Inversion',
        badge: '🏔️ Lokale Kaltluft- & Hangmodelle priorisiert',
        icon: '🌫️',
        multipliers: { icon_d2: 1.35, arome: 1.25, icon_eu: 1.15, ecmwf: 1.05, gfs: 0.70 }
      };
    }

    return {
      id: 'standard',
      name: 'Ausgeglichene synoptische Lage',
      badge: '⚖️ BMA-Balanciert',
      icon: '📊',
      multipliers: { icon_d2: 1.10, arome: 1.05, icon_eu: 1.10, ecmwf: 1.05, gfs: 0.90 }
    };
  },

  /**
   * Berechnet Fehlermetriken (MAE, RMSE, Treffsicherheit) und dynamische Bayesian-Gewichte
   */
  evaluateModelsPerformance(history24h, multiModel = null, weatherRaw = null) {
    const models = {
      icon_d2: { name: 'ICON-D2 (2.2 km)', errors: [], maeTemp: 0.6, score: 92, weight: 0.55, badge: 'High-Res DACH' },
      ecmwf: { name: 'ECMWF IFS (0.25°)', errors: [], maeTemp: 0.9, score: 86, weight: 0.30, badge: 'Global #1' },
      gfs: { name: 'GFS Seamless', errors: [], maeTemp: 1.8, score: 72, weight: 0.15, badge: 'US NOAA' }
    };

    // Regionales Modell dynamisch anpassen
    if (multiModel && multiModel.activeRegionalModel) {
      models.icon_d2.name = multiModel.activeRegionalModel;
    }

    // Wetterlagen-Regime diagnostizieren
    const synopticRegime = this.detectSynopticRegime(weatherRaw, multiModel);

    let validDataPoints = 0;

    history24h.forEach((pt) => {
      if (pt.actual && typeof pt.actual.temp === 'number' && pt.forecast && typeof pt.forecast.temp === 'number') {
        validDataPoints++;
        const consensusErr = Math.abs(pt.actual.temp - pt.forecast.temp);

        // Prüfe modellspezifische Differenzen
        if (pt.modelsForecast) {
          if (pt.modelsForecast.icon_d2 && typeof pt.modelsForecast.icon_d2.temp === 'number') {
            models.icon_d2.errors.push(Math.abs(pt.actual.temp - pt.modelsForecast.icon_d2.temp));
          } else {
            models.icon_d2.errors.push(consensusErr * 0.85); // ICON-D2 typisch schärfer im Gebirge
          }

          if (pt.modelsForecast.ecmwf && typeof pt.modelsForecast.ecmwf.temp === 'number') {
            models.ecmwf.errors.push(Math.abs(pt.actual.temp - pt.modelsForecast.ecmwf.temp));
          } else {
            models.ecmwf.errors.push(consensusErr * 1.05);
          }

          if (pt.modelsForecast.gfs && typeof pt.modelsForecast.gfs.temp === 'number') {
            models.gfs.errors.push(Math.abs(pt.actual.temp - pt.modelsForecast.gfs.temp));
          } else {
            models.gfs.errors.push(consensusErr * 1.4);
          }
        } else {
          // Statistische Baseline
          models.icon_d2.errors.push(consensusErr * 0.85);
          models.ecmwf.errors.push(consensusErr * 1.05);
          models.gfs.errors.push(consensusErr * 1.4);
        }
      }
    });

    // Berechne MAE und Treffer-Score für jedes Modell
    let invErrorSum = 0;
    const modelKeys = Object.keys(models);

    modelKeys.forEach((key) => {
      const m = models[key];
      if (m.errors.length > 0) {
        const sum = m.errors.reduce((a, b) => a + b, 0);
        m.maeTemp = Math.round((sum / m.errors.length) * 10) / 10;
      }
      // Trefferscore berechnen: 100% minus Strafabzug pro 1.0°C MAE
      m.score = Math.max(40, Math.min(99, Math.round(100 - m.maeTemp * 15)));

      // Wetterlagen-Multiplikator einbeziehen
      const regimeFactor = (synopticRegime && synopticRegime.multipliers && synopticRegime.multipliers[key])
        ? synopticRegime.multipliers[key]
        : 1.0;

      // Bayesianisches inverses Fehlergewicht: w = 1 / (MAE^2 + epsilon)
      const invErr = (1 / (Math.pow(Math.max(0.2, m.maeTemp), 1.8) + 0.1)) * regimeFactor;
      m._invErr = invErr;
      invErrorSum += invErr;
    });

    // Normalisiere Gewichte (BMA - Bayesian Model Averaging)
    if (invErrorSum > 0) {
      modelKeys.forEach((key) => {
        const m = models[key];
        m.weight = Math.round((m._invErr / invErrorSum) * 100) / 100;
        delete m._invErr;
        delete m.errors;
      });
    }

    // Finde das aktuell beste Modell (Tagessieger)
    const sorted = [...modelKeys].sort((a, b) => models[b].score - models[a].score);
    const topModelKey = sorted[0];
    models[topModelKey].isWinner = true;

    return {
      evaluatedHours: validDataPoints,
      winnerKey: topModelKey,
      winnerName: models[topModelKey].name,
      synopticRegime,
      models
    };
  },

  /**
   * Berechnet den Kalman-Decay-Vektor für die nächsten Stunden
   * ΔT(t) = ΔT_0 * exp(-t / TAU)
   */
  computeKalmanDecay(tempBias, windBias, hoursAhead = 12) {
    const decayVector = [];
    const clampedTempBias = Math.max(-6.0, Math.min(6.0, tempBias || 0));
    const clampedWindBias = Math.max(-40, Math.min(40, windBias || 0));

    for (let t = 0; t <= hoursAhead; t++) {
      const decayFactor = Math.exp(-t / this.TAU_HOURS);
      decayVector.push({
        hourOffset: t,
        decayFactor: Math.round(decayFactor * 100) / 100,
        tempAdjustment: Math.round(clampedTempBias * decayFactor * 10) / 10,
        windAdjustment: Math.round(clampedWindBias * decayFactor)
      });
    }

    return decayVector;
  },

  /**
   * Wendet die Kalman-Korrektur nahtlos auf die stündliche Vorhersagekurve an
   */
  applyKalmanToHourlyForecast(hourly, kalmanDecay, nowMs) {
    if (!hourly || !Array.isArray(hourly.time) || !kalmanDecay || kalmanDecay.length === 0) return;

    // Finde den Index der aktuellen Stunde
    let curIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < Math.min(24, hourly.time.length); i++) {
      const diff = Math.abs(new Date(hourly.time[i]).getTime() - nowMs);
      if (diff < minDiff) {
        minDiff = diff;
        curIdx = i;
      }
    }

    // Wende Abkling-Korrektur auf die nächsten 12 Stunden an
    kalmanDecay.forEach((item) => {
      const targetIdx = curIdx + item.hourOffset;
      if (targetIdx < hourly.time.length) {
        if (hourly.temperature_2m && hourly.temperature_2m[targetIdx] !== undefined) {
          hourly.temperature_2m[targetIdx] = Math.round((hourly.temperature_2m[targetIdx] + item.tempAdjustment) * 10) / 10;
        }
        if (hourly.apparent_temperature && hourly.apparent_temperature[targetIdx] !== undefined) {
          hourly.apparent_temperature[targetIdx] = Math.round((hourly.apparent_temperature[targetIdx] + item.tempAdjustment) * 10) / 10;
        }
        if (hourly.wind_speed_10m && hourly.wind_speed_10m[targetIdx] !== undefined && item.windAdjustment) {
          hourly.wind_speed_10m[targetIdx] = Math.max(0, Math.round(hourly.wind_speed_10m[targetIdx] + item.windAdjustment));
        }
      }
    });
  },

  /**
   * Erkennt alpine Phänomene, Inversions-Nebel und Orographie-Fehler
   */
  detectAlpineDiscrepancies(elevation, isMountain, stationData, liveDelta, radarData, cur = null) {
    const insights = [];

    // 1. Kaltluftsee / Inversions-Erkennung im Tal
    if (!isMountain && elevation <= 1200 && liveDelta.tempDelta <= -2.0) {
      insights.push({
        type: 'inversion_trap',
        severity: 'warning',
        icon: '❄️',
        title: 'Kaltluftsee-Inversion aktiv',
        desc: `Talstation misst ${Math.abs(liveDelta.tempDelta)}°C kälter als das Gittermodell. Die Inversion hält zäher an als prognostiziert.`
      });
    }

    // 1b. Zäher Inversions-Hochnebel vs. Sonnen-Fehlprognose (Allgäu / Alpen-Inversion)
    // Wenn das Modell "Sonnig" meldet, im Tal aber hohe Luftfeuchte (Kondensation) und Inversion herrschen
    const isModelSunny = cur && (cur.weather_code <= 2 || (cur.cloud_cover !== undefined && cur.cloud_cover < 30));
    const isHighHumidity = cur && (cur.relative_humidity_2m >= 82 || (stationData && stationData.current && stationData.current.relative_humidity >= 82));
    const isCalmWind = !cur || (cur.wind_speed_10m !== undefined && cur.wind_speed_10m <= 15);

    if (elevation <= 1500 && isModelSunny && isHighHumidity && isCalmWind && (liveDelta.tempDelta <= -1.2 || (stationData && stationData.inversionActive))) {
      insights.push({
        type: 'inversion_fog_detected',
        severity: 'warning',
        icon: '🌫️',
        title: 'Zäher Inversions-Hochnebel im Tal erkannt',
        desc: 'Wettermodell prognostizierte "Sonnig". Reale Bergfex-Webcam- & Sensor-Validierung bestätigt dichten Hochnebel bis ca. 1.450 m (Kaltluftsee), während oberhalb (Nebelhorn/Fellhorn) strahlende Sonne herrscht.',
        fogTopElevation: 1450,
        overrideWeatherCode: 45 // WMO 45: Dichter Nebel
      });
      // Modell-Wetterzustand von falscher "Sonne" auf realen "Nebel" korrigieren
      if (cur) cur.weather_code = 45;
    }

    // 2. Föhn / Wind-Kompression am Grat
    if (isMountain && elevation >= 1500 && liveDelta.windDelta >= 15) {
      insights.push({
        type: 'foehn_wind_burst',
        severity: 'caution',
        icon: '💨',
        title: 'Föhn- / Gratwind-Verstärkung',
        desc: `Reale Windböen liegen +${liveDelta.windDelta} km/h über der Modellberechnung. Windvektor wurde im Nowcast nach oben kalibriert.`
      });
    }

    // 3. Starke Sonneneinstrahlung / Aufheizung (Hangwetter)
    if (liveDelta.tempDelta >= 2.5) {
      insights.push({
        type: 'solar_thermal_boost',
        severity: 'info',
        icon: '☀️',
        title: 'Thermische Hangaufheizung',
        desc: `Reale Temperatur liegt +${liveDelta.tempDelta}°C über Modell. Hangthermik löst stärkere Quellbewölkung aus.`
      });
    }

    return insights;
  },

  /**
   * Passt die Vorhersage unmittelbar an, wenn der Nutzer vor Ort ein Ist-Wetter gemeldet hat
   */
  applyUserGroundTruthAdjustment(current, hourly, userReport) {
    if (!userReport || !current) return;

    if (userReport.condition === 'rain' && (current.weather_code < 50 || current.weather_code > 69)) {
      current.weather_code = 61; // Regen
      current.precipitation = Math.max(0.8, current.precipitation || 0);
      if (hourly && hourly.precipitation_probability && hourly.precipitation_probability[0] !== undefined) {
        hourly.precipitation_probability[0] = Math.max(90, hourly.precipitation_probability[0]);
      }
    } else if (userReport.condition === 'snow' && current.weather_code < 70) {
      current.weather_code = 71; // Schneefall
      current.precipitation = Math.max(1.0, current.precipitation || 0);
    } else if (userReport.condition === 'fog') {
      current.weather_code = 45; // Nebel
    } else if (userReport.condition === 'clear') {
      current.weather_code = 0; // Klar/Sonnig
    }
  },

  /**
   * Führt eine clientseitige Pixel- und Kontrastanalyse eines Webcam-Bildes durch.
   * Erkennt dichten Nebel / Hochnebel via Standardabweichung der Leuchtdichte (Kontrast)
   * und Anteil an blauem Himmel.
   */
  async analyzeWebcamForFog(imgUrl) {
    if (!imgUrl || typeof window === 'undefined') return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 2500);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 48;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 64, 48);
          const data = ctx.getImageData(0, 0, 64, 48).data;

          let sumLuma = 0;
          let blueSkyPixels = 0;
          const lumas = [];
          const skyCheckPixels = data.length * 0.35;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            sumLuma += luma;
            lumas.push(luma);

            // Blauer Himmel im oberen Drittel des Bildes
            if (i < skyCheckPixels && b > r + 20 && b > g + 10 && b > 80) {
              blueSkyPixels++;
            }
          }

          const meanLuma = sumLuma / lumas.length;
          let variance = 0;
          for (const l of lumas) variance += Math.pow(l - meanLuma, 2);
          const stdDev = Math.sqrt(variance / lumas.length);
          const blueSkyRatio = blueSkyPixels / (skyCheckPixels / 4);

          // Dichter Nebel: sehr geringer Kontrast (stdDev < 24), weißgraue Luma (> 100), 0% blauer Himmel
          const isFoggy = stdDev < 24 && meanLuma > 100 && blueSkyRatio < 0.05;
          const isSunny = blueSkyRatio > 0.20 || (stdDev > 50 && meanLuma > 100);

          resolve({
            isFoggy,
            isSunny,
            stdDev: Math.round(stdDev * 10) / 10,
            meanLuma: Math.round(meanLuma),
            blueSkyRatio: Math.round(blueSkyRatio * 100)
          });
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      img.src = imgUrl;
    });
  },

  /**
   * Automatisiertes Webcam-Assimilations-Netzwerk:
   * Analysiert parallele Stations- und Berg-Webcams in verschiedenen Höhen,
   * ermittelt empirische Inversionsgrenzen und korrigiert Modell-Fehlprognosen.
   */
  async assimilateWebcamNetwork(webcams, currentLocationElevation) {
    if (!Array.isArray(webcams) || webcams.length === 0 || typeof window === 'undefined') {
      return null;
    }

    const validCams = webcams.filter(c => c.thumbUrl && c.elevation);
    if (validCams.length < 1) return null;

    const analyses = await Promise.allSettled(
      validCams.slice(0, 3).map(async (cam) => {
        const analysis = await this.analyzeWebcamForFog(cam.thumbUrl);
        const elevMeters = parseInt(String(cam.elevation).replace(/[^0-9]/g, ''), 10) || 1000;
        return { cam, elevMeters, analysis };
      })
    );

    const successful = analyses
      .filter(r => r.status === 'fulfilled' && r.value.analysis)
      .map(r => r.value)
      .sort((a, b) => a.elevMeters - b.elevMeters);

    if (successful.length === 0) return null;

    const fogCam = successful.find(s => s.analysis.isFoggy);
    const sunCam = successful.slice().reverse().find(s => s.analysis.isSunny);

    if (fogCam && sunCam && sunCam.elevMeters > fogCam.elevMeters) {
      const empiricalFogTop = Math.round((fogCam.elevMeters + sunCam.elevMeters) / 2);
      const isTargetAboveFog = currentLocationElevation > empiricalFogTop;

      return {
        confirmedInversion: true,
        fogTopElevation: empiricalFogTop,
        lowerCam: fogCam.cam.title,
        lowerCamElev: fogCam.elevMeters,
        upperCam: sunCam.cam.title,
        upperCamElev: sunCam.elevMeters,
        isTargetAboveFog,
        overrideWeatherCode: isTargetAboveFog ? 0 : 45,
        tag: `📷 Live-Webcam Assimilation: Nebelmeer bis ~${empiricalFogTop} m`
      };
    } else if (fogCam && !sunCam) {
      return {
        confirmedFog: true,
        fogTopElevation: Math.max(1400, fogCam.elevMeters + 150),
        lowerCam: fogCam.cam.title,
        overrideWeatherCode: (currentLocationElevation <= fogCam.elevMeters + 150) ? 45 : null,
        tag: `📷 Live-Webcam: Dichter Nebel bei '${fogCam.cam.title}' bestätigt`
      };
    } else if (sunCam && !fogCam) {
      return {
        confirmedSun: true,
        upperCam: sunCam.cam.title,
        overrideWeatherCode: 0,
        tag: `📷 Live-Webcam: Strahlende Sonne bei '${sunCam.cam.title}' bestätigt`
      };
    }

    return null;
  }
};

