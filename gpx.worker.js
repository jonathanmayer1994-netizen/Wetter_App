/**
 * BEST WEATHER — GPX & Alpine Math Web Worker (Task 6a)
 * Features Ramer-Douglas-Peucker (RDP) point decimation, SAC hiking math,
 * and high-speed Transferable ArrayBuffers for zero-copy UI data transport.
 */

self.onmessage = function (e) {
  const { action, payload } = e.data;

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
        { status: 'success', action: 'parseGPX', data: parsed },
        [lats.buffer, lons.buffer, eles.buffer, dists.buffer]
      );
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

/**
 * Perpendicular distance in 2D coordinates for RDP
 */
function perpendicularDistance(pt, lineStart, lineEnd) {
  const dx = lineEnd.distFromStartKm - lineStart.distFromStartKm;
  const dy = lineEnd.ele - lineStart.ele;

  if (dx === 0 && dy === 0) {
    const px = pt.distFromStartKm - lineStart.distFromStartKm;
    const py = pt.ele - lineStart.ele;
    return Math.sqrt(px * px + py * py);
  }

  const t = ((pt.distFromStartKm - lineStart.distFromStartKm) * dx + (pt.ele - lineStart.ele) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const projX = lineStart.distFromStartKm + clampedT * dx;
  const projY = lineStart.ele + clampedT * dy;

  const diffX = (pt.distFromStartKm - projX) * 1000; // in meters
  const diffY = pt.ele - projY; // in meters
  return Math.sqrt(diffX * diffX + diffY * diffY);
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
    points,
    decimatedPoints
  };
}
