// Talks to the FastAPI backend (with the user's JWT) and keeps the user's
// interaction state. Likes / dislikes / saves / views / searches are written
// directly to Supabase with supabase-js — RLS guarantees they're the user's own.
import { sb, API_BASE, signOut } from './auth.js';

/** App-wide state for the signed-in user. */
export const state = {
  user: null,
  profile: null,
  likes: new Set(),
  saves: new Set(),
  dislikes: new Set(),
  categories: ['All'],
  weights: null,
  rowsStale: true,
  onSessionExpired: () => {},
};

export class ApiError extends Error {}

async function token() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token || '';
}

/** fetch() wrapper: adds the JWT and turns every failure into a friendly ApiError. */
export async function api(path, { method = 'GET', body, form } = {}) {
  const send = async (jwt) => {
    try {
      return await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${jwt}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: form || (body ? JSON.stringify(body) : undefined),
      });
    } catch {
      throw new ApiError("Can't reach the EDRecommend server — is it running?");
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

export async function health() {
  try {
    const r = await fetch(`${API_BASE}/api/health`);
    return await r.json();
  } catch {
    return { status: 'offline' };
  }
}

export const recommend = (query, category, offset = 0, limit = 24) =>
  api('/api/recommend', { method: 'POST', body: { query, category, offset, limit } });
export const madeForYou = () => api('/api/made-for-you');
export const similar = (id) => api(`/api/similar/${id}`);
export const itemDetail = (id) => api(`/api/item/${id}`);
export const itemsByIds = (ids) => api(`/api/items?ids=${ids.join(',')}`);
export const taste = () => api('/api/profile/taste');

// ---------------------------------------------------------- interactions
export async function loadInteractions() {
  const { data, error } = await sb.from('interactions').select('item_id,action')
    .in('action', ['like', 'save', 'dislike']);
  if (error) throw error;
  state.likes = new Set(); state.saves = new Set(); state.dislikes = new Set();
  for (const row of data) {
    ({ like: state.likes, save: state.saves, dislike: state.dislikes })[row.action].add(row.item_id);
  }
}

const setFor = (action) => ({ like: state.likes, save: state.saves, dislike: state.dislikes })[action];

/**
 * Toggle like / dislike / save. Optimistic: state changes immediately and
 * is rolled back if Supabase rejects the write. Liking removes a dislike and
 * vice versa. Returns the new on/off state.
 */
export async function toggle(action, itemId) {
  const set = setFor(action);
  const turningOn = !set.has(itemId);
  const opposite = action === 'like' ? 'dislike' : action === 'dislike' ? 'like' : null;
  const hadOpposite = opposite && setFor(opposite).has(itemId);
  const hadSave = action === 'dislike' && state.saves.has(itemId);

  // optimistic update
  turningOn ? set.add(itemId) : set.delete(itemId);
  if (turningOn && hadOpposite) setFor(opposite).delete(itemId);
  if (turningOn && hadSave) state.saves.delete(itemId);
  state.rowsStale = true;

  try {
    if (turningOn) {
      const remove = [opposite, action === 'dislike' ? 'save' : null].filter(Boolean);
      if (remove.length) {
        const { error } = await sb.from('interactions').delete().eq('item_id', itemId).in('action', remove);
        if (error) throw error;
      }
      const { error } = await sb.from('interactions').insert({ item_id: itemId, action, user_id: state.user.id });
      if (error) throw error;
    } else {
      const { error } = await sb.from('interactions').delete().match({ item_id: itemId, action });
      if (error) throw error;
    }
    return turningOn;
  } catch (err) {
    // rollback
    turningOn ? set.delete(itemId) : set.add(itemId);
    if (turningOn && hadOpposite) setFor(opposite).add(itemId);
    if (turningOn && hadSave) state.saves.add(itemId);
    throw new ApiError("Couldn't save that — please check your connection.");
  }
}

/** Fire-and-forget behaviour logging (never blocks or breaks the UI). */
export function logView(itemId) {
  sb.from('interactions').insert({ item_id: itemId, action: 'view', user_id: state.user.id }).then(() => {});
}
export function logClick(itemId) {
  sb.from('interactions').insert({ item_id: itemId, action: 'click', user_id: state.user.id }).then(() => {});
}
export function logSearch(query, category) {
  sb.from('searches').insert({ query: query.slice(0, 300), category, user_id: state.user.id }).then(() => {});
}

export async function clearHistory() {
  const uid = state.user.id;
  const a = await sb.from('interactions').delete().eq('user_id', uid);
  const b = await sb.from('searches').delete().eq('user_id', uid);
  if (a.error || b.error) throw new ApiError("Couldn't clear your history. Please try again.");
  state.likes.clear(); state.saves.clear(); state.dislikes.clear();
  state.rowsStale = true;
}
