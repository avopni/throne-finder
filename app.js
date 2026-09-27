import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TORONTO_WASHROOMS = 'https://services.arcgis.com/a3UyP711tRR4O2v8/ArcGIS/rest/services/Washroom_Facilities__Toronto/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson&returnGeometry=true';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const DEFAULT_START = { lat: 43.6476, lng: -79.4139, label: 'Trinity Bellwoods Park' };
const DEFAULT_END = { lat: 43.6487, lng: -79.3715, label: 'St. Lawrence Market' };

const planner = document.querySelector('#planner');
const drawer = document.querySelector('#saved-drawer');
const backdrop = document.querySelector('.drawer-backdrop');
const detail = document.querySelector('#detail-card');
const toast = document.querySelector('.toast');
const loading = document.querySelector('#map-loading');
const startInput = document.querySelector('#start-input');
const endInput = document.querySelector('#end-input');

let facilities = [];
let thrones = [];
let startCoords = { ...DEFAULT_START };
let endCoords = { ...DEFAULT_END };
let currentRoute = null;
let currentRouteStops = [];
let currentMode = 'route';
let userMarker = null;
let routeLayer = null;
const endpointLayer = L.layerGroup();
const throneLayer = L.layerGroup();
let saved = JSON.parse(localStorage.getItem('throne-finder-saved') || '[]').filter(id => String(id).startsWith('toronto-'));

const map = L.map('live-map', { zoomControl: false, attributionControl: true }).setView([43.6532, -79.3832], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
endpointLayer.addTo(map);
throneLayer.addTo(map);

const icon = (className, html = '') => L.divIcon({ className: '', html: `<div class="${className}">${html}</div>`, iconSize: [40, 40], iconAnchor: [20, 36] });

function showPlanner() {
  planner.classList.add('open');
  planner.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => map.invalidateSize(), 180);
}

function closePlanner() {
  planner.classList.remove('open');
  planner.setAttribute('aria-hidden', 'true');
  detail.classList.remove('open');
  document.body.style.overflow = '';
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function setLoading(isLoading, message = 'Finding the safest route…') {
  loading.querySelector('b').textContent = message;
  loading.classList.toggle('show', isLoading);
  document.querySelector('.route-submit').disabled = isLoading;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function facilityTags(facility) {
  const tags = [];
  if (/accessible/i.test(facility.accessibility)) tags.push('Accessible');
  if (/child change table/i.test(facility.accessibility)) tags.push('Change table');
  tags.push(facility.type || 'Public washroom');
  if (facility.status === '1') tags.push('Open status');
  if (facility.status === '2') tags.push('Limited access');
  return [...new Set(tags)].slice(0, 4);
}

function statusText(facility) {
  if (facility.status === '0') return facility.reason || 'Reported closed';
  if (facility.status === '2') return facility.reason || 'Partially available';
  return facility.hours && facility.hours !== 'None' ? facility.hours : 'Check posted hours';
}

function updateSaved() {
  localStorage.setItem('throne-finder-saved', JSON.stringify(saved));
  document.querySelectorAll('.saved-count').forEach(el => el.textContent = saved.length);
  const list = document.querySelector('#saved-list');
  const savedFacilities = saved.map(id => facilities.find(item => item.id === id)).filter(Boolean);
  if (!savedFacilities.length) {
    list.innerHTML = '<div class="empty-state"><b>No saved thrones yet</b><span>Tap any washroom on the live map, then save it for later.</span></div>';
    return;
  }
  list.innerHTML = savedFacilities.map(item => `<article class="saved-item"><div class="saved-item__top"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(statusText(item))}</p></div><button data-remove="${item.id}" aria-label="Remove ${escapeHtml(item.name)}">×</button></div><div class="saved-tags">${facilityTags(item).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div></article>`).join('');
}

function openDrawer() {
  updateSaved();
  drawer.classList.add('open');
  backdrop.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  drawer.classList.remove('open');
  backdrop.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}

function openDetail(id) {
  const item = facilities.find(facility => facility.id === id);
  if (!item) return;
  const officialLink = item.url ? `<a class="city-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">City details ↗</a>` : '';
  detail.innerHTML = `<h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.address || item.location || 'Toronto public washroom')}</p><p>${escapeHtml(statusText(item))}</p><div class="saved-tags">${facilityTags(item).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>${officialLink}<div class="detail-actions"><button class="save-throne" data-save="${item.id}">${saved.includes(item.id) ? 'Saved ✓' : 'Save this throne'}</button><button class="close-detail">Close</button></div>`;
  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');
}

async function loadFacilities() {
  if (facilities.length) return facilities;
  const response = await fetch(TORONTO_WASHROOMS);
  if (!response.ok) throw new Error('The City washroom feed is unavailable.');
  const data = await response.json();
  facilities = data.features.flatMap(feature => {
    const raw = feature.geometry?.coordinates;
    const coordinates = Array.isArray(raw?.[0]) ? raw[0] : raw;
    if (!coordinates || coordinates.length < 2) return [];
    const p = feature.properties;
    return [{
      id: `toronto-${p.FID}`,
      name: p.AssetNa13 || p.alterna5 || p.locatio4 || 'Public washroom',
      location: p.locatio9 || '',
      address: p.address11 || '',
      type: p.type6 || 'Public washroom',
      accessibility: p.accessi7 || '',
      hours: p.hours8 || '',
      status: String(p.Status16 ?? ''),
      reason: p.Reason14 || '',
      comment: p.Comment15 || '',
      url: p.url10 || '',
      lat: Number(coordinates[1]),
      lng: Number(coordinates[0]),
    }];
  });
  updateSaved();
  return facilities;
}

function activeFilters() {
  return [...document.querySelectorAll('.chip.active')].map(chip => chip.dataset.filter);
}

function passesFilters(item) {
  const filters = activeFilters();
  return (!filters.includes('accessible') || /accessible/i.test(item.accessibility))
    && (!filters.includes('open') || item.status === '1')
    && (!filters.includes('changing') || /child change table/i.test(item.accessibility))
    && (!filters.includes('building') || /building|community centre/i.test(item.type));
}

function haversine(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function nearestRoutePosition(item, route) {
  const step = Math.max(1, Math.floor(route.length / 350));
  let bestDistance = Infinity;
  let bestIndex = 0;
  for (let index = 0; index < route.length; index += step) {
    const distance = haversine(item, { lat: route[index][0], lng: route[index][1] });
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  }
  return { distance: bestDistance, progress: bestIndex / Math.max(1, route.length - 1) };
}

function chooseRouteStops(route) {
  const corridor = Math.min(1100, Math.max(450, Number(document.querySelector('#comfort-range').value) * 45));
  const candidates = facilities.filter(passesFilters).map(item => ({ ...item, ...nearestRoutePosition(item, route) })).filter(item => item.distance <= corridor && item.progress > .05 && item.progress < .95);
  const selected = [];
  for (const target of [.25, .5, .75]) {
    const next = candidates.filter(item => !selected.some(chosen => chosen.id === item.id)).sort((a, b) => (a.distance + Math.abs(a.progress - target) * 1800) - (b.distance + Math.abs(b.progress - target) * 1800))[0];
    if (next) selected.push(next);
  }
  return selected.sort((a, b) => a.progress - b.progress);
}

function decodePolyline(encoded, precision = 6) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  const factor = 10 ** precision;
  while (index < encoded.length) {
    let result = 0, shift = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    result = 0; shift = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

async function getWalkingRoute(points) {
  const request = { locations: points.map(point => ({ lat: point.lat, lon: point.lng })), costing: 'pedestrian', units: 'kilometers', directions_options: { units: 'kilometers' } };
  const response = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(request))}`);
  if (!response.ok) throw new Error('Walking directions are unavailable right now.');
  const data = await response.json();
  if (!data.trip?.legs?.length) throw new Error('No walkable route was found.');
  const coordinates = data.trip.legs.flatMap((leg, index) => {
    const decoded = decodePolyline(leg.shape);
    return index ? decoded.slice(1) : decoded;
  });
  return { coordinates, time: data.trip.summary.time, distance: data.trip.summary.length };
}

async function geocode(value) {
  const normalized = value.trim().toLowerCase();
  if (/trinity bellwoods/.test(normalized)) return { ...DEFAULT_START };
  if (/st\.? lawrence market/.test(normalized)) return { ...DEFAULT_END };
  const params = new URLSearchParams({ q: `${value}, Ontario, Canada`, format: 'jsonv2', limit: '1', countrycodes: 'ca' });
  const response = await fetch(`${NOMINATIM}?${params}`);
  if (!response.ok) throw new Error(`Could not look up “${value}”.`);
  const results = await response.json();
  if (!results.length) throw new Error(`Could not find “${value}”. Try a more specific address.`);
  return { lat: Number(results[0].lat), lng: Number(results[0].lon), label: results[0].display_name };
}

function renderRouteMarkers(stops) {
  throneLayer.clearLayers();
  thrones = stops;
  stops.forEach((item, index) => {
    L.marker([item.lat, item.lng], { icon: icon('live-pin', `<span>${index + 1}</span>`), keyboard: true, title: item.name }).on('click', () => openDetail(item.id)).addTo(throneLayer);
  });
}

function renderNearbyMarkers() {
  throneLayer.clearLayers();
  const bounds = map.getBounds();
  const nearby = facilities.filter(item => passesFilters(item) && bounds.contains([item.lat, item.lng])).slice(0, 180);
  nearby.forEach(item => L.marker([item.lat, item.lng], { icon: icon('live-pin live-pin--nearby'), keyboard: true, title: item.name }).on('click', () => openDetail(item.id)).addTo(throneLayer));
}

function renderEndpoints() {
  endpointLayer.clearLayers();
  L.marker([startCoords.lat, startCoords.lng], { icon: icon('endpoint-pin'), title: 'Route start' }).addTo(endpointLayer);
  L.marker([endCoords.lat, endCoords.lng], { icon: icon('endpoint-pin endpoint-pin--end'), title: 'Destination' }).addTo(endpointLayer);
  if (userMarker) userMarker.addTo(endpointLayer);
}

function updateSummary(route, stops) {
  document.querySelector('#route-time').textContent = `${Math.max(1, Math.round(route.time / 60))} min`;
  document.querySelector('#route-stop-count').textContent = String(stops.length);
  document.querySelector('#route-distance').textContent = `${route.distance.toFixed(1)} km`;
  const preview = document.querySelector('.stop-preview');
  if (stops.length) {
    const first = stops[0];
    preview.innerHTML = `<span class="stop-number">1</span><div><b>${escapeHtml(first.name)}</b><span>${Math.max(1, Math.round(route.time / 60 * first.progress))} min along route · ${escapeHtml(statusText(first))}</span></div><span class="rating">CITY DATA</span>`;
  } else {
    preview.innerHTML = '<span class="stop-number">!</span><div><b>No matching facilities on this route</b><span>Try clearing one or more must-have filters.</span></div><span class="rating">LIVE</span>';
  }
  document.querySelector('#route-summary').classList.add('ready');
  document.querySelector('#route-summary').classList.remove('hidden');
}

async function planRoute() {
  setLoading(true);
  try {
    const startNeedsLookup = !startCoords || startInput.value.trim() !== startCoords.inputValue;
    const endNeedsLookup = !endCoords || endInput.value.trim() !== endCoords.inputValue;
    if (startNeedsLookup) {
      startCoords = await geocode(startInput.value);
      startCoords.inputValue = startInput.value.trim();
    }
    if (endNeedsLookup) {
      if (startNeedsLookup && !/trinity bellwoods/i.test(startInput.value)) await new Promise(resolve => setTimeout(resolve, 1100));
      endCoords = await geocode(endInput.value);
      endCoords.inputValue = endInput.value.trim();
    }
    await loadFacilities();
    const directRoute = await getWalkingRoute([startCoords, endCoords]);
    const stops = chooseRouteStops(directRoute.coordinates);
    const finalRoute = stops.length ? await getWalkingRoute([startCoords, ...stops, endCoords]) : directRoute;
    currentRoute = finalRoute;
    currentRouteStops = stops;

    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.polyline(finalRoute.coordinates, { color: '#e86f43', weight: 6, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
    renderEndpoints();
    if (currentMode === 'route') renderRouteMarkers(stops); else renderNearbyMarkers();
    map.fitBounds(routeLayer.getBounds(), { padding: [55, 55] });
    updateSummary(finalRoute, stops);
    if (window.innerWidth <= 800) document.querySelector('.map-panel').scrollIntoView({ behavior: 'smooth' });
    showToast(`${stops.length} live washroom${stops.length === 1 ? '' : 's'} added to your route`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Could not plan that route.');
  } finally {
    setLoading(false);
  }
}

document.querySelectorAll('[data-open-planner]').forEach(button => button.addEventListener('click', showPlanner));
document.querySelector('.planner-close').addEventListener('click', closePlanner);
document.querySelector('#how-it-works').addEventListener('click', () => document.querySelector('#about').scrollIntoView());
document.querySelectorAll('[data-open-saved]').forEach(button => button.addEventListener('click', openDrawer));
document.querySelector('.drawer-close').addEventListener('click', closeDrawer);
backdrop.addEventListener('click', closeDrawer);

document.querySelector('#comfort-range').addEventListener('input', event => document.querySelector('#range-output').textContent = `${event.target.value} min`);
document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('active')));
document.querySelector('#clear-filters').addEventListener('click', () => document.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active')));

document.querySelector('#locate-button').addEventListener('click', () => {
  startInput.value = 'Finding your location…';
  if (!navigator.geolocation) { startInput.value = 'Current location unavailable'; showToast('Location is not available in this browser'); return; }
  navigator.geolocation.getCurrentPosition(position => {
    startCoords = { lat: position.coords.latitude, lng: position.coords.longitude, label: 'Current location', inputValue: 'Current location' };
    startInput.value = 'Current location';
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([startCoords.lat, startCoords.lng], { icon: icon('user-pin'), title: 'Your location' }).addTo(map);
    map.setView([startCoords.lat, startCoords.lng], 15);
    showToast('Current location added');
  }, () => {
    startInput.value = DEFAULT_START.label;
    startCoords = { ...DEFAULT_START, inputValue: DEFAULT_START.label };
    showToast('We could not access your location. Enter an address instead.');
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
});

startInput.addEventListener('input', () => { if (startInput.value !== startCoords?.inputValue) startCoords = null; });
endInput.addEventListener('input', () => { if (endInput.value !== endCoords?.inputValue) endCoords = null; });
document.querySelector('#route-form').addEventListener('submit', event => { event.preventDefault(); planRoute(); });

document.querySelectorAll('.map-mode').forEach(button => button.addEventListener('click', async () => {
  document.querySelectorAll('.map-mode').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  currentMode = button.dataset.mode;
  try {
    await loadFacilities();
    if (currentMode === 'nearby') renderNearbyMarkers(); else renderRouteMarkers(currentRouteStops);
  } catch (error) { showToast(error.message); }
}));

map.on('moveend', () => { if (currentMode === 'nearby' && facilities.length) renderNearbyMarkers(); });
map.on('click', event => {
  endCoords = { lat: event.latlng.lat, lng: event.latlng.lng, label: 'Dropped pin', inputValue: 'Dropped pin' };
  endInput.value = 'Dropped pin';
  renderEndpoints();
  showToast('Destination pin placed');
});

document.querySelector('.recenter').addEventListener('click', () => {
  if (routeLayer) map.fitBounds(routeLayer.getBounds(), { padding: [55, 55] });
  else map.setView([43.6532, -79.3832], 13);
});
document.querySelector('.summary-close').addEventListener('click', () => document.querySelector('#route-summary').classList.add('hidden'));
document.querySelector('#start-route').addEventListener('click', () => {
  if (!currentRoute) { showToast('Plan a route first'); return; }
  const waypoints = currentRouteStops.map(item => `${item.lat},${item.lng}`).join('|');
  const params = new URLSearchParams({ api: '1', origin: `${startCoords.lat},${startCoords.lng}`, destination: `${endCoords.lat},${endCoords.lng}`, travelmode: 'walking' });
  if (waypoints) params.set('waypoints', waypoints);
  window.open(`https://www.google.com/maps/dir/?${params}`, '_blank', 'noopener');
});

detail.addEventListener('click', event => {
  if (event.target.matches('.close-detail')) { detail.classList.remove('open'); detail.setAttribute('aria-hidden', 'true'); }
  if (event.target.matches('[data-save]')) {
    const id = event.target.dataset.save;
    if (!saved.includes(id)) { saved.push(id); updateSaved(); event.target.textContent = 'Saved ✓'; showToast('Throne saved for later'); }
  }
});

document.querySelector('#saved-list').addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  saved = saved.filter(id => id !== button.dataset.remove);
  updateSaved();
  showToast('Removed from saved thrones');
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (drawer.classList.contains('open')) closeDrawer();
  else if (detail.classList.contains('open')) detail.classList.remove('open');
  else if (planner.classList.contains('open')) closePlanner();
});

startCoords.inputValue = startInput.value.trim();
endCoords.inputValue = endInput.value.trim();
updateSaved();
loadFacilities().then(() => renderNearbyMarkers()).catch(error => console.warn(error));
const demoParams = new URLSearchParams(window.location.search);
if (demoParams.has('planner')) showPlanner();
if (demoParams.has('route') || window.location.search.includes('route=1')) setTimeout(planRoute, 300);
