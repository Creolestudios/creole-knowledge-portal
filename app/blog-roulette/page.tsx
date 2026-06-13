'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Plus,
  PenSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
} from 'lucide-react';
import PortalShell from '@/components/blog-roulette/portal-shell';
import type { RouletteBlog, BlogStatus } from '@/lib/blog-roulette/types';

const STATUS_STYLES: Record<BlogStatus, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'bg-zinc-100 text-zinc-700 border-zinc-200' },
  SUBMITTED: {
    label: 'Submitted',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  QUIZ_IN_PROGRESS: {
    label: 'Quiz In Progress',
    cls: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
  REJECTED: {
    label: 'Rejected (Blind AI)',
    cls: 'bg-red-50 text-red-700 border-red-200',
  },
  PASSED: {
    label: 'Passed Quiz',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  PUBLISHING: {
    label: 'Publishing…',
    cls: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  PUBLISHED: {
    label: 'Published',
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  PUBLISH_FAILED: {
    label: 'Publish Failed',
    cls: 'bg-red-50 text-red-700 border-red-200',
  },
};

export default function BlogRouletteListPage() {
  const supabase = createClient();
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [blogs, setBlogs] = useState<RouletteBlog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/');
        return;
      }
      setUser({ id: user.id, email: user.email ?? undefined });

      const { data } = await supabase
        .from('roulette_blogs')
        .select('*')
        .eq('author_id', user.id)
        .order('updated_at', { ascending: false });

      setBlogs(data ?? []);
      setLoading(false);
    })();
  }, [supabase, router]);

  return (
    <PortalShell userEmail={user?.email}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest mb-4">
              <Sparkles size={10} />
              Blog Roulette
            </div>
            <h1 className="text-4xl font-black text-zinc-900 tracking-tight mb-3">
              Your Technical Blogs
            </h1>
            <p className="text-zinc-500 text-base">
              Write deep-dive technical blogs. Pass the AI vetting quiz. Get
              published to marketing.
            </p>
          </div>

          <Link
            href="/blog-roulette/new"
            className="px-6 py-3 bg-brand hover:bg-brand-hover text-black font-black rounded-xl shadow-brand transition-all flex items-center gap-2 text-sm uppercase tracking-widest"
          >
            <Plus size={16} />
            Start New Blog
          </Link>
        </div>

        {loading ? (
          <div className="bg-white rounded-[32px] p-20 border border-zinc-100 shadow-card flex flex-col items-center justify-center text-center space-y-4">
            <Loader2 className="w-10 h-10 text-brand animate-spin" />
            <p className="text-zinc-500 font-semibold text-lg">
              Loading your blogs...
            </p>
          </div>
        ) : blogs.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-12 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-indigo-950 rounded-[48px] border border-zinc-800 text-white relative overflow-hidden shadow-2xl"
          >
            <div className="absolute top-0 right-0 w-96 h-96 bg-brand/10 blur-[130px] pointer-events-none" />
            <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-indigo-500/10 blur-[130px] pointer-events-none" />

            <div className="max-w-xl text-left space-y-8 relative z-10 py-10 md:pl-8">
              <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl flex items-center justify-center text-brand">
                <PenSquare size={32} />
              </div>
              <div className="space-y-4">
                <h2 className="text-4xl font-black tracking-tight leading-none">
                  No blogs yet. Share what you know.
                </h2>
                <p className="text-zinc-400 text-base leading-relaxed">
                  Write a 1200–1400 word technical deep-dive. Pass the AI
                  vetting quiz. Auto-publish to the marketing team.
                </p>
              </div>
              <Link
                href="/blog-roulette/new"
                className="inline-flex px-10 py-5 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-105 transition-all text-sm uppercase tracking-widest"
              >
                Write Your First Blog
              </Link>
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {blogs.map((b) => {
              const status = STATUS_STYLES[b.status];
              const isLocked = b.status !== 'DRAFT';
              const href = isLocked
                ? `/blog-roulette/${b.id}/edit`
                : `/blog-roulette/${b.id}/edit`;
              return (
                <Link
                  key={b.id}
                  href={href}
                  className="bg-white rounded-[28px] p-8 border border-zinc-100 shadow-card hover:shadow-lg hover:border-brand/30 transition-all group block"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span
                      className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${status.cls}`}
                    >
                      {status.label}
                    </span>
                    {b.status === 'PUBLISHED' ? (
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    ) : b.status === 'REJECTED' ||
                      b.status === 'PUBLISH_FAILED' ? (
                      <AlertCircle size={18} className="text-red-500" />
                    ) : null}
                  </div>

                  <h3 className="text-xl font-black text-zinc-900 leading-tight tracking-tight mb-3 group-hover:text-brand transition-colors line-clamp-2">
                    {b.title || 'Untitled draft'}
                  </h3>

                  <div className="flex items-center gap-4 text-[11px] text-zinc-400 font-bold uppercase tracking-widest">
                    <span className="flex items-center gap-1.5">
                      <Clock size={12} />
                      {b.reading_time || 0} min
                    </span>
                    <span>{b.word_count} words</span>
                    <span className="ml-auto">
                      {new Date(b.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
