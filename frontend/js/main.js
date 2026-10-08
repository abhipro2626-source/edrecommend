// Boot, splash, auth screens, onboarding, router and the greeting.
import { $, $$, esc, toast, sleep, categoryStyle } from './utils.js';
import {
  initAuth, sb, getSession, signIn, signUp, signOut, loadProfile, updateProfile,
} from './auth.js';
import { state, health, madeForYou, itemsByIds, recommend, loadInteractions, logSearch } from './api.js';
import {
  bindGlobalEvents, renderRows, rowsSkeleton, renderChips, runSearch, submitSearch, grid,
  renderGrid, skeletonCards, emptyHTML, openDetail, renderHow,
} from './ui.js';
import { initRobot, hideRobot, say } from './robot.js';
import { renderProfile } from './profile.js';
import { renderAdmin, openImportModal, setCatalogChangeHandler } from './admin.js';

const INTERESTS = ['Python', 'AI', 'Space', 'Psychology', 'Design', 'Gaming', 'Music', 'Business',
  'Science', 'Programming', 'Movies', 'Books', 'Mathematics', 'Cooking', 'Data Science', 'Startups'];
const ROUTES = ['home', 'foryou', 'explore', 'likes', 'saved', 'profile', 'how', 'admin'];
const CATEGORY_BLURB = {
  Movies: 'Films about science, technology, minds, sport and adventure.',
  Books: 'Programming, AI, psychology, science, business and great fiction.',
  Courses: 'Free and popular courses to learn a new skill.',
  Jobs: 'Careers across tech, science, design, health and more.',
  Apps: 'Apps for learning, productivity, creativity and everyday life.',
  Games: 'Puzzle, strategy, story and simulation games worth playing.',
  Technology: 'Languages, tools and ideas shaping the future.',
};
const slug = (c) => c.toLowerCase().replace(/[^a-z0-9]+/g, '-');
let lastRoute = 'home';

let cachedRows = null;
let greetTimers = [];
let started = false;

// ================================================================== screens
function show(id) {
  ['setup', 'auth', 'onboarding', 'app'].forEach((s) => { $(`#${s}`).hidden = s !== id; });
}

// ================================================================== splash
async function splash(task) {
  const first = !sessionStorage.getItem('edr-splash');
  if (!first) return task(() => {});
  sessionStorage.setItem('edr-splash', '1');
  const el = $('#splash');
  el.hidden = false;
  const bar = $('#splash-bar');
  const status = $('#splash-status');
  const progress = (p, text) => {
    bar.style.transform = `scaleX(${p})`;
    el.querySelector('.progress').setAttribute('aria-valuenow', Math.round(p * 100));
    if (text) status.textContent = text;
  };
  const started = performance.now();
  requestAnimationFrame(() => progress(0.15));
  const result = await task(progress);
  progress(1, 'Ready');
  await sleep(Math.max(0, 1600 - (performance.now() - started)));
  el.classList.add('done');
  setTimeout(() => { el.hidden = true; el.classList.remove('done'); }, 520);
  return result;
}

// ================================================================== auth screen
function showAuth(message) {
  stopGreeting();
  hideRobot();
  started = false;
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
        await enterApp(session);
      }
    } catch (err) {
      error.textContent = err.message;
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
}

// ================================================================== onboarding
function showOnboarding() {
  show('onboarding');
  const form = $('#onboard-form');
  form.name.value = state.profile.name || state.user.user_metadata?.name || '';
  $('#interest-chips').innerHTML = INTERESTS.map((t) =>
    `<button type="button" class="chip" aria-pressed="false" data-interest="${esc(t)}">${esc(t)}</button>`).join('');
  goStep(0);
  setTimeout(() => form.name.focus(), 100);
}

function goStep(n) {
  $$('.ob-step').forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === n));
  $$('.steps i').forEach((dot, i) => dot.classList.toggle('on', i <= n));
  const form = $('#onboard-form');
  if (n === 2) $('#ob-ready').textContent = `You're all set, ${form.name.value.trim()}!`;
  const focusTarget = $(`.ob-step[data-step="${n}"] input, .ob-step[data-step="${n}"] [type=submit]`);
  setTimeout(() => focusTarget?.focus(), 60);
}

function currentStep() { return Number($('.ob-step.active').dataset.step); }

function nextStep() {
  const form = $('#onboard-form');
  const step = currentStep();
  if (step === 0 && !form.name.value.trim()) { toast('Tell us your name first 🙂'); form.name.focus(); return; }
  if (step < 2) goStep(step + 1);
}

function bindOnboarding() {
  const form = $('#onboard-form');
  $('#interest-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-interest]');
    if (chip) chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
  });
  $$('[data-next]').forEach((b) => b.addEventListener('click', nextStep));
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && currentStep() < 2) { e.preventDefault(); nextStep(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const picked = $$('#interest-chips [aria-pressed="true"]').map((c) => c.dataset.interest);
    const custom = form.custom.value.split(',').map((s) => s.trim()).filter(Boolean);
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.classList.add('loading');
    try {
      state.profile = await updateProfile(state.user.id, {
        name: form.name.value.trim().slice(0, 60),
        interests: [...new Set([...picked, ...custom])].slice(0, 30),
        onboarded: true,
      });
      await startApp();
    } catch {
      toast('Couldn’t save your profile — is the database schema set up?', 'error');
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
}

// ================================================================== app
async function enterApp(session) {
  state.user = session.user;
  try {
    state.profile = await loadProfile(session.user.id);
  } catch {
    showAuth('Couldn’t load your profile. Has supabase/schema.sql been run?');
    await signOut();
    return;
  }
  if (!state.profile.onboarded) showOnboarding();
  else await startApp();
}

async function startApp() {
  show('app');
  started = true;
  cachedRows = null;
  state.rowsStale = true;
  grid.query = ''; grid.category = 'All';
  $('#search-input').value = '';
  $('#avatar-btn').textContent = (state.profile.name || state.user.email || '?')[0].toUpperCase();
  $$('.admin-only').forEach((el) => { el.hidden = !state.profile.is_admin; });
  try { await loadInteractions(); } catch { toast('Couldn’t load your history.', 'error'); }
  const h = await health();
  if (h.status === 'offline') toast("Can't reach the EDRecommend server — is it running?", 'error', 6000);
  else if (h.status !== 'ok') toast(h.message || 'The server is not fully set up yet.', 'error', 6000);
  state.categories = ['All', ...(h.categories || [])];
  state.categoryCounts = h.category_counts || {};
  state.weights = h.weights || null;
  renderChips();
  renderCategoryNav();
  initRobot(surprise);
  route();
}

async function surprise() {
  const { items } = await recommend('', 'All', 0, 12);
  if (!items.length) throw new Error('empty');
  const pick = items[Math.floor(Math.random() * items.length)];
  await openDetail(pick.id);
}

async function loadRows(container) {
  if (cachedRows && !state.rowsStale) { renderRows(container, cachedRows); return; }
  container.innerHTML = rowsSkeleton(2);
  try {
    const { rows } = await madeForYou();
    cachedRows = rows;
    state.rowsStale = false;
    if (!rows.length) {
      container.innerHTML = emptyHTML('📭', 'The catalog is empty', 'Run the backend once to seed demo data, or import a dataset.');
      return;
    }
    renderRows(container, rows);
  } catch (err) {
    container.innerHTML = emptyHTML('📡', 'Couldn’t load recommendations', err.message);
  }
}

async function loadList(gridId, ids, kind) {
  const el = $(gridId);
  if (!ids.length) {
    el.innerHTML = kind === 'like'
      ? emptyHTML('❤️', 'No likes yet', 'Tap the heart on anything you enjoy and it will show up here.', '<a class="btn primary" href="#/explore">Explore now</a>')
      : emptyHTML('🔖', 'Nothing saved yet', 'Save items to build your list for later.', '<a class="btn primary" href="#/explore">Explore now</a>');
    return;
  }
  el.innerHTML = skeletonCards(Math.min(ids.length, 8));
  try {
    const { items } = await itemsByIds([...ids].reverse());
    renderGrid(el, items, { removable: kind });
  } catch (err) {
    el.innerHTML = emptyHTML('📡', 'Couldn’t load your list', err.message);
  }
}

// ================================================================== categories
function renderCategoryNav() {
  const cats = state.categories.filter((c) => c !== 'All');
  $('#cat-nav').innerHTML = cats.map((c) =>
    `<a href="#/c/${slug(c)}" data-route="c/${slug(c)}"><span class="nav-emoji" aria-hidden="true">${categoryStyle(c).emoji}</span><span>${esc(c)}</span></a>`).join('');
  $('#cat-tiles').innerHTML = cats.map((c, i) => {
    const s = categoryStyle(c);
    const n = state.categoryCounts?.[c];
    return `<a class="cat-tile" href="#/c/${slug(c)}" style="--c1:${s.c1};--c2:${s.c2};--i:${i}">
      <span class="em" aria-hidden="true">${s.emoji}</span><b>${esc(c)}</b>${n ? `<small>${n} items</small>` : ''}</a>`;
  }).join('');
}

function showCategory(category) {
  const s = categoryStyle(category);
  const n = state.categoryCounts?.[category];
  $('#cat-hero').innerHTML = `<div class="cat-hero-inner" style="--c1:${s.c1};--c2:${s.c2}">
      <span class="em" aria-hidden="true">${s.emoji}</span>
      <div><p class="eyebrow">Category${n ? ` · ${n} items` : ''}</p><h1>${esc(category)}</h1>
      <p>${esc(CATEGORY_BLURB[category] || `Everything in ${category}, ranked for you.`)}</p></div>
    </div>`;
  const input = $('#cat-search-input');
  input.placeholder = `Search ${category.toLowerCase()}…`;
  input.value = '';
  grid.category = category;
  grid.query = '';
  runSearch({ announce: false });
}

// ================================================================== router
function route() {
  if (!started) return;
  let name = location.hash.replace('#/', '') || 'home';
  let category = null;
  if (name.startsWith('c/')) {
    category = state.categories.find((c) => c !== 'All' && slug(c) === name.slice(2));
    name = category ? 'category' : 'home';
  }
  if (!ROUTES.includes(name) && name !== 'category') name = 'home';
  if (name === 'admin' && !state.profile.is_admin) name = 'home';
  // Leaving a category page: the shared grid goes back to "All" (a top-bar search query is kept).
  if (lastRoute === 'category' && name !== 'category') grid.category = 'All';
  lastRoute = name;
  const routeKey = category ? `c/${slug(category)}` : name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  $$('.sidebar a').forEach((a) => {
    const on = a.dataset.route === routeKey;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  moveGlider();
  $('#avatar-menu').hidden = true;
  window.scrollTo({ top: 0 });
  $$('[data-chip]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.chip === grid.category));

  ({
    home: () => { loadRows($('#home-rows')); runSearch({ announce: false }); showGreeting(); },
    foryou: () => loadRows($('#foryou-rows')),
    explore: () => runSearch({ announce: !!grid.query }),
    category: () => showCategory(category),
    likes: () => loadList('#likes-grid', [...state.likes], 'like'),
    saved: () => loadList('#saved-grid', [...state.saves], 'save'),
    profile: () => renderProfile(() => { $('#avatar-btn').textContent = (state.profile.name || '?')[0].toUpperCase(); }),
    how: renderHow,
    admin: renderAdmin,
  })[name]();
}

function moveGlider() {
  const active = $('.sidebar a.active');
  const glider = $('.nav-glider');
  if (!active || active.offsetParent === null) { glider.style.opacity = 0; return; }
  glider.style.opacity = 1;
  glider.style.height = `${active.offsetHeight}px`;
  glider.style.transform = `translateY(${active.offsetTop}px)`;
}

const navigate = (name) => { location.hash = `#/${name}`; };

// ================================================================== greeting
function stopGreeting() { greetTimers.forEach(clearTimeout); greetTimers = []; $('#greeting').innerHTML = ''; }

function showGreeting() {
  stopGreeting();
  const hour = new Date().getHours();
  const name = state.profile?.name || 'there';
  const lines = [`Hi, ${name} <span class="wave">👋</span>`,
    hour < 12 ? `Good morning, ${name}` : hour < 18 ? `Good afternoon, ${name}` : `Good evening, ${name}`];
  const cycle = (n) => {
    const el = $('#greeting');
    el.innerHTML = `<span class="hi">${n === 0 ? lines[0].replace(name, esc(name)) : esc(lines[1])}</span>`;
    greetTimers.push(setTimeout(() => el.firstElementChild?.classList.add('out'), 4000));
    greetTimers.push(setTimeout(() => { el.innerHTML = ''; }, 4500));
    greetTimers.push(setTimeout(() => cycle(n === 0 ? 1 : 0), 45000));
  };
  cycle(0);
}

// ================================================================== chrome
function bindChrome() {
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitSearch($('#search-input').value, navigate);
  });
  $('#search-input').addEventListener('search', (e) => {   // the native clear (×) resets results
    if (!e.target.value && grid.query) { grid.query = ''; runSearch({ announce: false }); }
  });
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('edr-theme', next); } catch { /* private mode */ }
    if (location.hash === '#/profile') route();
  });
  const menu = $('#avatar-menu');
  $('#avatar-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#avatar-btn').setAttribute('aria-expanded', !menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.avatar-wrap')) menu.hidden = true;
    if (e.target.closest('[data-open-import]')) openImportModal();
  });
  $('#logout-btn').addEventListener('click', async () => {
    await signOut();
    showAuth();
    toast('Logged out. See you soon! 👋');
  });
  $('#cat-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#cat-search-input').value.trim();
    grid.query = q;
    if (q) { logSearch(q, grid.category); state.rowsStale = true; }
    runSearch({ announce: !!q });
  });
  addEventListener('hashchange', route);
  addEventListener('resize', moveGlider);
}

setCatalogChangeHandler(async () => {
  state.rowsStale = true;
  cachedRows = null;
  const h = await health();
  state.categories = ['All', ...(h.categories || [])];
  state.categoryCounts = h.category_counts || {};
  renderChips();
  renderCategoryNav();
});

// ================================================================== boot
async function boot() {
  bindGlobalEvents();
  bindAuth();
  bindOnboarding();
  bindChrome();
  const configured = await initAuth();
  if (!configured) {
    await splash(async (p) => { p(1, 'Setup needed'); });
    show('setup');
    return;
  }
  state.onSessionExpired = () => showAuth('Your session has expired. Please log in again.');
  const session = await splash(async (progress) => {
    progress(0.35, 'Checking the recommendation engine…');
    const h = await health();
    progress(0.7, h.status === 'ok' ? `${h.items} items ready` : 'Connecting…');
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
