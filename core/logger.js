/**
 * BEST WEATHER — Structured Logger
 * Centralized logging with levels. Easy to extend later with remote logging.
 */

const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;

export const logger = {
  info: (...args) => {
    if (isDev) console.info('[BestWeather]', ...args);
  },
  warn: (...args) => {
    console.warn('[BestWeather]', ...args);
  },
  error: (...args) => {
    console.error('[BestWeather]', ...args);
  },
  debug: (...args) => {
    if (isDev) console.debug('[BestWeather]', ...args);
  }
};
