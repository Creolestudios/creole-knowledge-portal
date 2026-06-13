import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Stub: Google Drive publish pipeline. Implementation lands in next phase.
// Reads MARKETING_NOTIFY_EMAILS + DRIVE_FOLDER_ID + service account creds.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: blog } = await supabase
    .from('roulette_blogs')
    .select('*')
    .eq('id', id)
    .eq('author_id', user.id)
    .single();
  if (!blog) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (blog.status !== 'PASSED') {
    return NextResponse.json(
      { error: 'Quiz not passed yet' },
      { status: 409 },
    );
  }

  await supabase
    .from('roulette_blogs')
    .update({ status: 'PUBLISHING' })
    .eq('id', id);

  // TODO: Drive upload + permissions loop (Phase 5).
  return NextResponse.json({
    ok: false,
    pending: true,
    note: 'Drive integration not yet wired. Service account + .env config required.',
  });
}
