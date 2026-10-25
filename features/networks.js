/**
 * BEST WEATHER — Networks & Data Transparency Feature Module (Task 1a)
 * Manages meteorological data source cards, dynamic geo-routing badges,
 * and category quick-navigation anchors.
 */

import { state } from '../core/state.js';

/**
 * Updates geo-routing borders and status badge based on current latitude and longitude
 */
export function updateGeoRoutingNetworks() {
  if (!state.currentLocation) return;
  const lat = state.currentLocation.lat;
  const lon = state.currentLocation.lon;

  const netDwd = document.getElementById('net-dwd');
  const netLawis = document.getElementById('net-lawis');
  const netSuedtirol = document.getElementById('net-suedtirol');
  const netSlf = document.getElementById('net-slf');
  const routingBadge = document.getElementById('active-routing-badge');

  [netDwd, netLawis, netSuedtirol, netSlf].forEach(n => {
    if (n) n.style.borderColor = 'rgba(255, 255, 255, 0.08)';
  });

  const activeNet = state.microData?.biasCorrection?.stationNetwork;
  const activeStation = state.microData?.biasCorrection?.stationName;

  if (activeNet === 'LAWIS') {
    if (netLawis) netLawis.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = `Geo-Routing: LAWIS (${activeStation || 'Alpen-Messnetz'}) aktiv`;
  } else if (activeNet === 'Südtirol Open Data') {
    if (netSuedtirol) netSuedtirol.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = `Geo-Routing: Open Data Hub Südtirol (${activeStation || 'Dolomiten'}) aktiv`;
  } else if (activeNet === 'MeteoSwiss') {
    if (netSlf) netSlf.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = `Geo-Routing: MeteoSwiss / SLF (${activeStation || 'Schweiz'}) aktiv`;
  } else if (activeNet === 'Météo-France') {
    if (netSlf) netSlf.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = `Geo-Routing: Météo-France (${activeStation || 'Frankreich'}) aktiv`;
  } else if (activeNet === 'ZAMG') {
    if (netLawis) netLawis.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = `Geo-Routing: ZAMG GeoSphere Austria (${activeStation || 'Österreich'}) aktiv`;
  } else if (lat >= 47.05 && lat <= 48.0 && lon >= 9.5 && lon <= 13.5) {
    if (netLawis) netLawis.style.borderColor = 'var(--ios-cyan)';
    if (netDwd) netDwd.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: LAWIS Bayern / Tirol + DWD aktiv';
  } else if (lat < 47.05 && lat >= 45.8 && lon >= 10.4 && lon <= 12.6) {
    if (netSuedtirol) netSuedtirol.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: Open Data Hub Südtirol aktiv';
  } else if (lon < 10.2 && lat >= 45.5 && lat <= 47.8) {
    if (netSlf) netSlf.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = 'Geo-Routing: SLF IMIS Schweiz aktiv';
  } else {
    if (netDwd) netDwd.style.borderColor = 'var(--ios-cyan)';
    if (routingBadge) routingBadge.innerText = activeStation ? `Geo-Routing: DWD (${activeStation}) aktiv` : 'Geo-Routing: DWD MOSMIX & Open-Meteo aktiv';
  }
}

/**
 * Smooth scrolling and active-highlighting for Tab 5 sources quick navigation
 */
export function setupSourcesQuickNav() {
  document.querySelectorAll('.sources-nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('href')?.replace('#', '');
      if (!targetId) return;
      const targetElem = document.getElementById(targetId);
      if (targetElem) {
        document.querySelectorAll('.sources-nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        targetElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}
