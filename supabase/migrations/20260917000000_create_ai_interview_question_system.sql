-- AI Interview question bank and candidate question sets
-- Creates the reusable admin question bank and the session-specific question snapshot.

CREATE TABLE IF NOT EXISTS public.interview_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_name text,
  candidate_email text,
  candidate_phone text,
  resume_storage_path text,
  jd_storage_path text,
  parsed_resume jsonb NOT NULL DEFAULT '{}'::jsonb,
  parsed_jd jsonb NOT NULL DEFAULT '{}'::jsonb,
  skill_gap jsonb NOT NULL DEFAULT '{}'::jsonb,
  experience_level varchar(50) NOT NULL DEFAULT 'mid',
  question_count integer,
  duration_minutes integer,
  similarity_confirmed boolean NOT NULL DEFAULT false,
  status varchar(30) NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_sessions_question_count_check CHECK (question_count IS NULL OR question_count > 0),
  CONSTRAINT interview_sessions_duration_check CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  CONSTRAINT interview_sessions_status_check CHECK (
    status IN ('draft', 'parsed', 'questions_generated', 'invite_issued', 'in_progress', 'completed', 'cancelled')
  )
);

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS question_count integer,
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS similarity_confirmed boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.hr_question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  question_text text NOT NULL,
  category varchar(50) NOT NULL DEFAULT 'hr',
  difficulty varchar(20) NOT NULL DEFAULT 'medium',
  required_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  intent text,
  is_mandatory boolean NOT NULL DEFAULT false,
  default_order integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_question_bank_category_check CHECK (
    category IN (
      'hr', 'behavioral', 'experience_overview', 'role_alignment',
      'project_experience', 'teamwork', 'adaptability', 'conflict_resolution',
      'work_preferences', 'career_vision', 'culture_fit'
    )
  ),
  CONSTRAINT hr_question_bank_difficulty_check CHECK (difficulty IN ('easy', 'medium', 'hard')),
  CONSTRAINT hr_question_bank_unique_question UNIQUE (category, question_text)
);

ALTER TABLE public.hr_question_bank
  ADD COLUMN IF NOT EXISTS required_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.hr_question_bank
  DROP CONSTRAINT IF EXISTS hr_question_bank_category_check;

ALTER TABLE public.hr_question_bank
  ADD CONSTRAINT hr_question_bank_category_check CHECK (
    category IN (
      'hr', 'behavioral', 'experience_overview', 'role_alignment',
      'project_experience', 'teamwork', 'adaptability', 'conflict_resolution',
      'work_preferences', 'career_vision', 'culture_fit'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS hr_question_bank_category_question_uidx
  ON public.hr_question_bank(category, question_text);

CREATE TABLE IF NOT EXISTS public.interview_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  question_bank_id uuid REFERENCES public.hr_question_bank(id) ON DELETE SET NULL,
  question_text text NOT NULL,
  question_type varchar(30) NOT NULL DEFAULT 'hr',
  category varchar(50) NOT NULL DEFAULT 'hr',
  difficulty varchar(20) NOT NULL DEFAULT 'medium',
  required_skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  intent text,
  evaluation_rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  question_order integer NOT NULL,
  time_limit_sec integer NOT NULL DEFAULT 150,
  is_mandatory_hr boolean NOT NULL DEFAULT false,
  weight integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_questions_type_check CHECK (
    question_type IN ('technical', 'role_specific', 'behavioral', 'situational', 'hr', 'system_design')
  ),
  CONSTRAINT interview_questions_difficulty_check CHECK (difficulty IN ('easy', 'medium', 'hard')),
  CONSTRAINT interview_questions_order_check CHECK (question_order > 0),
  CONSTRAINT interview_questions_time_check CHECK (time_limit_sec > 0)
);

ALTER TABLE public.interview_questions
  ADD COLUMN IF NOT EXISTS question_bank_id uuid REFERENCES public.hr_question_bank(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.interview_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.interview_questions(id) ON DELETE CASCADE,
  transcript text,
  audio_storage_path text,
  time_to_first_response_sec double precision NOT NULL DEFAULT 0,
  total_time_taken_sec double precision NOT NULL DEFAULT 0,
  score integer NOT NULL DEFAULT 0,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_answers_score_check CHECK (score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS interview_sessions_status_idx
  ON public.interview_sessions(status);
CREATE INDEX IF NOT EXISTS interview_sessions_created_by_idx
  ON public.interview_sessions(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS hr_question_bank_category_idx
  ON public.hr_question_bank(category, is_active, default_order);
CREATE INDEX IF NOT EXISTS interview_questions_session_order_idx
  ON public.interview_questions(session_id, question_order);
CREATE INDEX IF NOT EXISTS interview_questions_bank_idx
  ON public.interview_questions(question_bank_id);
CREATE INDEX IF NOT EXISTS interview_answers_session_idx
  ON public.interview_answers(session_id);

INSERT INTO public.hr_question_bank
  (title, question_text, category, difficulty, required_skills, intent, default_order)
VALUES
  ('HR 1', 'Please introduce yourself and highlight the experiences most relevant to this role.', 'hr', 'easy', '["Communication", "Self-Awareness"]', 'Understand the candidate background and communication style.', 1),
  ('HR 2', 'What are the most important factors you consider when evaluating a new opportunity?', 'hr', 'easy', '["Motivation", "Priorities"]', 'Understand candidate motivations and expectations.', 2),
  ('HR 3', 'What type of support helps you perform well when starting a new role?', 'hr', 'easy', '["Self-Awareness", "Communication"]', 'Assess onboarding expectations and self-awareness.', 3),
  ('HR 4', 'What is your notice period and when would you be available to start?', 'hr', 'easy', '["Availability", "Planning"]', 'Confirm practical hiring requirements.', 4),
  ('Behavioral 1', 'Tell us about a challenging professional situation and what you learned from handling it.', 'behavioral', 'medium', '["Reflection", "Judgment"]', 'Assess behavior, ownership, and learning.', 1),
  ('Behavioral 2', 'Describe a time you received difficult feedback and how you responded.', 'behavioral', 'medium', '["Receptiveness", "Growth Mindset"]', 'Assess response to feedback.', 2),
  ('Behavioral 3', 'Tell us about a decision you made with incomplete information.', 'behavioral', 'medium', '["Decision-Making", "Accountability"]', 'Evaluate judgment under uncertainty.', 3),
  ('Behavioral 4', 'Describe a professional mistake and the steps you took afterward.', 'behavioral', 'medium', '["Accountability", "Learning"]', 'Assess ownership and improvement.', 4),
  ('Experience Overview 1', 'Walk us through your career journey and the choices that shaped it.', 'experience_overview', 'easy', '["Communication", "Career Overview"]', 'Understand career progression.', 1),
  ('Experience Overview 2', 'Which previous responsibility best prepared you for this position?', 'experience_overview', 'easy', '["Experience", "Relevance"]', 'Connect past experience to the role.', 2),
  ('Experience Overview 3', 'What achievement from your previous work best represents your capabilities?', 'experience_overview', 'medium', '["Impact", "Communication"]', 'Identify meaningful professional impact.', 3),
  ('Experience Overview 4', 'Which part of your background would you like us to understand better?', 'experience_overview', 'easy', '["Self-Awareness", "Communication"]', 'Give the candidate space to add context.', 4),
  ('Role Alignment 1', 'What interests you most about this role and its responsibilities?', 'role_alignment', 'easy', '["Motivation", "Role Alignment"]', 'Assess interest in the position.', 1),
  ('Role Alignment 2', 'Which requirement of this role matches your strongest experience?', 'role_alignment', 'easy', '["Role Alignment", "Communication"]', 'Assess requirement alignment.', 2),
  ('Role Alignment 3', 'Which aspect of this role would require the most preparation from you?', 'role_alignment', 'medium', '["Self-Awareness", "Planning"]', 'Identify preparation needs honestly.', 3),
  ('Role Alignment 4', 'How would you define success in this role during your first few months?', 'role_alignment', 'medium', '["Planning", "Results Orientation"]', 'Assess expectations and role understanding.', 4),
  ('Project Experience 1', 'Tell us about a project you are proud of and your specific contribution.', 'project_experience', 'medium', '["Ownership", "Project Impact"]', 'Measure personal contribution.', 1),
  ('Project Experience 2', 'What was the biggest challenge in a recent project, and how did you address it?', 'project_experience', 'medium', '["Problem Solving", "Resilience"]', 'Assess project problem-solving.', 2),
  ('Project Experience 3', 'How did you decide what to prioritize during a project?', 'project_experience', 'medium', '["Prioritization", "Planning"]', 'Evaluate project organization.', 3),
  ('Project Experience 4', 'What would you do differently if you repeated one of your previous projects?', 'project_experience', 'medium', '["Reflection", "Continuous Improvement"]', 'Assess learning from project experience.', 4),
  ('Teamwork 1', 'Describe a time you worked with people who had different working styles.', 'teamwork', 'medium', '["Collaboration", "Adaptability"]', 'Assess collaboration across differences.', 1),
  ('Teamwork 2', 'How do you keep teammates informed when your work affects theirs?', 'teamwork', 'easy', '["Communication", "Collaboration"]', 'Evaluate team communication.', 2),
  ('Teamwork 3', 'What role do you naturally take when working in a team?', 'teamwork', 'easy', '["Self-Awareness", "Teamwork"]', 'Understand team contribution style.', 3),
  ('Teamwork 4', 'Tell us about a time your team achieved a result together.', 'teamwork', 'medium', '["Collaboration", "Results"]', 'Assess shared ownership.', 4),
  ('Adaptability 1', 'How do you approach learning an unfamiliar tool, process, or domain?', 'adaptability', 'easy', '["Adaptability", "Learning"]', 'Assess learning agility.', 1),
  ('Adaptability 2', 'Tell us about a time priorities changed unexpectedly.', 'adaptability', 'medium', '["Adaptability", "Prioritization"]', 'Evaluate response to change.', 2),
  ('Adaptability 3', 'How do you maintain quality when you must change direction quickly?', 'adaptability', 'medium', '["Quality", "Resilience"]', 'Assess flexibility under pressure.', 3),
  ('Adaptability 4', 'What is an example of a process or habit you changed after learning something new?', 'adaptability', 'easy', '["Growth Mindset", "Improvement"]', 'Assess continuous improvement.', 4),
  ('Conflict Resolution 1', 'Tell us about a disagreement with a teammate and how you resolved it.', 'conflict_resolution', 'medium', '["Conflict Resolution", "Empathy"]', 'Assess interpersonal judgment.', 1),
  ('Conflict Resolution 2', 'How would you respond if you disagreed with an important decision?', 'conflict_resolution', 'medium', '["Communication", "Professionalism"]', 'Evaluate respectful challenge.', 2),
  ('Conflict Resolution 3', 'Describe a time you helped two people reach an agreement.', 'conflict_resolution', 'medium', '["Mediation", "Communication"]', 'Assess conflict mediation.', 3),
  ('Conflict Resolution 4', 'What do you do when a disagreement starts affecting team progress?', 'conflict_resolution', 'medium', '["Leadership", "Problem Solving"]', 'Assess constructive escalation.', 4),
  ('Work Preferences 1', 'What type of work environment helps you perform at your best?', 'work_preferences', 'easy', '["Self-Awareness", "Communication"]', 'Understand workplace preferences.', 1),
  ('Work Preferences 2', 'How do you organize your work when several tasks are competing for attention?', 'work_preferences', 'medium', '["Organization", "Prioritization"]', 'Evaluate work organization.', 2),
  ('Work Preferences 3', 'How do you prefer to receive direction and feedback from a manager?', 'work_preferences', 'easy', '["Communication", "Self-Awareness"]', 'Assess management communication fit.', 3),
  ('Work Preferences 4', 'How do you maintain focus during repetitive or routine work?', 'work_preferences', 'easy', '["Discipline", "Consistency"]', 'Assess reliability and focus.', 4),
  ('Career Vision 1', 'What professional skills would you like to develop over the next few years?', 'career_vision', 'easy', '["Growth Mindset", "Career Planning"]', 'Understand development goals.', 1),
  ('Career Vision 2', 'How does this role fit into your longer-term career direction?', 'career_vision', 'easy', '["Motivation", "Career Vision"]', 'Assess long-term alignment.', 2),
  ('Career Vision 3', 'What kind of responsibility would you like to take on next?', 'career_vision', 'easy', '["Ambition", "Self-Awareness"]', 'Understand career aspirations.', 3),
  ('Career Vision 4', 'What would make your next career step successful?', 'career_vision', 'easy', '["Planning", "Results Orientation"]', 'Clarify success criteria.', 4),
  ('Culture Fit 1', 'What team values are most important to you?', 'culture_fit', 'easy', '["Values", "Self-Awareness"]', 'Understand cultural preferences.', 1),
  ('Culture Fit 2', 'How do you contribute to a respectful and positive team environment?', 'culture_fit', 'easy', '["Respect", "Teamwork"]', 'Assess contribution to team culture.', 2),
  ('Culture Fit 3', 'How do you work effectively with people whose perspectives differ from yours?', 'culture_fit', 'medium', '["Inclusion", "Empathy"]', 'Assess inclusive collaboration.', 3),
  ('Culture Fit 4', 'What does professional integrity mean in everyday work?', 'culture_fit', 'easy', '["Integrity", "Judgment"]', 'Understand professional values.', 4)
ON CONFLICT (category, question_text) DO NOTHING;

ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interview_sessions_service_role ON public.interview_sessions;
CREATE POLICY interview_sessions_service_role ON public.interview_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS hr_question_bank_service_role ON public.hr_question_bank;
CREATE POLICY hr_question_bank_service_role ON public.hr_question_bank
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS interview_questions_service_role ON public.interview_questions;
CREATE POLICY interview_questions_service_role ON public.interview_questions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS interview_answers_service_role ON public.interview_answers;
CREATE POLICY interview_answers_service_role ON public.interview_answers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';