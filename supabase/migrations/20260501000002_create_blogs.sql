-- ==========================================
-- Supabase Migration: Create blogs table
-- Created: 2026-05-01
--
-- Core table storing daily synthesized technical briefings, external crawled blogs,
-- and AI-generated learning materials. Referenced by quiz_questions, quiz_attempts,
-- and article_completions.
-- ==========================================

CREATE TABLE IF NOT EXISTS public.blogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    content TEXT,
    summary TEXT,
    url TEXT,
    source TEXT DEFAULT 'ai-synthesis',
    quiz_generated BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for querying briefings and quizzes
CREATE INDEX IF NOT EXISTS idx_blogs_url ON public.blogs (url);
CREATE INDEX IF NOT EXISTS idx_blogs_published_at ON public.blogs (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blogs_quiz_generated ON public.blogs (quiz_generated);

-- Enable Row Level Security
ALTER TABLE public.blogs ENABLE ROW LEVEL SECURITY;

-- Idempotent RLS Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'blogs'
          AND policyname = 'Allow all authenticated users to read blogs'
    ) THEN
        CREATE POLICY "Allow all authenticated users to read blogs"
            ON public.blogs
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'blogs'
          AND policyname = 'Allow anon to read blogs'
    ) THEN
        CREATE POLICY "Allow anon to read blogs"
            ON public.blogs
            FOR SELECT
            TO anon
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'blogs'
          AND policyname = 'Service role full access on blogs'
    ) THEN
        CREATE POLICY "Service role full access on blogs"
            ON public.blogs
            USING (true)
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'blogs'
          AND policyname = 'Admins can modify blogs'
    ) THEN
        CREATE POLICY "Admins can modify blogs"
            ON public.blogs
            FOR ALL
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
