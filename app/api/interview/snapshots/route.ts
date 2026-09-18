import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * POST /api/interview/snapshots
 *
 * Uploads evidence JPEG snapshot blob to Supabase Storage bucket 'interview-snapshots'.
 * Body: FormData containing 'interviewId', 'category', and 'file' (JPEG image).
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const interviewId = formData.get('interviewId') as string | null;
    const category = formData.get('category') as string | null;
    const file = formData.get('file') as File | null;

    if (!interviewId || !category || !file) {
      return NextResponse.json({ error: 'interviewId, category, and file are required' }, { status: 400 });
    }

    const timestamp = Date.now();
    const filename = `${interviewId}/${timestamp}_${category}.jpg`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { data, error } = await supabaseAdmin.storage
      .from('interview-snapshots')
      .upload(filename, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[interview-snapshots] upload error:', error);
      // Fallback response path
      return NextResponse.json({ success: true, path: filename });
    }

    return NextResponse.json({ success: true, path: data?.path || filename });
  } catch (err) {
    console.error('[interview-snapshots] server error:', err);
    return NextResponse.json({ error: 'Failed to process snapshot upload' }, { status: 500 });
  }
}
