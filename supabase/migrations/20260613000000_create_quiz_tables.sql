-- Create the Quiz Questions table
create table public.quiz_questions (
  id uuid default gen_random_uuid() primary key,
  blog_id uuid references public.blogs(id) on delete cascade,
  question_type text not null check (question_type in ('single', 'multiple', 'conceptual', 'code', 'descriptive')),
  difficulty text not null check (difficulty = 'Hard'),
  question text not null,
  options jsonb, -- Array of strings for MCQs
  correct_answers jsonb, -- Array of correct strings/identifiers
  explanation text,
  code_snippet text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.quiz_questions enable row level security;
create policy "Allow read access for authenticated users" on public.quiz_questions for select to authenticated using (true);
create policy "Allow insert/update for service role" on public.quiz_questions for all to service_role using (true);

-- Create Quiz Attempts table
create table public.quiz_attempts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade,
  blog_id uuid references public.blogs(id) on delete cascade,
  status text not null check (status in ('in_progress', 'completed')),
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  completed_at timestamp with time zone,
  score integer,
  percentage numeric,
  total_questions integer not null,
  time_taken_seconds integer,
  unique(user_id, blog_id) -- Enforce maxAttempts = 1
);

-- Enable RLS
alter table public.quiz_attempts enable row level security;
create policy "Users can read own attempts" on public.quiz_attempts for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert own attempts" on public.quiz_attempts for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update own attempts" on public.quiz_attempts for update to authenticated using (auth.uid() = user_id);

-- Create Quiz Answers table
create table public.quiz_answers (
  id uuid default gen_random_uuid() primary key,
  attempt_id uuid references public.quiz_attempts(id) on delete cascade,
  question_id uuid references public.quiz_questions(id) on delete cascade,
  user_answer jsonb,
  is_correct boolean,
  points_awarded integer,
  evaluation_reason text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(attempt_id, question_id) -- One answer per question per attempt
);

-- Enable RLS
alter table public.quiz_answers enable row level security;
create policy "Users can read own answers" on public.quiz_answers for select to authenticated using (
  exists (select 1 from public.quiz_attempts a where a.id = quiz_answers.attempt_id and a.user_id = auth.uid())
);
create policy "Users can insert own answers" on public.quiz_answers for insert to authenticated with check (
  exists (select 1 from public.quiz_attempts a where a.id = attempt_id and a.user_id = auth.uid())
);

-- Update blogs table to track quiz generation
alter table public.blogs add column quiz_generated boolean default false;
