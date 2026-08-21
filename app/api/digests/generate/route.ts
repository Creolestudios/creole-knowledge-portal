import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';

export const maxDuration = 300;

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = user.id;

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
