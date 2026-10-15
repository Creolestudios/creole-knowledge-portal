-- ==========================================
-- Supabase Migration: Create interview_reports table
-- Created: 2026-09-23
--
-- Stores synthesized assessment reports for completed interview sessions,
-- including performance scores, integrity breakdown, communication ratings,
-- and executive feedback summary.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.interview_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID UNIQUE NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
    performance_score INTEGER DEFAULT 0 CHECK (performance_score BETWEEN 0 AND 100),
    english_score INTEGER DEFAULT 0 CHECK (english_score BETWEEN 0 AND 100),
    capability_score INTEGER DEFAULT 0 CHECK (capability_score BETWEEN 0 AND 100),
    integrity_score INTEGER DEFAULT 0 CHECK (integrity_score BETWEEN 0 AND 100),
    end_reason VARCHAR(50) DEFAULT 'completed',
    generated_summary TEXT,
    detailed_feedback JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for fast session lookup
CREATE INDEX IF NOT EXISTS idx_interview_reports_session_id ON public.interview_reports (session_id);

-- Enable Row Level Security
ALTER TABLE public.interview_reports ENABLE ROW LEVEL SECURITY;

-- Idempotent RLS Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'interview_reports'
          AND policyname = 'Service role full access on interview_reports'
    ) THEN
        CREATE POLICY "Service role full access on interview_reports"
            ON public.interview_reports
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'interview_reports'
          AND policyname = 'Admins can read interview reports'
    ) THEN
        CREATE POLICY "Admins can read interview reports"
            ON public.interview_reports
            FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.user_profiles
                    WHERE user_profiles.user_id = auth.uid()
                      AND user_profiles.role = 'admin'
                )
            );
    END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
