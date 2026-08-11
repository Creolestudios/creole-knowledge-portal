/**
 * Blog data-access layer.
 *
 * Currently reads local mock fixtures. To go live, replace each function body
 * with a `fetch` to the backend endpoints documented in
 * `docs/frontend-backend-contract.md` — the return types are unchanged, so no
 * component needs to be touched.
 *
 *   getDailyBlog()      -> GET /api/digests/{user_id}/latest
 *   getBlogByDate(date) -> GET /api/digests/{user_id}/by-date/{date}
 *   getAvailableDates() -> GET /api/digests/{user_id}/history (dates only)
 */
import type { DailyBlog, ISODate } from '@/types/contracts';
import dailyBlog from '@/lib/mock/daily-blog.json';
import pastBlogs from '@/lib/mock/past-blogs.json';

const DAILY = dailyBlog as DailyBlog;
const PAST = pastBlogs as Record<ISODate, DailyBlog>;

/** Today's personalized ~20-minute blog (trending + continue-to-learn + quiz). */
export async function getDailyBlog(): Promise<DailyBlog> {
  // TODO(live): return fetch('/api/digests/${userId}/latest').then(r => r.json())
  return DAILY;
}

/** The blog published on a specific past date, or null if none exists. */
export async function getBlogByDate(date: ISODate): Promise<DailyBlog | null> {
  // TODO(live): return fetch(`/api/digests/${userId}/by-date/${date}`)...
  if (date === DAILY.date) return DAILY;
  return PAST[date] ?? null;
}

/** All dates that have a blog available (today + history), newest first. */
export async function getAvailableDates(): Promise<ISODate[]> {
  // TODO(live): derive from GET /api/digests/${userId}/history
  const dates = new Set<ISODate>([DAILY.date, ...Object.keys(PAST)]);
  return Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
}

/** Lightweight searchable index of every blog (title + tags), newest first. */
export interface BlogIndexEntry {
  date: ISODate;
  title: string;
  tags: string[];
}

export async function getBlogIndex(): Promise<BlogIndexEntry[]> {
  // TODO(live): derive from GET /api/digests/${userId}/history
  const all: DailyBlog[] = [DAILY, ...Object.values(PAST)];
  return all
    .map((b) => ({ date: b.date, title: b.title, tags: b.tags }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Filter the blog index by a free-text query against title and tags. */
export function searchBlogIndex(index: BlogIndexEntry[], query: string): BlogIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return index.filter(
    (b) => b.title.toLowerCase().includes(q) || b.tags.some((t) => t.toLowerCase().includes(q))
  );
}
