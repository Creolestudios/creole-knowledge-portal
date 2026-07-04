export type BlogStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'QUIZ_IN_PROGRESS'
  | 'REJECTED'
  | 'PASSED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PUBLISH_FAILED';

export type QuizResult = 'PASS' | 'SOFT_FAIL' | 'REJECT';

export type TrendDirection = 'rising' | 'stable' | 'falling';

export interface RouletteBlog {
  id: string;
  author_id: string;
  title: string;
  slug: string | null;
  body_html: string | null;
  body_md: string | null;
  seo_title: string | null;
  meta_description: string | null;
  cover_image_url: string | null;
  tldr: string | null;
  word_count: number;
  reading_time: number;
  ai_score: number | null;
  status: BlogStatus;
  submitted_at: string | null;
  published_at: string | null;
  drive_url: string | null;
  drive_file_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RouletteSeoKeyword {
  id: string;
  blog_id: string;
  keyword: string;
  type: 'primary' | 'long_tail';
  trend_direction: TrendDirection | null;
  selected: boolean;
  created_at: string;
}

export interface RouletteBlogTag {
  id: string;
  blog_id: string;
  tag: string;
}

export interface RouletteQuizQuestion {
  q: string;
  // expected_topic used by grading model, not shown to dev
  expected_topic: string;
}

export interface RouletteQuizAttempt {
  id: string;
  blog_id: string;
  attempt_number: number;
  questions: RouletteQuizQuestion[];
  answers: string[] | null;
  score: number | null;
  result: QuizResult | null;
  created_at: string;
  completed_at: string | null;
}

export interface RoulettePublishLog {
  id: string;
  blog_id: string;
  drive_file_id: string | null;
  drive_url: string | null;
  recipients: string[] | null;
  status: string;
  error_message: string | null;
  published_at: string | null;
  created_at: string;
}

export interface KeywordSuggestion {
  keyword: string;
  type: 'primary' | 'long_tail';
  trend_direction: TrendDirection;
}

export const BLOG_RULES = {
  WORD_MIN: 1200,
  WORD_MAX: 1400,
  MIN_CODE_BLOCKS: 1,
  MIN_DIAGRAMS_OR_CITATIONS: 1,
  MIN_TAGS: 3,
  SEO_TITLE_MAX: 60,
  META_DESC_MAX: 160,
  TLDR_MAX_WORDS: 80,
  AI_SCORE_REJECT: 80,
  AI_SCORE_WARN: 60,
  QUIZ_PASS_THRESHOLD: 3,
  QUIZ_RETRY_LIMIT: 1,
  QUIZ_LOCKOUT_COOLDOWN_HOURS: 24,
} as const;
