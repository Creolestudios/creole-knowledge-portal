-- ==========================================
-- Supabase Migration: Add senior_emails to user_profiles
-- Created: 2026-10-30
--
-- Adds senior_emails TEXT[] array to user_profiles table.
-- Allows administrators to configure reporting senior emails for daily
-- Zoho evaluation notifications.
-- ==========================================

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
