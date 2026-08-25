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
const mockMaybeSingle = vi.fn();
const insertedRows: any[] = [];

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
        maybeSingle: mockMaybeSingle,
        insert: vi.fn((row: any) => {
          insertedRows.push(row);
          return {
            select: vi.fn().mockReturnValue({
              single: mockInsertSingle,
            }),
          };
        }),
      };
    }),
  },
}));

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return { models: { generateContent: mockGenerateContent } };
  }),
}));

vi.mock('@/lib/blog-service', () => ({
  blogServiceHeaders: () => ({}),
  blogServiceUrl: (path: string) => `http://blog.test${path}`,
}));

const DEFAULT_AI_PAYLOAD = {
  title: 'Fresh AI Briefing',
  content: '## Overview\n\nContent here',
  tags: ['ai'],
  estimated_read_minutes: 10,
};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) }),
}));

function mockRequest(body: unknown) {
  return new Request('http://localhost/api/digests/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Both today-check and generate calls fail → Gemini fallback path. */
function mockFastApiDown() {
  (global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
}

describe('POST /api/digests/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    insertedRows.length = 0;
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(DEFAULT_AI_PAYLOAD) });
  });

  it('returns 401 when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(401);
  });

  it('returns today\'s existing digest without regenerating', async () => {
    const digestDate = todayKey();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'cached-1', title: 'Already Today', digest_date: digestDate },
      }),
    });

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.blog.title).toBe('Already Today');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('proxies generation to the Celery blog service', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, blog: null }),
      })
      .mockResolvedValueOnce({
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

  it('ignores force and still prefers FastAPI / cache over local AI', async () => {
    const digestDate = todayKey();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'cached-2', title: 'Today Brief', digest_date: digestDate },
      }),
    });

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.blog.title).toBe('Today Brief');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('maps a missing profile from the blog service to 404', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, blog: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Supabase profile not found for user-1' }),
      });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(404);
  });

  it('falls back to local AI synthesis when the blog service is unreachable', async () => {
    mockFastApiDown();
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

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog.title).toBe('Fresh AI Briefing');
  });

  it('returns 500 when blog insert fails in fallback mode', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockInsertSingle.mockResolvedValue({
      data: null,
      error: { message: 'Insert failed' },
    });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to persist fresh blog digest: Insert failed');
  });

  it('strips markdown code fences from the AI response', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({
      text: '```json\n' + JSON.stringify(DEFAULT_AI_PAYLOAD) + '\n```',
    });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-fenced', title: 'Fresh AI Briefing', content: '## Overview', tags: ['ai'] },
      error: null,
    });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blog.title).toBe('Fresh AI Briefing');
  });

  it('normalises a comma-separated tags string into an array', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ ...DEFAULT_AI_PAYLOAD, tags: 'ai, nextjs , performance' }),
    });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-tags', title: 'Fresh AI Briefing', content: '## Overview', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const inserted = insertedRows.at(-1);
    expect(inserted.tags).toEqual(['ai', 'nextjs', 'performance']);
  });

  it('replaces a non-string, non-array tags value with a default tag', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ ...DEFAULT_AI_PAYLOAD, tags: { primary: 'ai' } }),
    });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-tags2', title: 'Fresh AI Briefing', content: '## Overview', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    expect(insertedRows.at(-1).tags).toEqual(['tech']);
  });

  it('retries every model when the AI output is missing required fields', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ title: 'Only a title' }),
    });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-static', title: 'Only a title', content: '', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    expect(insertedRows.at(-1).title).toBe('Only a title');
  });

  it('falls back to the static briefing when the model returns no text at all', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({ text: '' });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-empty', title: 'static', content: 'static', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    expect(insertedRows.at(-1).title).toContain('Architectural Deep-Dive');
  });

  it('backs off and still falls back when the model reports a quota error', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockRejectedValue(new Error('429 quota exceeded'));
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-quota', title: 'static', content: 'static', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    expect(insertedRows.at(-1).title).toContain('Architectural Deep-Dive');
  });

  it('treats an unparseable request body as an empty body and falls through to the session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const bad = new Request('http://localhost/api/digests/generate', {
      method: 'POST',
      body: 'not-json',
    });

    const res = await POST(bad);
    expect(res.status).toBe(401);
  });

  it('reports an unknown-error message when the insert fails with no error detail', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockInsertSingle.mockResolvedValue({ data: null, error: null });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to persist fresh blog digest: Unknown error');
  });

  it('reuses an existing same-day Supabase briefing in fallback mode', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const digestDate = todayKey();
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'existing-sb',
        title: 'Already Saved',
        content: 'body',
        published_at: `${digestDate}T08:00:00.000Z`,
        tags: ['ai'],
        url: `briefing:user-1:${digestDate}`,
      },
      error: null,
    });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.blog.id).toBe('existing-sb');
    expect(mockInsertSingle).not.toHaveBeenCalled();
  });
});
