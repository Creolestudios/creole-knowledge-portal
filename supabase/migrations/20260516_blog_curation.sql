-- Migration: Blog Curation Schema
-- Created at: 2026-05-16

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: blogs
CREATE TABLE IF NOT EXISTS public.blogs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    content TEXT,
    source TEXT NOT NULL,
    summary TEXT,
    tags TEXT[] DEFAULT '{}',
    author TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index on source and published_at for faster querying
CREATE INDEX IF NOT EXISTS idx_blogs_source ON public.blogs(source);
CREATE INDEX IF NOT EXISTS idx_blogs_published_at ON public.blogs(published_at DESC);

-- Table: daily_30_curation
CREATE TABLE IF NOT EXISTS public.daily_30_curation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    blog_id UUID NOT NULL REFERENCES public.blogs(id) ON DELETE CASCADE,
    curated_date DATE NOT NULL DEFAULT CURRENT_DATE,
    display_order INTEGER NOT NULL,
    curation_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(curated_date, blog_id) -- A blog shouldn't be curated twice on the same day
);

-- Add index on curated_date
CREATE INDEX IF NOT EXISTS idx_daily_30_curated_date ON public.daily_30_curation(curated_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_30_display_order ON public.daily_30_curation(display_order);

-- Setup Row Level Security (RLS)
ALTER TABLE public.blogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_30_curation ENABLE ROW LEVEL SECURITY;

-- Create policies (assuming read access for authenticated users, write for service role only)
CREATE POLICY "Enable read access for all users" ON public.blogs FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON public.daily_30_curation FOR SELECT USING (true);

-- Insert function to automatically update 'updated_at' column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_blogs_updated_at
BEFORE UPDATE ON public.blogs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
