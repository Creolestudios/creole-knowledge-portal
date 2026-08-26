-- ==========================================
-- Supabase Migration: user_activity_logs
-- Created: 2026-08-25
--
-- `GET/POST /api/activity` (the dashboard sidebar activity widget) reads and
-- writes `public.user_activity_logs`. That table is declared inside the large
-- 20260524000000_daily_activity_tracker.sql migration, but that migration was
-- never applied to the live project, so every request failed with:
--
--     PGRST205: Could not find the table 'public.user_activity_logs'
--               in the schema cache
--
-- This migration creates just that one table, standalone and idempotent, so it
-- can be applied on its own without pulling in the rest of the gamification
-- schema (streaks, badges, leaderboards, ...). It is deliberately written to be
-- forward-compatible with 20260524000000: identical column definitions, and
-- every statement guarded with IF NOT EXISTS, so applying either migration
-- first leaves the same result and the other becomes a no-op.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.user_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL, -- e.g. 'article_read', 'quiz_submit', 'login'
    xp_awarded INTEGER DEFAULT 0,
    coins_awarded INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The GET handler filters by user_id + action_type and aggregates by day.
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_date
    ON public.user_activity_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type
    ON public.user_activity_logs (action_type);

ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY has no IF NOT EXISTS before PG15, so guard on the catalogue to
-- keep this migration re-runnable.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'user_activity_logs'
          AND policyname = 'Users can view their own activity logs'
    ) THEN
        CREATE POLICY "Users can view their own activity logs"
            ON public.user_activity_logs
            FOR SELECT USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'user_activity_logs'
          AND policyname = 'Service role can perform any action on activity logs'
    ) THEN
        CREATE POLICY "Service role can perform any action on activity logs"
            ON public.user_activity_logs
            USING (true) WITH CHECK (true);
    END IF;
END
$$;

-- PostgREST caches the schema; without this the table stays invisible to the
-- REST API (and the PGRST205 error persists) until the next automatic reload.
NOTIFY pgrst, 'reload schema';
