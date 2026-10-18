/**
 * BEST WEATHER — GPX & Alpine Math Web Worker
 * Offloads heavy GPX parsing, SAC hiking formulas and coordinate calculations
 * from the main thread for smooth 120 FPS UI.
 */

self.onmessage = function (e) {
  const { action, payload } = e.data;

  if (action === 'parseGPX') {
    try {
      const { xmlString } = payload;
      const parsed = parseGPXFast(xmlString);
      self.postMessage({ status: 'success', action: 'parseGPX', data: parsed });
    } catch (err) {
      self.postMessage({ status: 'error', action: 'parseGPX', error: err.message });
    }
  }
};

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Erdradius in Metern
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseGPXFast(xmlString) {
  const trkpts = [];
  const trkptRegex = /<trkpt\s+[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/trkpt>/gi;
  const eleRegex = /<ele>([^<]+)<\/ele>/i;
  let match;

  while ((match = trkptRegex.exec(xmlString)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    const eleMatch = eleRegex.exec(match[3]);
    const ele = eleMatch ? parseFloat(eleMatch[1]) : 1000;
    trkpts.push({ lat, lon, ele });
  }

  if (trkpts.length === 0) {
    throw new Error('Keine Trackpunkte im GPX gefunden.');
  }

  const points = [];
  let totalDistanceM = 0;
  let totalAscentM = 0;
  let totalDescentM = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;

  // Hysterese-Schwellenwert (5m) gegen GPS-Höhenrauschen
  let lastEleAnchor = trkpts[0].ele;

  for (let i = 0; i < trkpts.length; i++) {
    const pt = trkpts[i];
    const lat = pt.lat;
    const lon = pt.lon;
    const ele = pt.ele;

    if (i > 0) {
      const prev = points[i - 1];
      const d = calculateHaversineDistance(prev.lat, prev.lon, lat, lon);
      totalDistanceM += d;

      const dz = ele - lastEleAnchor;
      if (Math.abs(dz) >= 4.0) {
        if (dz > 0) totalAscentM += dz;
        else totalDescentM += Math.abs(dz);
        lastEleAnchor = ele;
      }
    }

    if (ele < minEle) minEle = ele;
    if (ele > maxEle) maxEle = ele;

    points.push({
      index: i,
      lat,
      lon,
      ele,
      distFromStartKm: Math.round((totalDistanceM / 1000) * 100) / 100
    });
  }

  let trackName = 'GPX-Route';
  const nameMatch = /<name>([^<]+)<\/name>/i.exec(xmlString);
  if (nameMatch && nameMatch[1]) {
    trackName = nameMatch[1].trim();
  }

  return {
    success: true,
    name: trackName,
    pointCount: points.length,
    totalDistanceKm: Math.round((totalDistanceM / 1000) * 10) / 10,
    totalAscentM: Math.round(totalAscentM),
    totalDescentM: Math.round(totalDescentM),
    minElevationM: Math.round(minEle),
    maxElevationM: Math.round(maxEle),
    points
  };
}
