-- ==========================================
-- Supabase Migration: Alter years_of_experience to NUMERIC(4, 1)
-- Created: 2026-11-06
--
-- Changes years_of_experience from INTEGER to NUMERIC(4, 1)
-- to allow fractional/decimal years of experience (e.g. 1.5, 2.5, 3.5).
-- ==========================================

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

