-- ==========================================
-- AI Interview module: interviews table + private storage bucket
-- Created: 2026-09-11
--
-- Phase 1 scope: admin uploads a resume + job description (as a file OR
-- pasted text — JDs are most often pasted from an ATS/email), the app
-- generates a shareable link + one-time passcode for the candidate.
-- Later phases (question generation, live session, scoring) build on
-- this table without altering its shape.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.ai_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_name text,
  candidate_email text,
  job_title text,
  resume_storage_path text NOT NULL,
  jd_storage_path text,
  jd_text text,
  access_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (timezone('utc'::text, now()) + interval '7 days'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ai_interviews_jd_source_present CHECK (
    (jd_storage_path IS NOT NULL) OR (jd_text IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ai_interviews_created_by_idx
  ON public.ai_interviews (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_interviews_access_code_idx
  ON public.ai_interviews (access_code);

ALTER TABLE public.ai_interviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_interviews'
      AND policyname = 'Admins can read own interviews'
  ) THEN
    CREATE POLICY "Admins can read own interviews"
      ON public.ai_interviews
      FOR SELECT
      TO authenticated
      USING (auth.uid() = created_by);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_interviews'
      AND policyname = 'Service role full access ai_interviews'
  ) THEN
    CREATE POLICY "Service role full access ai_interviews"
      ON public.ai_interviews
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- Private bucket: only the service role (admin API routes) reads/writes.
-- Candidates never get direct Storage access — files are only ever
-- served through server-side signed URLs when the interview session starts.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-interview-documents',
  'ai-interview-documents',
  false,
  10485760, -- 10 MB per file
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- No public/authenticated storage.objects policies are created here on
-- purpose — only supabaseAdmin (service role) touches this bucket.

NOTIFY pgrst, 'reload schema';
