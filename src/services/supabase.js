// ═══════════════════════════════════════════════════════════
// Supabase Client — browser-side (uses anon key, safe to expose)
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — auth/DB features disabled'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

// ── Auth helpers ───────────────────────────────────────────

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

export async function getUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

// ── DB helpers (for caching research data per-user) ────────

export async function saveResearchCache(type, data) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: result, error } = await supabase
    .from('research_cache')
    .upsert({
      user_id: user.id,
      data_type: type,
      data,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id,data_type',
    })
    .select()
    .single();

  if (error) {
    console.warn('[Supabase] Cache save failed:', error.message);
    return null;
  }
  return result;
}

export async function loadResearchCache(type) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('research_cache')
    .select('data, updated_at')
    .eq('user_id', user.id)
    .eq('data_type', type)
    .single();

  if (error) return null;
  return data;
}

export async function saveActivityLog(entries) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('activity_logs').insert(
    entries.map((e) => ({
      user_id: user.id,
      message: e.msg,
      log_type: e.type,
      logged_at: new Date().toISOString(),
    }))
  );
}
