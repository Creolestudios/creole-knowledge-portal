-- Blog Roulette — denormalize the published Google Doc link onto roulette_blogs
-- so the dashboard/list views can show it without joining roulette_publish_logs.

ALTER TABLE roulette_blogs
  ADD COLUMN IF NOT EXISTS drive_url TEXT,
  ADD COLUMN IF NOT EXISTS drive_file_id TEXT;
