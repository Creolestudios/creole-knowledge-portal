'use client';

import { Clock, BookOpen, Code2, Link2, GraduationCap, ExternalLink } from 'lucide-react';
import type { DailyBlog, Source } from '@/types/contracts';

/** Pull the `##` section headings from Markdown as "what you'll learn" points. */
function extractTopics(markdown: string): string[] {
  return markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3));
}

/**
 * Side panel for the Daily Blog tab. Gives the reader an at-a-glance idea of
 * what they'll learn: the tech/languages covered, the topics inside, and the
 * resources (sources) backing the blog.
 */
export default function BlogInfoPanel({ blog }: { blog: DailyBlog }) {
  const sources: Source[] = [
    ...blog.sections.trending.sources,
    ...blog.sections.continueToLearn.sources,
  ];
  const topics = [
    ...extractTopics(blog.sections.trending.content),
    ...extractTopics(blog.sections.continueToLearn.content),
  ];

  return (
    <div className="space-y-6 lg:sticky lg:top-0">
      {/* Overview */}
      <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card">
        <h3 className="text-base font-black text-zinc-900 mb-4">About this blog</h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-zinc-50 border border-zinc-100 py-3">
            <Clock size={16} className="text-brand mx-auto mb-1" />
            <p className="text-lg font-black text-zinc-900 tabular-nums leading-none">
              {blog.estimated_read_minutes}
            </p>
            <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest mt-1">min</p>
          </div>
          <div className="rounded-2xl bg-zinc-50 border border-zinc-100 py-3">
            <Code2 size={16} className="text-brand mx-auto mb-1" />
            <p className="text-lg font-black text-zinc-900 tabular-nums leading-none">
              {blog.tags.length}
            </p>
            <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest mt-1">
              topics
            </p>
          </div>
          <div className="rounded-2xl bg-zinc-50 border border-zinc-100 py-3">
            <Link2 size={16} className="text-brand mx-auto mb-1" />
            <p className="text-lg font-black text-zinc-900 tabular-nums leading-none">
              {sources.length}
            </p>
            <p className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest mt-1">
              sources
            </p>
          </div>
        </div>
      </div>

      {/* Tech & languages */}
      <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card">
        <h3 className="text-base font-black text-zinc-900 flex items-center gap-2 mb-4">
          <Code2 size={17} className="text-brand" />
          Tech &amp; languages
        </h3>
        <div className="flex flex-wrap gap-2">
          {blog.tags.map((tag) => (
            <span
              key={tag}
              className="px-3 py-1.5 bg-brand/5 border border-brand/15 text-zinc-700 rounded-xl text-xs font-bold"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* What you'll learn */}
      {topics.length > 0 && (
        <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card">
          <h3 className="text-base font-black text-zinc-900 flex items-center gap-2 mb-4">
            <GraduationCap size={18} className="text-brand" />
            What you&apos;ll learn
          </h3>
          <ul className="space-y-3">
            {topics.map((topic, i) => (
              <li key={i} className="flex gap-3 text-sm text-zinc-600 font-medium">
                <span className="w-5 h-5 rounded-full bg-brand/10 text-brand text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span className="leading-snug">{topic}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Resources */}
      {sources.length > 0 && (
        <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card">
          <h3 className="text-base font-black text-zinc-900 flex items-center gap-2 mb-4">
            <BookOpen size={17} className="text-brand" />
            Resources
          </h3>
          <div className="space-y-3">
            {sources.map((s) => (
              <a
                key={s.id}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-4 bg-zinc-50 border border-zinc-100 rounded-2xl hover:border-brand transition-all group"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold text-zinc-900 leading-tight group-hover:text-brand transition-colors">
                    {s.title}
                  </p>
                  <ExternalLink
                    size={13}
                    className="text-zinc-400 group-hover:text-brand transition-colors shrink-0 mt-0.5"
                  />
                </div>
                <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mt-1.5">
                  {s.source_domain} · {s.author}
                </p>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
