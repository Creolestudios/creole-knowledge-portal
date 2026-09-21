-- interview_invites and interview_events back the candidate-facing
-- /assess/[token] flow (verify, complete, terminate) and the admin invite
-- step (app/api/interviews/[id]/invite). Both are queried by the app today
-- but were never migrated, so every invite creation 500s with PGRST205.
--
-- All access goes through supabaseAdmin (service role) in server-only API
-- routes — candidates never query these tables directly, so RLS is enabled
-- with no public/authenticated policies, only a service-role bypass.

CREATE TABLE IF NOT EXISTS public.interview_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  passcode_hash text,
  passcode_salt text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'in_progress', 'completed', 'expired', 'revoked')),
  max_warnings integer NOT NULL DEFAULT 3,
  max_alerts integer NOT NULL DEFAULT 3,
  allowed_modes text[] NOT NULL DEFAULT ARRAY['interview']::text[],
  expires_at timestamptz,
  consumed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_invites_session_id
  ON public.interview_invites (session_id);

CREATE TABLE IF NOT EXISTS public.interview_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interview_events_session_id
  ON public.interview_events (session_id);

ALTER TABLE public.interview_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'interview_invites'
      AND policyname = 'Service role full access interview_invites'
  ) THEN
    CREATE POLICY "Service role full access interview_invites"
      ON public.interview_invites
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'interview_events'
      AND policyname = 'Service role full access interview_events'
  ) THEN
    CREATE POLICY "Service role full access interview_events"
      ON public.interview_events
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
