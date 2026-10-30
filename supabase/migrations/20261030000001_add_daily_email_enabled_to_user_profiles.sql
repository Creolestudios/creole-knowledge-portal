-- Migration: Add daily_email_enabled to user_profiles
-- Purpose: Allows admins to toggle which users receive automated 10 PM daily Zoho evaluation emails.

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS daily_email_enabled BOOLEAN DEFAULT true;

-- Update existing profiles to have daily_email_enabled = true if null
UPDATE public.user_profiles
SET daily_email_enabled = true
WHERE daily_email_enabled IS NULL;
