// Boot, splash, auth, profile picker, onboarding, router, nav, search and the greeting.
import {
  $, $$, esc, toast, sleep, debounce, paintAvatar, avatarInner, catSlug, AVATAR_COLORS, AVATAR_EMOJIS,
} from './utils.js';
import { initAuth, sb, getSession, signIn, signUp, signOut, loadProfile, updateProfile } from './auth.js';
import {
  state, health, home, categoryPage, itemsByIds, recommend, loadInteractions, logSearch,
  loadViewers, createViewer, updateViewer, deleteViewer, rememberViewer, rememberedViewer,
} from './api.js';
import {
  bindGlobalEvents, renderRows, rowsSkeleton, renderChips, runSearch, setQuery, grid, renderGrid,
  skeletonCards, emptyHTML, openDetail, renderHow, renderHero, heroSkeleton, stopHero, cardHTML,
  openModal, closeModal, itemCache,
} from './ui.js';
import { initRobot, hideRobot, say } from './robot.js';
import { renderProfile } from './profile.js';
import { renderAdmin, setCatalogChangeHandler } from './admin.js';
import { playIntro, soundOn, setSound } from './sound.js';

const INTERESTS = ['Movies', 'Books', 'Python', 'AI', 'Space', 'Psychology', 'Design', 'Gaming', 'Music',
  'Business', 'Science', 'Programming', 'Mathematics', 'Cooking', 'Data Science', 'Startups', 'Sports', 'History'];
const ROUTES = ['home', 'foryou', 'explore', 'search', 'mylist', 'likes', 'profile', 'how', 'admin'];
const VIEW_OF = { explore: 'search' };
const HERO_VIEWS = ['home', 'category'];

let homeCache = null;
const categoryCache = new Map();
let greetTimers = [];
let started = false;
let lastRoute = '';
let onboardMode = 'first';

// ================================================================== screens
function show(id) {
  ['setup', 'auth', 'picker', 'onboarding', 'app'].forEach((s) => { $(`#${s}`).hidden = s !== id; });
  if (id !== 'app') { stopHero(); hideRobot(); stopGreeting(); started = false; }
}

// ================================================================== splash
async function splash(task) {
  let first = true;
  try { first = !sessionStorage.getItem('edr-splash'); sessionStorage.setItem('edr-splash', '1'); } catch { /* private mode */ }
  if (!first) return task(() => {});
  const el = $('#splash');
  el.hidden = false;
  const bar = $('#splash-bar');
  const progress = (p, text) => {
    bar.style.transform = `scaleX(${p})`;
    $('.progress', el).setAttribute('aria-valuenow', Math.round(p * 100));
    if (text) $('#splash-status').textContent = text;
  };
  const t0 = performance.now();
  requestAnimationFrame(() => progress(0.18));
  const result = await task(progress);
  progress(1, 'Ready');
  await sleep(Math.max(0, 1800 - (performance.now() - t0)));
  el.classList.add('done');
  setTimeout(() => { el.hidden = true; el.classList.remove('done'); }, 460);
  return result;
}

// ================================================================== auth
function showAuth(message) {
  state.viewer = null;
  show('auth');
  setAuthTab('login');
  if (message) toast(message, 'error');
}

function setAuthTab(tab) {
  $('.seg').dataset.active = tab;
  $$('[data-auth-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.authTab === tab));
  $$('.signup-only').forEach((el) => { el.hidden = tab !== 'signup'; });
  $('#auth-submit').textContent = tab === 'signup' ? 'Create account' : 'Log in';
  $('#auth-form [name=password]').autocomplete = tab === 'signup' ? 'new-password' : 'current-password';
  $('#auth-error').textContent = '';
}

function bindAuth() {
  $$('[data-auth-tab]').forEach((b) => b.addEventListener('click', () => setAuthTab(b.dataset.authTab)));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const mode = $('.seg').dataset.active;
    const email = form.email.value.trim();
    const password = form.password.value;
    const error = $('#auth-error');
    error.textContent = '';
    if (!/^\S+@\S+\.\S+$/.test(email)) { error.textContent = 'Please enter a valid email address.'; return; }
    if (password.length < 6) { error.textContent = 'Password must be at least 6 characters.'; return; }
    const btn = $('#auth-submit');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const session = mode === 'signup'
        ? await signUp(form.name.value.trim(), email, password)
        : await signIn(email, password);
      if (!session) {
        setAuthTab('login');
        toast('Account created! Check your email to confirm, then log in.', 'success', 6000);
      } else {
        form.reset();
        await enterApp(session, { fresh: true });
      }
    } catch (err) {
      error.textContent = err.message;
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
}

// ================================================================== account → profile
async function enterApp(session, { fresh = false } = {}) {
  state.user = session.user;
  try {
    state.profile = await loadProfile(session.user.id);
    await loadViewers();
  } catch {
    await signOut();
    showAuth('Couldn’t load your account. Has the database schema been set up?');
    return;
  }
  if (!state.viewers.length) { showOnboarding('first'); return; }
  const remembered = state.viewers.find((v) => v.id === rememberedViewer());
  if (!fresh && remembered) selectViewer(remembered);
  else showPicker();
}

// ================================================================== profile picker
function showPicker() {
  show('picker');
  $('#picker-root').classList.remove('managing');
  $('#manage-profiles').setAttribute('aria-pressed', 'false');
  $('#manage-profiles').textContent = 'Manage profiles';
  renderPicker();
}

function renderPicker() {
  const managing = $('#picker-root').classList.contains('managing');
  const tiles = state.viewers.map((v) => `
    <button class="picker-tile" data-viewer="${esc(v.id)}" aria-label="${managing ? 'Edit' : 'Explore as'} ${esc(v.name)}">
      <span class="av ${AVATAR_COLORS.includes(v.color) ? v.color : 'violet'}">${avatarInner(v)}</span>
      <span class="edit-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></span>
      <b>${esc(v.name)}</b>
    </button>`).join('');
  const add = state.viewers.length < 5 && !managing
    ? `<button class="picker-tile add" data-add-viewer aria-label="Add profile"><span class="av">＋</span><b>Add profile</b></button>` : '';
  $('#picker-grid').innerHTML = tiles + add;
  $('#picker-grid').classList.add('stagger');
}

function bindPicker() {
  $('#picker-grid').addEventListener('click', (e) => {
    if (e.target.closest('[data-add-viewer]')) { showOnboarding('add'); return; }
    const tile = e.target.closest('[data-viewer]');
    if (!tile) return;
    const viewer = state.viewers.find((v) => v.id === tile.dataset.viewer);
    if ($('#picker-root').classList.contains('managing')) openProfileEditor(viewer);
    else { playIntro(); selectViewer(viewer); }
  });
  $('#manage-profiles').addEventListener('click', (e) => {
    const on = $('#picker-root').classList.toggle('managing');
    e.currentTarget.setAttribute('aria-pressed', on);
    e.currentTarget.textContent = on ? 'Done' : 'Manage profiles';
    renderPicker();
  });
}

function avatarPickerHTML(selected = {}) {
  return `<div class="emoji-grid" data-emoji-grid role="group" aria-label="Avatar">${AVATAR_EMOJIS.map((em) =>
    `<button type="button" data-emoji="${em}" aria-pressed="${(selected.avatar || '') === em}" aria-label="${em || 'Initials'}">${em || 'Aa'}</button>`).join('')}</div>
    <div class="swatches" data-swatches role="group" aria-label="Avatar colour">${AVATAR_COLORS.map((c) =>
    `<button type="button" class="av ${c}" data-color="${c}" aria-pressed="${(selected.color || 'violet') === c}" aria-label="${c}"></button>`).join('')}</div>`;
}

function bindAvatarPicker(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji], [data-color]');
    if (!b) return;
    const group = b.parentElement;
    $$('button', group).forEach((x) => x.setAttribute('aria-pressed', x === b));
  });
}
const pickedAvatar = (root) => ({
  avatar: $('[data-emoji][aria-pressed="true"]', root)?.dataset.emoji || '',
  color: $('[data-color][aria-pressed="true"]', root)?.dataset.color || 'violet',
});

function openProfileEditor(viewer) {
  openModal(`<div class="modal-pad">
    <h2 id="modal-title">Edit profile</h2>
    <form id="profile-editor" class="stack" style="margin-top:18px">
      <label class="field"><span>Name</span><input name="name" maxlength="40" value="${esc(viewer.name)}" required></label>
      <div class="field"><span>Avatar</span>${avatarPickerHTML(viewer)}</div>
      <p class="form-error" id="editor-error" role="alert"></p>
      <div class="row-between">
        <button type="button" class="btn danger" id="delete-viewer" ${state.viewers.length < 2 ? 'disabled title="You need at least one profile"' : ''}>Delete profile</button>
        <button class="btn primary">Save changes</button>
      </div>
    </form></div>`);
  const form = $('#profile-editor');
  bindAvatarPicker(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim();
    if (!name) { $('#editor-error').textContent = 'Give the profile a name.'; return; }
    try {
      await updateViewer(viewer.id, { name, ...pickedAvatar(form) });
      closeModal(); renderPicker(); toast('Profile saved', 'success');
    } catch (err) { $('#editor-error').textContent = err.message; }
  });
  $('#delete-viewer').addEventListener('click', async () => {
    if (!confirm(`Delete “${viewer.name}”? Its likes, saves and history are deleted too.`)) return;
    try {
      await deleteViewer(viewer.id);
      closeModal(); renderPicker(); toast('Profile deleted');
    } catch (err) { $('#editor-error').textContent = err.message; }
  });
}

async function selectViewer(viewer) {
  state.viewer = viewer;
  rememberViewer(viewer.id);
  homeCache = null;
  categoryCache.clear();
  await startApp();
}

// ================================================================== onboarding (first profile or a new one)
function showOnboarding(mode) {
  onboardMode = mode;
  show('onboarding');
  const form = $('#onboard-form');
  form.reset();
  form.name.value = mode === 'first' ? (state.user.user_metadata?.name || '') : '';
  $('#ob-emojis').innerHTML = AVATAR_EMOJIS.map((em, i) =>
    `<button type="button" data-emoji="${em}" aria-pressed="${i === 0}" aria-label="${em || 'Initials'}">${em || 'Aa'}</button>`).join('');
  $('#ob-colors').innerHTML = AVATAR_COLORS.map((c, i) =>
    `<button type="button" class="av ${c}" data-color="${c}" aria-pressed="${i === state.viewers.length % AVATAR_COLORS.length}" aria-label="${c}"></button>`).join('');
  $('#interest-chips').innerHTML = INTERESTS.map((t) =>
    `<button type="button" class="chip" aria-pressed="false" data-interest="${esc(t)}">${esc(t)}</button>`).join('');
  $('#ob-back')?.remove();
  if (mode === 'add') {
    $('.steps').insertAdjacentHTML('beforebegin', '<button type="button" class="btn ghost sm" id="ob-back" style="margin-bottom:18px">← Back to profiles</button>');
    $('#ob-back').addEventListener('click', showPicker);
  }
  goStep(0);
  setTimeout(() => form.name.focus(), 100);
}

function goStep(n) {
  $$('.ob-step').forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === n));
  $$('.steps i').forEach((dot, i) => dot.classList.toggle('on', i <= n));
  const form = $('#onboard-form');
  if (n === 2) $('#ob-ready').textContent = `You're all set, ${form.name.value.trim()}!`;
  setTimeout(() => $(`.ob-step[data-step="${n}"] input, .ob-step[data-step="${n}"] [type=submit]`)?.focus(), 60);
}

const currentStep = () => Number($('.ob-step.active').dataset.step);

function nextStep() {
  const form = $('#onboard-form');
  if (currentStep() === 0 && !form.name.value.trim()) { toast('Tell us your name first 🙂'); form.name.focus(); return; }
  if (currentStep() < 2) goStep(currentStep() + 1);
}

function bindOnboarding() {
  const form = $('#onboard-form');
  bindAvatarPicker(form);
  $('#interest-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-interest]');
    if (chip) chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
  });
  $$('[data-next]').forEach((b) => b.addEventListener('click', nextStep));
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && currentStep() < 2 && e.target.tagName === 'INPUT') { e.preventDefault(); nextStep(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const picked = $$('#interest-chips [aria-pressed="true"]').map((c) => c.dataset.interest);
    const custom = form.custom.value.split(',').map((s) => s.trim()).filter(Boolean);
    const name = form.name.value.trim().slice(0, 40);
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.classList.add('loading');
    try {
      playIntro();
      const viewer = await createViewer({ name, interests: [...new Set([...picked, ...custom])].slice(0, 30), ...pickedAvatar(form) });
      if (onboardMode === 'first' && !state.profile.onboarded) {
        state.profile = await updateProfile(state.user.id, { name, onboarded: true }).catch(() => state.profile);
      }
      await selectViewer(viewer);
    } catch (err) {
      toast(err.message || 'Couldn’t create the profile.', 'error');
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
}

// ================================================================== app
async function startApp() {
  show('app');
  started = true;
  homeCache = null;
  categoryCache.clear();
  state.rowsStale = true;
  grid.query = ''; grid.category = 'All';
  $('#search-input').value = '';
  paintAvatar($('#nav-avatar'), state.viewer);
  paintAvatar($('#menu-avatar'), state.viewer);
  $('#menu-name').textContent = state.viewer.name;
  $('#menu-email').textContent = state.user.email || '';
  $$('.admin-only').forEach((el) => { el.hidden = !state.profile.is_admin; });
  try { await loadInteractions(); } catch { toast('Couldn’t load your history.', 'error'); }
  const h = await health();
  if (h.status === 'offline') toast("Can't reach the EDRecommend server. It may be waking up — give it a minute.", 'error', 7000);
  else if (h.status !== 'ok') toast(h.message || 'The server is not fully set up yet.', 'error', 6000);
  state.categories = ['All', ...(h.categories || [])];
  state.categoryCounts = h.category_counts || {};
  state.weights = h.weights || null;
  renderChips();
  initRobot(surprise);
  lastRoute = '';
  route();
}

async function surprise() {
  const { items } = await recommend('', 'All', 0, 12);
  if (!items.length) throw new Error('empty');
  const pick = items[Math.floor(Math.random() * items.length)];
  itemCache.set(pick.id, pick);
  await openDetail(pick.id);
}

async function loadHome() {
  const heroEl = $('#home-hero');
  const rowsEl = $('#home-rows');
  if (homeCache && !state.rowsStale) {
    renderHero(heroEl, homeCache.hero);
    renderRows(rowsEl, homeCache.rows);
    return;
  }
  heroSkeleton(heroEl);
  rowsEl.innerHTML = rowsSkeleton(3);
  try {
    const data = await home();
    homeCache = data;
    state.rowsStale = false;
    renderHero(heroEl, data.hero);
    if (!data.rows.length) {
      rowsEl.innerHTML = emptyHTML('📭', 'The catalog is empty', 'Run the server once to load the datasets, or import one from the admin panel.');
      return;
    }
    renderRows(rowsEl, data.rows);
  } catch (err) {
    heroEl.hidden = true;
    rowsEl.innerHTML = `<div class="page">${emptyHTML('📡', 'Couldn’t load your recommendations', err.message, '<button class="btn primary" data-retry>Try again</button>')}</div>`;
    $('[data-retry]', rowsEl)?.addEventListener('click', loadHome);
  }
}

async function loadCategory(category) {
  const heroEl = $('#cat-hero');
  const rowsEl = $('#cat-rows');
  $('#cat-filter').hidden = true;
  rowsEl.hidden = false;
  const cached = categoryCache.get(category);
  const paint = (data) => {
    renderHero(heroEl, data.hero);
    $('#cat-tags').innerHTML = ['All', ...data.tags].map((t, i) =>
      `<button class="chip" data-cat-tag="${esc(i ? t : '')}" aria-pressed="${i === 0}">${esc(i ? t : `All ${category}`)}</button>`).join('');
    renderRows(rowsEl, data.rows);
  };
  if (cached && !state.rowsStale) { paint(cached); return; }
  heroSkeleton(heroEl);
  $('#cat-tags').innerHTML = '';
  rowsEl.innerHTML = rowsSkeleton(3);
  try {
    const data = await categoryPage(category);
    categoryCache.set(category, data);
    paint(data);
  } catch (err) {
    heroEl.hidden = true;
    rowsEl.innerHTML = `<div class="page">${emptyHTML('📡', 'Couldn’t load this category', err.message)}</div>`;
  }
}

async function filterCategoryByTag(category, tag) {
  $$('[data-cat-tag]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.catTag === tag));
  const filter = $('#cat-filter');
  if (!tag) { filter.hidden = true; $('#cat-rows').hidden = false; return; }
  $('#cat-rows').hidden = true;
  filter.hidden = false;
  $('#cat-filter-title').textContent = `${category} · ${tag}`;
  const gridEl = $('#cat-grid');
  gridEl.innerHTML = skeletonCards(12);
  try {
    const { items } = await recommend(tag, category, 0, 36);
    if (items.length) renderGrid(gridEl, items);
    else gridEl.innerHTML = emptyHTML('🔭', 'Nothing tagged like that', 'Try another tag.');
  } catch (err) { gridEl.innerHTML = emptyHTML('📡', 'Something went wrong', err.message); }
}

async function loadMyList() {
  const el = $('#mylist-grid');
  const ids = [...state.saves];
  if (!ids.length) {
    el.innerHTML = emptyHTML('🔖', 'Your list is empty', 'Press ＋ on anything you want to come back to — it lands here.', '<a class="btn primary" href="#/home">Find something</a>');
    return;
  }
  el.innerHTML = skeletonCards(Math.min(ids.length, 12));
  try {
    const { items } = await itemsByIds(ids);
    const sort = $('#mylist-sort').value;
    const sorters = {
      recent: (a, b) => String(state.savedAt.get(b.id) || '').localeCompare(String(state.savedAt.get(a.id) || '')),
      rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1),
      match: (a, b) => b.match_percent - a.match_percent,
    };
    renderGrid(el, items.sort(sorters[sort]), { removable: 'save' });
  } catch (err) {
    el.innerHTML = emptyHTML('📡', 'Couldn’t load your list', err.message);
  }
}

async function loadLikes() {
  const el = $('#likes-grid');
  const ids = [...state.loves, ...state.likes];
  if (!ids.length) {
    el.innerHTML = emptyHTML('👍', 'Nothing rated yet', 'Rate things 👍 Like or 💖 Love and they show up here.', '<a class="btn primary" href="#/home">Start exploring</a>');
    return;
  }
  el.innerHTML = skeletonCards(Math.min(ids.length, 12));
  try {
    const { items } = await itemsByIds(ids);
    el.classList.add('stagger');
    el.innerHTML = items.map((it, i) => cardHTML(it, i, { removable: state.loves.has(it.id) ? 'love' : 'like' })).join('');
    items.forEach((it) => itemCache.set(it.id, it));
  } catch (err) {
    el.innerHTML = emptyHTML('📡', 'Couldn’t load your ratings', err.message);
  }
}

async function loadForYou() {
  const el = $('#foryou-rows');
  if (!homeCache || state.rowsStale) {
    el.innerHTML = rowsSkeleton(3);
    try { homeCache = await home(); state.rowsStale = false; } catch (err) { el.innerHTML = emptyHTML('📡', 'Couldn’t load recommendations', err.message); return; }
  }
  renderRows(el, homeCache.rows);
}

// ================================================================== router
function parseRoute() {
  let name = location.hash.replace('#/', '') || 'home';
  let category = null;
  if (name.startsWith('c/')) {
    category = state.categories.find((c) => c !== 'All' && catSlug(c) === name.slice(2));
    name = category ? 'category' : 'home';
  }
  if (!ROUTES.includes(name) && name !== 'category') name = 'home';
  if (name === 'admin' && !state.profile?.is_admin) name = 'home';
  return { name, category, key: category ? `c/${catSlug(category)}` : name };
}

function route() {
  if (!started) return;
  const { name, category, key } = parseRoute();
  if (key === lastRoute && name !== 'search' && name !== 'explore') return;
  const leavingSearch = (lastRoute === 'search' || lastRoute === 'explore') && name !== 'search' && name !== 'explore';
  lastRoute = key;
  const view = VIEW_OF[name] || name;
  stopHero();
  closeModal();
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  $$('[data-route]').forEach((a) => {
    const on = a.dataset.route === key;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#avatar-menu').hidden = true;
  $('#avatar-btn').setAttribute('aria-expanded', 'false');
  if (leavingSearch) closeSearch({ clear: true });
  updateNav();
  window.scrollTo({ top: 0 });
  if (name !== 'home') stopGreeting();

  ({
    home: () => { loadHome(); showGreeting(); },
    category: () => loadCategory(category),
    foryou: loadForYou,
    explore: () => { grid.query = ''; grid.category = 'All'; renderChips(); runSearch({ announce: false }); },
    search: () => { renderChips(); runSearch({ announce: !!grid.query }); },
    mylist: loadMyList,
    likes: loadLikes,
    profile: () => renderProfile(() => { paintAvatar($('#nav-avatar'), state.viewer); paintAvatar($('#menu-avatar'), state.viewer); $('#menu-name').textContent = state.viewer.name; }),
    how: renderHow,
    admin: renderAdmin,
  })[name]();
}

const navigate = (name) => { location.hash = `#/${name}`; };

/** Transparent over a hero, solid with blur after 60px or on pages without a hero. */
function updateNav() {
  const view = $('.view.active')?.dataset.view;
  $('#topnav').classList.toggle('solid', scrollY > 60 || !HERO_VIEWS.includes(view));
}

// ================================================================== greeting
function stopGreeting() { greetTimers.forEach(clearTimeout); greetTimers = []; const g = $('#greeting'); if (g) g.innerHTML = ''; }

function showGreeting() {
  stopGreeting();
  const name = state.viewer?.name || 'there';
  const el = $('#greeting');
  el.innerHTML = `<span class="hi">Hi, ${esc(name)} <span class="wave" aria-hidden="true">👋</span></span>`;
  greetTimers.push(setTimeout(() => el.firstElementChild?.classList.add('out'), 4000));
  greetTimers.push(setTimeout(() => { el.innerHTML = ''; }, 4500));
}

// ================================================================== search
function openSearch() {
  const box = $('#nav-search');
  box.classList.add('open');
  $('#search-toggle').setAttribute('aria-expanded', 'true');
  const input = $('#search-input');
  input.tabIndex = 0;
  setTimeout(() => input.focus(), 30);
}

function closeSearch({ clear = false } = {}) {
  const input = $('#search-input');
  if (clear) { input.value = ''; grid.query = ''; }
  if (input.value) return;
  $('#nav-search').classList.remove('open');
  $('#search-toggle').setAttribute('aria-expanded', 'false');
  input.tabIndex = -1;
}

const logLater = debounce((q) => setQuery(q, { log: true }), 1500);

function onSearchInput(value) {
  setQuery(value);
  logLater(value);
  if (!location.hash.startsWith('#/search')) navigate('search');
  else runSearch({ announce: false });
}

function bindSearch() {
  const input = $('#search-input');
  const live = debounce(() => onSearchInput(input.value), 300);
  $('#search-toggle').addEventListener('click', openSearch);
  input.addEventListener('input', live);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      input.value = '';
      setQuery('');
      closeSearch();
      if (location.hash.startsWith('#/search')) runSearch({ announce: false });
      input.blur();
    }
  });
  $('#nav-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) { toast('Type what you’re looking for — e.g. “space movies” or “learn python”.'); say('Tell me what you’re curious about! ✍️'); return; }
    setQuery(q, { log: true });
    if (!location.hash.startsWith('#/search')) navigate('search'); else runSearch();
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!input.value) closeSearch(); }, 150));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-search]')) { navigate('search'); openSearch(); }
  });
  document.addEventListener('edr:search', (e) => {
    input.value = e.detail;
    openSearch();
    setQuery(e.detail, { log: true });
    if (!location.hash.startsWith('#/search')) navigate('search'); else runSearch();
  });
}

// ================================================================== chrome
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('edr-theme', next); } catch { /* private mode */ }
  if (location.hash === '#/profile') { lastRoute = ''; route(); }
}

function paintSoundToggle() {
  const b = $('[data-sound-toggle]');
  if (b) b.textContent = soundOn() ? '🔊 Intro sound: on' : '🔇 Intro sound: off';
}

function bindChrome() {
  paintSoundToggle();
  $('#theme-toggle').addEventListener('click', toggleTheme);
  const menu = $('#avatar-menu');
  $('#avatar-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#avatar-btn').setAttribute('aria-expanded', !menu.hidden);
    if (!menu.hidden) $('[role=menuitem]', menu)?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { menu.hidden = true; $('#avatar-btn').setAttribute('aria-expanded', 'false'); $('#avatar-btn').focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.avatar-wrap')) { menu.hidden = true; $('#avatar-btn').setAttribute('aria-expanded', 'false'); }
    if (e.target.closest('[data-theme-toggle]')) toggleTheme();
    if (e.target.closest('[data-sound-toggle]')) {
      setSound(!soundOn());
      paintSoundToggle();
      if (soundOn()) playIntro();
      toast(soundOn() ? 'Intro sound on 🔊' : 'Intro sound off 🔇');
    }
    if (e.target.closest('[data-switch-profile]')) { menu.hidden = true; showPicker(); }
    const tag = e.target.closest('[data-cat-tag]');
    if (tag) { const { category } = parseRoute(); if (category) filterCategoryByTag(category, tag.dataset.catTag); }
  });
  $('#mylist-sort').addEventListener('change', loadMyList);
  $('#logout-btn').addEventListener('click', async () => {
    await signOut();
    showAuth();
    toast('Logged out. See you soon! 👋');
  });
  addEventListener('hashchange', route);
  addEventListener('scroll', updateNav, { passive: true });
}

setCatalogChangeHandler(async () => {
  state.rowsStale = true;
  homeCache = null;
  categoryCache.clear();
  const h = await health();
  state.categories = ['All', ...(h.categories || [])];
  state.categoryCounts = h.category_counts || {};
  renderChips();
});

// ================================================================== boot
async function boot() {
  bindGlobalEvents();
  bindAuth();
  bindPicker();
  bindOnboarding();
  bindSearch();
  bindChrome();
  const configured = await initAuth();
  if (!configured) {
    await splash(async (p) => { p(1, 'Setup needed'); });
    show('setup');
    return;
  }
  state.onSessionExpired = () => showAuth('Your session has expired. Please log in again.');
  const session = await splash(async (progress) => {
    progress(0.4, 'Checking the recommendation engine…');
    const h = await health();
    progress(0.75, h.status === 'ok' ? `${h.items} items ready` : 'Connecting…');
    return getSession();
  });
  sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' && started) showAuth(); });
  if (session) await enterApp(session);
  else showAuth();
}

boot().catch((err) => {
  console.error(err);
  toast('Something went wrong while starting. Please reload.', 'error', 8000);
});
