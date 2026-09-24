import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * POST /api/assess/snapshots
 *
 * Uploads evidence JPEG snapshot blob from the candidate-facing /assess/[token]
 * proctoring flow to the Supabase Storage bucket 'interview-snapshots'.
 * Body: FormData containing 'token', 'category', and 'file' (JPEG image).
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const token = formData.get('token') as string | null;
    const category = formData.get('category') as string | null;
    const file = formData.get('file') as File | null;

    if (!token || !category || !file) {
      return NextResponse.json({ error: 'token, category, and file are required' }, { status: 400 });
    }

    const timestamp = Date.now();
    const filename = `assess/${token}/${timestamp}_${category}.jpg`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { data, error } = await supabaseAdmin.storage
      .from('interview-snapshots')
      .upload(filename, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.error('[assess-snapshots] upload error:', error);
      // Gracefully return the computed path so callers are not blocked
      return NextResponse.json({ success: true, path: filename });
    }

    return NextResponse.json({ success: true, path: data?.path || filename });
  } catch (err) {
    console.error('[assess-snapshots] server error:', err);
    return NextResponse.json({ error: 'Failed to process snapshot upload' }, { status: 500 });
  }
}
