const thrones = [
  { id: 0, name: 'David Pecaut Square', note: '8 min away · Open until 10 PM', rating: '4.9', tags: ['Accessible', 'Staffed', 'Very clean'] },
  { id: 1, name: 'Nathan Phillips Square', note: '11 min after stop 1 · Open 24 hours', rating: '4.7', tags: ['Accessible', 'Gender neutral', '24/7'] },
  { id: 2, name: 'St. Lawrence Market', note: '9 min after stop 2 · Open until 7 PM', rating: '4.8', tags: ['Accessible', 'Change table', 'Staffed'] },
];

const planner = document.querySelector('#planner');
const drawer = document.querySelector('#saved-drawer');
const backdrop = document.querySelector('.drawer-backdrop');
const detail = document.querySelector('#detail-card');
const toast = document.querySelector('.toast');
let saved = JSON.parse(localStorage.getItem('throne-finder-saved') || '[]');

function showPlanner() {
  planner.classList.add('open');
  planner.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
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
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function updateSaved() {
  localStorage.setItem('throne-finder-saved', JSON.stringify(saved));
  document.querySelectorAll('.saved-count').forEach(el => el.textContent = saved.length);
  const list = document.querySelector('#saved-list');
  if (!saved.length) {
    list.innerHTML = '<div class="empty-state"><b>No saved thrones yet</b><span>Tap any numbered stop on the map, then save it for later.</span></div>';
    return;
  }
  list.innerHTML = saved.map(id => {
    const t = thrones.find(item => item.id === id);
    return `<article class="saved-item"><div class="saved-item__top"><div><h3>${t.name}</h3><p>★ ${t.rating} · ${t.note.split('·')[1]}</p></div><button data-remove="${t.id}" aria-label="Remove ${t.name}">×</button></div><div class="saved-tags">${t.tags.map(tag => `<span>${tag}</span>`).join('')}</div></article>`;
  }).join('');
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
  const t = thrones[id];
  detail.innerHTML = `<h3>${t.name}</h3><p>★ ${t.rating} · ${t.note}</p><div class="saved-tags">${t.tags.map(tag => `<span>${tag}</span>`).join('')}</div><div class="detail-actions"><button class="save-throne" data-save="${id}">${saved.includes(id) ? 'Saved ✓' : 'Save this throne'}</button><button class="close-detail">Close</button></div>`;
  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');
}

document.querySelectorAll('[data-open-planner]').forEach(button => button.addEventListener('click', showPlanner));
document.querySelector('.planner-close').addEventListener('click', closePlanner);
document.querySelector('#how-it-works').addEventListener('click', () => document.querySelector('#about').scrollIntoView());
document.querySelectorAll('[data-open-saved]').forEach(button => button.addEventListener('click', openDrawer));
document.querySelector('.drawer-close').addEventListener('click', closeDrawer);
backdrop.addEventListener('click', closeDrawer);

document.querySelector('#comfort-range').addEventListener('input', event => {
  document.querySelector('#range-output').textContent = `${event.target.value} min`;
  document.querySelector('#route-time').textContent = `${Math.round(22 + Number(event.target.value) * .6)} min`;
});

document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('active')));
document.querySelector('#clear-filters').addEventListener('click', () => document.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active')));

document.querySelector('#locate-button').addEventListener('click', () => {
  const input = document.querySelector('#start-input');
  input.value = 'Finding your location…';
  if (!navigator.geolocation) { input.value = 'Current location'; return; }
  navigator.geolocation.getCurrentPosition(
    () => { input.value = 'Current location'; showToast('Location added to your route'); },
    () => { input.value = 'Current location'; showToast('Using an approximate starting point'); },
    { timeout: 4000 }
  );
});

document.querySelector('#route-form').addEventListener('submit', event => {
  event.preventDefault();
  const summary = document.querySelector('#route-summary');
  summary.classList.remove('hidden');
  document.querySelector('.map-panel').scrollIntoView({ behavior: 'smooth' });
  showToast('3 dependable stops found');
});

document.querySelectorAll('.map-mode').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.map-mode').forEach(b => b.classList.remove('active'));
  button.classList.add('active');
  document.querySelector('.route-path').style.opacity = button.dataset.mode === 'nearby' ? '.25' : '1';
}));

document.querySelector('.recenter').addEventListener('click', () => showToast('Route centred'));
document.querySelector('.summary-close').addEventListener('click', () => document.querySelector('#route-summary').classList.add('hidden'));
document.querySelector('#start-route').addEventListener('click', () => showToast('Route started — first stop in 8 minutes'));
document.querySelectorAll('.throne-pin').forEach(pin => pin.addEventListener('click', () => openDetail(Number(pin.dataset.throne))));

detail.addEventListener('click', event => {
  if (event.target.matches('.close-detail')) {
    detail.classList.remove('open');
    detail.setAttribute('aria-hidden', 'true');
  }
  if (event.target.matches('[data-save]')) {
    const id = Number(event.target.dataset.save);
    if (!saved.includes(id)) {
      saved.push(id);
      updateSaved();
      event.target.textContent = 'Saved ✓';
      showToast('Throne saved for later');
    }
  }
});

document.querySelector('#saved-list').addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  saved = saved.filter(id => id !== Number(button.dataset.remove));
  updateSaved();
  showToast('Removed from saved thrones');
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (drawer.classList.contains('open')) closeDrawer();
  else if (detail.classList.contains('open')) detail.classList.remove('open');
  else if (planner.classList.contains('open')) closePlanner();
});

updateSaved();
