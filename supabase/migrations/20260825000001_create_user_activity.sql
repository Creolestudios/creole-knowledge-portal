-- ==========================================
-- Supabase Migration: user_activity
-- Created: 2026-08-25
-- ==========================================

CREATE TABLE IF NOT EXISTS public.user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    read_seconds INTEGER DEFAULT 0,
    quiz_taken BOOLEAN DEFAULT false,
    quiz_score INTEGER DEFAULT 0,
    quiz_total INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_user_activity_user_date ON public.user_activity (user_id, date);
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own daily activity" ON public.user_activity
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can perform any action on daily activity" ON public.user_activity
    USING (true) WITH CHECK (true);
