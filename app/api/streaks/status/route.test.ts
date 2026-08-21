import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

let tableResponses: Record<string, any[]>;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const queue = tableResponses[table] ?? [];
          const res = queue.length > 0 ? queue.shift() : { data: null, error: null };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

function mockRequest(url = 'http://localhost/api/streaks/status', cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new Request(url, { headers });
}

describe('GET /api/streaks/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResponses = {};
  });

  it('returns 401 with no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(mockRequest());
    expect(res.status).toBe(401);
  });

  it('does not authenticate via a mockUser query param', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(mockRequest('http://localhost/api/streaks/status?mockUser=true'));
    expect(res.status).toBe(401);
  });

  it('returns zero stats when the DB has no gamification rows', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      user_profiles: [{ data: null, error: { message: 'no row' } }],
      streaks: [{ data: null, error: { message: 'no row' } }],
      user_badges: [{ data: [], error: null }],
      quiz_attempts: [{ data: [], error: null }],
    };

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.data.simulated).toBe(true);
    expect(body.data.profile.xp).toBe(0);
    expect(body.data.profile.level).toBe(1);
    expect(body.data.streak.currentStreak).toBe(0);
    expect(body.data.badges).toEqual([]);
  });

  it('reads real profile, streak and badge rows from the DB when present', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      user_profiles: [{ data: { xp: 500, level: 3, coins: 40 }, error: null }],
      streaks: [
        { data: { current_streak: 5, longest_streak: 10, last_active_date: '2026-08-01', streak_freezes: 2 }, error: null },
      ],
      user_badges: [
        {
          data: [{ badge_id: 'quiz-master', unlocked_at: '2026-08-01', badges: { name: 'Quiz Master', description: 'x', rarity: 'epic' } }],
          error: null,
        },
      ],
      quiz_attempts: [{ data: [], error: null }],
    };

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.data.simulated).toBe(false);
    expect(body.data.profile.xp).toBe(500);
    expect(body.data.streak.currentStreak).toBe(5);
    expect(body.data.badges).toHaveLength(1);
    expect(body.data.badges[0].name).toBe('Quiz Master');
  });

  it('reports the completed daily quiz result when one exists for today', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      user_profiles: [{ data: null, error: { message: 'no row' } }],
      streaks: [{ data: null, error: { message: 'no row' } }],
      user_badges: [{ data: [], error: null }],
      quiz_attempts: [
        { data: [{ score: 3, total_questions: 3, xp_earned: 120, answers: [] }], error: null },
      ],
    };

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.data.dailyQuizCompleted).toBe(true);
    expect(body.data.dailyQuizResult.isPerfect).toBe(true);
  });

  it('does not authenticate via a mock-user cookie', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const cookie = `mock_gamification_stats=${encodeURIComponent(JSON.stringify({ xp: 999 }))}; mock-user=true`;
    const res = await GET(mockRequest('http://localhost/api/streaks/status', cookie));
    expect(res.status).toBe(401);
  });
});
