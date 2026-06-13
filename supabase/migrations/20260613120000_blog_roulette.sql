-- Blog Roulette Module — Isolated tables (prefix: roulette_)
-- Safe: only creates new tables/enums. No modifications to existing schema.

-- =========================================================
-- ENUMS
-- =========================================================
DO $$ BEGIN
  CREATE TYPE roulette_blog_status AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'QUIZ_IN_PROGRESS',
    'REJECTED',
    'PASSED',
    'PUBLISHING',
    'PUBLISHED',
    'PUBLISH_FAILED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE roulette_quiz_result AS ENUM ('PASS', 'SOFT_FAIL', 'REJECT');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =========================================================
-- TABLE: roulette_blogs
-- =========================================================
CREATE TABLE IF NOT EXISTS roulette_blogs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title           TEXT NOT NULL,
  slug            TEXT UNIQUE,
  body_html       TEXT,
  body_md         TEXT,

  seo_title       TEXT,
  meta_description TEXT,
  cover_image_url TEXT,
  tldr            TEXT,

  word_count      INTEGER DEFAULT 0,
  reading_time    INTEGER DEFAULT 0,
  ai_score        NUMERIC(5,2),

  status          roulette_blog_status NOT NULL DEFAULT 'DRAFT',

  submitted_at    TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roulette_blogs_author ON roulette_blogs(author_id);
CREATE INDEX IF NOT EXISTS idx_roulette_blogs_status ON roulette_blogs(status);

-- =========================================================
-- TABLE: roulette_seo_keywords
-- =========================================================
CREATE TABLE IF NOT EXISTS roulette_seo_keywords (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id     UUID NOT NULL REFERENCES roulette_blogs(id) ON DELETE CASCADE,
  keyword     TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('primary', 'long_tail')),
  trend_direction TEXT CHECK (trend_direction IN ('rising', 'stable', 'falling')),
  selected    BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roulette_seo_blog ON roulette_seo_keywords(blog_id);

-- =========================================================
-- TABLE: roulette_blog_tags
-- =========================================================
CREATE TABLE IF NOT EXISTS roulette_blog_tags (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id   UUID NOT NULL REFERENCES roulette_blogs(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  UNIQUE (blog_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_roulette_tags_blog ON roulette_blog_tags(blog_id);

-- =========================================================
-- TABLE: roulette_quiz_attempts
-- =========================================================
CREATE TABLE IF NOT EXISTS roulette_quiz_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id         UUID NOT NULL REFERENCES roulette_blogs(id) ON DELETE CASCADE,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  questions       JSONB NOT NULL,
  answers         JSONB,
  score           INTEGER,
  result          roulette_quiz_result,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_roulette_quiz_blog ON roulette_quiz_attempts(blog_id);

-- =========================================================
-- TABLE: roulette_publish_logs
-- =========================================================
CREATE TABLE IF NOT EXISTS roulette_publish_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id         UUID NOT NULL REFERENCES roulette_blogs(id) ON DELETE CASCADE,
  drive_file_id   TEXT,
  drive_url       TEXT,
  recipients      TEXT[],
  status          TEXT NOT NULL DEFAULT 'pending',
  error_message   TEXT,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roulette_publish_blog ON roulette_publish_logs(blog_id);

-- =========================================================
-- TRIGGER: auto-update updated_at on roulette_blogs
-- =========================================================
CREATE OR REPLACE FUNCTION roulette_blogs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_roulette_blogs_updated_at ON roulette_blogs;
CREATE TRIGGER trg_roulette_blogs_updated_at
  BEFORE UPDATE ON roulette_blogs
  FOR EACH ROW
  EXECUTE FUNCTION roulette_blogs_set_updated_at();

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
ALTER TABLE roulette_blogs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE roulette_seo_keywords    ENABLE ROW LEVEL SECURITY;
ALTER TABLE roulette_blog_tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE roulette_quiz_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE roulette_publish_logs    ENABLE ROW LEVEL SECURITY;

-- Authors can read/write their own blogs
CREATE POLICY "roulette_blogs_author_all" ON roulette_blogs
  FOR ALL
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- Anyone authenticated can read PUBLISHED blogs
CREATE POLICY "roulette_blogs_read_published" ON roulette_blogs
  FOR SELECT
  USING (status = 'PUBLISHED');

-- Cascading policies (own blog → own related rows)
CREATE POLICY "roulette_seo_author" ON roulette_seo_keywords
  FOR ALL
  USING (EXISTS (SELECT 1 FROM roulette_blogs b WHERE b.id = blog_id AND b.author_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM roulette_blogs b WHERE b.id = blog_id AND b.author_id = auth.uid()));

CREATE POLICY "roulette_tags_author" ON roulette_blog_tags
  FOR ALL
  USING (EXISTS (SELECT 1 FROM roulette_blogs b WHERE b.id = blog_id AND b.author_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM roulette_blogs b WHERE b.id = blog_id AND b.author_id = auth.uid()));

CREATE POLICY "roulette_quiz_author" ON roulette_quiz_attempts
  FOR ALL
  USING (EXISTS (SELECT 1 FROM roulette_blogs b WHERE b.id = blog_id AND b.author_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM roulette_blogs b WHERE b.id = blog_id AND b.author_id = auth.uid()));

CREATE POLICY "roulette_publish_author" ON roulette_publish_logs
  FOR ALL
  USING (EXISTS (SELECT 1 FROM roulette_blogs b WHERE b.id = blog_id AND b.author_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM roulette_blogs b WHERE b.id = blog_id AND b.author_id = auth.uid()));
