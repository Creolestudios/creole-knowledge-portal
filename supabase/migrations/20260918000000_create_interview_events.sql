-- ==========================================
-- Migration: Create interview_events Table & Supabase Realtime
-- Date: 2026-09-18
-- ==========================================

CREATE TABLE IF NOT EXISTS public.interview_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    ts_ms BIGINT NOT NULL,
    category VARCHAR(50) NOT NULL, -- e.g. 'gaze_away', 'reading_suspected', 'no_face', 'multi_face', 'expression_metrics', 'identity_mismatch'
    severity VARCHAR(20) NOT NULL DEFAULT 'info', -- 'warning', 'info', 'fatal'
    confidence FLOAT DEFAULT 1.0,
    snapshot_path TEXT,
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for quick querying during live monitoring and audit reviews
CREATE INDEX IF NOT EXISTS idx_interview_events_session ON public.interview_events (session_id, ts_ms DESC);
CREATE INDEX IF NOT EXISTS idx_interview_events_category ON public.interview_events (category);

-- Enable Supabase Realtime for live HR monitoring dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE public.interview_events;
