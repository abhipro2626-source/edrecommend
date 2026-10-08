// Small shared helpers: escaping, toasts, placeholders, timing.

/** Escape text before putting it in HTML — imported CSVs can't inject scripts. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Show a toast message. type: 'info' | 'success' | 'error'. */
export function toast(message, type = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); el.addEventListener('animationend', () => el.remove()); }, ms);
}

// ---------- category look (colour + emoji) ----------
const CATEGORY_STYLE = {
  movies: ['#ff6b6b', '#7a1f3d', '🎬'],
  books: ['#f4a261', '#7c3a12', '📚'],
  courses: ['#4f7cff', '#1e2a78', '🎓'],
  jobs: ['#22c55e', '#0f5132', '💼'],
  apps: ['#00b4d8', '#0b3d5c', '📱'],
  games: ['#9b5cff', '#3b1677', '🎮'],
  technology: ['#14b8a6', '#0d4a4a', '💡'],
};

export function categoryStyle(category = '') {
  const known = CATEGORY_STYLE[category.toLowerCase()];
  if (known) return { c1: known[0], c2: known[1], emoji: known[2] };
  let hash = 0;                               // stable colour for imported categories
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return { c1: `hsl(${hash} 70% 60%)`, c2: `hsl(${(hash + 40) % 360} 60% 22%)`, emoji: '✨' };
}

export function initials(title = '') {
  return title.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase();
}

/** Generated artwork: category gradient + emoji + initials. Never a broken image. */
export function placeholderHTML(item) {
  const s = categoryStyle(item.category);
  return `<div class="ph" style="--c1:${s.c1};--c2:${s.c2}" role="img" aria-label="${esc(item.title)}">
    <span class="ph-emoji">${s.emoji}</span><span class="ph-initials">${esc(initials(item.title))}</span></div>`;
}

// How each category's pictures are framed: posters/covers are shown whole over a blurred
// copy of themselves, logos sit on a light tile, photos fill the frame.
const MEDIA_FIT = { movies: 'poster', books: 'poster', games: 'poster', apps: 'logo', technology: 'logo' };

export function mediaHTML(item) {
  if (!item.image_url) return placeholderHTML(item);
  const src = esc(item.image_url);
  const img = `<img src="${src}" alt="${esc(item.title)}" loading="lazy" decoding="async" data-fallback>`;
  const fit = MEDIA_FIT[(item.category || '').toLowerCase()];
  if (fit === 'poster') {
    return `<div class="media poster"><img class="media-bg" src="${src}" alt="" aria-hidden="true" loading="lazy" decoding="async">${img}</div>`;
  }
  if (fit === 'logo') return `<div class="media logo">${img}</div>`;
  return img;
}

// Any image that fails to load is swapped for its placeholder (capture phase catches img errors).
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.hasAttribute('data-fallback')) return;
  const card = img.closest('[data-category]');
  const target = img.closest('.media') || img;
  target.outerHTML = placeholderHTML({ title: img.alt, category: card?.dataset.category || '' });
}, true);

export function formatRating(rating) {
  if (rating == null) return '';
  return `⭐ ${Number(rating).toFixed(1).replace(/\.0$/, '')}`;
}

export function matchClass(p) { return p > 80 ? 'hi' : p > 50 ? 'mid' : ''; }

/** Animate a number counting up inside an element. */
export function countUp(el, to, ms = 700) {
  if (reducedMotion()) { el.textContent = to; return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / ms, 1);
    el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
