import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const OSM_AMENITIES = 'https://services6.arcgis.com/Do88DoK2xjTUCXd1/arcgis/rest/services/OSM_Amenities_NA/FeatureServer/0/query';
const PHOTON = 'https://photon.komoot.io/api/';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const DEFAULT_START = { lat: 43.4474, lng: -80.4937, label: 'Victoria Park, Kitchener' };
const DEFAULT_END = { lat: 43.4644, lng: -80.5222, label: 'Waterloo Public Square' };

const planner = document.querySelector('#planner');
const drawer = document.querySelector('#saved-drawer');
const backdrop = document.querySelector('.drawer-backdrop');
const detail = document.querySelector('#detail-card');
const toast = document.querySelector('.toast');
const loading = document.querySelector('#map-loading');
const startInput = document.querySelector('#start-input');
const endInput = document.querySelector('#end-input');
const autocompleteState = new Map();

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
let saved = JSON.parse(localStorage.getItem('throne-finder-saved') || '[]').filter(id => String(id).startsWith('osm-'));

const map = L.map('live-map', { zoomControl: false, attributionControl: true }).setView([43.4516, -80.4925], 13);
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
  document.querySelector('.route-submit').disabled = isLoading || !startCoords || !endCoords;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function facilityTags(facility) {
  const tags = [];
  if (/yes|designated|limited|accessible/i.test(facility.accessibility)) tags.push('Accessible');
  if (/yes|limited/i.test(facility.changingTable)) tags.push('Change table');
  if (/yes/i.test(facility.unisex)) tags.push('Gender neutral');
  if (facility.openingHours === '24/7') tags.push('24/7');
  if (facility.fee === 'no') tags.push('Free');
  if (facility.fee === 'yes') tags.push('Fee');
  tags.push(facility.type || 'Public washroom');
  return [...new Set(tags)].slice(0, 4);
}

function statusText(facility) {
  if (/customers/i.test(facility.access)) return 'Customer access';
  if (facility.openingHours) return facility.openingHours === '24/7' ? 'Open 24 hours' : facility.openingHours;
  if (facility.fee === 'yes') return 'Fee may apply · Hours not listed';
  return 'Public washroom · Hours not listed';
}

function updateSaved() {
  localStorage.setItem('throne-finder-saved', JSON.stringify(saved));
  document.querySelectorAll('.saved-count').forEach(el => el.textContent = saved.length);
  const list = document.querySelector('#saved-list');
  const savedFacilities = saved.map(id => facilities.find(item => item.id === id)).filter(Boolean);
  if (!savedFacilities.length) {
    list.innerHTML = '<div class="empty-state"><b>No saved thrones yet</b><span>Search a route, tap any washroom on the live map, then save it for later.</span></div>';
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
  const officialLink = item.url ? `<a class="city-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">OpenStreetMap details ↗</a>` : '';
  detail.innerHTML = `<h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.address || item.location || 'Mapped public washroom')}</p><p>${escapeHtml(statusText(item))}</p><div class="saved-tags">${facilityTags(item).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>${officialLink}<div class="detail-actions"><button class="save-throne" data-save="${item.id}">${saved.includes(item.id) ? 'Saved ✓' : 'Save this throne'}</button><button class="close-detail">Close</button></div>`;
  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');
}

function normalizeOsmFacility(tags, osmType, osmId, lat, lng) {
  const streetAddress = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return {
    id: `osm-${osmType}-${osmId}`,
    name: tags.name || tags.operator || 'Public washroom',
    location: tags.description || '',
    address: streetAddress || tags['addr:full'] || '',
    type: tags.building === 'toilets' ? 'Washroom building' : 'Public washroom',
    accessibility: tags['toilets:wheelchair'] || tags.wheelchair || '',
    changingTable: tags.changing_table || tags['toilets:changing_table'] || '',
    unisex: tags.unisex || tags['toilets:unisex'] || '',
    openingHours: tags.opening_hours || '',
    access: tags.access || 'yes',
    fee: tags.fee || tags['toilets:fee'] || '',
    building: tags.building || '',
    operator: tags.operator || '',
    url: `https://www.openstreetmap.org/${osmType}/${osmId}`,
    lat: Number(lat),
    lng: Number(lng),
  };
}

function routeBounds(route, padding = .025) {
  const latitudes = route.map(point => point[0]);
  const longitudes = route.map(point => point[1]);
  return {
    south: Math.min(...latitudes) - padding,
    west: Math.min(...longitudes) - padding,
    north: Math.max(...latitudes) + padding,
    east: Math.max(...longitudes) + padding,
  };
}

async function queryOverpass(bounds) {
  const query = `[out:json][timeout:15];nwr["amenity"="toilets"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});out center tags;`;
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`OpenStreetMap query returned ${response.status}`);
      const data = await response.json();
      return data.elements.flatMap(element => {
        const lat = element.lat ?? element.center?.lat;
        const lng = element.lon ?? element.center?.lon;
        return Number.isFinite(lat) && Number.isFinite(lng) ? [normalizeOsmFacility(element.tags || {}, element.type, element.id, lat, lng)] : [];
      });
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('OpenStreetMap query failed.');
}

async function queryAmenitiesFallback(bounds) {
  const params = new URLSearchParams({
    where: "amenity='toilets'",
    geometry: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    outSR: '4326',
    returnGeometry: 'true',
    f: 'geojson',
  });
  const response = await fetch(`${OSM_AMENITIES}?${params}`);
  if (!response.ok) throw new Error('The public washroom search is unavailable.');
  const data = await response.json();
  return data.features.map(feature => {
    const p = feature.properties;
    return normalizeOsmFacility({
      name: p.name,
      operator: p.operator,
      access: p.access,
      building: p.building,
      'addr:housenumber': p.addr_housenumber,
      'addr:street': p.addr_street,
    }, 'node', p.osm_id2, feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
  });
}

async function loadFacilitiesForBounds(bounds) {
  let source = 'OpenStreetMap live query';
  try {
    facilities = await queryOverpass(bounds);
  } catch (error) {
    console.warn('Overpass unavailable; using the North America OSM mirror.', error);
    source = 'OpenStreetMap North America mirror';
    facilities = await queryAmenitiesFallback(bounds);
  }
  facilities = [...new Map(facilities.map(item => [item.id, item])).values()];
  document.querySelector('.map-source').textContent = `${facilities.length} washrooms · ${source}`;
  updateSaved();
  return facilities;
}

function activeFilters() {
  return [...document.querySelectorAll('.chip.active')].map(chip => chip.dataset.filter);
}

function passesFilters(item) {
  const filters = activeFilters();
  return (!filters.includes('accessible') || /yes|designated|limited|accessible/i.test(item.accessibility))
    && (!filters.includes('public') || !/private|no|customers/i.test(item.access))
    && (!filters.includes('changing') || /yes|limited/i.test(item.changingTable))
    && (!filters.includes('building') || Boolean(item.building));
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
  const legs = data.trip.legs.map(leg => ({
    coordinates: decodePolyline(leg.shape),
    time: Number(leg.summary.time),
    distance: Number(leg.summary.length),
  }));
  const coordinates = legs.flatMap((leg, index) => index ? leg.coordinates.slice(1) : leg.coordinates);
  return { coordinates, legs, time: data.trip.summary.time, distance: data.trip.summary.length };
}

function comfortMinutes() {
  return Number(document.querySelector('#comfort-range').value);
}

function comfortStatus(seconds) {
  const limit = comfortMinutes() * 60;
  if (seconds <= limit) return 'safe';
  if (seconds <= limit * 1.5) return 'caution';
  return 'danger';
}

function routePointDistance(a, b) {
  return haversine({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
}

function slicePolyline(coordinates, startRatio, endRatio) {
  if (coordinates.length < 2 || endRatio <= startRatio) return [];
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index++) cumulative.push(cumulative[index - 1] + routePointDistance(coordinates[index - 1], coordinates[index]));
  const total = cumulative[cumulative.length - 1];
  if (!total) return coordinates;
  const startDistance = total * startRatio;
  const endDistance = total * endRatio;
  const pointAt = distance => {
    let index = 1;
    while (index < cumulative.length && cumulative[index] < distance) index++;
    if (index >= coordinates.length) return coordinates[coordinates.length - 1];
    const segmentLength = cumulative[index] - cumulative[index - 1];
    const ratio = segmentLength ? (distance - cumulative[index - 1]) / segmentLength : 0;
    return [
      coordinates[index - 1][0] + (coordinates[index][0] - coordinates[index - 1][0]) * ratio,
      coordinates[index - 1][1] + (coordinates[index][1] - coordinates[index - 1][1]) * ratio,
    ];
  };
  const sliced = [pointAt(startDistance)];
  for (let index = 1; index < coordinates.length - 1; index++) {
    if (cumulative[index] > startDistance && cumulative[index] < endDistance) sliced.push(coordinates[index]);
  }
  sliced.push(pointAt(endDistance));
  return sliced;
}

function drawComfortRoute(route) {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = L.featureGroup().addTo(map);
  L.polyline(route.coordinates, { color: '#fffefa', weight: 11, opacity: .94, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
  const limit = comfortMinutes() * 60;
  const colors = { safe: '#3c8f5a', caution: '#e4a72f', danger: '#cf4a3f' };
  route.legs.forEach(leg => {
    const boundaries = [
      { status: 'safe', start: 0, end: Math.min(leg.time, limit) },
      { status: 'caution', start: Math.min(leg.time, limit), end: Math.min(leg.time, limit * 1.5) },
      { status: 'danger', start: Math.min(leg.time, limit * 1.5), end: leg.time },
    ];
    boundaries.filter(part => part.end > part.start).forEach(part => {
      const coordinates = slicePolyline(leg.coordinates, part.start / leg.time, part.end / leg.time);
      if (coordinates.length > 1) L.polyline(coordinates, { color: colors[part.status], weight: 6, opacity: .98, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    });
  });
}

function photonFeatureToLocation(feature) {
  const properties = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  const streetAddress = [properties.housenumber, properties.street].filter(Boolean).join(' ');
  const name = properties.name || streetAddress || properties.city || properties.county || 'Selected location';
  const area = properties.city || properties.town || properties.village || properties.county;
  const labelParts = [name];
  if (streetAddress && streetAddress.toLowerCase() !== name.toLowerCase()) labelParts.push(streetAddress);
  [area, properties.state, properties.country].filter(Boolean).forEach(part => {
    if (!labelParts.some(existing => existing.toLowerCase() === String(part).toLowerCase())) labelParts.push(part);
  });
  return {
    lat: Number(lat),
    lng: Number(lng),
    label: labelParts.join(', '),
    title: name,
    subtitle: labelParts.slice(1).join(', '),
  };
}

async function searchLocations(value, signal, limit = 6) {
  const center = map.getCenter();
  const params = new URLSearchParams({
    q: value.trim(),
    limit: String(limit),
    lang: 'en',
    lat: String(center.lat),
    lon: String(center.lng),
    location_bias_scale: '0.35',
  });
  const response = await fetch(`${PHOTON}?${params}`, { signal });
  if (!response.ok) throw new Error('Location suggestions are unavailable right now.');
  const data = await response.json();
  return (data.features || []).map(photonFeatureToLocation).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function setLocationForInput(input, location) {
  const selected = { ...location, inputValue: location.label };
  if (input === startInput) startCoords = selected;
  else endCoords = selected;
  input.value = location.label;
  const field = input.closest('.location-field');
  field.classList.add('is-selected');
  field.querySelector('.location-status').textContent = '✓ Location selected';
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  const state = autocompleteState.get(input);
  if (state) {
    state.menu.classList.remove('open');
    state.activeIndex = -1;
  }
  document.querySelector('.route-submit').disabled = !startCoords || !endCoords;
}

function setupAutocomplete(input) {
  const field = input.closest('.location-field');
  const menu = field.querySelector('.location-suggestions');
  const status = field.querySelector('.location-status');
  const state = { menu, results: [], activeIndex: -1, timer: null, controller: null };
  autocompleteState.set(input, state);

  const close = () => {
    menu.classList.remove('open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    state.activeIndex = -1;
  };

  const updateActiveOption = () => {
    menu.querySelectorAll('.location-option').forEach((option, index) => {
      const isActive = index === state.activeIndex;
      option.classList.toggle('active', isActive);
      option.setAttribute('aria-selected', String(isActive));
    });
    if (state.activeIndex >= 0) {
      const active = menu.querySelectorAll('.location-option')[state.activeIndex];
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const select = index => {
    const location = state.results[index];
    if (location) setLocationForInput(input, location);
  };

  const render = (results, message = '') => {
    state.results = results;
    state.activeIndex = -1;
    if (message) menu.innerHTML = `<div class="location-suggestions__message">${escapeHtml(message)}</div>`;
    else menu.innerHTML = results.map((item, index) => `<button type="button" class="location-option" id="${menu.id}-option-${index}" role="option" aria-selected="false" data-location-index="${index}"><span class="location-option__pin">⌖</span><span><b>${escapeHtml(item.title)}</b><em>${escapeHtml(item.subtitle || 'Mapped location')}</em></span></button>`).join('');
    menu.classList.add('open');
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', () => {
    if (input === startInput) startCoords = null;
    else endCoords = null;
    document.querySelector('.route-submit').disabled = true;
    field.classList.remove('is-selected');
    status.textContent = input.value.trim().length < 3 ? 'Type at least 3 characters' : 'Choose a suggestion';
    clearTimeout(state.timer);
    state.controller?.abort();
    if (input.value.trim().length < 3) { close(); return; }
    state.timer = setTimeout(async () => {
      state.controller = new AbortController();
      render([], 'Searching locations…');
      try {
        const results = await searchLocations(input.value, state.controller.signal);
        render(results, results.length ? '' : 'No matching locations found. Try adding a city or postal code.');
      } catch (error) {
        if (error.name !== 'AbortError') render([], error.message);
      }
    }, 350);
  });

  input.addEventListener('focus', () => {
    if (state.results.length && !field.classList.contains('is-selected')) {
      menu.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
    }
  });

  input.addEventListener('keydown', event => {
    if (!menu.classList.contains('open') || !state.results.length) {
      if (event.key === 'Escape') close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      state.activeIndex = (state.activeIndex + 1) % state.results.length;
      updateActiveOption();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      state.activeIndex = (state.activeIndex - 1 + state.results.length) % state.results.length;
      updateActiveOption();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(state.activeIndex >= 0 ? state.activeIndex : 0);
    } else if (event.key === 'Escape') close();
  });

  menu.addEventListener('mousedown', event => {
    const option = event.target.closest('[data-location-index]');
    if (!option) return;
    event.preventDefault();
    select(Number(option.dataset.locationIndex));
    input.focus();
  });
  input.addEventListener('blur', () => setTimeout(close, 160));
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
  if (startCoords) L.marker([startCoords.lat, startCoords.lng], { icon: icon('endpoint-pin'), title: 'Route start' }).addTo(endpointLayer);
  if (endCoords) L.marker([endCoords.lat, endCoords.lng], { icon: icon('endpoint-pin endpoint-pin--end'), title: 'Destination' }).addTo(endpointLayer);
  if (userMarker) userMarker.addTo(endpointLayer);
}

function roundedMinutes(seconds) {
  return Math.max(1, Math.round(seconds / 60));
}

function renderItinerary(route, stops) {
  const itinerary = document.querySelector('#route-itinerary');
  const list = document.querySelector('#itinerary-list');
  const limit = comfortMinutes();
  const statusLabels = { safe: 'SAFE', caution: 'CAUTION', danger: 'OVERDUE' };
  const statusColors = { safe: '#3c8f5a', caution: '#e4a72f', danger: '#cf4a3f' };
  const waypoints = [
    { ...startCoords, name: startCoords.title || startCoords.label.split(',')[0], kind: 'start' },
    ...stops.map(stop => ({ ...stop, kind: 'washroom' })),
    { ...endCoords, name: endCoords.title || endCoords.label.split(',')[0], kind: 'destination' },
  ];
  let elapsed = 0;
  list.innerHTML = waypoints.map((point, index) => {
    const incoming = index ? route.legs[index - 1] : null;
    const next = route.legs[index];
    if (incoming) elapsed += incoming.time;
    const arrivalStatus = incoming ? comfortStatus(incoming.time) : 'safe';
    const nextStatus = next ? comfortStatus(next.time) : arrivalStatus;
    const badge = index === 0 ? 'START' : statusLabels[arrivalStatus];
    const marker = index === 0 ? 'S' : index === waypoints.length - 1 ? '◆' : String(index);
    const timing = index === 0 ? 'Depart now' : `ETA ${roundedMinutes(elapsed)} min · ${roundedMinutes(incoming.time)} min since last stop`;
    let nextText = '';
    if (next) {
      const nextName = index === waypoints.length - 2 ? 'destination' : 'next washroom';
      nextText = `${nextName.charAt(0).toUpperCase() + nextName.slice(1)} in ${roundedMinutes(next.time)} min`;
      if (next.time > limit * 60) nextText += ` · ${roundedMinutes(next.time - limit * 60)} min over limit`;
    }
    return `<li class="itinerary-stop ${arrivalStatus} ${point.kind}" style="--next-color:${statusColors[nextStatus]}"><span class="itinerary-stop__marker">${marker}</span><div class="itinerary-stop__copy"><button type="button" data-itinerary-index="${index}" data-lat="${point.lat}" data-lng="${point.lng}"${point.id ? ` data-facility-id="${escapeHtml(point.id)}"` : ''}>${escapeHtml(point.name)}</button><span>${timing}</span>${nextText ? `<small>${nextText}</small>` : ''}</div><b class="itinerary-stop__badge">${badge}</b></li>`;
  }).join('');
  document.querySelector('#itinerary-limit').textContent = `${limit} min limit`;
  itinerary.hidden = false;
}

function updateSummary(route, stops) {
  document.querySelector('#route-time').textContent = `${Math.max(1, Math.round(route.time / 60))} min`;
  document.querySelector('#route-stop-count').textContent = String(stops.length);
  document.querySelector('#route-distance').textContent = `${route.distance.toFixed(1)} km`;
  const preview = document.querySelector('.stop-preview');
  const limit = comfortMinutes();
  const worstLeg = route.legs.reduce((worst, leg) => leg.time > worst.time ? leg : worst, route.legs[0]);
  const severity = comfortStatus(worstLeg.time);
  const longest = Math.max(1, Math.ceil(worstLeg.time / 60));
  const overdue = Math.max(1, Math.ceil((worstLeg.time - limit * 60) / 60));
  preview.className = `stop-preview route-alert ${severity}`;
  if (severity === 'safe') {
    preview.innerHTML = `<span class="stop-number">✓</span><div><b>Every stop is within your ${limit} min range</b><span>Longest stretch between safe stops: ${longest} min</span></div><span class="rating">SAFE</span>`;
  } else if (severity === 'caution') {
    preview.innerHTML = `<span class="stop-number">!</span><div><b>A stretch enters the caution zone</b><span>Longest stretch: ${longest} min · ${overdue} min over your range</span></div><span class="rating">CAUTION</span>`;
  } else {
    preview.innerHTML = `<span class="stop-number">!</span><div><b>Warning: a stretch exceeds the safe window</b><span>Longest stretch: ${longest} min · ${overdue} min over your range</span></div><span class="rating">OVERDUE</span>`;
  }
  renderItinerary(route, stops);
  document.querySelector('#route-summary').classList.add('ready');
  document.querySelector('#route-summary').classList.remove('hidden');
}

async function planRoute() {
  if (!startCoords || !endCoords) {
    showToast('Choose both locations from the suggestions first.');
    return;
  }
  setLoading(true);
  try {
    const directRoute = await getWalkingRoute([startCoords, endCoords]);
    await loadFacilitiesForBounds(routeBounds(directRoute.coordinates));
    const stops = chooseRouteStops(directRoute.coordinates);
    const finalRoute = stops.length ? await getWalkingRoute([startCoords, ...stops, endCoords]) : directRoute;
    currentRoute = finalRoute;
    currentRouteStops = stops;

    drawComfortRoute(finalRoute);
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

document.querySelector('#comfort-range').addEventListener('input', event => {
  document.querySelector('#range-output').textContent = `${event.target.value} min`;
  if (currentRoute) {
    drawComfortRoute(currentRoute);
    updateSummary(currentRoute, currentRouteStops);
  }
});
document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('active')));
document.querySelector('#clear-filters').addEventListener('click', () => document.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active')));

document.querySelector('#locate-button').addEventListener('click', () => {
  startInput.value = 'Finding your location…';
  startCoords = null;
  startInput.closest('.location-field').classList.remove('is-selected');
  startInput.closest('.location-field').querySelector('.location-status').textContent = 'Waiting for browser location permission';
  document.querySelector('.route-submit').disabled = true;
  if (!navigator.geolocation) { startInput.value = 'Current location unavailable'; showToast('Location is not available in this browser'); return; }
  navigator.geolocation.getCurrentPosition(position => {
    setLocationForInput(startInput, { lat: position.coords.latitude, lng: position.coords.longitude, label: 'Current location' });
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([startCoords.lat, startCoords.lng], { icon: icon('user-pin'), title: 'Your location' }).addTo(map);
    map.setView([startCoords.lat, startCoords.lng], 15);
    showToast('Current location added');
  }, () => {
    setLocationForInput(startInput, DEFAULT_START);
    showToast('We could not access your location. Enter an address instead.');
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
});

setupAutocomplete(startInput);
setupAutocomplete(endInput);
document.querySelector('#route-form').addEventListener('submit', event => { event.preventDefault(); planRoute(); });
document.querySelector('#itinerary-list').addEventListener('click', event => {
  const waypoint = event.target.closest('[data-itinerary-index]');
  if (!waypoint) return;
  map.flyTo([Number(waypoint.dataset.lat), Number(waypoint.dataset.lng)], Math.max(map.getZoom(), 16));
  if (waypoint.dataset.facilityId) openDetail(waypoint.dataset.facilityId);
});

document.querySelectorAll('.map-mode').forEach(button => button.addEventListener('click', async () => {
  document.querySelectorAll('.map-mode').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  currentMode = button.dataset.mode;
  try {
    if (currentMode === 'nearby') {
      const bounds = map.getBounds();
      setLoading(true, 'Searching this map area…');
      await loadFacilitiesForBounds({ south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() });
      renderNearbyMarkers();
    } else {
      renderRouteMarkers(currentRouteStops);
    }
  } catch (error) { showToast(error.message); }
  finally { setLoading(false); }
}));

map.on('moveend', () => {
  if (currentMode !== 'nearby') return;
  clearTimeout(map.refreshTimer);
  map.refreshTimer = setTimeout(async () => {
    const bounds = map.getBounds();
    try {
      await loadFacilitiesForBounds({ south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() });
      renderNearbyMarkers();
    } catch (error) { showToast(error.message); }
  }, 700);
});
map.on('click', event => {
  setLocationForInput(endInput, { lat: event.latlng.lat, lng: event.latlng.lng, label: 'Dropped pin' });
  renderEndpoints();
  showToast('Destination pin placed');
});

document.querySelector('.recenter').addEventListener('click', () => {
  if (routeLayer) map.fitBounds(routeLayer.getBounds(), { padding: [55, 55] });
  else map.setView([43.4516, -80.4925], 13);
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
const demoParams = new URLSearchParams(window.location.search);
if (demoParams.has('planner')) showPlanner();
if (demoParams.has('route') || window.location.search.includes('route=1')) setTimeout(planRoute, 300);
