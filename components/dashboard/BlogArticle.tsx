'use client';

import { Clock, Sparkles, BookOpen, Link2, TrendingUp, GraduationCap } from 'lucide-react';
import type { DailyBlog, BlogSection } from '@/types/contracts';
import BlogReader from './BlogReader';

function SectionBlock({
  section,
  icon,
  badge,
}: {
  section: BlogSection;
  icon: React.ReactNode;
  badge: string;
}) {
  return (
    <section className="space-y-4">
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest">
        {icon}
        {badge}
      </div>
      <BlogReader content={section.content} />
      {section.sources.length > 0 && (
        <div className="pt-2 flex flex-wrap gap-2">
          {section.sources.map((s) => (
            <a
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-xl text-[11px] font-bold text-zinc-600 hover:border-brand hover:text-brand transition-all"
            >
              <Link2 size={11} />
              {s.source_domain}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Renders one DailyBlog: header meta, the "Trending for you" and
 * "Continue to learn" sections, and (optionally) the end-of-blog quiz CTA.
 */
export default function BlogArticle({
  blog,
  onStartQuiz,
}: {
  blog: DailyBlog;
  onStartQuiz?: () => void;
}) {
  return (
    <article className="bg-white rounded-3xl sm:rounded-[32px] p-6 sm:p-10 border border-zinc-100 shadow-card">
      <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-6 border-b pb-6 border-zinc-100">
        <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-50 rounded-lg border">
          <Clock size={12} className="text-zinc-500" />
          <span>{blog.estimated_read_minutes} min read</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-50 rounded-lg border">
          <Sparkles size={12} className="text-brand" />
          <span>Personalized</span>
        </div>
        <span className="ml-auto text-zinc-400">
          {new Date(blog.date).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>

      <h2 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight leading-tight mb-4">
        {blog.title}
      </h2>

      <div className="flex flex-wrap gap-2 mb-8">
        {blog.tags.map((tag) => (
          <span
            key={tag}
            className="px-3 py-1 bg-zinc-50 border border-zinc-200 text-zinc-600 rounded-lg text-[11px] font-bold"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="space-y-12">
        <SectionBlock
          section={blog.sections.trending}
          icon={<TrendingUp size={11} />}
          badge="Trending for you"
        />
        <SectionBlock
          section={blog.sections.continueToLearn}
          icon={<GraduationCap size={11} />}
          badge="Continue to learn"
        />
      </div>

      {onStartQuiz && (
        <div className="mt-12 pt-8 border-t border-zinc-100 text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-widest">
            <BookOpen size={14} /> You&apos;ve reached the end
          </div>
          <p className="text-zinc-500 text-sm">Test what you learned with a quick quiz.</p>
          <button
            type="button"
            id="start-quiz-btn"
            onClick={onStartQuiz}
            className="mt-2 px-10 py-4 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-105 transition-all text-sm uppercase tracking-widest cursor-pointer"
          >
            Start Quiz
          </button>
        </div>
      )}
    </article>
  );
}
