-- ====================================================================
-- Supabase Migration: Add GitHub Username and PR Evidence
-- Created: 2026-11-12
-- Module: Zoho Task Evaluation & Proof-of-Work Verification
-- ====================================================================

-- 1. Add github_username to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS github_username TEXT;

-- 2. Add pr_evidence to zoho_task_evaluations
ALTER TABLE public.zoho_task_evaluations
ADD COLUMN IF NOT EXISTS pr_evidence JSONB DEFAULT '[]'::jsonb;
