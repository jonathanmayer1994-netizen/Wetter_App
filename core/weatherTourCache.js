/**
 * BEST WEATHER — Offline Storage & Cache Layer for Locations, Telemetry, and Tours
 */

import { AlpineStorage } from '../storage.js';

export const WeatherTourCache = {
  LOCATION_KEY: 'alpine_offline_last_location',
  WEATHER_KEY: 'alpine_offline_weather_data',
  SPORTS_TOUR_KEY: 'alpine_offline_sports_tour',

  async saveLocationAndWeather(loc, weatherData, microData) {
    if (!loc) return;
    AlpineStorage.safeSetItem(this.LOCATION_KEY, loc);
    if (weatherData) {
      await AlpineStorage.saveWeatherCache(loc, weatherData, microData);
    }
  },

  getCachedLocation() {
    return AlpineStorage.safeGetItem(this.LOCATION_KEY, null);
  },

  async getCachedWeather() {
    return await AlpineStorage.getCachedWeather();
  },

  async saveTour(tourName, gpxXml, parsedGPX, timeline, stats) {
    const payload = {
      id: 'current_tour',
      timestamp: Date.now(),
      tourName,
      gpxXml,
      parsedGPX,
      timeline,
      stats
    };
    await AlpineStorage.queueSaveTour(payload, 600);
  },

  async getCachedTour() {
    return await AlpineStorage.getTour('current_tour');
  }
};
