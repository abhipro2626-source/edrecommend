// Rendering: cards, grids, rows, the detail modal, search + chips, How it works.
import {
  $, $$, esc, toast, mediaHTML, formatRating, matchClass, countUp, reducedMotion,
} from './utils.js';
import {
  state, recommend, similar, itemDetail, toggle, logView, logClick, logSearch, ApiError,
} from './api.js';
import { say } from './robot.js';

/** Every item we've rendered, so the modal can open instantly. */
export const itemCache = new Map();
const remember = (items) => items.forEach((i) => itemCache.set(i.id, i));

// ------------------------------------------------------------------ icons
const ICONS = {
  like: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  dislike: '<svg viewBox="0 0 24 24"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H6.7a2 2 0 0 0-2 1.7l-1.4 9A2 2 0 0 0 5.3 15zM17 2h2.7A2.3 2.3 0 0 1 22 4v7a2.3 2.3 0 0 1-2.3 2H17"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
};

const pressed = (action, id) =>
  ({ like: state.likes, save: state.saves, dislike: state.dislikes })[action].has(id);

function actionButtons(item) {
  return ['like', 'dislike', 'save'].map((a) => {
    const label = { like: 'Like', dislike: 'Not for me', save: 'Save' }[a];
    return `<button class="act ${a}" data-act="${a}" aria-pressed="${pressed(a, item.id)}" aria-label="${label}: ${esc(item.title)}" title="${label}">${ICONS[a]}</button>`;
  }).join('');
}

// ------------------------------------------------------------------ cards
export function cardHTML(item, i = 0, { removable = null } = {}) {
  const meta = [esc(item.category), formatRating(item.rating)].filter(Boolean).join(' <span aria-hidden="true">•</span> ');
  const reason = item.reasons?.[0] ? `<p class="reason">${esc(item.reasons[0])}</p>` : '';
  const remove = removable
    ? `<button class="act remove" data-remove="${removable}" aria-label="Remove ${esc(item.title)}" title="Remove">${ICONS.remove}</button>` : '';
  return `<article class="card" tabindex="0" data-id="${item.id}" data-category="${esc(item.category)}" style="--i:${i}" aria-label="${esc(item.title)}">
    <div class="card-media">${mediaHTML(item)}</div>
    <div class="card-body">
      <h3 class="card-title">${esc(item.title)}</h3>
      <div class="card-meta">${meta}</div>
      <p class="card-desc">${esc(item.description)}</p>
      ${reason}
      <div class="card-foot">
        <span class="match ${matchClass(item.match_percent)}">${item.match_percent}% MATCH</span>
        <div class="card-actions">${remove || actionButtons(item)}</div>
      </div>
    </div>
  </article>`;
}

export function skeletonCards(n = 8) {
  return Array.from({ length: n }, () => `<div class="card skeleton" aria-hidden="true">
    <div class="card-media"></div>
    <div class="card-body"><div class="sk w70"></div><div class="sk w40"></div><div class="sk w90"></div><div class="sk w60"></div></div>
  </div>`).join('');
}

export function emptyHTML(emoji, title, text, action = '') {
  return `<div class="empty"><span class="em" aria-hidden="true">${emoji}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
}

export function renderGrid(container, items, opts = {}) {
  remember(items);
  container.classList.add('stagger');
  container.innerHTML = items.map((item, i) => cardHTML(item, i, opts)).join('');
}

// ------------------------------------------------------------------ rows
export function rowsSkeleton(n = 2) {
  return Array.from({ length: n }, () => `<div class="row"><div class="row-head"><div class="sk w40" style="width:220px;height:18px"></div></div>
    <div class="row-track skeleton">${skeletonCards(5)}</div></div>`).join('');
}

export function renderRows(container, rows) {
  rows.forEach((r) => remember(r.items));
  container.innerHTML = rows.map((row, r) => `<section class="row" style="--i:${r}" aria-label="${esc(row.title)}">
      <div class="row-head">
        <h2>${esc(row.title)}</h2>
        <div class="row-arrows">
          <button class="icon-btn" data-scroll="-1" aria-label="Scroll left">${ICONS.left}</button>
          <button class="icon-btn" data-scroll="1" aria-label="Scroll right">${ICONS.right}</button>
        </div>
      </div>
      <div class="row-track stagger">${row.items.map((it, i) => cardHTML(it, i)).join('')}</div>
    </section>`).join('');
}

// ------------------------------------------------------------------ actions
function burst(btn) {
  if (reducedMotion()) return;
  const rect = btn.getBoundingClientRect();
  const host = btn.closest('.card, .modal') || document.body;
  const hostRect = host.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'burst';
  el.style.left = `${rect.left - hostRect.left + rect.width / 2}px`;
  el.style.top = `${rect.top - hostRect.top + rect.height / 2}px`;
  el.innerHTML = Array.from({ length: 8 }, (_, k) => {
    const angle = (k / 8) * Math.PI * 2;
    return `<i style="--dx:${Math.cos(angle) * 22}px;--dy:${Math.sin(angle) * 22}px"></i>`;
  }).join('');
  host.append(el);
  setTimeout(() => el.remove(), 650);
}

/** Keep every copy of an item's buttons (cards, rows, modal) in sync. */
function syncButtons(id) {
  $$(`[data-id="${id}"] [data-act], .modal [data-act-id="${id}"]`).forEach((btn) => {
    btn.setAttribute('aria-pressed', pressed(btn.dataset.act, id));
  });
}

function removeCards(id, selector = `[data-id="${id}"].card`) {
  $$(selector).forEach((card) => {
    card.classList.add('leaving');
    setTimeout(() => card.remove(), 260);
  });
}

export async function handleAction(action, id, btn) {
  btn?.classList.remove('pop');
  void btn?.offsetWidth;
  btn?.classList.add('pop');
  try {
    const on = await toggle(action, id);
    syncButtons(id);
    if (on && action === 'like') { burst(btn); say('Nice choice! I’ll remember it ❤️'); }
    if (on && action === 'save') say('Saved to your list 🔖');
    if (on && action === 'dislike') {
      say('Got it, fewer like this 👍');
      removeCards(id, `.view [data-id="${id}"].card`);
    }
    if (!on && action === 'like') removeCards(id, `#likes-grid [data-id="${id}"]`);
    if (!on && action === 'save') removeCards(id, `#saved-grid [data-id="${id}"]`);
  } catch (err) {
    syncButtons(id);                      // rolled back — reflect the real state
    toast(err.message, 'error');
  }
}

// ------------------------------------------------------------------ modal
let lastFocus = null;

export function openModal(html, { onClose } = {}) {
  const modal = $('#modal');
  lastFocus = document.activeElement;
  $('#modal-body').innerHTML = html;
  modal.hidden = false;
  modal.classList.remove('closing');
  modal._onClose = onClose;
  $('.modal', modal).scrollTop = 0;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('.modal-close', modal).focus(), 30);
}

export function closeModal() {
  const modal = $('#modal');
  if (modal.hidden) return;
  modal.classList.add('closing');
  setTimeout(() => {
    modal.hidden = true;
    modal.classList.remove('closing');
    $('#modal-body').innerHTML = '';
    document.body.style.overflow = '';
    modal._onClose?.();
    lastFocus?.focus?.();
  }, 180);
}

function breakdownHTML(b) {
  const labels = { content: 'Content', preference: 'Preference', behaviour: 'Behaviour', rating: 'Rating', category: 'Category', penalty: 'Dislike penalty' };
  const max = Math.max(...Object.values(b).map(Math.abs), 0.0001);
  const total = Object.values(b).reduce((s, v) => s + v, 0);
  return `<div class="breakdown">${Object.entries(labels).map(([k, label]) => `
      <div class="bd-row"><span>${label}</span>
        <div class="bd-track"><i class="bd-fill ${b[k] < 0 ? 'neg' : ''}" data-w="${Math.abs(b[k] || 0) / max}"></i></div>
        <span>${b[k] < 0 ? '−' : '+'}${Math.abs(b[k] || 0).toFixed(3)}</span></div>`).join('')}
      <div class="bd-row bd-total"><span>Final score</span><span></span><span>${total.toFixed(3)}</span></div>
    </div>`;
}

export async function openDetail(id, { fromSearch = false } = {}) {
  let item = itemCache.get(id);
  logView(id);
  if (fromSearch) logClick(id);
  if (!item) {
    try { item = await itemDetail(id); remember([item]); } catch (err) { toast(err.message, 'error'); return; }
  }
  const actionBtn = (a, label) =>
    `<button class="btn ghost sm ${a}" data-act="${a}" data-act-id="${item.id}" aria-pressed="${pressed(a, item.id)}">${label}</button>`;
  openModal(`
    <div class="detail-media" data-category="${esc(item.category)}">${mediaHTML(item)}</div>
    <div class="modal-pad">
      <div class="detail-head">
        <div>
          <p class="eyebrow">${esc(item.category)} ${item.rating != null ? '· ' + formatRating(item.rating) : ''}</p>
          <h2 id="modal-title">${esc(item.title)}</h2>
        </div>
        <span class="match ${matchClass(item.match_percent)}"><b data-count="${item.match_percent}">0</b>% MATCH</span>
      </div>
      <div class="detail-actions">
        ${actionBtn('like', '❤️ Like')}${actionBtn('save', '🔖 Save')}${actionBtn('dislike', '👎 Not for me')}
      </div>
      <p class="detail-section" style="color:var(--text-2)">${esc(item.description) || 'No description yet.'}</p>
      ${item.tags?.length ? `<div class="detail-section"><h3>Tags</h3><div class="tags">${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>` : ''}
      <div class="detail-section"><h3>Why this?</h3>${(item.reasons || []).map((r) => `<p class="reason">${esc(r)}</p>`).join('')}</div>
      ${item.breakdown ? `<div class="detail-section"><h3>Live score breakdown</h3>${breakdownHTML(item.breakdown)}</div>` : ''}
      <div class="detail-section"><h3>More like this</h3><div class="row-track" id="similar-track">${skeletonCards(4)}</div></div>
    </div>`);
  const count = $('#modal [data-count]');
  if (count) countUp(count, Number(count.dataset.count));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('#modal .bd-fill').forEach((f) => { f.style.transform = `scaleX(${f.dataset.w})`; });
  }));
  try {
    const { items } = await similar(id);
    const track = $('#similar-track');
    if (!track) return;
    remember(items);
    track.classList.add('stagger');
    track.innerHTML = items.length ? items.map((it, i) => cardHTML(it, i)).join('')
      : '<p class="muted">Nothing similar yet — import more items!</p>';
  } catch (err) {
    const track = $('#similar-track');
    if (track) track.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

// ------------------------------------------------------------------ search + chips
export const grid = { query: '', category: 'All', offset: 0, total: 0, loading: false };
const PAGE = 24;

const activeView = () => $('.view.active');

export function renderChips() {
  $$('[data-chips]').forEach((wrap) => {
    wrap.innerHTML = state.categories.map((c) =>
      `<button class="chip" data-chip="${esc(c)}" aria-pressed="${c === grid.category}">${esc(c)}</button>`).join('');
  });
}

export async function runSearch({ append = false, announce = true } = {}) {
  const view = activeView();
  const gridEl = view && $('[data-grid]', view);
  if (!gridEl || grid.loading) return;
  const meta = $('[data-results-meta]', view);
  const more = $('[data-load-more]', view);
  grid.loading = true;
  if (!append) {
    grid.offset = 0;
    gridEl.classList.remove('stagger');
    gridEl.innerHTML = skeletonCards(8);
    meta.textContent = '';
  } else {
    more.classList.add('loading');
  }
  try {
    const res = await recommend(grid.query, grid.category, grid.offset, PAGE);
    remember(res.items);
    grid.total = res.total;
    if (append) {
      gridEl.insertAdjacentHTML('beforeend', res.items.map((it, i) => cardHTML(it, i)).join(''));
    } else if (res.items.length) {
      renderGrid(gridEl, res.items);
    } else {
      gridEl.innerHTML = grid.query
        ? emptyHTML('🔭', 'Nothing matched', `No results for "${grid.query}"${grid.category !== 'All' ? ' in ' + grid.category : ''}. Try different words or another category.`)
        : emptyHTML('🗂️', 'Nothing here yet', 'This category is empty. An admin can import a dataset to fill it.');
    }
    grid.offset += res.items.length;
    const where = grid.category !== 'All' ? ` in ${grid.category}` : '';
    meta.textContent = res.total
      ? (grid.query ? `${res.total} results for “${grid.query}”${where}` : `${res.total} picks ranked for you${where}`)
      : '';
    more.hidden = grid.offset >= res.total;
    if (announce && grid.query) {
      say(res.total ? `I found ${res.total} things for you!` : 'Hmm, nothing matched. Try different words?');
    }
  } catch (err) {
    if (!append) gridEl.innerHTML = emptyHTML('📡', 'Something went wrong', err.message);
    toast(err.message, 'error');
  } finally {
    grid.loading = false;
    more?.classList.remove('loading');
  }
}

export function submitSearch(query, navigate) {
  const q = query.trim();
  if (!q) {
    toast('Type what you’re looking for — e.g. “space movies” or “learn python”.');
    say('Tell me what you’re curious about! ✍️');
    return;
  }
  grid.query = q;
  logSearch(q, grid.category);
  state.rowsStale = true;
  const route = location.hash.replace('#/', '') || 'home';
  if (route !== 'home' && route !== 'explore') { navigate('explore'); return; }
  runSearch();
  if (route === 'home') $('.view.active [data-chips]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ------------------------------------------------------------------ global delegated events
export function bindGlobalEvents() {
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      const id = Number(act.dataset.actId || act.closest('[data-id]')?.dataset.id);
      if (id) handleAction(act.dataset.act, id, act);
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      const id = Number(remove.closest('[data-id]').dataset.id);
      handleAction(remove.dataset.remove, id, remove);
      return;
    }
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      const track = scroll.closest('.row').querySelector('.row-track');
      track.scrollBy({ left: Number(scroll.dataset.scroll) * track.clientWidth * 0.85, behavior: 'smooth' });
      return;
    }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      grid.category = chip.dataset.chip;
      $$('[data-chip]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.chip === grid.category));
      runSearch({ announce: false });
      return;
    }
    if (e.target.closest('[data-load-more]')) { runSearch({ append: true }); return; }
    if (e.target.closest('[data-close-modal]') || e.target.id === 'modal') { closeModal(); return; }
    const card = e.target.closest('.card[data-id]');
    if (card) openDetail(Number(card.dataset.id), { fromSearch: !!grid.query && !!card.closest('[data-grid]') });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && e.target.matches('.card[data-id]')) openDetail(Number(e.target.dataset.id));
    // keep keyboard focus inside the open modal
    if (e.key === 'Tab' && !$('#modal').hidden) {
      const focusables = $$('#modal button, #modal [tabindex="0"], #modal input, #modal select');
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  });
}

// ------------------------------------------------------------------ How it works
export function renderHow() {
  const w = state.weights || { content: 0.45, preference: 0.25, behaviour: 0.1, rating: 0.1, category: 0.1, dislike: 0.3 };
  const steps = [
    ['💬', 'Your query', 'You type “learn python” or just open Home.'],
    ['🗄️', 'Supabase', 'Items + your private likes, saves and searches.'],
    ['🔢', 'TF-IDF', 'Each item’s words become a weighted vector.'],
    ['📐', 'Cosine similarity', 'Measures the angle between vectors: 1 = same topic.'],
    ['⚖️', 'Hybrid score', 'Blends similarity with your taste and ratings.'],
    ['🏆', 'Ranked results', 'Sorted, diversified and explained.'],
  ];
  $('#how-root').innerHTML = `
    <div class="box">
      <div class="pipeline"><div class="pipe-line" aria-hidden="true"></div>
        ${steps.map(([e, t, d], i) => `<div class="pipe-node" style="--i:${i}"><div class="pipe-dot" aria-hidden="true">${e}</div><div><h3>${t}</h3><p>${d}</p></div></div>`).join('')}
      </div>
      <h3 style="margin-bottom:10px">The hybrid formula</h3>
      <div class="formula">final_score =
 <span class="w">${w.content}</span> × content_similarity   <span class="muted">// how well it matches your words</span>
 + <span class="w">${w.preference}</span> × preference_score   <span class="muted">// like what you liked, saved & said you love</span>
 + <span class="w">${w.behaviour}</span> × behaviour_score    <span class="muted">// what you viewed & searched (recent counts more)</span>
 + <span class="w">${w.rating}</span> × normalised_rating  <span class="muted">// per category: 9/10 movie ≈ 4.5/5 course</span>
 + <span class="w">${w.category}</span> × category_affinity  <span class="muted">// categories you engage with</span>
 <span class="neg">− ${w.dislike} × dislike_penalty</span>    <span class="muted">// similar to things you skipped</span></div>
    </div>
    <div class="explain-grid stagger">
      <div class="box" style="--i:0"><h3>Why TF-IDF?</h3><p class="muted">Words that are frequent in one item but rare overall (like “python” or “astronomy”) get high weight; filler words get almost none. Fast, free and explainable.</p></div>
      <div class="box" style="--i:1"><h3>Cosine similarity</h3><p class="muted">Two items are vectors. The smaller the angle between them, the more they’re about the same thing — regardless of description length.</p></div>
      <div class="box" style="--i:2"><h3>Private by design</h3><p class="muted">The catalog is shared, but Row Level Security means your likes, saves and searches can only ever be read by you.</p></div>
      <div class="box" style="--i:3"><h3>New users</h3><p class="muted">No history yet? Your onboarding interests plus top-rated items get you started — then every click teaches the engine.</p></div>
    </div>`;
}

export { ApiError };
