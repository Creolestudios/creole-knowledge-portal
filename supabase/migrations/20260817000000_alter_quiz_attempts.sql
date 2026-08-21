-- Alter quiz_attempts to support up to 3 attempts per blog and track pass/fail state

-- 1. Drop the 1-attempt constraint on quiz_attempts
ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_user_id_blog_id_key;

-- 2. Add attempt_number and passed columns to quiz_attempts
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS attempt_number integer DEFAULT 1 CHECK (attempt_number IN (1, 2, 3));
ALTER TABLE public.quiz_attempts ADD COLUMN IF NOT EXISTS passed boolean DEFAULT false;

-- 3. Enforce unique constraint per user, blog, and attempt_number
ALTER TABLE public.quiz_attempts DROP CONSTRAINT IF EXISTS quiz_attempts_user_id_blog_id_attempt_number_key;
ALTER TABLE public.quiz_attempts ADD CONSTRAINT quiz_attempts_user_id_blog_id_attempt_number_key UNIQUE (user_id, blog_id, attempt_number);
