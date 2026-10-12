-- ============================================================================
-- Migration: 20260924000000_interview_transcript_and_scoring.sql
-- Description: Adds interview_transcript, interview_turn_metrics, and extends
--              interview_reports for real-time STT, fluency, and cognitive scoring.
-- ============================================================================

-- 1. Real-time Transcript Table
-- Stores chronological spoken utterances by candidate, platform AI, or unauthorized voices.
CREATE TABLE IF NOT EXISTS public.interview_transcript (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  question_ord int,
  speaker text NOT NULL CHECK (speaker IN ('ai', 'candidate', 'unauthorized_voice')),
  text text NOT NULL,
  ts_ms bigint NOT NULL,
  is_flagged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_transcript_session_id ON public.interview_transcript(session_id);
CREATE INDEX IF NOT EXISTS idx_interview_transcript_ts ON public.interview_transcript(session_id, ts_ms);

-- 2. Turn Metrics Table
-- Stores objective, deterministic audio and fluency measurements per answer turn.
CREATE TABLE IF NOT EXISTS public.interview_turn_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  question_ord int,
  turn_index int NOT NULL DEFAULT 0,
  speech_ms int NOT NULL DEFAULT 0,
  pause_ms_total int NOT NULL DEFAULT 0,
  pause_count int NOT NULL DEFAULT 0,
  word_count int NOT NULL DEFAULT 0,
  filler_count int NOT NULL DEFAULT 0,
  response_latency_ms int NOT NULL DEFAULT 0,
  unauthorized_voice_detected boolean NOT NULL DEFAULT false,
  raw_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_turn_metrics_session_id ON public.interview_turn_metrics(session_id);

-- 3. Extend interview_reports for Cognitive, Fluency, and Recommendation Scoring
ALTER TABLE public.interview_reports
  ADD COLUMN IF NOT EXISTS cognitive_composite int,
  ADD COLUMN IF NOT EXISTS reasoning_subscore int,
  ADD COLUMN IF NOT EXISTS clarity_subscore int,
  ADD COLUMN IF NOT EXISTS fluency_score int,
  ADD COLUMN IF NOT EXISTS fluency_cefr text,
  ADD COLUMN IF NOT EXISTS fluency_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS local_metrics jsonb,
  ADD COLUMN IF NOT EXISTS competency_scores jsonb,
  ADD COLUMN IF NOT EXISTS recommendation text,
  ADD COLUMN IF NOT EXISTS recommendation_rationale text,
  ADD COLUMN IF NOT EXISTS flags text[],
  ADD COLUMN IF NOT EXISTS rubric_version text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS llm_tokens_used int DEFAULT 0;

-- 4. Enable RLS
ALTER TABLE public.interview_transcript ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_turn_metrics ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
DROP POLICY IF EXISTS "Service role has full access to interview_transcript" ON public.interview_transcript;
CREATE POLICY "Service role has full access to interview_transcript"
  ON public.interview_transcript
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role has full access to interview_turn_metrics" ON public.interview_turn_metrics;
CREATE POLICY "Service role has full access to interview_turn_metrics"
  ON public.interview_turn_metrics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users (HR/Admin) read access
DROP POLICY IF EXISTS "Authenticated users can read interview_transcript" ON public.interview_transcript;
CREATE POLICY "Authenticated users can read interview_transcript"
  ON public.interview_transcript
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can read interview_turn_metrics" ON public.interview_turn_metrics;
CREATE POLICY "Authenticated users can read interview_turn_metrics"
  ON public.interview_turn_metrics
  FOR SELECT
  TO authenticated
  USING (true);
