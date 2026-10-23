/**
 * BEST WEATHER — Central Action Dispatcher & Event Bus (Task 8b)
 * Enables decoupled, unidirectional event flow between modules.
 */

class ActionDispatcher {
  constructor() {
    this.handlers = new Map();
  }

  /**
   * Subscribe to an action or event name
   * @param {string} action - Action identifier (e.g. 'LOCATION_LOADED', 'WEATHER_UPDATED')
   * @param {Function} callback - Handler function
   * @returns {Function} Unsubscribe function
   */
  on(action, callback) {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, new Set());
    }
    this.handlers.get(action).add(callback);
    return () => this.off(action, callback);
  }

  /**
   * Unsubscribe a handler
   */
  off(action, callback) {
    if (this.handlers.has(action)) {
      this.handlers.get(action).delete(callback);
    }
  }

  /**
   * Dispatch an action with a payload to all registered handlers
   */
  dispatch(action, payload) {
    if (this.handlers.has(action)) {
      for (const callback of this.handlers.get(action)) {
        try {
          callback(payload);
        } catch (err) {
          console.error(`[Dispatcher] Error in handler for action "${action}":`, err);
        }
      }
    }
  }
}

export const dispatcher = new ActionDispatcher();

// Standard Action Constants
export const ACTIONS = {
  LOCATION_SELECT: 'LOCATION_SELECT',
  LOCATION_LOADED: 'LOCATION_LOADED',
  WEATHER_UPDATED: 'WEATHER_UPDATED',
  TAB_SWITCH: 'TAB_SWITCH',
  UNIT_TOGGLE: 'UNIT_TOGGLE',
  METEOGRAM_METRIC_CHANGE: 'METEOGRAM_METRIC_CHANGE',
  ASPECT_CHANGED: 'ASPECT_CHANGED',
  ALTITUDE_HOUR_CHANGED: 'ALTITUDE_HOUR_CHANGED',
  SPORTS_GPX_LOADED: 'SPORTS_GPX_LOADED',
  SPORTS_TIMELINE_UPDATED: 'SPORTS_TIMELINE_UPDATED',
  FAVORITES_UPDATED: 'FAVORITES_UPDATED',
  HAZARD_ALERT_TRIGGERED: 'HAZARD_ALERT_TRIGGERED'
};
