-- ====================================================================
-- Supabase Migration: Dynamic Zoho Evaluation Rules Table
-- Created: 2026-11-03
-- Purpose: Global configurable criteria rules for admin on main dashboard
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.zoho_evaluation_rules (
    id TEXT PRIMARY KEY DEFAULT 'global',
    rules_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

