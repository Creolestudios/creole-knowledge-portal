-- ==========================================
-- Migration: Fix interview_events schema, snapshot storage,
--            and add per-type proctoring warning counts
-- Date: 2026-09-23
-- ==========================================

-- ─── 1. Align interview_events columns ───────────────────────────────────────
-- The first migration (20260918000000) created: ts_ms, category, confidence, snapshot_path
-- The second migration (20260918120000) created: event_type, metadata
-- The events API route uses: category, ts_ms, confidence, snapshot_path, meta
-- We align the table to the API's expectation using ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.interview_events
  ADD COLUMN IF NOT EXISTS ts_ms BIGINT,
  ADD COLUMN IF NOT EXISTS category VARCHAR(50),
  ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS snapshot_path TEXT,
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

-- Back-fill category from event_type for existing rows (safe no-op if column already exists)
UPDATE public.interview_events
SET category = event_type
WHERE category IS NULL AND event_type IS NOT NULL;

-- Back-fill meta from metadata for existing rows
UPDATE public.interview_events
SET meta = metadata
WHERE meta = '{}'::jsonb AND metadata IS NOT NULL AND metadata != '{}'::jsonb;

-- Back-fill ts_ms for existing rows that have created_at
UPDATE public.interview_events
SET ts_ms = EXTRACT(EPOCH FROM created_at) * 1000
WHERE ts_ms IS NULL;

-- Add index on category for fast proctoring queries
CREATE INDEX IF NOT EXISTS idx_interview_events_category_session
  ON public.interview_events (session_id, category);

-- ─── 2. interview-snapshots storage bucket ───────────────────────────────────
-- Evidence JPEG snapshots captured during proctoring events.
-- Private bucket; only service role (server API routes) writes.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'interview-snapshots',
  'interview-snapshots',
  false,
  5242880, -- 5 MB per snapshot
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ─── 3. Per-type proctoring warning counts on interview_sessions ──────────────
-- Tracks face, object, and voice warnings individually so the HR report can
-- show a breakdown rather than just a combined total.

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS face_warning_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS object_warning_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_warning_count INTEGER NOT NULL DEFAULT 0;

-- Partial index so the HR dashboard can efficiently query sessions with violations
CREATE INDEX IF NOT EXISTS idx_interview_sessions_warnings
  ON public.interview_sessions (face_warning_count, object_warning_count, voice_warning_count)
  WHERE face_warning_count > 0 OR object_warning_count > 0 OR voice_warning_count > 0;

NOTIFY pgrst, 'reload schema';
