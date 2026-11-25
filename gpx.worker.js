/**
 * BEST WEATHER — GPX & Alpine Math Web Worker (Task 6a)
 * Features Ramer-Douglas-Peucker (RDP) point decimation, SAC hiking math,
 * and high-speed Transferable ArrayBuffers for zero-copy UI data transport.
 */

self.onmessage = function (e) {
  const { id, action, payload } = e.data || {};

  if (action === 'parseGPX') {
    try {
      const { xmlString } = payload;
      const parsed = parseGPXFast(xmlString);

      // Extract Transferable TypedArrays for high-speed zero-copy transfer
      const decimated = parsed.decimatedPoints || parsed.points;
      const pointCount = decimated.length;
      const lats = new Float32Array(pointCount);
      const lons = new Float32Array(pointCount);
      const eles = new Float32Array(pointCount);
      const dists = new Float32Array(pointCount);

      for (let i = 0; i < pointCount; i++) {
        lats[i] = decimated[i].lat;
        lons[i] = decimated[i].lon;
        eles[i] = decimated[i].ele;
        dists[i] = decimated[i].distFromStartKm;
      }

      parsed.transferable = {
        lats,
        lons,
        eles,
        dists
      };

      // Post message with transferable buffers
      self.postMessage(
        { id, status: 'success', action: 'parseGPX', data: parsed },
        [lats.buffer, lons.buffer, eles.buffer, dists.buffer]
      );
    } catch (err) {
      self.postMessage({ id, status: 'error', action: 'parseGPX', error: err.message });
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

/**
 * Echter geometrischer Senkrecht-Abstand (in Metern) im (lat, lon)-Raum für Douglas-Peucker,
 * damit Serpentinen auf der Karte sauber erhalten bleiben.
 */
function perpendicularDistance(pt, lineStart, lineEnd) {
  const latScale = 111320;
  const meanLatRad = ((lineStart.lat + lineEnd.lat) * 0.5) * (Math.PI / 180);
  const lonScale = 111320 * Math.cos(meanLatRad);

  const ax = lineStart.lon * lonScale;
  const ay = lineStart.lat * latScale;
  const bx = lineEnd.lon * lonScale;
  const by = lineEnd.lat * latScale;
  const px = pt.lon * lonScale;
  const py = pt.lat * latScale;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(px - ax, py - ay);
  }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Ramer-Douglas-Peucker decimation algorithm (O(N log N) recursive simplification)
 */
function rdpDecimate(points, epsilon = 8.0) {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const rec1 = rdpDecimate(points.slice(0, index + 1), epsilon);
    const rec2 = rdpDecimate(points.slice(index), epsilon);
    return rec1.slice(0, -1).concat(rec2);
  } else {
    return [points[0], points[end]];
  }
}

function parseGPXFast(xmlString) {
  const trkpts = [];
  // Unterstützt beliebige Attributreihenfolge (lat/lon oder lon/lat) sowie self-closing <trkpt .../>
  const trkptRegex = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi;
  const latAttrRegex = /\blat=["']([^"']+)["']/i;
  const lonAttrRegex = /\blon=["']([^"']+)["']/i;
  const eleRegex = /<ele>([^<]+)<\/ele>/i;
  let match;
  let lastValidEle = 500;

  while ((match = trkptRegex.exec(xmlString)) !== null) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const latMatch = latAttrRegex.exec(attrs);
    const lonMatch = lonAttrRegex.exec(attrs);
    if (!latMatch || !lonMatch) continue;
    const lat = parseFloat(latMatch[1]);
    const lon = parseFloat(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleMatch = eleRegex.exec(inner);
    const parsedEle = eleMatch ? parseFloat(eleMatch[1]) : NaN;
    const ele = Number.isFinite(parsedEle) ? parsedEle : lastValidEle;
    lastValidEle = ele;
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

  let lastEleAnchor = trkpts[0].ele;

  for (let i = 0; i < trkpts.length; i++) {
    const pt = trkpts[i];
    const lat = pt.lat;
    const lon = pt.lon;
    const ele = pt.ele;

    if (i > 0) {
      const prev = points[i - 1];
      // 3D-Haversine Distanz: Berücksichtigung des Höhendeltas dz für reale alpine Wegstrecken
      const dHorizontal = calculateHaversineDistance(prev.lat, prev.lon, lat, lon);
      const dzStep = ele - prev.ele;
      const d3D = Math.sqrt(dHorizontal * dHorizontal + dzStep * dzStep);
      totalDistanceM += d3D;

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

  // Adaptive Ramer-Douglas-Peucker Decimation: reduces 20.000+ points to ~400-800 key points
  const decimatedPoints = points.length > 500 ? rdpDecimate(points, 7.5) : points;

  // SAC/DAV Marschzeit: 4 km/h flach + 400 Hm/h Anstieg
  const distHours = (totalDistanceM / 1000) / 4.0;
  const ascHours = totalAscentM / 400.0;
  const totalHours = Math.max(distHours, ascHours) + 0.5 * Math.min(distHours, ascHours);
  const hFormatted = Math.floor(totalHours);
  const mFormatted = Math.round((totalHours - hFormatted) * 60);

  return {
    success: true,
    name: trackName,
    pointCount: points.length,
    decimatedCount: decimatedPoints.length,
    totalDistanceKm: Math.round((totalDistanceM / 1000) * 10) / 10,
    totalAscentM: Math.round(totalAscentM),
    totalDescentM: Math.round(totalDescentM),
    minElevationM: Math.round(minEle),
    maxElevationM: Math.round(maxEle),
    estimatedDuration: `${hFormatted} h ${mFormatted} min`,
    points,
    decimatedPoints
  };
}
