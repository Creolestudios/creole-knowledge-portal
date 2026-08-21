// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify([
            {
              topic: 'Next.js 15',
              title: 'Modern Actions',
              slug: 'modern-actions',
              content: 'Markdown content',
              tags: ['nextjs'],
              readingTime: 4,
            },
            {
              topic: 'AI SDK',
              title: 'Building Agents',
              slug: 'building-agents',
              content: 'Markdown content 2',
              tags: ['ai'],
              readingTime: 6,
            },
          ]),
        }),
      },
    };
  }),
}));

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

describe('GET /api/digests/trending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const res = await GET(new Request('http://localhost/api/digests/trending'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns existing fresh trending blogs if they exist and are under 24 hours old', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    const now = new Date().toISOString();
    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        ilike: vi.fn().mockResolvedValue({
          data: [
            { id: 'b1', url: 'trending:u1:b1', created_at: now },
            { id: 'b2', url: 'trending:u1:b2', created_at: now },
          ],
          error: null,
        }),
      }),
    });

    const res = await GET(new Request('http://localhost/api/digests/trending'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.blogs).toHaveLength(2);
  });

  it('returns 500 when database error occurs during existing blog fetch', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        ilike: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }),
      }),
    });

    const res = await GET(new Request('http://localhost/api/digests/trending'));
    expect(res.status).toBe(500);
  });

  it('returns 404 if user profile is missing', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'blogs') {
        return {
          select: vi.fn().mockReturnValue({
            ilike: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === 'user_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await GET(new Request('http://localhost/api/digests/trending'));
    expect(res.status).toBe(404);
  });

  it('researches and generates fresh trending topics using Gemini AI when stale', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'blogs') {
        return {
          select: vi.fn().mockReturnValue({
            ilike: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
          delete: vi.fn().mockReturnValue({
            ilike: vi.fn().mockResolvedValue({ error: null }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'new-b1', title: 'Modern Actions' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'user_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { email: 'dev@test.com', current_role: 'Fullstack Dev' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    });

    const res = await GET(new Request('http://localhost/api/digests/trending'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.blogs).toBeDefined();
  });
});
