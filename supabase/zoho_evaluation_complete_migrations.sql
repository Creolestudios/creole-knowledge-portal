-- ====================================================================
-- CONSOLIDATED ZOHO EVALUATION SYSTEM MIGRATIONS (1 to 8)
-- Module: Zoho Evaluation Module (Creole Knowledge Portal)
-- Run this in Supabase Dashboard -> SQL Editor (or via CLI)
-- ====================================================================

-- ####################################################################
-- MIGRATION 1 of 8: 20261028000000_create_zoho_evaluation_system.sql
-- Core Zoho evaluation tables, mappings, and security policies
-- ####################################################################

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


-- ####################################################################
-- MIGRATION 2 of 8: 20261030000000_add_senior_emails_to_user_profiles.sql
-- Add senior_emails TEXT[] array for CCing reporting seniors
-- ####################################################################

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_profiles'
          AND column_name = 'senior_emails'
    ) THEN
        ALTER TABLE public.user_profiles
        ADD COLUMN senior_emails TEXT[] DEFAULT '{}'::text[];
    END IF;
END $$;


-- ####################################################################
-- MIGRATION 3 of 8: 20261030000001_add_daily_email_enabled_to_user_profiles.sql
-- Toggle automated daily 10 PM evaluation emails per user
-- ####################################################################

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS daily_email_enabled BOOLEAN DEFAULT true;

UPDATE public.user_profiles
SET daily_email_enabled = true
WHERE daily_email_enabled IS NULL;


-- ####################################################################
-- MIGRATION 4 of 8: 20261102000000_create_admin_digest_recipients.sql
-- Consolidated 10 PM team digest recipients table & RLS policies
-- ####################################################################

CREATE TABLE IF NOT EXISTS public.admin_digest_recipients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin', 'manager')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_admin_digest_recipients_email ON public.admin_digest_recipients (email);
CREATE INDEX IF NOT EXISTS idx_admin_digest_recipients_active ON public.admin_digest_recipients (is_active);

ALTER TABLE public.admin_digest_recipients ENABLE ROW LEVEL SECURITY;

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


-- ####################################################################
-- MIGRATION 5 of 8: 20261103000000_create_zoho_evaluation_rules.sql
-- Configurable evaluation rules and criteria JSON configuration
-- ####################################################################

CREATE TABLE IF NOT EXISTS public.zoho_evaluation_rules (
    id TEXT PRIMARY KEY DEFAULT 'global',
    rules_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);


-- ####################################################################
-- MIGRATION 6 of 8: 20261106000000_alter_years_of_experience_to_numeric.sql
-- Support fractional years of experience (e.g. 1.5, 2.5 yrs)
-- ####################################################################

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_profiles'
          AND column_name = 'years_of_experience'
    ) THEN
        ALTER TABLE public.user_profiles
        ALTER COLUMN years_of_experience TYPE NUMERIC(4, 1)
        USING years_of_experience::NUMERIC(4, 1);
    END IF;
END $$;


-- ####################################################################
-- MIGRATION 7 of 8: 20261112000000_add_pr_evidence_and_github_username.sql
-- GitHub profile linkage and PR evidence verification array
-- ####################################################################

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS github_username TEXT;

ALTER TABLE public.zoho_task_evaluations
ADD COLUMN IF NOT EXISTS pr_evidence JSONB DEFAULT '[]'::jsonb;


-- ####################################################################
-- MIGRATION 8 of 8: 20261116000000_allow_planned_tasks_in_zoho_tasks.sql
-- Next-day planner, queued draft tasks & weekly container hierarchy
-- ####################################################################

-- 1. Modify zoho_tasks to support pre-sync planned tasks (before 10:00 PM cron)
ALTER TABLE public.zoho_tasks 
    ALTER COLUMN zoho_task_id DROP NOT NULL;

ALTER TABLE public.zoho_tasks 
    ALTER COLUMN zoho_link DROP NOT NULL;

-- 2. Add sync_status and container reference columns
ALTER TABLE public.zoho_tasks 
    ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced' 
    CHECK (sync_status IN ('queued', 'synced', 'failed'));

ALTER TABLE public.zoho_tasks 
    ADD COLUMN IF NOT EXISTS planned_bucket_subtask_id TEXT;

ALTER TABLE public.zoho_tasks 
    ADD COLUMN IF NOT EXISTS planned_placeholder_task_id TEXT;

-- 3. Composite index for fast querying of planned & queued tasks
CREATE INDEX IF NOT EXISTS idx_zoho_tasks_user_date_sync 
ON public.zoho_tasks(user_id, task_date, sync_status);

-- 4. Create weekly container cache table to map Level 1 Main Task & Level 2 user buckets
CREATE TABLE IF NOT EXISTS public.zoho_weekly_containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_number INT NOT NULL,
    year INT NOT NULL,
    zoho_project_id TEXT NOT NULL,
    admin_parent_task_id TEXT NOT NULL,
    admin_parent_task_name TEXT NOT NULL,
    user_subtask_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    UNIQUE(week_number, year, zoho_project_id)
);

CREATE INDEX IF NOT EXISTS idx_zoho_weekly_containers_lookup 
ON public.zoho_weekly_containers(week_number, year, zoho_project_id);

-- 5. RLS Policies on zoho_tasks for inserting/deleting planned tasks
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_tasks' AND policyname = 'Users insert own planned zoho_tasks') THEN
        CREATE POLICY "Users insert own planned zoho_tasks" ON public.zoho_tasks
            FOR INSERT TO authenticated
            WITH CHECK (user_id = auth.uid());
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_tasks' AND policyname = 'Users delete own planned zoho_tasks') THEN
        CREATE POLICY "Users delete own planned zoho_tasks" ON public.zoho_tasks
            FOR DELETE TO authenticated
            USING (user_id = auth.uid() AND sync_status = 'queued');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_weekly_containers' AND policyname = 'Admins manage zoho_weekly_containers') THEN
        CREATE POLICY "Admins manage zoho_weekly_containers" ON public.zoho_weekly_containers
            FOR ALL TO authenticated
            USING (EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = auth.uid() AND role = 'admin'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zoho_weekly_containers' AND policyname = 'Users view zoho_weekly_containers') THEN
        CREATE POLICY "Users view zoho_weekly_containers" ON public.zoho_weekly_containers
            FOR SELECT TO authenticated
            USING (true);
    END IF;
END $$;
