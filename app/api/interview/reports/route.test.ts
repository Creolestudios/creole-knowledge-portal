import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const { mockSessions, mockViolationEvents, mockReportMap } = vi.hoisted(() => {
  const sessions = [
    {
      id: 'sess-completed',
      candidate_name: 'Alice Completed',
      candidate_email: 'alice@example.com',
      status: 'completed',
      created_at: '2026-09-28T10:00:00Z',
      updated_at: '2026-09-28T10:30:00Z',
      parsed_jd: { jobTitle: 'Full Stack Engineer' },
      voice_warning_count: 0,
      face_warning_count: 0,
      object_warning_count: 0,
    },
    {
      id: 'sess-terminated',
      candidate_name: 'Bob Terminated',
      candidate_email: 'bob@example.com',
      status: 'cancelled',
      created_at: '2026-09-28T11:00:00Z',
      updated_at: '2026-09-28T11:15:00Z',
      parsed_jd: { jobTitle: 'DevOps Lead' },
      voice_warning_count: 3,
      face_warning_count: 0,
      object_warning_count: 0,
    },
  ];

  const violationEvents = [
    {
      session_id: 'sess-terminated',
      metadata: { reason: 'Three proctoring warnings issued. Session auto-terminated.' },
      meta: {},
    },
  ];

  const reportMap = new Map([
    [
      'sess-completed',
      {
        cognitive_composite: 85,
        fluency_score: 90,
        fluency_cefr: 'C1',
        recommendation: 'strong_yes',
        recommendation_rationale: 'Clean and solid performance.',
        flags: [],
      },
    ],
  ]);

  return { mockSessions: sessions, mockViolationEvents: violationEvents, mockReportMap: reportMap };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'interview_sessions') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: mockSessions, error: null }),
          }),
        };
      }
      if (table === 'interview_events') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockViolationEvents, error: null }),
            }),
          }),
        };
      }
      if (table === 'ai_interviews') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    }),
  },
}));

vi.mock('@/lib/ai-interview/report-store', () => ({
  getInterviewReports: vi.fn().mockResolvedValue(mockReportMap),
}));

vi.mock('@/lib/ai-interview/scorer', () => ({
  scoreInterviewSession: vi.fn().mockResolvedValue({ report: null }),
}));

describe('GET /api/interview/reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns reports list with termination reasons and scores for terminated candidates', async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const json = (await res.json()) as { reports: Array<Record<string, unknown>> };
    expect(json.reports).toHaveLength(2);

    const completed = json.reports.find((r) => r.id === 'sess-completed');
    expect(completed).toBeDefined();
    expect(completed?.status).toBe('completed');
    expect(completed?.cognitiveScore).toBe(85);
    expect(completed?.fluencyScore).toBe(90);
    expect(completed?.terminationReason).toBeNull();

    const terminated = json.reports.find((r) => r.id === 'sess-terminated');
    expect(terminated).toBeDefined();
    expect(terminated?.status).toBe('terminated');
    expect(terminated?.terminationReason).toBe('Three proctoring warnings issued. Session auto-terminated.');
    expect(terminated?.cognitiveScore).toBe(0);
    expect(terminated?.fluencyScore).toBe(0);
    expect(terminated?.recommendation).toBe('no');
  });
});
