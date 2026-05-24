import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  try {
    // Query seeded mock blogs from the database
    const { data: blogs, error } = await supabaseAdmin
      .from('blogs')
      .select('id, title, url, summary, tags, author, published_at')
      .like('url', 'mock:%')
      .order('created_at', { ascending: false });

    if (error || !blogs || blogs.length === 0) {
      console.warn('[DB Query] No practice blogs found in Supabase or table error. Returning standard mock set.');
      
      // Fallback static list for perfect offline/CI robustness
      const fallbackBlogs = [
        {
          id: "mock-id-nextjs",
          title: "Leveraging Next.js 15 Server Actions for Production Systems",
          url: "mock:nextjs15-server-actions",
          summary: "A deep dive into Next.js 15 Server Actions, security considerations, and state management strategies in modern React 19 apps.",
          tags: ["nextjs", "react", "server-actions", "security"],
          author: "Alex Rivers",
          published_at: new Date().toISOString()
        },
        {
          id: "mock-id-ts",
          title: "Advanced TypeScript 5.x Typings and Generics in SaaS Architectures",
          url: "mock:typescript-generics",
          summary: "Mastering conditional types, mapped types, and generic record utilities for building type-safe modular structures.",
          tags: ["typescript", "generics", "type-safety"],
          author: "Jane Foster",
          published_at: new Date().toISOString()
        },
        {
          id: "mock-id-supabase",
          title: "Supabase Scaling: Database Partitioning, Caching, and pgvector Indexes",
          url: "mock:supabase-scaling",
          summary: "Optimizing PostgreSQL databases for scale: when to use HNSW indexes, caching in Supabase, and RLS performance optimization.",
          tags: ["supabase", "postgres", "pgvector", "performance"],
          author: "Marcus Chen",
          published_at: new Date().toISOString()
        }
      ];

      return NextResponse.json({ success: true, blogs: fallbackBlogs });
    }

    return NextResponse.json({ success: true, blogs });

  } catch (error: any) {
    console.error('Error fetching practice blogs:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
