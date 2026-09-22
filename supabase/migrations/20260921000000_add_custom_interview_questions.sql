-- Allow admins to assign candidate-specific questions that are not in hr_question_bank.

ALTER TABLE public.interview_questions
  ADD COLUMN IF NOT EXISTS is_custom boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS interview_questions_custom_idx
  ON public.interview_questions(session_id, is_custom);

COMMENT ON COLUMN public.interview_questions.is_custom IS
  'True when the admin wrote this question for a specific candidate instead of selecting it from hr_question_bank.';

NOTIFY pgrst, 'reload schema';
