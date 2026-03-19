-- ═══════════════════════════════════════════════════════════
-- RELISH MARKET INTELLIGENCE — Supabase Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ═══════════════════════════════════════════════════════════

-- ── Research Cache ─────────────────────────────────────────
-- Stores fetched data per user: trade flows, pricing, buyers, specs
CREATE TABLE IF NOT EXISTS research_cache (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data_type   TEXT NOT NULL,       -- 'trade', 'price', 'buyer', 'spec'
  data        JSONB NOT NULL,      -- the full research result payload
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT research_cache_unique UNIQUE (user_id, data_type)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_research_cache_user_type 
  ON research_cache (user_id, data_type);

-- ── Activity Logs ──────────────────────────────────────────
-- Persists activity log entries to Supabase
CREATE TABLE IF NOT EXISTS activity_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  log_type    TEXT NOT NULL DEFAULT 'info',   -- info, success, warn, error
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user 
  ON activity_logs (user_id, logged_at DESC);

-- ── API Key Vault (optional — per-user data source keys) ──
-- Users can store their own Volza, Zauba, etc. keys
CREATE TABLE IF NOT EXISTS user_api_keys (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL,       -- 'volza', 'zauba', 'chemanalyst', etc.
  api_key     TEXT NOT NULL,       -- encrypted at rest by Supabase
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT user_api_keys_unique UNIQUE (user_id, source_id)
);

-- ── User Profiles (extends auth.users) ────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  company     TEXT DEFAULT 'Relish Group',
  role        TEXT DEFAULT 'analyst',   -- analyst, admin
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Row-Level Security ─────────────────────────────────────
-- Every user can only see their own data

ALTER TABLE research_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- research_cache policies
CREATE POLICY "Users read own cache"
  ON research_cache FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users write own cache"
  ON research_cache FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own cache"
  ON research_cache FOR UPDATE
  USING (auth.uid() = user_id);

-- activity_logs policies
CREATE POLICY "Users read own logs"
  ON activity_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users write own logs"
  ON activity_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- user_api_keys policies
CREATE POLICY "Users read own keys"
  ON user_api_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own keys"
  ON user_api_keys FOR ALL
  USING (auth.uid() = user_id);

-- profiles policies
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ── Auto-create profile on signup ──────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, company)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name', 'Relish Group');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists, then recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
