/**
 * Shared frontend ⇄ backend data contract for the Creole Knowledge Portal
 * "Daily Learning" user dashboard.
 *
 * The frontend is built against these types using local mock fixtures
 * (see `lib/mock/`). The backend team must return JSON that matches these
 * shapes 1:1 so the data layer in `lib/data/` can swap mocks for real API
 * calls without touching any component.
 *
 * See `docs/frontend-backend-contract.md` for the full handoff notes,
 * the admin source URL, and the user-data schema the backend reads from.
 */

/** ISO-8601 date string, day precision e.g. "2026-06-30". */
export type ISODate = string;

/**
 * Mirror of the Supabase `user_profiles` table. The backend reads this to
 * personalize curation; the admin sets these fields in `app/admin/dashboard`
 * (see `components/user-management.tsx`). Frontend treats it as read-only.
 */
export interface UserProfileSchema {
  user_id: string;
  email: string;
  current_role: string;
  years_of_experience: number;
  current_tech_stack: string[];
  primary_tech_stack: string[];
  secondary_tech_stack: string[];
  future_interests: string;
  updated_at: string;
}

/**
 * Mirror of the Supabase `blog_sources` table. This is a **global** crawl list
 * the admin manages in `app/admin/dashboard` (the "Sources" tab) — the blog
 * URLs the backend fetches from. It is NOT per-end-user: rows are keyed by the
 * admin who added them (`added_by`) and shared across all users. The backend
 * reads this dynamically to know which domains to crawl.
 */
export interface BlogSourceSchema {
  /** Supabase row id (uuid). */
  id?: string;
  /** The source URL to crawl, e.g. "https://netflixtechblog.com". */
  url: string;
  /** Admin user id who registered the URL (Supabase auth id). */
  added_by: string;
  /** ISO timestamp the row was created. */
  created_at?: string;
}

/** A cited source backing a blog section. */
export interface Source {
  id: number;
  title: string;
  url: string;
  author: string;
  source_domain: string;
  published_at: string;
}

/** One rendered block of a daily blog (Markdown body + its sources). */
export interface BlogSection {
  heading: string;
  /** Markdown — rendered by `components/dashboard/BlogReader.tsx`. */
  content: string;
  sources: Source[];
}

/** A single multiple-choice quiz question. */
export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Zero-based index into `options` of the correct answer. */
  answerIndex: number;
}

/** The end-of-blog quiz shipped inside each daily blog. */
export interface Quiz {
  quiz_id: string;
  questions: QuizQuestion[];
}

/**
 * The personalized ~20-minute morning blog for one day. Two ordered
 * sections: "Trending for you" (interest-matched) then "Continue to learn"
 * (carried-over depth), plus the quiz.
 */
export interface DailyBlog {
  digest_id: string;
  date: ISODate;
  title: string;
  estimated_read_minutes: number;
  tags: string[];
  sections: {
    trending: BlogSection;
    continueToLearn: BlogSection;
  };
  quiz: Quiz;
}

/** Result of one quiz attempt, recorded to the activity tracker. */
export interface QuizResult {
  quiz_id: string;
  date: ISODate;
  score: number;
  total: number;
  correctIds: string[];
  wrongIds: string[];
}

/** Per-day engagement record powering the Activity tab. */
export interface ActivityRecord {
  date: ISODate;
  readSeconds: number;
  /** A quiz attempt that reached completion. */
  quizTaken: boolean;
  /** A quiz attempt that was started, whether or not it was finished. */
  quizStarted?: boolean;
  quizScore: number;
  quizTotal: number;
}

/** Aggregated weekly stats for the Activity tab widget. */
export interface WeeklyStats {
  daysRead: number;
  /**
   * Days in the window that actually had a briefing (Mon-Fri). The denominator
   * for `daysRead` -- weekends are excluded because nothing is generated then.
   */
  briefingDays: number;
  quizzesSubmitted: number;
  correctPct: number;
  wrongPct: number;
}
