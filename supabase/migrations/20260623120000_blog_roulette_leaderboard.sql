-- Database Migration — Blog Roulette Leaderboard
-- Safe: only creates a new table and policies. No impact on existing tables.

CREATE TABLE IF NOT EXISTS roulette_leaderboard (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  badges          TEXT[] DEFAULT ARRAY[]::TEXT[],
  points          INTEGER DEFAULT 0,
  last_blog_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index to optimize querying leaderboard rankings
CREATE INDEX IF NOT EXISTS idx_roulette_leaderboard_points ON roulette_leaderboard(points DESC);

-- Enable Row-Level Security
ALTER TABLE roulette_leaderboard ENABLE ROW LEVEL SECURITY;

-- 1. Anyone authenticated can view the leaderboard scores
CREATE POLICY "leaderboard_read_all" ON roulette_leaderboard
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- 2. Users can create their own leaderboard profile
CREATE POLICY "leaderboard_insert_own" ON roulette_leaderboard
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 3. Users can update their own points/badges (through server client execution context)
CREATE POLICY "leaderboard_update_own" ON roulette_leaderboard
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
