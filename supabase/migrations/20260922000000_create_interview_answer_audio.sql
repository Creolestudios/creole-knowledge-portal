-- ==========================================
-- Candidate spoken answers: audio storage + one row per answered question
-- Created: 2026-09-22
--
-- `interview_answers` already exists (20260917000000_create_ai_interview_question_system.sql)
-- with exactly the columns this feature needs (transcript, audio_storage_path, timings).
-- Two things were missing for it to actually be written to:
--   1. a unique key so re-answering a question (candidate navigates Previous → Next)
--      overwrites that answer instead of inserting a duplicate row, and
--   2. a private bucket to hold the recorded audio.
-- ==========================================

CREATE UNIQUE INDEX IF NOT EXISTS interview_answers_session_question_uidx
  ON public.interview_answers (session_id, question_id);

-- Private bucket: only supabaseAdmin (service role, server-only API routes) reads/writes.
-- Candidates and admins never touch Storage directly — an admin replaying an answer gets a
-- short-lived signed URL generated server-side, same as `ai-interview-documents`.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'interview-answer-audio',
  'interview-answer-audio',
  false,
  26214400, -- 25 MB per answer, generous for a few minutes of speech
  ARRAY[
    'audio/webm',
    'audio/mp4',
    'audio/ogg'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
