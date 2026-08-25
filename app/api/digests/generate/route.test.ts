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

describe('POST /api/digests/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    insertedRows.length = 0;
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(DEFAULT_AI_PAYLOAD) });
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
    expect(body.error).toBe('Failed to persist fresh blog digest: Insert failed');
  });
  it('strips markdown code fences from the AI response', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({
      text: '```json\n' + JSON.stringify(DEFAULT_AI_PAYLOAD) + '\n```',
    });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-fenced', title: 'Fresh AI Briefing', content: '## Overview', tags: ['ai'] },
      error: null,
    });

    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blog.title).toBe('Fresh AI Briefing');
  });

  it('normalises a comma-separated tags string into an array', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ ...DEFAULT_AI_PAYLOAD, tags: 'ai, nextjs , performance' }),
    });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-tags', title: 'Fresh AI Briefing', content: '## Overview', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(200);
    const inserted = insertedRows.at(-1);
    expect(inserted.tags).toEqual(['ai', 'nextjs', 'performance']);
  });

  it('replaces a non-string, non-array tags value with a default tag', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ ...DEFAULT_AI_PAYLOAD, tags: { primary: 'ai' } }),
    });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-tags2', title: 'Fresh AI Briefing', content: '## Overview', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(200);
    expect(insertedRows.at(-1).tags).toEqual(['tech']);
  });

  it('retries every model when the AI output is missing required fields', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    // Missing `content` -> the route throws and retries the next model, all four fail.
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ title: 'Only a title' }),
    });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-static', title: 'Only a title', content: '', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(200);
    expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    // NOTE: `parsed` is assigned before the validation throw, so the static
    // fallback at `if (!parsed)` is bypassed and the partial object is persisted.
    expect(insertedRows.at(-1).title).toBe('Only a title');
  });

  it('falls back to the static briefing when the model returns no text at all', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockResolvedValue({ text: '' });
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-empty', title: 'static', content: 'static', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(200);
    expect(insertedRows.at(-1).title).toContain('Architectural Deep-Dive');
  });

  it('backs off and still falls back when the model reports a quota error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGenerateContent.mockRejectedValue(new Error('429 quota exceeded'));
    mockInsertSingle.mockResolvedValue({
      data: { id: 'b-quota', title: 'static', content: 'static', tags: [] },
      error: null,
    });

    const res = await POST(mockRequest({ force: true }));
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
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockInsertSingle.mockResolvedValue({ data: null, error: null });

    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to persist fresh blog digest: Unknown error');
  });
});
