-- ====================================================================
-- Supabase Migration: Zoho Projects Integration & Task Evaluation Engine
-- Created: 2026-10-28
-- Module: Zoho Evaluation Module
-- ====================================================================

-- 0. Ensure user_profiles has ai_subscriptions column
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS ai_subscriptions TEXT[] DEFAULT '{}'::text[];

-- 1. Integration Settings & OAuth Credentials
CREATE TABLE IF NOT EXISTS public.zoho_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_id TEXT NOT NULL,
    portal_name TEXT,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    access_token_expires_at TIMESTAMPTZ,
    sync_frequency_minutes INT DEFAULT 30,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 2. User Mapping Table (CKP User to Zoho User & AI tool metadata)
CREATE TABLE IF NOT EXISTS public.zoho_user_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    zoho_user_id TEXT NOT NULL UNIQUE,
    zoho_user_email TEXT NOT NULL,
    ai_subscriptions TEXT[] DEFAULT '{"ChatGPT", "GitHub Copilot"}'::text[],
    seniority_level TEXT DEFAULT 'Mid' CHECK (seniority_level IN ('Junior', 'Mid', 'Senior', 'Lead')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 3. Zoho Tasks Table
CREATE TABLE IF NOT EXISTS public.zoho_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zoho_task_id TEXT NOT NULL UNIQUE,
    zoho_project_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    task_name TEXT NOT NULL,
    task_description TEXT,
    zoho_status TEXT NOT NULL, -- 'Open', 'In Progress', 'QA Review', 'Closed'
    is_qa_review BOOLEAN DEFAULT false,
    planned_hours NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    actual_hours NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    planned_minutes INT GENERATED ALWAYS AS (ROUND(planned_hours * 60)) STORED,
    actual_minutes INT GENERATED ALWAYS AS (ROUND(actual_hours * 60)) STORED,
    task_date DATE NOT NULL,
    zoho_link TEXT NOT NULL,
    created_time TIMESTAMPTZ,
    last_modified_time TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 4. Zoho Task Comments
CREATE TABLE IF NOT EXISTS public.zoho_task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zoho_comment_id TEXT NOT NULL UNIQUE,
    zoho_task_id TEXT NOT NULL REFERENCES public.zoho_tasks(zoho_task_id) ON DELETE CASCADE,
    author_name TEXT,
    comment_content TEXT NOT NULL,
    comment_added_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 5. Individual Task Evaluations
CREATE TABLE IF NOT EXISTS public.zoho_task_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.zoho_tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    evaluation_date DATE NOT NULL,
    overall_score INT NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
    time_score INT NOT NULL,
    comment_quality_score INT NOT NULL,
    complexity_score INT NOT NULL,
    repetition_score INT NOT NULL,
    time_variance_minutes INT NOT NULL,
    time_assessment_label TEXT NOT NULL,
    is_repetitive BOOLEAN DEFAULT false,
    repetition_similarity_pct NUMERIC(5, 2) DEFAULT 0.00,
    matched_repetitive_task_id TEXT,
    summary_feedback TEXT NOT NULL,
    strengths TEXT[] DEFAULT '{}'::text[],
    improvements TEXT[] DEFAULT '{}'::text[],
    ai_model_used TEXT DEFAULT 'gemini-2.5-flash',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- 6. User Daily Evaluation Aggregation
CREATE TABLE IF NOT EXISTS public.zoho_daily_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    evaluation_date DATE NOT NULL,
    total_tasks INT DEFAULT 0,
    done_tasks INT DEFAULT 0,
    qa_review_tasks INT DEFAULT 0,
    delayed_tasks INT DEFAULT 0,
    total_planned_hours NUMERIC(6, 2) DEFAULT 0.00,
    total_actual_hours NUMERIC(6, 2) DEFAULT 0.00,
    daily_score INT NOT NULL CHECK (daily_score BETWEEN 0 AND 100),
    daily_summary TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, evaluation_date)
);

-- 7. Till-Date / Weekly Summary Rollup
CREATE TABLE IF NOT EXISTS public.zoho_user_weekly_rollups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL,
    week_end_date DATE NOT NULL,
    till_date_done_tasks INT DEFAULT 0,
    till_date_not_done_tasks INT DEFAULT 0,
    till_date_delayed_tasks INT DEFAULT 0,
    weekly_avg_score INT DEFAULT 0,
    ai_productivity_index NUMERIC(4, 2) DEFAULT 1.00,
    weekly_remarks TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    UNIQUE(user_id, week_start_date)
);

-- Indexes for Fast Querying & Filtering
CREATE INDEX IF NOT EXISTS idx_zoho_tasks_user_date ON public.zoho_tasks(user_id, task_date);
CREATE INDEX IF NOT EXISTS idx_zoho_tasks_project ON public.zoho_tasks(zoho_project_id);
CREATE INDEX IF NOT EXISTS idx_zoho_task_eval_date ON public.zoho_task_evaluations(user_id, evaluation_date);
CREATE INDEX IF NOT EXISTS idx_zoho_daily_eval_date ON public.zoho_daily_evaluations(user_id, evaluation_date);
CREATE INDEX IF NOT EXISTS idx_zoho_user_mappings_email ON public.zoho_user_mappings(zoho_user_email);

-- Enable Row Level Security (RLS)
ALTER TABLE public.zoho_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_user_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_task_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_daily_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zoho_user_weekly_rollups ENABLE ROW LEVEL SECURITY;

-- Idempotent RLS Policies
DO $$
BEGIN
    -- zoho_integrations: admin only
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_integrations' AND policyname = 'Admins manage zoho_integrations') THEN
        CREATE POLICY "Admins manage zoho_integrations" ON public.zoho_integrations
            FOR ALL TO authenticated
            USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin'));
    END IF;

    -- zoho_user_mappings
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_user_mappings' AND policyname = 'Admins manage zoho_user_mappings') THEN
        CREATE POLICY "Admins manage zoho_user_mappings" ON public.zoho_user_mappings
            FOR ALL TO authenticated
            USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_user_mappings' AND policyname = 'Users view own zoho_user_mappings') THEN
        CREATE POLICY "Users view own zoho_user_mappings" ON public.zoho_user_mappings
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());
    END IF;

    -- zoho_tasks
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_tasks' AND policyname = 'Admins manage zoho_tasks') THEN
        CREATE POLICY "Admins manage zoho_tasks" ON public.zoho_tasks
            FOR ALL TO authenticated
            USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_tasks' AND policyname = 'Users view own zoho_tasks') THEN
        CREATE POLICY "Users view own zoho_tasks" ON public.zoho_tasks
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());
    END IF;

    -- zoho_task_evaluations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_task_evaluations' AND policyname = 'Admins manage zoho_task_evaluations') THEN
        CREATE POLICY "Admins manage zoho_task_evaluations" ON public.zoho_task_evaluations
            FOR ALL TO authenticated
            USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_task_evaluations' AND policyname = 'Users view own zoho_task_evaluations') THEN
        CREATE POLICY "Users view own zoho_task_evaluations" ON public.zoho_task_evaluations
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());
    END IF;

    -- zoho_daily_evaluations
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_daily_evaluations' AND policyname = 'Admins manage zoho_daily_evaluations') THEN
        CREATE POLICY "Admins manage zoho_daily_evaluations" ON public.zoho_daily_evaluations
            FOR ALL TO authenticated
            USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_daily_evaluations' AND policyname = 'Users view own zoho_daily_evaluations') THEN
        CREATE POLICY "Users view own zoho_daily_evaluations" ON public.zoho_daily_evaluations
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());
    END IF;

    -- zoho_user_weekly_rollups
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_user_weekly_rollups' AND policyname = 'Admins manage zoho_user_weekly_rollups') THEN
        CREATE POLICY "Admins manage zoho_user_weekly_rollups" ON public.zoho_user_weekly_rollups
            FOR ALL TO authenticated
            USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_user_weekly_rollups' AND policyname = 'Users view own zoho_user_weekly_rollups') THEN
        CREATE POLICY "Users view own zoho_user_weekly_rollups" ON public.zoho_user_weekly_rollups
            FOR SELECT TO authenticated
            USING (user_id = auth.uid());
    END IF;
END $$;
