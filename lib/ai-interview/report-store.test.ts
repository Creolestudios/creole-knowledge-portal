import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveInterviewReport, getInterviewReport, getInterviewReports } from './report-store';
import { supabaseAdmin } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin', () => {
  return {
    supabaseAdmin: {
      from: vi.fn(),
    },
  };
});

describe('report-store adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves report to interview_reports when table exists', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'r1' }, error: null }),
      }),
    });

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'interview_reports') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mockMaybeSingle,
            }),
          }),
          insert: mockInsert,
        };
      }
      return {};
    });

    const res = await saveInterviewReport({
      session_id: 's1',
      cognitive_composite: 80,
    });

    expect(res.success).toBe(true);
    expect(res.target).toBe('table');
  });

  it('falls back to interview_events when interview_reports is missing', async () => {
    const mockInsertEvent = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'ev-1' }, error: null }),
      }),
    });

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'interview_reports') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST205', message: 'table not in schema cache' },
              }),
            }),
          }),
        };
      }
      if (table === 'interview_events') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: mockInsertEvent,
        };
      }
      return {};
    });

    const res = await saveInterviewReport({
      session_id: 's2',
      cognitive_composite: 75,
    });

    expect(res.success).toBe(true);
    expect(res.target).toBe('event');
    expect(res.id).toBe('ev-1');
  });

  it('retrieves report from interview_events when not in table', async () => {
    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'interview_reports') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST205', message: 'table not found' },
              }),
            }),
          }),
        };
      }
      if (table === 'interview_events') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: 'ev-10',
                        session_id: 's-10',
                        created_at: '2026-09-28T00:00:00Z',
                        metadata: {
                          cognitive_composite: 90,
                          fluency_score: 85,
                          recommendation: 'strong_yes',
                        },
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const report = await getInterviewReport('s-10');
    expect(report).toBeDefined();
    expect(report?.cognitive_composite).toBe(90);
    expect(report?.recommendation).toBe('strong_yes');
  });

  it('batch retrieves reports from both table and event fallback', async () => {
    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'interview_reports') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [{ session_id: 's-1', cognitive_composite: 80 }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'interview_events') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'ev-2',
                      session_id: 's-2',
                      created_at: '2026-09-28T00:00:00Z',
                      metadata: { cognitive_composite: 88 },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const map = await getInterviewReports(['s-1', 's-2']);
    expect(map.size).toBe(2);
    expect(map.get('s-1')?.cognitive_composite).toBe(80);
    expect(map.get('s-2')?.cognitive_composite).toBe(88);
  });
});
