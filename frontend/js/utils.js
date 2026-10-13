// Small shared helpers: escaping, toasts, category looks, media, avatars, timing.

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
export const canHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * Show a toast. type: 'info' | 'success' | 'error'.
 * Pass { undo: fn } to add an Undo button (the toast closes when it's used).
 */
export function toast(message, type = 'info', ms = 3600, { undo } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  const close = () => { el.classList.add('out'); el.addEventListener('animationend', () => el.remove(), { once: true }); };
  if (undo) {
    const btn = document.createElement('button');
    btn.className = 'undo';
    btn.textContent = 'Undo';
    btn.addEventListener('click', () => { undo(); close(); });
    el.append(btn);
  }
  $('#toasts').append(el);
  setTimeout(close, undo ? Math.max(ms, 5200) : ms);
}

// ---------- categories ----------
const CATEGORY_EMOJI = {
  movies: '🎬', books: '📚', courses: '🎓', jobs: '💼', apps: '📱', games: '🎮', technology: '💡',
};
export const catSlug = (category = '') => category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const catEmoji = (category = '') => CATEGORY_EMOJI[catSlug(category)] || '✨';
/** data-cat attribute for known categories (their colour token); imported ones fall back to the accent. */
export const catAttr = (category = '') => (CATEGORY_EMOJI[catSlug(category)] ? `data-cat="${catSlug(category)}"` : '');

/** Generated artwork: category gradient, pattern, emoji and the title. Never a broken image. */
export function placeholderHTML(item) {
  return `<div class="ph" ${catAttr(item.category)} role="img" aria-label="${esc(item.title)}">
    <span class="ph-emoji" aria-hidden="true">${catEmoji(item.category)}</span><span class="ph-title">${esc(item.title)}</span></div>`;
}

// How each category's pictures are framed: posters/covers shown whole over a blurred
// copy of themselves, logos on a light tile, photos fill the frame.
const MEDIA_FIT = { movies: 'poster', books: 'poster', games: 'poster', apps: 'logo', technology: 'logo' };
export const mediaFit = (category = '') => MEDIA_FIT[catSlug(category)] || 'cover';

const img = (src, alt, cls = '') =>
  `<img src="${src}" alt="${alt}" ${cls ? `class="${cls}"` : ''} loading="lazy" decoding="async" data-fallback>`;

export function mediaHTML(item) {
  if (!item.image_url) return placeholderHTML(item);
  const src = esc(item.image_url);
  const alt = esc(item.title);
  const fit = mediaFit(item.category);
  if (fit === 'poster') return `<div class="media poster">${img(src, '', 'media-bg')}${img(src, alt)}</div>`;
  if (fit === 'logo') return `<div class="media logo">${img(src, alt)}</div>`;
  return img(src, alt);
}

// Images fade in once loaded; any that fail are swapped for placeholder art (capture phase).
document.addEventListener('load', (e) => {
  if (e.target.tagName === 'IMG') e.target.classList.add('loaded');
}, true);
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el.tagName !== 'IMG' || !el.hasAttribute('data-fallback')) return;
  const host = el.closest('[data-category]');
  const target = el.closest('.media') || el;
  target.outerHTML = placeholderHTML({ title: host?.dataset.title || el.alt, category: host?.dataset.category || '' });
}, true);

// ---------- avatars ----------
export const AVATAR_COLORS = ['violet', 'cyan', 'amber', 'emerald', 'rose', 'indigo'];
export const AVATAR_EMOJIS = ['', '🚀', '🎧', '📚', '🎮', '🧠', '🎬', '🌱', '⚡', '🦊', '🐼', '🌙'];

export function initials(name = '') {
  return name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase() || '?';
}

/** Inner HTML + class for a profile avatar (emoji if chosen, otherwise initials). */
export function avatarInner(profile = {}) {
  return profile.avatar ? `<span class="emoji" aria-hidden="true">${esc(profile.avatar)}</span>` : esc(initials(profile.name));
}
export function paintAvatar(el, profile = {}) {
  if (!el) return;
  el.className = `av ${AVATAR_COLORS.includes(profile.color) ? profile.color : 'violet'}`;
  el.innerHTML = avatarInner(profile);
}

// ---------- formatting ----------
export function formatRating(rating) {
  if (rating == null) return '';
  return `⭐ ${Number(rating).toFixed(1).replace(/\.0$/, '')}`;
}
export function matchClass(p) { return p > 80 ? 'hi' : p > 50 ? 'mid' : ''; }

/** Animate a number counting up inside an element. */
export function countUp(el, to, ms = 700) {
  if (!el) return;
  if (reducedMotion()) { el.textContent = to; return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / ms, 1);
    el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
