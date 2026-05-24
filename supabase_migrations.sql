-- ==========================================
-- Supabase Migration: Gamification & Learning Analytics System
-- Created: 2026-05-24
-- ==========================================

-- Enable UUID extension if not already present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Alter existing user_profiles table to support gamification
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS coins INTEGER DEFAULT 0;

-- 1. Table: user_activity_logs
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL, -- e.g. 'article_read', 'quiz_submit', 'login'
    xp_awarded INTEGER DEFAULT 0,
    coins_awarded INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for activity search and metrics calculation
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_date ON public.user_activity_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON public.user_activity_logs (action_type);

-- 2. Table: streaks
CREATE TABLE IF NOT EXISTS public.streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    current_streak INTEGER DEFAULT 0 CHECK (current_streak >= 0),
    longest_streak INTEGER DEFAULT 0 CHECK (longest_streak >= 0),
    last_active_date DATE NOT NULL DEFAULT CURRENT_DATE,
    streak_freezes INTEGER DEFAULT 0 CHECK (streak_freezes >= 0),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for streak check
CREATE INDEX IF NOT EXISTS idx_streaks_user ON public.streaks (user_id);

-- 3. Table: badges
CREATE TABLE IF NOT EXISTS public.badges (
    id VARCHAR(50) PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    rarity VARCHAR(15) DEFAULT 'common' CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
    icon_url TEXT,
    rule_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial badges
INSERT INTO public.badges (id, name, description, rarity) VALUES
('knowledge-contributor', 'Knowledge Contributor', 'Synthesized or logged 5 technical activities.', 'common'),
('consistency-champion', 'Consistency Champion', 'Maintained a 30-day learning streak.', 'rare'),
('deep-dive-expert', 'Deep Dive Expert', 'Completed 15 advanced depth briefings.', 'epic'),
('quiz-master', 'Quiz Master', 'Achieved a perfect score on 10 separate quizzes.', 'epic'),
('fast-learner', 'Fast Learner', 'Completed daily briefing and passed daily quiz within 10 minutes.', 'common'),
('team-collaborator', 'Team Collaborator', 'Won 10 Multiplayer Knowledge Challenges.', 'rare')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    rarity = EXCLUDED.rarity;

-- 4. Table: user_badges
CREATE TABLE IF NOT EXISTS public.user_badges (
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    badge_id VARCHAR(50) NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, badge_id)
);

-- 5. Table: quiz_attempts
CREATE TABLE IF NOT EXISTS public.quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    quiz_id UUID NOT NULL, -- references external synthesized quiz ID
    score INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    answers JSONB NOT NULL, -- array of user answers [{question_id, user_answer, correct_answer, is_correct}]
    time_taken_sec INTEGER NOT NULL,
    xp_earned INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for quiz results
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON public.quiz_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_score ON public.quiz_attempts (score, total_questions);

-- 6. Table: article_completions
CREATE TABLE IF NOT EXISTS public.article_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    blog_id UUID NOT NULL REFERENCES public.blogs(id) ON DELETE CASCADE,
    time_spent_sec INTEGER NOT NULL,
    scroll_depth_pct INTEGER DEFAULT 0 CHECK (scroll_depth_pct BETWEEN 0 AND 100),
    completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for article metrics
CREATE INDEX IF NOT EXISTS idx_article_completions_user ON public.article_completions (user_id);

-- 7. Table: leaderboard_scores
CREATE TABLE IF NOT EXISTS public.leaderboard_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    timeframe VARCHAR(10) NOT NULL CHECK (timeframe IN ('daily', 'weekly', 'monthly', 'all_time')),
    period_start DATE NOT NULL,
    score INTEGER DEFAULT 0 CHECK (score >= 0),
    rank INTEGER,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Composite Unique index for ranking periods
CREATE UNIQUE INDEX IF NOT EXISTS uidx_leaderboard_user_period ON public.leaderboard_scores (user_id, timeframe, period_start);

-- 8. Table: multiplayer_challenges
CREATE TABLE IF NOT EXISTS public.multiplayer_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    opponent_id UUID REFERENCES public.user_profiles(user_id) ON DELETE SET NULL,
    quiz_id UUID NOT NULL,
    status VARCHAR(15) DEFAULT 'waiting' CHECK (status IN ('waiting', 'matched', 'ongoing', 'completed')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    matched_at TIMESTAMPTZ
);

-- 9. Table: challenge_results
CREATE TABLE IF NOT EXISTS public.challenge_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES public.multiplayer_challenges(id) ON DELETE CASCADE,
    winner_id UUID REFERENCES public.user_profiles(user_id) ON DELETE SET NULL,
    creator_score INTEGER NOT NULL,
    opponent_score INTEGER NOT NULL,
    creator_time FLOAT NOT NULL,
    opponent_time FLOAT NOT NULL,
    xp_exchanged INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Table: engagement_metrics
CREATE TABLE IF NOT EXISTS public.engagement_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    read_count INTEGER DEFAULT 0,
    quiz_count INTEGER DEFAULT 0,
    avg_quiz_score FLOAT DEFAULT 0.0,
    time_spent_min FLOAT DEFAULT 0.0,
    expertise_vector JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_engagement_user_date ON public.engagement_metrics (user_id, metric_date);

-- ==========================================
-- Enable RLS and standard access policies
-- ==========================================

ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leaderboard_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.multiplayer_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_metrics ENABLE ROW LEVEL SECURITY;

-- 1. user_activity_logs policies
CREATE POLICY "Users can view their own activity logs" ON public.user_activity_logs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can perform any action on activity logs" ON public.user_activity_logs
    USING (true) WITH CHECK (true);

-- 2. streaks policies
CREATE POLICY "Users can view all streaks (for leaderboard)" ON public.streaks
    FOR SELECT USING (true);

CREATE POLICY "Service role can perform any action on streaks" ON public.streaks
    USING (true) WITH CHECK (true);

-- 3. badges policies
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anyone to read badges list" ON public.badges
    FOR SELECT USING (true);

-- 4. user_badges policies
CREATE POLICY "Allow anyone to read user badges collection" ON public.user_badges
    FOR SELECT USING (true);

CREATE POLICY "Service role can unlock badges" ON public.user_badges
    USING (true) WITH CHECK (true);

-- 5. quiz_attempts policies
CREATE POLICY "Users can view their own quiz attempts" ON public.quiz_attempts
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can write quiz attempts" ON public.quiz_attempts
    USING (true) WITH CHECK (true);

-- 6. article_completions policies
CREATE POLICY "Users can view their own article completions" ON public.article_completions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can write article completions" ON public.article_completions
    USING (true) WITH CHECK (true);

-- 7. leaderboard_scores policies
CREATE POLICY "Allow public read access to leaderboard scores" ON public.leaderboard_scores
    FOR SELECT USING (true);

-- ==========================================
-- Postgres Triggers / Helpers
-- ==========================================

-- Trigger to auto-sync XP updates in user_profiles when logs are created
CREATE OR REPLACE FUNCTION public.sync_profile_xp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.user_profiles
    SET 
        updated_at = NOW()
    WHERE user_id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER trg_sync_profile_xp
AFTER INSERT ON public.user_activity_logs
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_xp();
