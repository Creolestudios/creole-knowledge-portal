import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';

const mockUpdate = vi.fn();
const mockSingle = vi.fn();
const mockIn = vi.fn();
const mockOr = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      return {
        update: (...args: any[]) => {
          mockUpdate(table, ...args);
          return {
            or: (...orArgs: any[]) => {
              mockOr(table, ...orArgs);
              return Promise.resolve({ data: null, error: null });
            },
            in: (...inArgs: any[]) => {
              mockIn(table, ...inArgs);
              return Promise.resolve({ data: null, error: null });
            },
            eq: () => Promise.resolve({ data: null, error: null }),
          };
        },
        select: () => ({
          eq: () => ({
            single: mockSingle,
            maybeSingle: mockSingle,
          }),
        }),
      };
    }),
  },
}));

vi.mock('@/lib/ai-interview/invite-token', () => ({
  resolveInterviewSessionId: vi.fn().mockImplementation((id: string) => Promise.resolve(id === 'token123' ? 'sess-1' : id)),
  hashToken: vi.fn().mockReturnValue('hashed_token'),
}));

vi.mock('@/lib/ai-interview/answers', () => ({
  ensureAllQuestionsAnswered: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/ai-interview/scorer', () => ({
  scoreInterviewSession: vi.fn().mockResolvedValue(undefined),
}));

describe('POST /api/interview/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if interviewId is missing', async () => {
    const req = new NextRequest('http://localhost/api/interview/complete', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Interview ID is required');
  });

  it('successfully completes session and updates invites and sessions', async () => {
    const req = new NextRequest('http://localhost/api/interview/complete', {
      method: 'POST',
      body: JSON.stringify({
        interviewId: 'token123',
        warningCounts: { face: 1, object: 2, voice: 0 },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.completed).toBe(true);
    expect(json.interviewId).toBe('sess-1');

    expect(mockUpdate).toHaveBeenCalledWith(
      'interview_invites',
      expect.objectContaining({ status: 'completed' })
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      'interview_sessions',
      expect.objectContaining({
        status: 'completed',
        face_warning_count: 1,
        object_warning_count: 2,
        voice_warning_count: 0,
      })
    );
  });
});
