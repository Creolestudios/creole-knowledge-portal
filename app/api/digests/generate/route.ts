import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { mockUserFromCookie } from '@/lib/dev/mock-user';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    let userId: string | null = null;
    try {
      const body = await request.json();
      userId = body.userId || null;
    } catch {
      // empty body
    }

    if (!userId) {
      const supabase = await createClient();
      let {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        const cookieStore = await cookies();
        const mockUser = mockUserFromCookie(cookieStore.get('mock-user')?.value);
        if (mockUser) {
          user = mockUser as any;
        }
      }
      if (user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const res = await fetch(blogServiceUrl('/digests/generate'), {
      method: 'POST',
      headers: blogServiceHeaders(),
      body: JSON.stringify({ userId }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = payload.detail || payload.error || 'Blog service generation failed';
      const status = res.status === 404 ? 404 : 500;
      return NextResponse.json({ error: detail }, { status });
    }

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('Digest synthesis error:', error);
    return NextResponse.json(
      {
        error:
          error.message ||
          'Could not reach the Celery blog service. Start FastAPI on :8000 with Mongo and Redis.',
      },
      { status: 500 }
    );
  }
}
