// Talks to the FastAPI backend (with the user's JWT + active profile) and keeps the
// profile's interaction state. Ratings, saves, views and searches are written straight
// to Supabase with supabase-js — RLS guarantees they belong to this account's profile.
import { sb, API_BASE, signOut } from './auth.js';

/** App-wide state for the signed-in account and the active viewer profile. */
export const state = {
  user: null,          // Supabase auth user (the account)
  profile: null,       // account row: is_admin, onboarded
  viewer: null,        // active "Who's exploring?" profile
  viewers: [],         // all profiles on this account
  likes: new Set(),
  loves: new Set(),
  saves: new Set(),
  dislikes: new Set(),
  savedAt: new Map(),  // item id -> when it was saved (for My List sorting)
  categories: ['All'],
  categoryCounts: {},
  weights: null,
  rowsStale: true,
  onSessionExpired: () => {},
};

export class ApiError extends Error {}

async function token() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || '';
}

/** fetch() wrapper: adds the JWT + profile and turns every failure into a friendly ApiError. */
export async function api(path, { method = 'GET', body, form } = {}) {
  const send = async (jwt) => {
    try {
      return await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${jwt}`,
          ...(state.viewer ? { 'X-Profile-Id': state.viewer.id } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: form || (body ? JSON.stringify(body) : undefined),
      });
    } catch {
      throw new ApiError("Can't reach the EDRecommend server. It may be waking up — try again in a moment.");
    }
  };
  let response = await send(await token());
  if (response.status === 401) {
    // The access token may have expired between reading it and the server checking it
    // (e.g. after the tab slept). Refresh once and retry before treating it as a logout.
    const { data: refreshed } = await sb.auth.refreshSession();
    if (refreshed?.session) response = await send(refreshed.session.access_token);
  }
  let data = {};
  try { data = await response.json(); } catch { /* empty or non-JSON body */ }
  if (response.status === 401) {
    await signOut();
    state.onSessionExpired();
    throw new ApiError(data.error || 'Your session has expired. Please log in again.');
  }
  if (!response.ok) throw new ApiError(data.error || `Request failed (${response.status}).`);
  return data;
}

/**
 * Server status. Never waits longer than `ms`: the free Render server can take ~50s to
 * wake up, and the splash screen must not hang on it.
 */
export async function health(ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
    return await r.json();
  } catch {
    return { status: controller.signal.aborted ? 'waking' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

export const recommend = (query, category, offset = 0, limit = 24) =>
  api('/api/recommend', { method: 'POST', body: { query, category, offset, limit } });
export const home = () => api('/api/made-for-you');                      // { hero, rows }
export const madeForYou = async () => ({ rows: (await home()).rows });
export const categoryPage = (name) => api(`/api/category/${encodeURIComponent(name)}`);
export const similar = (id) => api(`/api/similar/${id}`);
export const itemDetail = (id) => api(`/api/item/${id}`);
export const itemsByIds = (ids) => api(`/api/items?ids=${ids.join(',')}`);
export const taste = () => api('/api/profile/taste');

// ---------------------------------------------------------- viewer profiles
const LAST_PROFILE = 'edr-profile';
export const rememberViewer = (id) => { try { localStorage.setItem(LAST_PROFILE, id); } catch { /* private mode */ } };
export const rememberedViewer = () => { try { return localStorage.getItem(LAST_PROFILE); } catch { return null; } };

export async function loadViewers() {
  const { data, error } = await sb.from('viewer_profiles').select('*').order('created_at');
  if (error) throw new ApiError("Couldn't load your profiles.");
  state.viewers = data || [];
  return state.viewers;
}

export async function createViewer(fields) {
  const { data, error } = await sb.from('viewer_profiles').insert(fields).select().single();
  if (error) throw new ApiError(/up to 5/i.test(error.message) ? 'You can have up to 5 profiles.' : "Couldn't create that profile.");
  state.viewers.push(data);
  return data;
}

export async function updateViewer(id, fields) {
  const { data, error } = await sb.from('viewer_profiles').update(fields).eq('id', id).select().single();
  if (error) throw new ApiError("Couldn't save that profile.");
  state.viewers = state.viewers.map((v) => (v.id === id ? data : v));
  if (state.viewer?.id === id) state.viewer = data;
  return data;
}

export async function deleteViewer(id) {
  const { error } = await sb.from('viewer_profiles').delete().eq('id', id);
  if (error) throw new ApiError("Couldn't delete that profile.");
  state.viewers = state.viewers.filter((v) => v.id !== id);
}

/** Rows written to Supabase carry the account and the active profile. */
const owner = () => ({ user_id: state.user.id, profile_id: state.viewer?.id ?? null });
const scoped = (query) => (state.viewer ? query.eq('profile_id', state.viewer.id) : query.is('profile_id', null));

// ---------------------------------------------------------- interactions
const SETS = () => ({ like: state.likes, love: state.loves, save: state.saves, dislike: state.dislikes });

export async function loadInteractions() {
  const { data, error } = await scoped(sb.from('interactions').select('item_id,action,created_at')
    .in('action', ['like', 'love', 'save', 'dislike'])).order('created_at');
  if (error) throw error;
  state.likes = new Set(); state.loves = new Set(); state.saves = new Set(); state.dislikes = new Set();
  state.savedAt = new Map();
  for (const row of data) {
    SETS()[row.action].add(row.item_id);
    if (row.action === 'save') state.savedAt.set(row.item_id, row.created_at);
  }
}

/** The rating levels are exclusive: Not for me, Like, Love this. Saving is separate. */
const EXCLUSIVE = { like: ['love', 'dislike'], love: ['like', 'dislike'], dislike: ['like', 'love', 'save'], save: ['dislike'] };

/**
 * Toggle like / love / dislike / save. Optimistic: state changes immediately and is
 * rolled back if Supabase rejects the write. Returns the new on/off state.
 */
export async function toggle(action, itemId) {
  const sets = SETS();
  const turningOn = !sets[action].has(itemId);
  const removed = turningOn ? EXCLUSIVE[action].filter((a) => sets[a].has(itemId)) : [];

  turningOn ? sets[action].add(itemId) : sets[action].delete(itemId);
  removed.forEach((a) => sets[a].delete(itemId));
  if (action === 'save') turningOn ? state.savedAt.set(itemId, new Date().toISOString()) : state.savedAt.delete(itemId);
  state.rowsStale = true;

  try {
    if (turningOn) {
      if (removed.length) {
        const { error } = await scoped(sb.from('interactions').delete().eq('item_id', itemId).in('action', removed));
        if (error) throw error;
      }
      const { error } = await sb.from('interactions').insert({ item_id: itemId, action, ...owner() });
      if (error) throw error;
    } else {
      const { error } = await scoped(sb.from('interactions').delete().match({ item_id: itemId, action }));
      if (error) throw error;
    }
    return turningOn;
  } catch {
    turningOn ? sets[action].delete(itemId) : sets[action].add(itemId);
    removed.forEach((a) => sets[a].add(itemId));
    throw new ApiError("Couldn't save that — please check your connection.");
  }
}

/** Fire-and-forget behaviour logging (never blocks or breaks the UI). */
export function logView(itemId) {
  sb.from('interactions').insert({ item_id: itemId, action: 'view', ...owner() }).then(() => {});
}
export function logClick(itemId) {
  sb.from('interactions').insert({ item_id: itemId, action: 'click', ...owner() }).then(() => {});
}
export function logSearch(query, category) {
  sb.from('searches').insert({ query: query.slice(0, 300), category, ...owner() }).then(() => {});
}

export async function recentSearches(limit = 8) {
  const { data } = await scoped(sb.from('searches').select('query').order('created_at', { ascending: false }).limit(30));
  return [...new Set((data || []).map((r) => r.query.trim()).filter(Boolean))].slice(0, limit);
}

export async function clearHistory() {
  const a = await scoped(sb.from('interactions').delete().eq('user_id', state.user.id));
  const b = await scoped(sb.from('searches').delete().eq('user_id', state.user.id));
  if (a.error || b.error) throw new ApiError("Couldn't clear your history. Please try again.");
  [state.likes, state.loves, state.saves, state.dislikes].forEach((s) => s.clear());
  state.savedAt.clear();
  state.rowsStale = true;
}
