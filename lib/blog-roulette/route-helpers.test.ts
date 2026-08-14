import { describe, it, expect, vi } from 'vitest';
import { requireUserAndBlog } from './route-helpers';

function makeSupabase({ user, blog }: { user: any; blog: any }) {
  const single = vi.fn().mockResolvedValue({ data: blog });
  const eq2 = vi.fn().mockReturnValue({ single });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2, single });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from,
    _spies: { from, select, eq1, eq2, single },
  } as any;
}

describe('requireUserAndBlog', () => {
  it('returns a 401 error response when there is no authenticated user', async () => {
    const supabase = makeSupabase({ user: null, blog: null });

    const result = await requireUserAndBlog(supabase, 'blog-1');

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(401);
    }
  });

  it('returns a 404 error response when the blog does not exist', async () => {
    const supabase = makeSupabase({ user: { id: 'u1' }, blog: null });

    const result = await requireUserAndBlog(supabase, 'blog-1');

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error.status).toBe(404);
    }
  });

  it('returns the user and blog when both exist', async () => {
    const blog = { id: 'blog-1', author_id: 'u1', status: 'DRAFT' };
    const supabase = makeSupabase({ user: { id: 'u1' }, blog });

    const result = await requireUserAndBlog(supabase, 'blog-1', { restrictToAuthor: true });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.user.id).toBe('u1');
      expect(result.blog).toEqual(blog);
    }
    expect(supabase._spies.eq1).toHaveBeenCalledWith('id', 'blog-1');
    expect(supabase._spies.eq2).toHaveBeenCalledWith('author_id', 'u1');
  });

  it('does not scope by author_id when restrictToAuthor is not set', async () => {
    const blog = { id: 'blog-1', author_id: 'someone-else' };
    const supabase = makeSupabase({ user: { id: 'u1' }, blog });

    const result = await requireUserAndBlog(supabase, 'blog-1');

    expect('error' in result).toBe(false);
    expect(supabase._spies.eq2).not.toHaveBeenCalled();
  });
});
