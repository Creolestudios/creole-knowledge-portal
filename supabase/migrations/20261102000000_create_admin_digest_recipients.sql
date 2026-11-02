-- ==========================================
-- Supabase Migration: Create admin_digest_recipients table
-- Created: 2026-11-02
--
-- Tracks administrator and manager email addresses configured to receive
-- the consolidated daily team performance table report at 10:00 PM IST.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.admin_digest_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Index for lookup and active queries
CREATE INDEX IF NOT EXISTS idx_admin_digest_recipients_email ON public.admin_digest_recipients (email);
CREATE INDEX IF NOT EXISTS idx_admin_digest_recipients_active ON public.admin_digest_recipients (is_active);

-- Enable Row Level Security
ALTER TABLE public.admin_digest_recipients ENABLE ROW LEVEL SECURITY;

-- Idempotent RLS Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'admin_digest_recipients'
          AND policyname = 'Allow authenticated users to read admin digest recipients'
    ) THEN
        CREATE POLICY "Allow authenticated users to read admin digest recipients"
            ON public.admin_digest_recipients
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'admin_digest_recipients'
          AND policyname = 'Allow service role to manage admin digest recipients'
    ) THEN
        CREATE POLICY "Allow service role to manage admin digest recipients"
            ON public.admin_digest_recipients
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;
