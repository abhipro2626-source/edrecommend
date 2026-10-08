// Supabase Auth: sign up, log in, log out, profile read/write.
// Uses only the public ANON key; Row Level Security protects every table.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export let sb = null;
export let API_BASE = '';

/** Load config.js and create the Supabase client. Returns false if not configured. */
export async function initAuth() {
  try {
    const cfg = await import('./config.js');
    const placeholder = (v) => !v || /YOUR-PROJECT|your-anon|PASTE/i.test(v);
    if (placeholder(cfg.SUPABASE_URL) || placeholder(cfg.SUPABASE_ANON_KEY)) return false;
    API_BASE = cfg.API_BASE || '';
    sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return true;
  } catch {
    return false;
  }
}

/** Translate Supabase auth errors into friendly sentences. */
export function friendlyAuthError(error) {
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('invalid login')) return 'Wrong email or password.';
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'That email is already registered — try logging in.';
  if (msg.includes('email not confirmed')) return 'Please confirm your email first (check your inbox).';
  if (msg.includes('password should be')) return 'Password must be at least 6 characters.';
  if (msg.includes('valid email') || msg.includes('invalid email')) return 'Please enter a valid email address.';
  if (msg.includes('rate limit')) return 'Too many attempts — please wait a minute.';
  if (msg.includes('fetch')) return "Can't reach Supabase — check your internet connection.";
  return error?.message || 'Something went wrong. Please try again.';
}

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyAuthError(error));
  return data.session;
}

/** Returns the session, or null when email confirmation is required. */
export async function signUp(name, email, password) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    // Confirmation emails link back to whichever site the person signed up on (local, Netlify…).
    options: { data: { name }, emailRedirectTo: location.origin },
  });
  if (error) throw new Error(friendlyAuthError(error));
  if (data.user && data.user.identities?.length === 0) throw new Error('That email is already registered — try logging in.');
  return data.session;
}

export async function signOut() {
  await sb.auth.signOut().catch(() => {});
}

export async function loadProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  // Trigger may not have run (e.g. schema added after sign-up) — create it ourselves.
  const { data: created, error: insertError } = await sb.from('profiles')
    .insert({ id: userId, name: '' }).select().single();
  if (insertError) throw insertError;
  return created;
}

export async function updateProfile(userId, fields) {
  const { data, error } = await sb.from('profiles').update(fields).eq('id', userId).select().single();
  if (error) throw error;
  return data;
}
