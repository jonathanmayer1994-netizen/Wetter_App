/**
 * BEST WEATHER — TypeScript Type Definitions
 * Meteorological, Alpine Downscaling and Route Weather Data Models.
 */

export interface LocationConfig {
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  country?: string;
  isMountain: boolean;
}

export interface MicroTerrain {
  elevation: number;
  tilt: number;
  openMeteoAzimuth: number;
  compassAzimuth: number;
  tpi: number;
  gridResolutionMeters: number;
  landform: string;
  aspectName: string;
}

export interface AltitudeLevel {
  label: string;
  icon: string;
  z: number;
  temp: number;
  felt: number;
  wind: number;
  gusts: number;
  precipType: 'Trocken' | 'Regen' | 'Schnee';
  precipMm: number;
  condition: string;
  conditionIcon: string;
  isSnow: boolean;
}

export interface GPXPoint {
  index: number;
  lat: number;
  lon: number;
  ele: number;
  distFromStartKm: number;
}

export interface GPXTrack {
  success: boolean;
  name: string;
  pointCount: number;
  totalDistanceKm: number;
  totalAscentM: number;
  totalDescentM: number;
  minElevationM: number;
  maxElevationM: number;
  points: GPXPoint[];
}

export interface TimelineMilestone {
  index: number;
  label: string;
  lat: number;
  lon: number;
  ele: number;
  distFromStartKm: number;
  arrivalMs: number;
  arrivalTimeStr: string;
  arrivalDateStr: string;
  tempC: number;
  weatherCondition: string;
  weatherIcon: string;
  windKmH: number;
  gustsKmH: number;
  precipMm: number;
  pop: number;
  isSnow: boolean;
  hazards: string[];
}

export interface RouteHazards {
  level: 'green' | 'yellow' | 'red';
  advice: string;
  alerts: Array<{
    type: 'storm' | 'gust' | 'cold' | 'precip';
    title: string;
    text: string;
    kmFrom: number;
    kmTo: number;
  }>;
}

export interface RouteTimeline {
  sportType: string;
  fitnessLevel: string;
  totalDistanceKm: number;
  totalAscentM: number;
  totalDescentM: number;
  totalDurationHours: number;
  totalDurationStr: string;
  startTimeMs: number;
  startTimeStr: string;
  endTimeMs: number;
  endTimeStr: string;
  maxElevationM: number;
  minElevationM: number;
  milestones: TimelineMilestone[];
  hazards: RouteHazards;
}
