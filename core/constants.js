/**
 * BEST WEATHER — Core Constants & Tables
 */

export const OFFICIAL_KNOWN_ELEVATIONS = {
  // Hochalpine Berggipfel
  'matterhorn': { elevation: 4478, isMountain: true, country: 'Schweiz' },
  'zugspitze': { elevation: 2962, isMountain: true, country: 'Deutschland' },
  'mont blanc': { elevation: 4808, isMountain: true, country: 'Frankreich' },
  'großglockner': { elevation: 3798, isMountain: true, country: 'Österreich' },
  'grossglockner': { elevation: 3798, isMountain: true, country: 'Österreich' },
  'ortler': { elevation: 3905, isMountain: true, country: 'Italien' },
  'wildspitze': { elevation: 3768, isMountain: true, country: 'Österreich' },
  'watzmann': { elevation: 2713, isMountain: true, country: 'Deutschland' },
  'feldberg': { elevation: 1493, isMountain: true, country: 'Deutschland' },
  'brocken': { elevation: 1141, isMountain: true, country: 'Deutschland' },
  'nebelhorn': { elevation: 2224, isMountain: true, country: 'Deutschland' },

  // Städte & Flachland
  'münchen': { elevation: 520, isMountain: false, country: 'Deutschland' },
  'munich': { elevation: 520, isMountain: false, country: 'Deutschland' },
  'berlin': { elevation: 34, isMountain: false, country: 'Deutschland' },
  'hamburg': { elevation: 6, isMountain: false, country: 'Deutschland' },
  'köln': { elevation: 53, isMountain: false, country: 'Deutschland' },
  'frankfurt am main': { elevation: 112, isMountain: false, country: 'Deutschland' },
  'frankfurt': { elevation: 112, isMountain: false, country: 'Deutschland' },
  'stuttgart': { elevation: 247, isMountain: false, country: 'Deutschland' },
  'düsseldorf': { elevation: 38, isMountain: false, country: 'Deutschland' },
  'leipzig': { elevation: 113, isMountain: false, country: 'Deutschland' },
  'dresden': { elevation: 113, isMountain: false, country: 'Deutschland' },
  'nürnberg': { elevation: 309, isMountain: false, country: 'Deutschland' },
  'wien': { elevation: 171, isMountain: false, country: 'Österreich' },
  'vienna': { elevation: 171, isMountain: false, country: 'Österreich' },
  'salzburg': { elevation: 424, isMountain: false, country: 'Österreich' },
  'innsbruck': { elevation: 574, isMountain: false, country: 'Österreich' },
  'graz': { elevation: 353, isMountain: false, country: 'Österreich' },
  'linz': { elevation: 266, isMountain: false, country: 'Österreich' },
  'klagenfurt': { elevation: 446, isMountain: false, country: 'Österreich' },
  'zürich': { elevation: 408, isMountain: false, country: 'Schweiz' },
  'zurich': { elevation: 408, isMountain: false, country: 'Schweiz' },
  'genf': { elevation: 375, isMountain: false, country: 'Schweiz' },
  'geneva': { elevation: 375, isMountain: false, country: 'Schweiz' },
  'bern': { elevation: 542, isMountain: false, country: 'Schweiz' },
  'basel': { elevation: 260, isMountain: false, country: 'Schweiz' },
  'luzern': { elevation: 436, isMountain: false, country: 'Schweiz' },
  'bozen': { elevation: 262, isMountain: false, country: 'Italien' },
  'meran': { elevation: 325, isMountain: false, country: 'Italien' },
  'trient': { elevation: 194, isMountain: false, country: 'Italien' },
  'brixen': { elevation: 560, isMountain: false, country: 'Italien' },
  'garmisch-partenkirchen': { elevation: 708, isMountain: false, country: 'Deutschland' },
  'zermatt': { elevation: 1608, isMountain: false, country: 'Schweiz' },
  'oberstdorf': { elevation: 813, isMountain: false, country: 'Deutschland' },
  'chamonix': { elevation: 1035, isMountain: false, country: 'Frankreich' }
};

export const WMO_CODES = {
  0: { label: 'Klar / Wolkenlos', icon: '☀️', iconNight: '🌙', theme: 'clear-day', themeNight: 'clear-night' },
  1: { label: 'Überwiegend klar', icon: '🌤️', iconNight: '🌤️', theme: 'clear-day', themeNight: 'clear-night' },
  2: { label: 'Teilweise bewölkt', icon: '⛅', iconNight: '☁️', theme: 'cloudy', themeNight: 'cloudy' },
  3: { label: 'Bedeckt', icon: '☁️', iconNight: '☁️', theme: 'cloudy', themeNight: 'cloudy' },
  45: { label: 'Nebel', icon: '🌫️', iconNight: '🌫️', theme: 'fog', themeNight: 'fog' },
  48: { label: 'Raureifnebel', icon: '🌫️', iconNight: '🌫️', theme: 'fog', themeNight: 'fog' },
  51: { label: 'Leichter Nieselregen', icon: '🌦️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  53: { label: 'Mäßiger Nieselregen', icon: '🌦️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  55: { label: 'Dichter Nieselregen', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  56: { label: 'Gefrierender Nieselregen', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  57: { label: 'Starker gefrierender Niesel', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  61: { label: 'Leichter Regen', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  63: { label: 'Mäßiger Regen', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  65: { label: 'Kräftiger Regen', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  66: { label: 'Gefrierender Regen', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  67: { label: 'Starker gefrierender Regen', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  71: { label: 'Leichter Schneefall', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  73: { label: 'Mäßiger Schneefall', icon: '❄️', iconNight: '❄️', theme: 'snow', themeNight: 'snow' },
  75: { label: 'Starker Schneefall', icon: '❄️', iconNight: '❄️', theme: 'snow', themeNight: 'snow' },
  77: { label: 'Schneegriesel', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  80: { label: 'Leichte Regenschauer', icon: '🌦️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  81: { label: 'Mäßige Regenschauer', icon: '🌧️', iconNight: '🌧️', theme: 'rain', themeNight: 'rain' },
  82: { label: 'Heftige Regenschauer', icon: '⛈️', iconNight: '⛈️', theme: 'rain', themeNight: 'rain' },
  85: { label: 'Leichte Schneeschauer', icon: '🌨️', iconNight: '🌨️', theme: 'snow', themeNight: 'snow' },
  86: { label: 'Starke Schneeschauer', icon: '❄️', iconNight: '❄️', theme: 'snow', themeNight: 'snow' },
  95: { label: 'Gewitter', icon: '⛈️', iconNight: '⛈️', theme: 'thunder', themeNight: 'thunder' },
  96: { label: 'Gewitter mit Hagel', icon: '⛈️', iconNight: '⛈️', theme: 'thunder', themeNight: 'thunder' },
  99: { label: 'Schweres Hagelgewitter', icon: '⛈️', iconNight: '⛈️', theme: 'thunder', themeNight: 'thunder' }
};

export const REGIONAL_STATIONS = [
  { name: 'München', lat: 48.137, lon: 11.581, elevation: 520, isMountain: false },
  { name: 'Zugspitze', lat: 47.421, lon: 10.985, elevation: 2962, isMountain: true },
  { name: 'Garmisch-Partenk.', lat: 47.491, lon: 11.095, elevation: 708, isMountain: false },
  { name: 'Innsbruck', lat: 47.269, lon: 11.404, elevation: 574, isMountain: false },
  { name: 'Kitzbühel', lat: 47.446, lon: 12.392, elevation: 762, isMountain: false },
  { name: 'Großglockner', lat: 47.074, lon: 12.694, elevation: 3798, isMountain: true },
  { name: 'Salzburg', lat: 47.809, lon: 13.055, elevation: 424, isMountain: false },
  { name: 'Nebelhorn', lat: 47.421, lon: 10.345, elevation: 2224, isMountain: true },
  { name: 'Oberstdorf', lat: 47.408, lon: 10.279, elevation: 813, isMountain: false },
  { name: 'Matterhorn', lat: 45.976, lon: 7.749, elevation: 4478, isMountain: true },
  { name: 'Zermatt', lat: 46.020, lon: 7.749, elevation: 1620, isMountain: false },
  { name: 'Mont Blanc', lat: 45.832, lon: 6.865, elevation: 4808, isMountain: true },
  { name: 'Feldberg', lat: 47.874, lon: 8.004, elevation: 1493, isMountain: true },
  { name: 'Zürich', lat: 47.376, lon: 8.541, elevation: 408, isMountain: false },
  { name: 'St. Moritz', lat: 46.498, lon: 9.839, elevation: 1822, isMountain: true },
  { name: 'Bozen', lat: 46.498, lon: 11.354, elevation: 262, isMountain: false },
  { name: 'Watzmann', lat: 47.554, lon: 12.921, elevation: 2713, isMountain: true },
  { name: 'Stuttgart', lat: 48.775, lon: 9.182, elevation: 245, isMountain: false },
  { name: 'Nürnberg', lat: 49.452, lon: 11.076, elevation: 309, isMountain: false },
  { name: 'Frankfurt', lat: 50.110, lon: 8.682, elevation: 112, isMountain: false },
  { name: 'Wien', lat: 48.208, lon: 16.373, elevation: 171, isMountain: false }
];

export const BASE_LAYERS = {
  'osm-standard': {
    name: 'Standard (OSM)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    fallbackUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxNativeZoom: 19,
      maxZoom: 20,
      subdomains: ['a', 'b', 'c'],
      attribution: '© OpenStreetMap-Mitwirkende'
    },
    isDark: false
  },
  'osm-outdoor': {
    name: 'Topo (OSM Alpinrelief)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    fallbackUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    options: {
      subdomains: ['a', 'b', 'c'],
      maxNativeZoom: 17,
      maxZoom: 20,
      attribution: '© OpenStreetMap, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA)'
    },
    isDark: false
  },
  'osm-dark': {
    name: 'Dunkel (High Contrast)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxNativeZoom: 16,
      maxZoom: 20,
      attribution: '© Esri, HERE, Garmin, © OpenStreetMap'
    },
    labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    isDark: false
  },
  'satellite': {
    name: 'Satellit (HD Luftbild)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    fallbackUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxNativeZoom: 18,
      maxZoom: 20,
      attribution: '© Esri World Imagery, © OpenStreetMap'
    },
    labelsUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    isDark: false
  }
};

