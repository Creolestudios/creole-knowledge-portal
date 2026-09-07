-- ==========================================
-- Quiz proctoring: events + media metadata + private bucket
-- Created: 2026-09-07
--
-- ADDITIVE ONLY. Does not ALTER quiz_attempts, quiz_answers,
-- quiz_questions, or any other existing application tables.
--
-- Purpose:
--   1) quiz_proctor_events  — audit trail for screen/camera/tab (and future) signals
--   2) quiz_proctor_media    — metadata for screen/webcam recording chunks in Storage
--   3) storage bucket quiz-proctor-media — private object store (7-day retention via app job)
--
-- Retention:
--   - Event rows are kept (audit).
--   - Media objects are intended to expire after ~7 days (expires_at); a separate
--     scheduled job must call Storage remove — Supabase has no S3 lifecycle API.
-- ==========================================

-- ---------------------------------------------------------------------------
-- 1) Events (no video — facts only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_proctor_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blog_id uuid NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN (
      'screen_share_granted',
      'screen_share_ended',
      'screen_share_restored',
      'camera_granted',
      'camera_ended',
      'camera_restored',
      'tab_hidden',
      'tab_leave_auto_submit',
      'setup_rejected',
      'gaze_away',
      'gaze_back',
      'face_missing',
      'face_back'
    )),
  question_index integer,
  elapsed_seconds_client integer,
  duration_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_ts timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS quiz_proctor_events_attempt_id_idx
  ON public.quiz_proctor_events (attempt_id, created_at ASC);

CREATE INDEX IF NOT EXISTS quiz_proctor_events_user_blog_idx
  ON public.quiz_proctor_events (user_id, blog_id, created_at DESC);

CREATE INDEX IF NOT EXISTS quiz_proctor_events_type_idx
  ON public.quiz_proctor_events (event_type);

ALTER TABLE public.quiz_proctor_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_proctor_events'
      AND policyname = 'Users can read own proctor events'
  ) THEN
    CREATE POLICY "Users can read own proctor events"
      ON public.quiz_proctor_events
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_proctor_events'
      AND policyname = 'Users can insert own proctor events'
  ) THEN
    CREATE POLICY "Users can insert own proctor events"
      ON public.quiz_proctor_events
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1
          FROM public.quiz_attempts a
          WHERE a.id = attempt_id
            AND a.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_proctor_events'
      AND policyname = 'Service role full access proctor events'
  ) THEN
    CREATE POLICY "Service role full access proctor events"
      ON public.quiz_proctor_events
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2) Media metadata (points at Storage objects; not the blobs themselves)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quiz_proctor_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blog_id uuid NOT NULL,
  stream_type text NOT NULL
    CHECK (stream_type IN ('camera', 'screen')),
  storage_bucket text NOT NULL DEFAULT 'quiz-proctor-media',
  storage_path text NOT NULL,
  chunk_index integer,
  byte_size bigint,
  mime_type text,
  duration_ms integer,
  recorded_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT quiz_proctor_media_path_unique UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS quiz_proctor_media_attempt_id_idx
  ON public.quiz_proctor_media (attempt_id, stream_type, chunk_index ASC NULLS LAST);

CREATE INDEX IF NOT EXISTS quiz_proctor_media_expires_idx
  ON public.quiz_proctor_media (expires_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS quiz_proctor_media_user_blog_idx
  ON public.quiz_proctor_media (user_id, blog_id);

ALTER TABLE public.quiz_proctor_media ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_proctor_media'
      AND policyname = 'Users can read own proctor media rows'
  ) THEN
    CREATE POLICY "Users can read own proctor media rows"
      ON public.quiz_proctor_media
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_proctor_media'
      AND policyname = 'Users can insert own proctor media rows'
  ) THEN
    CREATE POLICY "Users can insert own proctor media rows"
      ON public.quiz_proctor_media
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1
          FROM public.quiz_attempts a
          WHERE a.id = attempt_id
            AND a.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_proctor_media'
      AND policyname = 'Users can update own proctor media rows'
  ) THEN
    -- Soft-delete / metadata fixes by owner; expiry sweep uses service_role.
    CREATE POLICY "Users can update own proctor media rows"
      ON public.quiz_proctor_media
      FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'quiz_proctor_media'
      AND policyname = 'Service role full access proctor media'
  ) THEN
    CREATE POLICY "Service role full access proctor media"
      ON public.quiz_proctor_media
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Private Storage bucket for camera + screen recordings
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quiz-proctor-media',
  'quiz-proctor-media',
  false,
  52428800, -- 50 MB per object (chunk-sized uploads)
  ARRAY[
    'video/webm',
    'video/mp4',
    'application/octet-stream'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {user_id}/{attempt_id}/{stream_type}/{chunk_index}.webm
DROP POLICY IF EXISTS "quiz_proctor_media_select_own" ON storage.objects;
CREATE POLICY "quiz_proctor_media_select_own"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'quiz-proctor-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "quiz_proctor_media_insert_own" ON storage.objects;
CREATE POLICY "quiz_proctor_media_insert_own"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'quiz-proctor-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "quiz_proctor_media_update_own" ON storage.objects;
CREATE POLICY "quiz_proctor_media_update_own"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'quiz-proctor-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'quiz-proctor-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "quiz_proctor_media_delete_own" ON storage.objects;
CREATE POLICY "quiz_proctor_media_delete_own"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'quiz-proctor-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

NOTIFY pgrst, 'reload schema';
