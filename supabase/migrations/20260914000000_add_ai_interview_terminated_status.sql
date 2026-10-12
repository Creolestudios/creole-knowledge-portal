-- ==========================================
-- AI Interview module: proctoring termination state
-- Created: 2026-09-14
--
-- The candidate-facing proctoring flow (tab switch / camera-mic / screen-share
-- monitoring) needs a server-side terminal state so a terminated session
-- cannot simply be resumed by refreshing the page and re-submitting the
-- passcode. Adds 'terminated' to the status enum plus bookkeeping columns.
-- ==========================================

ALTER TABLE public.ai_interviews
  DROP CONSTRAINT IF EXISTS ai_interviews_status_check;

ALTER TABLE public.ai_interviews
  ADD CONSTRAINT ai_interviews_status_check
    CHECK (status IN ('pending', 'in_progress', 'completed', 'expired', 'terminated'));

ALTER TABLE public.ai_interviews
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz,
  ADD COLUMN IF NOT EXISTS termination_reason text;

NOTIFY pgrst, 'reload schema';
