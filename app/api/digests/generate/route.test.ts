import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/dev/mock-user', () => ({
  mockUserFromCookie: vi.fn().mockReturnValue(null),
}));

const mockInsertSingle = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'user_profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { primary_tech_stack: ['Next.js 15'], current_role: 'Fullstack Dev' },
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: mockInsertSingle,
          }),
        }),
      };
    }),
  },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({
            title: 'Fresh AI Briefing',
            content: '## Overview\n\nContent here',
            tags: ['ai'],
            estimated_read_minutes: 10,
          }),
        }),
      },
    };
  }),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) }),
}));

function mockRequest(body: unknown) {
  return new Request('http://localhost/api/digests/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/digests/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns 401 when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(401);
  });

  it('proxies generation to the Celery blog service', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'd1', title: 'Morning Brief', content: '# hi' },
      }),
    });

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog.title).toBe('Morning Brief');
  });

  it('bypasses blog service and generates using local AI synthesis when force is true', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockInsertSingle.mockResolvedValue({
      data: {
        id: 'new-b1',
        title: 'Fresh AI Briefing',
        content: '## Overview\n\nContent here',
        published_at: new Date().toISOString(),
        tags: ['ai'],
      },
      error: null,
    });

    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog.title).toBe('Fresh AI Briefing');
  });

  it('maps a missing profile from the blog service to 404', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Supabase profile not found for user-1' }),
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(404);
  });

  it('returns 500 when the blog service is unreachable', async () => {
    (global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(500);
  });

  it('returns 500 when blog insert fails in fallback mode', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { message: 'Insert failed' },
    });

    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to persist fresh blog digest.');
  });
});
