import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/require-user';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * POST /api/blog-roulette/upload
 *
 * Uploads an image to Supabase Storage (`blog-images` bucket).
 * Returns the public URL for use in blog content.
 *
 * Body: multipart/form-data with field "file"
 */
export async function POST(req: Request) {
  const { user, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;

  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Allowed: jpeg, png, webp, gif, svg` },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max: 5 MB` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split('.').pop() ?? 'png';
  const path = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError, data } = await supabaseAdmin.storage
    .from('blog-images')
    .upload(path, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error('[blog-roulette/upload]', uploadError);
    // Bucket might not exist — try creating it on the fly
    if (uploadError.message?.includes('bucket')) {
      const { error: bucketError } = await supabaseAdmin.storage.createBucket('blog-images', {
        public: true,
        fileSizeLimit: MAX_SIZE,
      });
      if (bucketError) {
        console.error('[blog-roulette/upload] bucket create failed', bucketError);
        return NextResponse.json({ error: 'Upload failed — storage not configured' }, { status: 500 });
      }
      // Retry upload
      const { data: retryData, error: retryError } = await supabaseAdmin.storage
        .from('blog-images')
        .upload(path, buffer, { contentType: file.type, upsert: false });
      if (retryError) {
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
      }
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/blog-images/${path}`;
      return NextResponse.json({ url });
    }
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/blog-images/${path}`;
  return NextResponse.json({ url });
}
