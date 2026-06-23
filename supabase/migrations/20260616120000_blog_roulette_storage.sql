-- Blog Roulette — Supabase Storage bucket for inline images
-- Run this via Supabase SQL editor or include in migrations.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blog-images',
  'blog-images',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Public read access for all (bucket is public, but policy ensures)
DROP POLICY IF EXISTS "blog_images_public_select" ON storage.objects;
CREATE POLICY "blog_images_public_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'blog-images');

-- Authenticated users can upload to blog-images
DROP POLICY IF EXISTS "blog_images_auth_insert" ON storage.objects;
CREATE POLICY "blog_images_auth_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'blog-images'
    AND auth.role() = 'authenticated'
  );

-- Authors can delete their own uploads
DROP POLICY IF EXISTS "blog_images_own_delete" ON storage.objects;
CREATE POLICY "blog_images_own_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'blog-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
