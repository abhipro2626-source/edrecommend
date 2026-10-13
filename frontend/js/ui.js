// Rendering: cards, rows, hero billboard, hover preview, details overlay, search, How it works.
import {
  $, $$, esc, toast, mediaHTML, formatRating, matchClass, countUp, reducedMotion, canHover,
  catAttr, catSlug, mediaFit, placeholderHTML,
} from './utils.js';
import {
  state, recommend, similar, itemDetail, toggle, logView, logClick, logSearch, recentSearches, ApiError,
} from './api.js';
import { say, robotAway } from './robot.js';

/** Every item we've rendered, so overlays open instantly. */
export const itemCache = new Map();
const remember = (items) => items.forEach((i) => itemCache.set(i.id, i));

// ------------------------------------------------------------------ icons
const ICONS = {
  like: '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.5 20H7"/></svg>',
  love: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  dislike: '<svg viewBox="0 0 24 24"><path d="M17 13V4h3v9zM17 13l-4 8a2.5 2.5 0 0 1-2.5-2.5V15H5.3a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.5 4H17"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  saved: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  more: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>',
};
const LABELS = { like: 'Like', love: 'Love this', dislike: 'Not for me', save: 'My List' };

const sets = () => ({ like: state.likes, love: state.loves, save: state.saves, dislike: state.dislikes });
const pressed = (action, id) => sets()[action].has(id);

function rateButtons(item, actions = ['like', 'love', 'dislike']) {
  return actions.map((a) => `<button class="rate-btn ${a}" data-act="${a}" data-act-id="${item.id}"
    aria-pressed="${pressed(a, item.id)}" aria-label="${LABELS[a]}: ${esc(item.title)}" title="${LABELS[a]}">${ICONS[a]}</button>`).join('');
}
function saveButton(item) {
  const on = pressed('save', item.id);
  return `<button class="rate-btn save" data-act="save" data-act-id="${item.id}" aria-pressed="${on}"
    aria-label="${on ? 'Remove from' : 'Add to'} My List: ${esc(item.title)}" title="My List">${on ? ICONS.saved : ICONS.save}</button>`;
}

// ------------------------------------------------------------------ cards
const dataAttrs = (item) => `data-id="${item.id}" data-category="${esc(item.category)}" data-title="${esc(item.title)}" ${catAttr(item.category)}`;

export function cardHTML(item, i = 0, { removable = null } = {}) {
  const sub = [formatRating(item.rating) && `<span>${formatRating(item.rating)}</span>`,
    item.match_percent != null && `<span class="match ${matchClass(item.match_percent)}">${item.match_percent}% match</span>`]
    .filter(Boolean).join('');
  const badges = [pressed('love', item.id) && '<span title="Loved">💖</span>', pressed('save', item.id) && '<span title="On My List">🔖</span>']
    .filter(Boolean).join('');
  const remove = removable
    ? `<button class="card-remove" data-remove="${removable}" aria-label="Remove ${esc(item.title)}">${ICONS.remove}</button>` : '';
  return `<article class="card" tabindex="0" ${dataAttrs(item)} style="--i:${i}" aria-label="${esc(item.title)}, ${esc(item.category)}">
    <div class="card-media">${mediaHTML(item)}</div>
    <span class="card-cat">${esc(item.category)}</span>
    ${remove || (badges ? `<span class="card-state">${badges}</span>` : '')}
    <div class="card-info"><h3 class="card-title">${esc(item.title)}</h3><div class="card-sub">${sub}</div></div>
  </article>`;
}

function top10HTML(item, i) {
  return `<div class="top10-card" style="--i:${i}">
    <div class="rank" aria-hidden="true"><svg viewBox="0 0 ${item.rank >= 10 ? 190 : 110} 150"><text x="50%" y="140" text-anchor="middle">${item.rank}</text></svg></div>
    ${cardHTML(item, i).replace('aria-label="', `aria-label="Number ${item.rank}: `)}
  </div>`;
}

export function skeletonCards(n = 6) {
  return Array.from({ length: n }, () => '<div class="card skeleton" aria-hidden="true"><div class="card-media"></div></div>').join('');
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
const ROW_LINKS = { mylist: '#/mylist', continue: null, top: '#/foryou' };

function rowLink(row) {
  if (row.category) return `#/c/${catSlug(row.category)}`;
  if (row.id === 'trending') return `#/c/${catSlug(row.title.replace(/^Trending in /, ''))}`;
  return ROW_LINKS[row.id] || null;
}

export function rowsSkeleton(n = 3) {
  return Array.from({ length: n }, () => `<section class="row" aria-hidden="true"><div class="row-head"><div class="sk title"></div></div>
    <div class="row-viewport"><div class="row-track">${skeletonCards(7)}</div></div></section>`).join('');
}

function rowShell(row, r) {
  const link = rowLink(row);
  return `<section class="row ${row.kind === 'top10' ? 'top10' : ''} lazy" data-row="${r}" aria-label="${esc(row.title)}">
    <div class="row-head"><h2>${esc(row.title)}</h2>${link ? `<a class="explore" href="${link}">Explore all ›</a>` : ''}</div>
    <div class="row-viewport">
      <button class="row-arrow left" data-scroll="-1" aria-label="Scroll ${esc(row.title)} left" hidden>${ICONS.left}</button>
      <div class="row-track" role="list">${skeletonCards(row.kind === 'top10' ? 5 : 7)}</div>
      <button class="row-arrow right" data-scroll="1" aria-label="Scroll ${esc(row.title)} right" hidden>${ICONS.right}</button>
    </div>
  </section>`;
}

function fillRow(section, row) {
  const track = $('.row-track', section);
  track.classList.add('stagger');
  track.innerHTML = row.items.map((it, i) => (row.kind === 'top10' ? top10HTML(it, i) : cardHTML(it, i))).join('');
  section.classList.remove('lazy');
  updateEdges(section);
  track.addEventListener('scroll', () => updateEdges(section), { passive: true });
}

/** Arrows + fade masks only on the sides that have more content. */
function updateEdges(section) {
  const track = $('.row-track', section);
  const viewport = $('.row-viewport', section);
  const left = track.scrollLeft > 4;
  const right = track.scrollLeft + track.clientWidth < track.scrollWidth - 4;
  viewport.classList.toggle('fade-l', left);
  viewport.classList.toggle('fade-r', right);
  $('.row-arrow.left', section).hidden = !left;
  $('.row-arrow.right', section).hidden = !right;
}

let rowObserver = null;
/** Render rows; each row's cards are drawn when it scrolls near the viewport. */
export function renderRows(container, rows) {
  rows.forEach((r) => remember(r.items));
  container.innerHTML = rows.map(rowShell).join('');
  rowObserver?.disconnect();
  const sections = $$('.row', container);
  const fill = (el) => fillRow(el, rows[Number(el.dataset.row)]);
  if (!('IntersectionObserver' in window)) { sections.forEach(fill); return; }
  rowObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      rowObserver.unobserve(e.target);
      fill(e.target);
    });
  }, { rootMargin: '300px 0px' });
  sections.forEach((el) => rowObserver.observe(el));
}

addEventListener('resize', () => $$('.row:not(.lazy)').forEach(updateEdges));

// ------------------------------------------------------------------ hero billboard
let heroTimer = null;

export function heroSkeleton(el) {
  clearInterval(heroTimer);
  el.classList.add('skeleton');
  el.innerHTML = '';
}

function heroSlide(item) {
  const fit = mediaFit(item.category);
  const media = item.image_url
    ? `<div class="hero-media ${fit === 'cover' ? '' : fit}"><img class="bg" src="${esc(item.image_url)}" alt="" aria-hidden="true">
        <img class="fg" src="${esc(item.image_url)}" alt="" data-fallback></div>`
    : `<div class="hero-media gradient" ${catAttr(item.category)}></div>`;
  const tags = (item.tags || []).slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join('');
  const why = item.reasons?.[0] ? `<p class="hero-why">💡 ${esc(item.reasons[0])}</p>` : '';
  const onList = pressed('save', item.id);
  return `${media}
    <div class="hero-content" ${dataAttrs(item)}>
      <div><span class="pill cat" ${catAttr(item.category)}>${esc(item.category)}</span></div>
      <h1 class="hero-title">${esc(item.title)}</h1>
      <div class="hero-meta">
        ${item.match_percent != null ? `<span class="match ${matchClass(item.match_percent)}">${item.match_percent}% match</span>` : ''}
        ${item.rating != null ? `<span>${formatRating(item.rating)}</span>` : ''}
        ${tags ? `<span class="dots-list" style="color:rgba(255,255,255,.75)">${tags}</span>` : ''}
      </div>
      <p class="hero-desc">${esc(item.description)}</p>
      ${why}
      <div class="hero-actions">
        <button class="btn primary" data-open-detail="${item.id}">${ICONS.play} View Details</button>
        <button class="btn glass" data-act="save" data-act-id="${item.id}" data-hero-save aria-pressed="${onList}">${onList ? '✓ On My List' : '+ My List'}</button>
      </div>
    </div>`;
}

/** Hero with up to 3 items; auto-advances every 8s (paused on hover / reduced motion). */
export function renderHero(el, items) {
  clearInterval(heroTimer);
  el.classList.remove('skeleton');
  if (!items?.length) { el.hidden = true; return; }
  el.hidden = false;
  remember(items);
  let current = 0;
  const show = (n) => {
    current = (n + items.length) % items.length;
    el.innerHTML = heroSlide(items[current]) + (items.length > 1
      ? `<div class="hero-dots" role="group" aria-label="Featured items">${items.map((it, i) =>
        `<button data-hero-dot="${i}" aria-label="Show ${esc(it.title)}" aria-current="${i === current}"></button>`).join('')}</div>` : '');
  };
  show(0);
  el.onclick = (e) => {
    const dot = e.target.closest('[data-hero-dot]');
    if (dot) { show(Number(dot.dataset.heroDot)); restart(); }
  };
  const restart = () => {
    clearInterval(heroTimer);
    if (items.length > 1 && !reducedMotion()) heroTimer = setInterval(() => { if (!el.matches(':hover') && document.contains(el)) show(current + 1); }, 8000);
  };
  restart();
}
export const stopHero = () => clearInterval(heroTimer);

// ------------------------------------------------------------------ hover preview (desktop)
let pop = null;
let hoverTimer = null;
let popCard = null;

function closePop() {
  clearTimeout(hoverTimer);
  if (!pop) return;
  const el = pop;
  pop = null;
  popCard = null;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 260);
}

function openPop(card) {
  const item = itemCache.get(Number(card.dataset.id));
  if (!item || !document.contains(card)) return;
  closePop();
  const rect = card.getBoundingClientRect();
  const width = Math.max(rect.width * 1.35, 300);
  const height = width * 9 / 16;
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, 10), innerWidth - width - 10);
  const top = Math.max(rect.top + rect.height / 2 - height / 2, 74);
  const el = document.createElement('div');
  el.className = 'pop';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `${item.title} preview`);
  el.style.cssText = `left:${left}px;top:${top}px;width:${width}px;--from:${rect.width / width};--ox:${((rect.left + rect.width / 2 - left) / width) * 100}%`;
  const tags = (item.tags || []).slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join('');
  el.innerHTML = `<div class="pop-media" ${dataAttrs(item)} data-open-detail="${item.id}">${mediaHTML(item)}<span class="card-cat" ${catAttr(item.category)}>${esc(item.category)}</span></div>
    <div class="pop-body" ${dataAttrs(item)}>
      <div class="pop-title">${esc(item.title)}</div>
      <div class="pop-actions">${saveButton(item)}${rateButtons(item)}<span class="spacer"></span>
        <button class="rate-btn" data-open-detail="${item.id}" aria-label="More info: ${esc(item.title)}" title="More info">${ICONS.more}</button></div>
      <div class="pop-meta">
        ${item.match_percent != null ? `<span class="match ${matchClass(item.match_percent)}">${item.match_percent}% match</span>` : ''}
        ${item.rating != null ? `<span>${formatRating(item.rating)}</span>` : ''}
        <span>${esc(item.category)}</span>
      </div>
      ${tags ? `<div class="dots-list">${tags}</div>` : ''}
    </div>`;
  document.body.append(el);
  el.addEventListener('pointerleave', (e) => { if (!popCard?.contains(e.relatedTarget)) closePop(); });
  pop = el;
  popCard = card;
  requestAnimationFrame(() => el.classList.add('show'));
}

function bindHoverPreview() {
  document.addEventListener('pointerover', (e) => {
    if (!canHover() || reducedMotion()) return;
    const card = e.target.closest('.row .card[data-id], .grid .card[data-id]');
    if (!card || card === popCard) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openPop(card), 350);
  });
  document.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.card[data-id]');
    if (!card || card.contains(e.relatedTarget)) return;
    clearTimeout(hoverTimer);
    if (popCard === card && !pop?.contains(e.relatedTarget)) closePop();
  });
  addEventListener('scroll', closePop, { passive: true });
  document.addEventListener('scroll', (e) => { if (e.target.classList?.contains('row-track')) closePop(); }, { capture: true, passive: true });
}

// ------------------------------------------------------------------ actions
function burst(btn) {
  if (reducedMotion() || !btn) return;
  const host = btn.closest('.pop, .modal, .hero-content') || document.body;
  const rect = btn.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'burst';
  el.style.left = `${rect.left - hostRect.left + rect.width / 2}px`;
  el.style.top = `${rect.top - hostRect.top + rect.height / 2}px`;
  el.innerHTML = Array.from({ length: 8 }, (_, k) => {
    const a = (k / 8) * Math.PI * 2;
    return `<i style="--dx:${Math.cos(a) * 24}px;--dy:${Math.sin(a) * 24}px"></i>`;
  }).join('');
  host.append(el);
  setTimeout(() => el.remove(), 650);
}

/** Keep every copy of an item's controls and badges (cards, pop, overlay, hero) in sync. */
function syncItem(id) {
  $$(`[data-act-id="${id}"]`).forEach((btn) => {
    const on = pressed(btn.dataset.act, id);
    btn.setAttribute('aria-pressed', on);
    if (btn.dataset.act === 'save') {
      if (btn.hasAttribute('data-hero-save')) btn.textContent = on ? '✓ On My List' : '+ My List';
      else if (btn.classList.contains('rate-btn')) btn.innerHTML = on ? ICONS.saved : ICONS.save;
      else btn.textContent = on ? '✓ On My List' : '+ My List';
    }
  });
  const item = itemCache.get(id);
  if (!item) return;
  $$(`.card[data-id="${id}"]`).forEach((card) => {
    if (card.querySelector('.card-remove')) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHTML(item, Number(card.style.getPropertyValue('--i')) || 0);
    const fresh = tmp.firstElementChild.querySelector('.card-state');
    card.querySelector('.card-state')?.remove();
    if (fresh) card.querySelector('.card-info').before(fresh);
  });
}

function removeCards(id, selector = `.card[data-id="${id}"]`) {
  $$(selector).forEach((card) => {
    const target = card.closest('.top10-card') || card;
    target.classList.add('leaving');
    target.style.animation = 'leave 260ms var(--ease-out) forwards';
    setTimeout(() => target.remove(), 260);
  });
}

export async function handleAction(action, id, btn) {
  btn?.classList.remove('pop-anim');
  void btn?.offsetWidth;
  btn?.classList.add('pop-anim');
  try {
    const on = await toggle(action, id);
    syncItem(id);
    if (!on) {
      if (action === 'save') removeCards(id, `#mylist-grid .card[data-id="${id}"]`);
      if (action === 'like' || action === 'love') removeCards(id, `#likes-grid .card[data-id="${id}"]`);
      return;
    }
    if (action === 'like') say('Nice choice! I’ll remember it 👍');
    if (action === 'love') { burst(btn); say('Loved it! I’ll find more like this 💖'); }
    if (action === 'save') say('Added to My List 🔖');
    if (action === 'dislike') {
      say('Got it — fewer like this 👌');
      closePop();
      if (btn?.closest('.modal')) closeModal();
      removeCards(id, `.view .card[data-id="${id}"]`);
      toast('Got it — we’ll show fewer like this.', 'info', 5200, {
        undo: async () => {
          try { await toggle('dislike', id); syncItem(id); state.rowsStale = true; say('Undone ↩'); } catch (err) { toast(err.message, 'error'); }
        },
      });
    }
  } catch (err) {
    syncItem(id);                         // rolled back — show the real state
    toast(err.message, 'error');
  }
}

// ------------------------------------------------------------------ details overlay
let lastFocus = null;

export function openModal(html, { onClose, origin } = {}) {
  const modal = $('#modal');
  closePop();
  if (modal.hidden) lastFocus = document.activeElement;
  $('#modal-body').innerHTML = html;
  const box = $('.modal', modal);
  if (origin && modal.hidden) {
    const r = origin.getBoundingClientRect();
    box.style.setProperty('--mox', `${((r.left + r.width / 2) / innerWidth) * 100}%`);
    box.style.setProperty('--moy', `${Math.max(0, r.top + r.height / 2 - 40)}px`);
  }
  modal.hidden = false;
  modal.classList.remove('closing');
  modal._onClose = onClose;
  modal.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  robotAway(true);
  setTimeout(() => $('.modal-close', modal).focus(), 30);
}

export function closeModal() {
  const modal = $('#modal');
  if (modal.hidden || modal.classList.contains('closing')) return;
  modal.classList.add('closing');
  setTimeout(() => {
    modal.hidden = true;
    modal.classList.remove('closing');
    $('#modal-body').innerHTML = '';
    document.body.style.overflow = '';
    robotAway(false);
    modal._onClose?.();
    lastFocus?.focus?.({ preventScroll: true });
  }, 230);
}

function breakdownHTML(b) {
  const labels = { content: 'Content', preference: 'Your taste', behaviour: 'Activity', rating: 'Rating', category: 'Category', penalty: 'Dislike penalty' };
  const max = Math.max(...Object.values(b).map(Math.abs), 0.0001);
  const total = Object.values(b).reduce((s, v) => s + v, 0);
  return `<div class="breakdown">${Object.entries(labels).map(([k, label]) => `
      <div class="bd-row"><span>${label}</span>
        <div class="bd-track"><i class="bd-fill ${b[k] < 0 ? 'neg' : ''}" data-w="${Math.abs(b[k] || 0) / max}"></i></div>
        <span>${b[k] < 0 ? '−' : '+'}${Math.abs(b[k] || 0).toFixed(3)}</span></div>`).join('')}
      <div class="bd-row bd-total"><span>Final score</span><span></span><span>${total.toFixed(3)}</span></div>
    </div>`;
}

export async function openDetail(id, { fromSearch = false, origin = null } = {}) {
  let item = itemCache.get(id);
  logView(id);
  if (fromSearch) logClick(id);
  if (!item?.breakdown) {
    try { item = await itemDetail(id); remember([item]); } catch (err) { if (!item) { toast(err.message, 'error'); return; } }
  }
  const onList = pressed('save', item.id);
  const tags = (item.tags || []).slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  openModal(`
    <div class="detail-media" ${dataAttrs(item)}>${mediaHTML(item)}</div>
    <div class="detail-hero">
      <div><span class="pill cat" ${catAttr(item.category)}>${esc(item.category)}</span></div>
      <h2 id="modal-title">${esc(item.title)}</h2>
      <div class="detail-actions">
        <button class="btn primary" data-act="save" data-act-id="${item.id}" aria-pressed="${onList}">${onList ? '✓ On My List' : '+ My List'}</button>
        ${rateButtons(item)}
      </div>
    </div>
    <div class="modal-pad">
      <div class="info-row">
        ${item.match_percent != null ? `<span class="match ${matchClass(item.match_percent)}"><b data-count="${item.match_percent}">0</b>% match</span>` : ''}
        ${item.rating != null ? `<span>${formatRating(item.rating)}</span>` : ''}
        <span>${esc(item.category)}</span>
      </div>
      ${tags ? `<div class="tags" style="margin-top:14px">${tags}</div>` : ''}
      <div class="detail-grid" style="margin-top:22px">
        <div class="detail-section"><p class="detail-desc">${esc(item.description) || 'No description yet.'}</p></div>
        <div class="detail-section"><h3>Why we recommended this</h3>
          ${(item.reasons || []).map((r) => `<p class="reason">${esc(r)}</p>`).join('')}
          ${item.breakdown ? breakdownHTML(item.breakdown) : ''}
        </div>
      </div>
      <div class="detail-section" style="margin-top:30px"><h3>More Like This</h3><div class="more-grid" id="similar-grid">${skeletonCards(6)}</div></div>
    </div>`, { origin });
  const count = $('#modal [data-count]');
  if (count) countUp(count, Number(count.dataset.count));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('#modal .bd-fill').forEach((f) => { f.style.transform = `scaleX(${f.dataset.w})`; });
  }));
  try {
    const { items } = await similar(id);
    const gridEl = $('#similar-grid');
    if (!gridEl) return;
    remember(items);
    gridEl.classList.add('stagger');
    gridEl.innerHTML = items.length ? items.slice(0, 9).map((it, i) => cardHTML(it, i)).join('')
      : '<p class="muted">Nothing similar yet — import more items!</p>';
  } catch (err) {
    const gridEl = $('#similar-grid');
    if (gridEl) gridEl.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

// ------------------------------------------------------------------ search
export const grid = { query: '', category: 'All', offset: 0, total: 0, loading: false };
const PAGE = 24;
const POPULAR = ['space movies', 'learn python', 'psychology books', 'puzzle games', 'data science jobs', 'productivity apps', 'machine learning', 'sci-fi novels'];

export function renderChips() {
  $$('[data-chips]').forEach((wrap) => {
    wrap.innerHTML = state.categories.map((c) =>
      `<button class="chip" data-chip="${esc(c)}" aria-pressed="${c === grid.category}">${esc(c)}</button>`).join('');
  });
}

async function renderSuggestions(view) {
  const box = $('#search-suggest', view);
  if (!box) return;
  const recent = await recentSearches().catch(() => []);
  box.hidden = false;
  box.innerHTML = `
    ${recent.length ? `<div><p class="eyebrow" style="margin-bottom:10px">Your recent searches</p><div class="chips">${recent.map((q) => `<button class="chip" data-suggest="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>` : ''}
    <div><p class="eyebrow" style="margin-bottom:10px">Popular searches</p><div class="chips">${POPULAR.map((q) => `<button class="chip" data-suggest="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`;
}

export async function runSearch({ append = false, announce = true } = {}) {
  const view = $('.view.active');
  const gridEl = view && $('[data-grid]', view);
  if (!gridEl) return;
  const meta = $('[data-results-meta]', view);
  const more = $('[data-load-more]', view);
  const title = $('#search-title', view);
  const isSearchPage = view.dataset.view === 'search';
  const suggest = $('#search-suggest', view);
  if (title) title.textContent = grid.query ? `Results for “${grid.query}”` : (location.hash === '#/explore' ? 'Explore everything' : 'Search');
  if (isSearchPage && !grid.query && location.hash !== '#/explore') {
    gridEl.innerHTML = ''; meta.textContent = ''; more.hidden = true;
    renderSuggestions(view);
    return;
  }
  if (suggest) suggest.hidden = true;
  const ticket = Symbol('search');
  grid.ticket = ticket;
  if (!append) {
    grid.offset = 0;
    gridEl.classList.remove('stagger');
    gridEl.innerHTML = skeletonCards(12);
    meta.textContent = '';
  } else {
    more.classList.add('loading');
  }
  try {
    const res = await recommend(grid.query, grid.category, grid.offset, PAGE);
    if (grid.ticket !== ticket) return;           // a newer search started while this one ran
    remember(res.items);
    grid.total = res.total;
    if (append) {
      gridEl.insertAdjacentHTML('beforeend', res.items.map((it, i) => cardHTML(it, i)).join(''));
    } else if (res.items.length) {
      renderGrid(gridEl, res.items);
    } else {
      gridEl.innerHTML = emptyHTML('🔭', 'Nothing matched',
        grid.query ? `No results for “${grid.query}”${grid.category !== 'All' ? ` in ${grid.category}` : ''}. Try one of the searches below or pick another category.`
          : 'This category is empty. An admin can import a dataset to fill it.');
      if (grid.query && isSearchPage) renderSuggestions(view);
    }
    grid.offset += res.items.length;
    const where = grid.category !== 'All' ? ` in ${grid.category}` : '';
    meta.textContent = res.total ? (grid.query ? `${res.total} results${where}` : `${res.total} picks ranked for you${where}`) : '';
    more.hidden = grid.offset >= res.total;
    if (announce && grid.query) say(res.total ? `I found ${res.total} things for you!` : 'Hmm, nothing matched. Try a suggestion below?');
  } catch (err) {
    if (!append) gridEl.innerHTML = emptyHTML('📡', 'Something went wrong', err.message);
    toast(err.message, 'error');
  } finally {
    more?.classList.remove('loading');
  }
}

export function setQuery(query, { log = false } = {}) {
  grid.query = query.trim();
  if (log && grid.query.length >= 3) { logSearch(grid.query, grid.category); state.rowsStale = true; }
}

// ------------------------------------------------------------------ global events
export function bindGlobalEvents() {
  bindHoverPreview();
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
      e.stopPropagation();
      handleAction(remove.dataset.remove, Number(remove.closest('[data-id]').dataset.id), remove);
      return;
    }
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      const track = scroll.closest('.row').querySelector('.row-track');
      track.scrollBy({ left: Number(scroll.dataset.scroll) * (track.clientWidth - 80), behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      grid.category = chip.dataset.chip;
      $$('[data-chip]').forEach((c) => c.setAttribute('aria-pressed', c.dataset.chip === grid.category));
      runSearch({ announce: false });
      return;
    }
    const suggestion = e.target.closest('[data-suggest]');
    if (suggestion) {
      document.dispatchEvent(new CustomEvent('edr:search', { detail: suggestion.dataset.suggest }));
      return;
    }
    if (e.target.closest('[data-load-more]')) { runSearch({ append: true }); return; }
    if (e.target.closest('[data-close-modal]') || e.target.id === 'modal') { closeModal(); return; }
    const opener = e.target.closest('[data-open-detail]');
    if (opener) { openDetail(Number(opener.dataset.openDetail), { origin: popCard || opener }); closePop(); return; }
    const card = e.target.closest('.card[data-id]');
    if (card) openDetail(Number(card.dataset.id), { fromSearch: !!grid.query && !!card.closest('[data-grid]'), origin: card });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (pop) closePop(); else closeModal(); }
    if (e.key === 'Enter' && e.target.matches('.card[data-id]')) {
      openDetail(Number(e.target.dataset.id), { origin: e.target });
    }
    // Arrow keys move between cards in a row.
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.matches('.row .card[data-id]')) {
      const cards = $$('.card[data-id]', e.target.closest('.row-track'));
      const next = cards[cards.indexOf(e.target) + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }
    }
    // Keep keyboard focus inside the open overlay.
    if (e.key === 'Tab' && !$('#modal').hidden) {
      const focusables = $$('#modal button, #modal [tabindex="0"], #modal a[href], #modal input, #modal select').filter((el) => el.offsetParent !== null);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  });
}

// ------------------------------------------------------------------ How it works
export function renderHow() {
  const w = state.weights || { content: 0.45, preference: 0.25, behaviour: 0.1, rating: 0.1, category: 0.1, dislike: 0.3 };
  const steps = [
    ['💬', 'Your search', 'You type “space movies” or just open Home.'],
    ['🗄️', 'Supabase', 'The shared catalog plus this profile’s private likes, loves, saves and searches.'],
    ['🔢', 'TF-IDF', 'Each item’s words become a weighted vector.'],
    ['📐', 'Cosine similarity', 'Measures the angle between vectors: 1 = same topic.'],
    ['⚖️', 'Hybrid score', 'Blends similarity with your taste, ratings and the category you asked for.'],
    ['🏆', 'Ranked rows', 'Sorted, diversified and explained.'],
  ];
  $('#how-root').innerHTML = `
    <div class="box">
      <div class="pipeline"><div class="pipe-line" aria-hidden="true"></div>
        ${steps.map(([e, t, d], i) => `<div class="pipe-node" style="--i:${i}"><div class="pipe-dot" aria-hidden="true">${e}</div><div><h3>${t}</h3><p>${d}</p></div></div>`).join('')}
      </div>
      <h3 style="margin-bottom:10px">The hybrid formula</h3>
      <div class="formula">final_score =
 <span class="w">${w.content}</span> × content_similarity   <span class="muted">// how well it matches your words</span>
 + <span class="w">${w.preference}</span> × preference_score   <span class="muted">// like what you loved (1.5×), liked and saved</span>
 + <span class="w">${w.behaviour}</span> × behaviour_score    <span class="muted">// what you viewed & searched (recent counts more)</span>
 + <span class="w">${w.rating}</span> × normalised_rating  <span class="muted">// per category: 9/10 movie ≈ 4.5/5 course</span>
 + <span class="w">${w.category}</span> × category_affinity  <span class="muted">// categories you engage with</span>
 <span class="neg">− ${w.dislike} × dislike_penalty</span>    <span class="muted">// similar to things you marked “not for me”</span></div>
    </div>
    <div class="explain-grid stagger">
      <div class="box" style="--i:0"><h3>Why TF-IDF?</h3><p class="muted">Words that are frequent in one item but rare overall (like “python” or “astronomy”) get high weight; filler words get almost none. Fast, free and explainable.</p></div>
      <div class="box" style="--i:1"><h3>Cosine similarity</h3><p class="muted">Two items are vectors. The smaller the angle between them, the more they’re about the same thing — regardless of description length.</p></div>
      <div class="box" style="--i:2"><h3>Private by design</h3><p class="muted">The catalog is shared, but Row Level Security means each profile’s likes, saves and searches can only be read by its own account.</p></div>
      <div class="box" style="--i:3"><h3>New profiles</h3><p class="muted">No history yet? Your onboarding interests plus top-rated items get you started — then every rating teaches the engine.</p></div>
    </div>`;
}

export { ApiError, placeholderHTML };
