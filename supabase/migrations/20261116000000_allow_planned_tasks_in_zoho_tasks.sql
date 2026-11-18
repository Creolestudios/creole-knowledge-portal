-- ====================================================================
-- Supabase Migration: Allow Next-Day Planned Tasks in zoho_tasks (Option B: Single Table)
-- Created: 2026-11-16
-- Module: Zoho Evaluation Module - Planned Task Lifecycle
-- ====================================================================

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

