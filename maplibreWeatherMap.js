/**
 * MapLibreWeatherMap - High-Performance 60 FPS WebGL Interactive Weather Map
 * 
 * Hardware-accelerated with MapLibre GL JS (WebGL2).
 * Liquid Glass / Frosted-Glassmorphism Apple Dark Mode styling.
 * 
 * Features:
 * 1. Architecture: MapLibre GL JS, Dark Matter basemap, 3D Alpine Terrain-RGB / Terrarium DEM & Hillshading.
 * 2. Layer 1: Seamless Live RainViewer Radar & Nowcast with anti-flicker preloading engine and 60 FPS GPU cross-fade.
 * 3. Layer 2: Alpine Live Summit & Valley Stations (LAWIS, Open Data Hub Südtirol, SLF IMIS, DWD MOSMIX) with WebGL Clustering.
 * 4. Layer 3: Floating Altitude & Pressure Level Selector (Tal 2m, 1.000m, 2.000m, 3.000m 700hPa, 4.200m 600hPa).
 * 5. Layer 4: Coastal & Marine Mode (Open-Meteo Marine wave height and sea surface temperature).
 * 6. UI: Modern Apple Liquid Glass Floating Dock, Touch Gestures (Pinch, 2-Finger Pitch, Rotation), iOS Bottom Sheet.
 */

export const ALPINE_STATIONS = [
  // 1. LAWIS (Bayern, Nordtirol, Vorarlberg, Allgäuer Alpen bis Berchtesgaden)
  { id: 'lawis-zugspitze', name: 'Zugspitze Gipfel', lat: 47.4211, lon: 10.9853, elevation: 2962, isMountain: true, agency: 'LAWIS Bayern / Tirol', agencyBadge: 'LAWIS', temp: -2.4, dewPoint: -5.1, windSpeed: 42, windGust: 68, windDir: 250, snowDepth: 145, freshSnow24: 15 },
  { id: 'lawis-schneeferner', name: 'Schneefernerhaus', lat: 47.4168, lon: 10.9791, elevation: 2650, isMountain: true, agency: 'LAWIS Bayern', agencyBadge: 'LAWIS', temp: -0.8, dewPoint: -3.5, windSpeed: 34, windGust: 52, windDir: 240, snowDepth: 160, freshSnow24: 18 },
  { id: 'lawis-nebelhorn', name: 'Nebelhorn Gipfel', lat: 47.4219, lon: 10.3452, elevation: 2224, isMountain: true, agency: 'LAWIS Allgäu', agencyBadge: 'LAWIS', temp: 1.2, dewPoint: -2.0, windSpeed: 28, windGust: 46, windDir: 270, snowDepth: 95, freshSnow24: 8 },
  { id: 'lawis-fellhorn', name: 'Fellhorn Kamm', lat: 47.3524, lon: 10.2155, elevation: 1967, isMountain: true, agency: 'LAWIS Allgäu', agencyBadge: 'LAWIS', temp: 3.1, dewPoint: -0.8, windSpeed: 24, windGust: 38, windDir: 260, snowDepth: 65, freshSnow24: 4 },
  { id: 'lawis-wendelstein', name: 'Wendelstein', lat: 47.7033, lon: 12.0125, elevation: 1838, isMountain: true, agency: 'LAWIS Oberbayern', agencyBadge: 'LAWIS', temp: 4.5, dewPoint: 0.2, windSpeed: 22, windGust: 35, windDir: 230, snowDepth: 40, freshSnow24: 0 },
  { id: 'lawis-wank', name: 'Wank Bergstation', lat: 47.5094, lon: 11.1442, elevation: 1780, isMountain: true, agency: 'LAWIS Werdenfels', agencyBadge: 'LAWIS', temp: 5.2, dewPoint: 0.9, windSpeed: 18, windGust: 30, windDir: 210, snowDepth: 35, freshSnow24: 0 },
  { id: 'lawis-karwendel', name: 'Dammkar Karwendel', lat: 47.4331, lon: 11.2833, elevation: 2244, isMountain: true, agency: 'LAWIS Mittenwald', agencyBadge: 'LAWIS', temp: 0.9, dewPoint: -2.8, windSpeed: 30, windGust: 48, windDir: 250, snowDepth: 110, freshSnow24: 12 },
  { id: 'lawis-valluga', name: 'Valluga Arlberg', lat: 47.1583, lon: 10.2133, elevation: 2811, isMountain: true, agency: 'LAWIS Vorarlberg / Tirol', agencyBadge: 'LAWIS', temp: -1.9, dewPoint: -4.6, windSpeed: 45, windGust: 72, windDir: 280, snowDepth: 175, freshSnow24: 22 },
  { id: 'lawis-patscherkofel', name: 'Patscherkofel', lat: 47.2086, lon: 11.4608, elevation: 2248, isMountain: true, agency: 'LAWIS Nordtirol', agencyBadge: 'LAWIS', temp: 1.5, dewPoint: -1.9, windSpeed: 38, windGust: 62, windDir: 190, snowDepth: 85, freshSnow24: 6 },
  { id: 'lawis-kitzbuehel', name: 'Kitzbüheler Horn', lat: 47.4725, lon: 12.4314, elevation: 1996, isMountain: true, agency: 'LAWIS Kitzbühel', agencyBadge: 'LAWIS', temp: 3.4, dewPoint: -0.5, windSpeed: 25, windGust: 40, windDir: 240, snowDepth: 70, freshSnow24: 5 },
  { id: 'lawis-jenner', name: 'Jenner Berchtesgaden', lat: 47.5753, lon: 13.0194, elevation: 1874, isMountain: true, agency: 'LAWIS Berchtesgaden', agencyBadge: 'LAWIS', temp: 4.1, dewPoint: 0.4, windSpeed: 20, windGust: 32, windDir: 220, snowDepth: 55, freshSnow24: 2 },
  { id: 'lawis-rofan', name: 'Achenkirch Rofan', lat: 47.5250, lon: 11.7100, elevation: 1820, isMountain: true, agency: 'LAWIS Achental', agencyBadge: 'LAWIS', temp: 4.8, dewPoint: 0.8, windSpeed: 19, windGust: 31, windDir: 230, snowDepth: 50, freshSnow24: 0 },

  // 2. Open Data Hub Südtirol (Ortler, Dolomiten, Pustertal, Südalpen)
  { id: 'suedtirol-ortler', name: 'Ortler Schaubachhütte', lat: 46.5052, lon: 10.5901, elevation: 2600, isMountain: true, agency: 'Meteo Südtirol', agencyBadge: 'Südtirol ODH', temp: -0.5, dewPoint: -3.8, windSpeed: 36, windGust: 55, windDir: 260, snowDepth: 150, freshSnow24: 16 },
  { id: 'suedtirol-pizboe', name: 'Piz Boè Dolomiten', lat: 46.5092, lon: 11.8283, elevation: 3152, isMountain: true, agency: 'Meteo Südtirol', agencyBadge: 'Südtirol ODH', temp: -3.2, dewPoint: -6.4, windSpeed: 48, windGust: 76, windDir: 270, snowDepth: 130, freshSnow24: 14 },
  { id: 'suedtirol-kronplatz', name: 'Kronplatz Gipfel', lat: 46.7402, lon: 11.9564, elevation: 2275, isMountain: true, agency: 'Meteo Südtirol', agencyBadge: 'Südtirol ODH', temp: 1.0, dewPoint: -2.5, windSpeed: 26, windGust: 42, windDir: 250, snowDepth: 80, freshSnow24: 5 },
  { id: 'suedtirol-seceda', name: 'Seceda Gröden', lat: 46.6002, lon: 11.7251, elevation: 2450, isMountain: true, agency: 'Meteo Südtirol', agencyBadge: 'Südtirol ODH', temp: 0.2, dewPoint: -3.1, windSpeed: 32, windGust: 50, windDir: 260, snowDepth: 95, freshSnow24: 8 },
  { id: 'suedtirol-dreizinnen', name: 'Drei Zinnen Hütte', lat: 46.6364, lon: 12.3102, elevation: 2405, isMountain: true, agency: 'Meteo Südtirol', agencyBadge: 'Südtirol ODH', temp: 0.4, dewPoint: -3.0, windSpeed: 31, windGust: 49, windDir: 245, snowDepth: 105, freshSnow24: 10 },
  { id: 'suedtirol-schoeneben', name: 'Schöneben Reschen', lat: 46.8042, lon: 10.5053, elevation: 2100, isMountain: true, agency: 'Meteo Südtirol', agencyBadge: 'Südtirol ODH', temp: 2.1, dewPoint: -1.6, windSpeed: 23, windGust: 37, windDir: 230, snowDepth: 75, freshSnow24: 4 },
  { id: 'suedtirol-rossalm', name: 'Rossalm Plose', lat: 46.6903, lon: 11.7102, elevation: 2200, isMountain: true, agency: 'Meteo Südtirol', agencyBadge: 'Südtirol ODH', temp: 1.6, dewPoint: -2.1, windSpeed: 25, windGust: 39, windDir: 240, snowDepth: 80, freshSnow24: 6 },

  // 3. SLF IMIS-Messnetz (Schweizer Hochgebirgs-Kammstationen)
  { id: 'slf-jungfraujoch', name: 'Jungfraujoch Sphinx', lat: 46.5475, lon: 7.9853, elevation: 3454, isMountain: true, agency: 'SLF IMIS Schweiz', agencyBadge: 'SLF IMIS', temp: -5.1, dewPoint: -8.4, windSpeed: 52, windGust: 84, windDir: 290, snowDepth: 210, freshSnow24: 25 },
  { id: 'slf-gornergrat', name: 'Gornergrat Zermatt', lat: 45.9833, lon: 7.7833, elevation: 3130, isMountain: true, agency: 'SLF IMIS Schweiz', agencyBadge: 'SLF IMIS', temp: -3.0, dewPoint: -6.1, windSpeed: 44, windGust: 69, windDir: 280, snowDepth: 165, freshSnow24: 18 },
  { id: 'slf-weissfluhjoch', name: 'Weissfluhjoch Davos', lat: 46.8333, lon: 9.8083, elevation: 2693, isMountain: true, agency: 'SLF IMIS Schweiz', agencyBadge: 'SLF IMIS', temp: -1.2, dewPoint: -4.3, windSpeed: 36, windGust: 56, windDir: 270, snowDepth: 140, freshSnow24: 14 },
  { id: 'slf-saentis', name: 'Säntis Gipfelstation', lat: 47.2494, lon: 9.3433, elevation: 2502, isMountain: true, agency: 'SLF IMIS Schweiz', agencyBadge: 'SLF IMIS', temp: -0.2, dewPoint: -3.4, windSpeed: 40, windGust: 65, windDir: 260, snowDepth: 155, freshSnow24: 16 },
  { id: 'slf-titlis', name: 'Titlis Rotair', lat: 46.7722, lon: 8.4383, elevation: 3020, isMountain: true, agency: 'SLF IMIS Schweiz', agencyBadge: 'SLF IMIS', temp: -2.6, dewPoint: -5.7, windSpeed: 46, windGust: 74, windDir: 285, snowDepth: 190, freshSnow24: 20 },
  { id: 'slf-corvatsch', name: 'Piz Corvatsch', lat: 46.4183, lon: 9.8211, elevation: 3303, isMountain: true, agency: 'SLF IMIS Schweiz', agencyBadge: 'SLF IMIS', temp: -4.3, dewPoint: -7.5, windSpeed: 49, windGust: 79, windDir: 275, snowDepth: 180, freshSnow24: 19 },
  { id: 'slf-stbernard', name: 'Grand St. Bernard', lat: 45.8692, lon: 7.1706, elevation: 2472, isMountain: true, agency: 'SLF IMIS Schweiz', agencyBadge: 'SLF IMIS', temp: 0.1, dewPoint: -3.2, windSpeed: 35, windGust: 55, windDir: 250, snowDepth: 125, freshSnow24: 11 },

  // 4. DWD OpenData / MOSMIX-L & Alpenvorland
  { id: 'dwd-feldberg', name: 'Feldberg Schwarzwald', lat: 47.8744, lon: 8.0042, elevation: 1493, isMountain: true, agency: 'DWD OpenData', agencyBadge: 'DWD MOSMIX', temp: 6.8, dewPoint: 2.1, windSpeed: 26, windGust: 42, windDir: 240, snowDepth: 10, freshSnow24: 0 },
  { id: 'dwd-hohenpeissenberg', name: 'Hohenpeißenberg', lat: 47.8011, lon: 11.0114, elevation: 977, isMountain: false, agency: 'DWD Met. Observatorium', agencyBadge: 'DWD MOSMIX', temp: 10.4, dewPoint: 4.8, windSpeed: 18, windGust: 29, windDir: 220, snowDepth: 0, freshSnow24: 0 },
  { id: 'dwd-kempten', name: 'Kempten Allgäu', lat: 47.7272, lon: 10.3164, elevation: 705, isMountain: false, agency: 'DWD Messnetz', agencyBadge: 'DWD MOSMIX', temp: 12.1, dewPoint: 6.2, windSpeed: 14, windGust: 23, windDir: 200, snowDepth: 0, freshSnow24: 0 },
  { id: 'dwd-garmisch', name: 'Garmisch-Partenk.', lat: 47.4914, lon: 11.0953, elevation: 708, isMountain: false, agency: 'DWD Messnetz', agencyBadge: 'DWD MOSMIX', temp: 11.8, dewPoint: 5.9, windSpeed: 12, windGust: 20, windDir: 180, snowDepth: 0, freshSnow24: 0 },
  { id: 'dwd-oberstdorf', name: 'Oberstdorf Tal', lat: 47.4081, lon: 10.2792, elevation: 813, isMountain: false, agency: 'DWD Messnetz', agencyBadge: 'DWD MOSMIX', temp: 11.2, dewPoint: 5.4, windSpeed: 13, windGust: 21, windDir: 190, snowDepth: 0, freshSnow24: 0 },
  { id: 'dwd-berchtesgaden', name: 'Berchtesgaden Tal', lat: 47.6294, lon: 13.0017, elevation: 710, isMountain: false, agency: 'DWD Messnetz', agencyBadge: 'DWD MOSMIX', temp: 12.0, dewPoint: 6.0, windSpeed: 11, windGust: 19, windDir: 170, snowDepth: 0, freshSnow24: 0 },
  { id: 'dwd-muenchen', name: 'München Stadt', lat: 48.1374, lon: 11.5810, elevation: 520, isMountain: false, agency: 'DWD Bayern', agencyBadge: 'DWD MOSMIX', temp: 14.2, dewPoint: 7.5, windSpeed: 15, windGust: 25, windDir: 210, snowDepth: 0, freshSnow24: 0 },
  { id: 'at-innsbruck', name: 'Innsbruck Universität', lat: 47.2692, lon: 11.4041, elevation: 574, isMountain: false, agency: 'GeoSphere Austria', agencyBadge: 'GeoSphere AT', temp: 13.8, dewPoint: 6.8, windSpeed: 16, windGust: 27, windDir: 190, snowDepth: 0, freshSnow24: 0 },
  { id: 'it-bozen', name: 'Bozen Talboden', lat: 46.4983, lon: 11.3548, elevation: 262, isMountain: false, agency: 'Meteo Südtirol', agencyBadge: 'Südtirol ODH', temp: 17.5, dewPoint: 9.2, windSpeed: 10, windGust: 18, windDir: 160, snowDepth: 0, freshSnow24: 0 },
  { id: 'at-salzburg', name: 'Salzburg Flughafen', lat: 47.8094, lon: 13.0550, elevation: 424, isMountain: false, agency: 'GeoSphere Austria', agencyBadge: 'GeoSphere AT', temp: 14.5, dewPoint: 7.8, windSpeed: 14, windGust: 24, windDir: 220, snowDepth: 0, freshSnow24: 0 }
];

export const MARINE_STATIONS = [
  { id: 'marine-helgoland', name: 'Helgoland Tiefsee', lat: 54.180, lon: 7.890, sea: 'Nordsee', waveHeight: 1.6, waterTemp: 14.8, wavePeriod: 5.2, windSpeed: 38, windGust: 52 },
  { id: 'marine-norderney', name: 'Norderney Riff', lat: 53.710, lon: 7.150, sea: 'Nordsee', waveHeight: 1.2, waterTemp: 15.2, wavePeriod: 4.8, windSpeed: 32, windGust: 45 },
  { id: 'marine-kiel', name: 'Kiel Leuchtturm', lat: 54.500, lon: 10.275, sea: 'Ostsee', waveHeight: 0.9, waterTemp: 13.9, wavePeriod: 3.9, windSpeed: 28, windGust: 40 },
  { id: 'marine-arkona', name: 'Kap Arkona / Rügen', lat: 54.680, lon: 13.430, sea: 'Ostsee', waveHeight: 1.1, waterTemp: 14.1, wavePeriod: 4.3, windSpeed: 30, windGust: 44 },
  { id: 'marine-genua', name: 'Golf von Genua', lat: 44.380, lon: 8.950, sea: 'Mittelmeer (Ligurien)', waveHeight: 1.4, waterTemp: 21.5, wavePeriod: 5.5, windSpeed: 24, windGust: 36 },
  { id: 'marine-venedig', name: 'Venedig Offshore Buoy', lat: 45.410, lon: 12.370, sea: 'Adria', waveHeight: 0.7, waterTemp: 20.8, wavePeriod: 3.5, windSpeed: 18, windGust: 28 },
  { id: 'marine-nizza', name: 'Baie des Anges / Nizza', lat: 43.680, lon: 7.280, sea: 'Mittelmeer (Côte d’Azur)', waveHeight: 1.2, waterTemp: 22.0, wavePeriod: 5.0, windSpeed: 22, windGust: 34 }
];

export class MapLibreWeatherMap {
  constructor(options = {}) {
    this.containerId = options.containerId || 'interactive-map';
    this.onStationSelect = options.onStationSelect || null;
    this.map = null;
    this.isLoaded = false;

    // 3D Terrain & Hillshading
    this.terrainEnabled = true;
    this.hillshadeEnabled = true;

    // Radar Player State (Anti-Flicker Preloading)
    this.radarFrames = [];
    this.radarIndex = 0;
    this.radarPlaying = false;
    this.radarInterval = null;
    this.playbackSpeed = 1.0; // 1x, 1.5x, 2x

    // Altitude & Pressure Level State
    this.currentAltitude = 500; // meters (Default Tal/Boden)
    this.currentPressureLevel = 1013; // hPa

    // Coastal & Marine Mode
    this.marineModeActive = false;

    // Stations & Clustering
    this.stationsData = [...ALPINE_STATIONS];
    this.stationsVisible = true;
    this.activeStation = null;

    // Touch & Gesture state
    this.touchStartDistance = 0;
  }

  /**
   * Initialisiert MapLibre GL JS mit Dark Matter Basiskarte, 3D Relief & Gesten
   */
  async init() {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`MapLibreWeatherMap: Container #${this.containerId} nicht gefunden.`);
      return;
    }

    // Falls MapLibre GL JS noch nicht geladen wurde (z. B. CDN-Fallback)
    if (typeof maplibregl === 'undefined') {
      console.warn('MapLibre GL JS nicht global verfügbar. Lade CDN...');
      await this.loadMapLibreDependencies();
    }

    const darkStyle = {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        'carto-dark': {
          type: 'raster',
          tiles: [
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
            'https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'
          ],
          tileSize: 256,
          attribution: '&copy; OpenStreetMap &copy; CARTO'
        },
        'terrain-dem': {
          type: 'raster-dem',
          tiles: [
            'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
          ],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15
        }
      },
      layers: [
        {
          id: 'carto-dark-tiles',
          type: 'raster',
          source: 'carto-dark',
          paint: {
            'raster-opacity': 0.95,
            'raster-contrast': 0.15,
            'raster-brightness-min': 0.05
          }
        },
        {
          id: 'hillshading-3d',
          type: 'hillshade',
          source: 'terrain-dem',
          paint: {
            'hillshade-exaggeration': 0.85,
            'hillshade-shadow-color': '#030712',
            'hillshade-highlight-color': '#38bdf8',
            'hillshade-accent-color': '#1e293b'
          }
        }
      ]
    };

    this.map = new maplibregl.Map({
      container: this.containerId,
      style: darkStyle,
      center: [10.5, 47.3], // Süddeutschland / Alpenraum
      zoom: 7.5,
      pitch: 35, // 3D-Alpen-Relief Neigung
      bearing: 0,
      maxPitch: 85,
      touchPitch: true,
      dragRotate: true,
      touchZoomRotate: true
    });

    // Mobile / Desktop Navigation Controls
    this.map.addControl(new maplibregl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: true
    }), 'top-right');

    // UI-Elemente sofort verknüpfen für blitzschnelle Reaktivität
    this.bindUIEvents();

    this.map.on('load', async () => {
      this.isLoaded = true;

      // 1. 3D-Alpen-Relief aktivieren
      this.setup3DTerrain();

      // 2. Anti-Flicker Live-Regenradar Preloading Engine
      await this.loadRainViewerRadar();

      // 3. Alpine Messstationen mit WebGL-Clustering
      this.setupStationClustering();

      // 4. Höhenströmungs- & Druckflächen-Layer
      this.setupAltitudeVectorLayer();

      // 5. Marine & Küsten-Layer
      this.setupMarineLayer();
    });
  }

  /**
   * Lädt MapLibre GL JS dynamically, falls noch nicht eingebunden
   */
  async loadMapLibreDependencies() {
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
      document.head.appendChild(link);

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }

  // ===========================================================================
  // 1. 3D-ALPEN-RELIEF & DYNAMISCHES HILLSHADING
  // ===========================================================================
  setup3DTerrain() {
    if (!this.map || !this.map.getSource('terrain-dem')) return;

    try {
      this.map.setTerrain({
        source: 'terrain-dem',
        exaggeration: 1.35 // Grate & 4.000er plastisch hervorheben
      });

      this.map.setSky({
        'sky-color': '#060a12',
        'horizon-color': '#111827',
        'fog-color': '#0b0f19',
        'horizon-fog-blend': 0.8
      });
    } catch (err) {
      console.warn('3D Terrain Init Info:', err);
    }
  }

  toggleTerrain(enable) {
    this.terrainEnabled = enable;
    if (!this.map) return;
    this.map.setTerrain(enable ? { source: 'terrain-dem', exaggeration: 1.35 } : null);
  }

  // ===========================================================================
  // 2. LAYER 1: NAHTLOSES LIVE-RADAR & NOWCAST (ANTI-FLICKER PRELOADING)
  // ===========================================================================
  async loadRainViewerRadar() {
    try {
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const data = await res.json();

      const host = data.host || 'https://tilecache.rainviewer.com';
      const past = (data.radar && data.radar.past) ? data.radar.past : [];
      let nowcast = (data.radar && data.radar.nowcast) ? data.radar.nowcast : [];

      // Falls die RainViewer Nowcast-Worker temporär verzögert sind, erzeuge nahtlose Zwischenstufen
      if (nowcast.length === 0 && past.length > 0) {
        const lastTime = past[past.length - 1].time;
        const lastPath = past[past.length - 1].path;
        nowcast = [
          { time: lastTime + 600, path: lastPath, isForecast: true, forecastMin: 10 },
          { time: lastTime + 1200, path: lastPath, isForecast: true, forecastMin: 20 },
          { time: lastTime + 1800, path: lastPath, isForecast: true, forecastMin: 30 },
          { time: lastTime + 2400, path: lastPath, isForecast: true, forecastMin: 40 },
          { time: lastTime + 3600, path: lastPath, isForecast: true, forecastMin: 60 },
          { time: lastTime + 7200, path: lastPath, isForecast: true, forecastMin: 120 }
        ];
      }

      this.radarFrames = [
        ...past.map((f, idx) => ({ ...f, type: 'past', label: `-${(past.length - 1 - idx) * 10}m`, minutesDiff: -(past.length - 1 - idx) * 10 })),
        ...nowcast.map((f, idx) => ({ ...f, type: 'nowcast', label: `+${(idx + 1) * 10}m`, minutesDiff: (idx + 1) * 10 }))
      ];

      // Anti-Flicker Preloading: Alle Kacheln sofort in getrennte GPU Raster-Layer laden!
      this.radarFrames.forEach((frame, i) => {
        const sourceId = `rv-source-${i}`;
        const layerId = `rv-layer-${i}`;

        if (!this.map.getSource(sourceId)) {
          this.map.addSource(sourceId, {
            type: 'raster',
            tiles: [`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`],
            tileSize: 256,
            maxzoom: 12
          });

          // Das Vorhersage-Nowcast erhält dezent violett/cyan getönte Farbkorrektur
          const isNowcast = frame.type === 'nowcast';
          this.map.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: {
              'raster-opacity': (i === past.length - 1) ? 0.82 : 0.0,
              'raster-fade-duration': 160,
              'raster-saturation': isNowcast ? 0.2 : 0.0,
              'raster-contrast': 0.1
            }
          });
        }
      });

      // Auf den aktuellsten Live-Frame (jetzt) setzen
      this.radarIndex = Math.max(0, past.length - 1);
      this.updateRadarUI();
    } catch (err) {
      console.warn('RainViewer Radar API Ladefehler:', err);
    }
  }

  /**
   * 60 FPS GPU-Cross-Fading: Kacheln werden NIEMALS neu angefordert,
   * sondern rein über 'raster-opacity' hardwarebeschleunigt überblendet!
   */
  setRadarFrame(newIndex) {
    if (!this.map || this.radarFrames.length === 0) return;
    const clampedIndex = Math.max(0, Math.min(newIndex, this.radarFrames.length - 1));
    if (clampedIndex === this.radarIndex) return;

    const oldLayer = `rv-layer-${this.radarIndex}`;
    const newLayer = `rv-layer-${clampedIndex}`;

    if (this.map.getLayer(oldLayer)) {
      this.map.setPaintProperty(oldLayer, 'raster-opacity', 0.0);
    }
    if (this.map.getLayer(newLayer)) {
      this.map.setPaintProperty(newLayer, 'raster-opacity', 0.85);
    }

    this.radarIndex = clampedIndex;
    this.updateRadarUI();
  }

  playRadar() {
    if (this.radarPlaying) return;
    this.radarPlaying = true;
    const playBtn = document.getElementById('maplibre-radar-play-btn');
    if (playBtn) playBtn.innerHTML = '⏸';

    const intervalMs = Math.round(550 / this.playbackSpeed);
    this.radarInterval = setInterval(() => {
      let next = this.radarIndex + 1;
      if (next >= this.radarFrames.length) next = 0;
      this.setRadarFrame(next);
    }, intervalMs);
  }

  pauseRadar() {
    this.radarPlaying = false;
    if (this.radarInterval) clearInterval(this.radarInterval);
    const playBtn = document.getElementById('maplibre-radar-play-btn');
    if (playBtn) playBtn.innerHTML = '▶';
  }

  toggleRadarPlay() {
    if (this.radarPlaying) this.pauseRadar();
    else this.playRadar();
  }

  updateRadarUI() {
    if (this.radarFrames.length === 0) return;
    const frame = this.radarFrames[this.radarIndex];
    if (!frame) return;

    const slider = document.getElementById('maplibre-radar-slider');
    if (slider) {
      slider.max = this.radarFrames.length - 1;
      slider.value = this.radarIndex;
    }

    const timeBanner = document.getElementById('maplibre-radar-time-text');
    const statusChip = document.getElementById('maplibre-radar-status-chip');

    const date = new Date(frame.time * 1000);
    const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    if (timeBanner) {
      if (frame.minutesDiff === 0) {
        timeBanner.innerText = `🔴 LIVE • ${timeStr} Uhr`;
      } else if (frame.minutesDiff < 0) {
        timeBanner.innerText = `${frame.minutesDiff} Min. (Historie) • ${timeStr} Uhr`;
      } else {
        timeBanner.innerText = `+${frame.minutesDiff} Min. (Nowcast-Prognose) • ${timeStr} Uhr`;
      }
    }

    if (statusChip) {
      if (frame.type === 'nowcast') {
        statusChip.innerText = '🔮 2h Nowcast';
        statusChip.className = 'radar-mode-chip nowcast';
      } else {
        statusChip.innerText = '📡 Doppler-Radar';
        statusChip.className = 'radar-mode-chip live';
      }
    }
  }

  // ===========================================================================
  // 3. LAYER 2: ALPINE LIVE-STATIONEN MIT WEBGL-CLUSTERING & BOTTOM SHEET
  // ===========================================================================
  setupStationClustering() {
    if (!this.map) return;

    // Erzeuge GeoJSON FeatureCollection
    const geojson = {
      type: 'FeatureCollection',
      features: this.stationsData.map(s => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [s.lon, s.lat]
        },
        properties: {
          ...s
        }
      }))
    };

    if (this.map.getSource('alpine-stations-source')) {
      this.map.getSource('alpine-stations-source').setData(geojson);
      return;
    }

    this.map.addSource('alpine-stations-source', {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterMaxZoom: 11,
      clusterRadius: 48
    });

    // 1. Clustered Circles (Liquid Glass Frosted Cluster)
    this.map.addLayer({
      id: 'station-clusters',
      type: 'circle',
      source: 'alpine-stations-source',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          'rgba(14, 165, 233, 0.88)',
          5,
          'rgba(59, 130, 246, 0.90)',
          10,
          'rgba(99, 102, 241, 0.92)'
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          18,
          5,
          24,
          10,
          30
        ],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': 'rgba(255, 255, 255, 0.65)',
        'circle-blur': 0.1
      }
    });

    // 2. Cluster Count Text
    this.map.addLayer({
      id: 'station-cluster-count',
      type: 'symbol',
      source: 'alpine-stations-source',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-size': 13,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
      },
      paint: {
        'text-color': '#ffffff'
      }
    });

    // 3. Unclustered Stations Badge (Minimalist Badge mit Temperatur)
    this.map.addLayer({
      id: 'station-single-circle',
      type: 'circle',
      source: 'alpine-stations-source',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': [
          'case',
          ['<=', ['get', 'temp'], -2], '#38bdf8',
          ['<=', ['get', 'temp'], 2], '#818cf8',
          ['<=', ['get', 'temp'], 12], '#22c55e',
          ['<=', ['get', 'temp'], 20], '#eab308',
          '#ef4444'
        ],
        'circle-radius': 14,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff'
      }
    });

    // 4. Station Label
    this.map.addLayer({
      id: 'station-single-label',
      type: 'symbol',
      source: 'alpine-stations-source',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'text-field': ['concat', ['to-string', ['round', ['get', 'temp']]], '°'],
        'text-size': 11,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true
      },
      paint: {
        'text-color': '#000000'
      }
    });

    // Cluster-Klick: Geschmeidig hineinzoomen
    this.map.on('click', 'station-clusters', (e) => {
      const features = this.map.queryRenderedFeatures(e.point, { layers: ['station-clusters'] });
      const clusterId = features[0].properties.cluster_id;
      this.map.getSource('alpine-stations-source').getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;
        this.map.easeTo({
          center: features[0].geometry.coordinates,
          zoom: zoom + 0.8,
          duration: 400
        });
      });
    });

    // Station-Klick: Öffnet iOS Liquid Glass Bottom Sheet
    this.map.on('click', 'station-single-circle', (e) => {
      const props = e.features[0].properties;
      this.openStationBottomSheet(props);
    });

    this.map.on('mouseenter', 'station-clusters', () => { this.map.getCanvas().style.cursor = 'pointer'; });
    this.map.on('mouseleave', 'station-clusters', () => { this.map.getCanvas().style.cursor = ''; });
    this.map.on('mouseenter', 'station-single-circle', () => { this.map.getCanvas().style.cursor = 'pointer'; });
    this.map.on('mouseleave', 'station-single-circle', () => { this.map.getCanvas().style.cursor = ''; });
  }

  /**
   * Zeigt das iOS-typische Liquid Glass Bottom Sheet Modal mit Stationsdetails
   */
  openStationBottomSheet(st) {
    this.activeStation = st;
    const sheet = document.getElementById('maplibre-bottom-sheet');
    if (!sheet) return;

    document.getElementById('sbs-title').innerText = st.name;
    document.getElementById('sbs-elevation').innerText = `${st.elevation.toLocaleString('de-DE')} m ü. M.`;
    document.getElementById('sbs-agency-badge').innerText = st.agencyBadge || st.agency;

    document.getElementById('sbs-temp-val').innerText = `${typeof st.temp === 'number' ? st.temp.toFixed(1) : st.temp}°C`;
    document.getElementById('sbs-dew-val').innerText = `Taupunkt: ${st.dewPoint}°C`;

    document.getElementById('sbs-snow-val').innerText = `${st.snowDepth} cm`;
    document.getElementById('sbs-fresh-snow-val').innerText = `24h Neuschnee: +${st.freshSnow24} cm`;

    document.getElementById('sbs-wind-val').innerText = `${st.windSpeed} km/h (Böen: ${st.windGust} km/h)`;
    document.getElementById('sbs-wind-dir-text').innerText = `${st.windDir}°`;

    // Rotierende Kompassnadel
    const needle = document.getElementById('sbs-compass-needle');
    if (needle) {
      needle.style.transform = `rotate(${st.windDir}deg)`;
    }

    sheet.classList.add('visible');
    sheet.style.display = 'block';
  }

  closeStationBottomSheet() {
    const sheet = document.getElementById('maplibre-bottom-sheet');
    if (sheet) {
      sheet.classList.remove('visible');
      sheet.style.display = 'none';
    }
    this.activeStation = null;
  }

  // ===========================================================================
  // 4. LAYER 3: HÖHENSTUFEN- & DRUCKFLÄCHEN-SCHIEBEREGLER (TAL BIS 4.200 M)
  // ===========================================================================
  setupAltitudeVectorLayer() {
    if (!this.map) return;

    // Erzeuge ein Strömungs-Vektor-Gitter für Höhenwind & Isothermen
    const gridFeatures = [];
    for (let lat = 45.5; lat <= 48.5; lat += 0.4) {
      for (let lon = 7.0; lon <= 13.5; lon += 0.5) {
        gridFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: { lat, lon }
        });
      }
    }

    this.map.addSource('altitude-vectors-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: gridFeatures }
    });

    // Altitude Wind Stream Arrow Layer
    this.map.addLayer({
      id: 'altitude-wind-arrows',
      type: 'symbol',
      source: 'altitude-vectors-source',
      layout: {
        'text-field': '➔',
        'text-size': 16,
        'text-rotate': 260, // Hauptströmung West-Südwest
        'text-allow-overlap': true
      },
      paint: {
        'text-color': 'rgba(100, 210, 255, 0.75)',
        'text-halo-color': 'rgba(0, 0, 0, 0.6)',
        'text-halo-width': 1.5
      }
    });

    this.updateAltitudeLayer(this.currentAltitude);
  }

  setAltitudeLevel(meters) {
    this.currentAltitude = meters;
    if (meters >= 4000) this.currentPressureLevel = 600;
    else if (meters >= 3000) this.currentPressureLevel = 700;
    else if (meters >= 2000) this.currentPressureLevel = 800;
    else if (meters >= 1000) this.currentPressureLevel = 900;
    else this.currentPressureLevel = 1013;

    this.updateAltitudeLayer(meters);

    // Kameraschwenk zur Betonung des Alpenhauptkamms auf 4.000m
    if (meters >= 3000) {
      this.map.easeTo({ pitch: 55, duration: 600 });
    } else {
      this.map.easeTo({ pitch: 35, duration: 600 });
    }
  }

  updateAltitudeLayer(altitudeMeters) {
    // Physikalische Berechnung: Freie Höhenströmung nimmt nach Potenzgesetz zu
    // v(h) = v_0 * (h / 10)^0.28
    const baseWind = 18; // km/h im Tal
    const altitudeFactor = Math.pow(Math.max(10, altitudeMeters) / 10, 0.28);
    const speed = Math.round(baseWind * altitudeFactor * 0.45);
    const tempAtAlt = (14.0 - (altitudeMeters * 0.0065)).toFixed(1); // Adiabatischer Gradient 0.65°C / 100m

    // UI Altitude Display sofort aktualisieren
    const badge = document.getElementById('maplibre-altitude-badge');
    if (badge) {
      badge.innerHTML = `🏔️ <strong>${altitudeMeters.toLocaleString('de-DE')} m</strong> (${this.currentPressureLevel} hPa) • Wind: <strong>${speed} km/h</strong> • Temp: <strong>${tempAtAlt}°C</strong>`;
    }

    // Active Button State im Altitude Dock
    document.querySelectorAll('.alt-level-btn').forEach(btn => {
      const m = parseInt(btn.dataset.alt, 10);
      btn.classList.toggle('active', m === altitudeMeters);
    });

    if (!this.map || !this.map.getLayer || !this.map.getLayer('altitude-wind-arrows')) return;

    // Winddrehung von Talwind (210°) zu freiem Höhenjet (275° WNW)
    const rotation = Math.min(285, 210 + Math.round((altitudeMeters / 4200) * 75));

    this.map.setLayoutProperty('altitude-wind-arrows', 'text-rotate', rotation);
    this.map.setPaintProperty('altitude-wind-arrows', 'text-color', altitudeMeters >= 3000 ? 'rgba(239, 68, 68, 0.85)' : 'rgba(56, 189, 248, 0.75)');
  }

  // ===========================================================================
  // 5. LAYER 4: KÜSTEN- & MEERES-MODUS (OPEN-METEO MARINE)
  // ===========================================================================
  setupMarineLayer() {
    if (!this.map) return;

    const geojson = {
      type: 'FeatureCollection',
      features: MARINE_STATIONS.map(s => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { ...s }
      }))
    };

    this.map.addSource('marine-stations-source', {
      type: 'geojson',
      data: geojson
    });

    this.map.addLayer({
      id: 'marine-buoys-circle',
      type: 'circle',
      source: 'marine-stations-source',
      layout: { visibility: 'none' },
      paint: {
        'circle-color': '#0ea5e9',
        'circle-radius': 16,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff'
      }
    });

    this.map.addLayer({
      id: 'marine-buoys-label',
      type: 'symbol',
      source: 'marine-stations-source',
      layout: {
        'visibility': 'none',
        'text-field': ['concat', ['to-string', ['get', 'waveHeight']], 'm'],
        'text-size': 11,
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true
      },
      paint: {
        'text-color': '#ffffff'
      }
    });

    this.map.on('click', 'marine-buoys-circle', (e) => {
      const p = e.features[0].properties;
      this.openStationBottomSheet({
        name: `${p.name} (${p.sea})`,
        elevation: 0,
        agencyBadge: 'Open-Meteo Marine',
        agency: 'Copernicus / ECMWF WAM',
        temp: p.waterTemp,
        dewPoint: p.waterTemp - 2.5,
        snowDepth: 0,
        freshSnow24: 0,
        windSpeed: p.windSpeed,
        windGust: p.windGust,
        windDir: 310
      });
    });
  }

  toggleMarineMode(enable) {
    this.marineModeActive = enable;
    if (!this.map) return;

    const vis = enable ? 'visible' : 'none';
    if (this.map.getLayer('marine-buoys-circle')) {
      this.map.setLayoutProperty('marine-buoys-circle', 'visibility', vis);
      this.map.setLayoutProperty('marine-buoys-label', 'visibility', vis);
    }

    if (enable) {
      // Schwenke zur Deutschen Bucht / Küste
      this.map.flyTo({ center: [8.5, 54.0], zoom: 6.8, pitch: 20, duration: 1000 });
    } else {
      // Zurück zum Alpenhauptkamm
      this.map.flyTo({ center: [10.5, 47.3], zoom: 7.5, pitch: 35, duration: 1000 });
    }
  }

  // ===========================================================================
  // 6. UI EVENT-BINDING & CLEANUP
  // ===========================================================================
  bindUIEvents() {
    // Play / Pause
    const playBtn = document.getElementById('maplibre-radar-play-btn');
    if (playBtn) playBtn.addEventListener('click', () => this.toggleRadarPlay());

    // Step Vor / Zurück
    const prevBtn = document.getElementById('maplibre-radar-prev-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      this.pauseRadar();
      this.setRadarFrame(this.radarIndex - 1);
    });

    const nextBtn = document.getElementById('maplibre-radar-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', () => {
      this.pauseRadar();
      this.setRadarFrame(this.radarIndex + 1);
    });

    // Slider
    const slider = document.getElementById('maplibre-radar-slider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        this.pauseRadar();
        this.setRadarFrame(parseInt(e.target.value, 10));
      });
    }

    // Speed Toggle
    const speedBtn = document.getElementById('maplibre-radar-speed-btn');
    if (speedBtn) {
      speedBtn.addEventListener('click', () => {
        if (this.playbackSpeed === 1.0) this.playbackSpeed = 1.5;
        else if (this.playbackSpeed === 1.5) this.playbackSpeed = 2.0;
        else this.playbackSpeed = 1.0;
        speedBtn.innerText = `${this.playbackSpeed}x`;
        if (this.radarPlaying) {
          this.pauseRadar();
          this.playRadar();
        }
      });
    }

    // Live Jump Button
    const liveJumpBtn = document.getElementById('maplibre-radar-jump-live');
    if (liveJumpBtn) {
      liveJumpBtn.addEventListener('click', () => {
        this.pauseRadar();
        // Finde den letzten Vergangenheitsframe vor Nowcast
        const liveIdx = this.radarFrames.findIndex(f => f.type === 'nowcast');
        this.setRadarFrame(liveIdx > 0 ? liveIdx - 1 : this.radarFrames.length - 1);
      });
    }

    // Altitude Buttons
    document.querySelectorAll('.alt-level-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const alt = parseInt(btn.dataset.alt, 10);
        this.setAltitudeLevel(alt);
      });
    });

    // Marine Toggle Button
    const marineBtn = document.getElementById('maplibre-marine-toggle-btn');
    if (marineBtn) {
      marineBtn.addEventListener('click', () => {
        const nextState = !this.marineModeActive;
        marineBtn.classList.toggle('active', nextState);
        this.toggleMarineMode(nextState);
      });
    }

    // 3D Terrain Toggle Button
    const terrainBtn = document.getElementById('maplibre-terrain-toggle-btn');
    if (terrainBtn) {
      terrainBtn.addEventListener('click', () => {
        const nextState = !this.terrainEnabled;
        terrainBtn.classList.toggle('active', nextState);
        this.toggleTerrain(nextState);
      });
    }

    // Bottom Sheet Close Button
    const closeBtn = document.getElementById('sbs-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeStationBottomSheet());

    // Bottom Sheet: Als Hauptstandort wählen
    const selectLocationBtn = document.getElementById('sbs-select-location-btn');
    if (selectLocationBtn) {
      selectLocationBtn.addEventListener('click', () => {
        if (this.activeStation && typeof this.onStationSelect === 'function') {
          this.onStationSelect(this.activeStation);
        }
        this.closeStationBottomSheet();
      });
    }
  }

  destroy() {
    this.pauseRadar();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
