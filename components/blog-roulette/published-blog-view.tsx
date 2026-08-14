'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Clock,
  BookOpen,
  ArrowLeft,
  Calendar,
  Tag as TagIcon,
  CheckCircle2,
} from 'lucide-react';
import type { RouletteBlog } from '@/lib/blog-roulette/types';
import { useBlogContentEnhancer, sanitizeBlogHtml } from '@/hooks/useBlogContentEnhancer';

interface PublishedBlogViewProps {
  blog: RouletteBlog;
  tags: string[];
}

export default function PublishedBlogView({ blog, tags }: PublishedBlogViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useBlogContentEnhancer(contentRef, [blog.body_html]);

  return (
    <div className="max-w-4xl mx-auto py-6">
      {/* Top Bar Navigation */}
      <div className="mb-8 flex items-center justify-between">
        <Link
          href="/blog-roulette"
          className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-950 font-bold transition-all text-sm group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
          Back to Roulette
        </Link>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold uppercase tracking-wider rounded-full shadow-sm">
          <CheckCircle2 size={12} />
          {blog.status === 'PUBLISHED' ? 'Published' : blog.status === 'PUBLISHING' ? 'Publishing' : 'Passed Quiz'}
        </span>
      </div>

      <motion.article
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-white rounded-[32px] border border-zinc-150 shadow-card overflow-hidden"
      >
        {/* Cover Image */}
        {blog.cover_image_url && (
          <div className="w-full h-[320px] relative overflow-hidden bg-zinc-100 border-b border-zinc-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={blog.cover_image_url}
              alt={blog.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="p-8 md:p-12">
          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 bg-zinc-100 text-zinc-600 text-xs font-semibold rounded-lg flex items-center gap-1"
                >
                  <TagIcon size={10} />
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Title */}
          <h1 className="text-3xl md:text-5xl font-black text-zinc-900 tracking-tight leading-tight mb-6">
            {blog.title}
          </h1>

          {/* Metadata Row */}
          <div className="flex flex-wrap items-center gap-y-3 gap-x-6 pb-6 border-b border-zinc-100 text-sm text-zinc-500 font-medium">
            <span className="flex items-center gap-2">
              <Calendar size={15} />
              Updated {new Date(blog.updated_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            <span className="flex items-center gap-2">
              <Clock size={15} />
              {blog.reading_time || 1} min read
            </span>
            <span className="flex items-center gap-2">
              <BookOpen size={15} />
              {blog.word_count || 0} words
            </span>
          </div>

          {/* TL;DR Box */}
          {blog.tldr && (
            <div className="mt-8 p-6 bg-gradient-to-tr from-brand/5 to-brand/10 border border-brand/20 rounded-2xl relative overflow-hidden shadow-sm">
              <div className="absolute top-0 right-0 w-32 h-32 bg-brand/10 blur-2xl pointer-events-none" />
              <h2 className="text-xs font-black uppercase tracking-widest text-brand-dark mb-2 flex items-center gap-1.5">
                Key Takeaways / TL;DR
              </h2>
              <p className="text-zinc-800 text-sm leading-relaxed font-medium">
                {blog.tldr}
              </p>
            </div>
          )}

          {/* Article Body */}
          <div className="mt-10" ref={contentRef}>
            <style>{`
              .blog-body-content {
                font-family: Inter, system-ui, sans-serif;
                font-size: 16px;
                line-height: 1.8;
                color: #27272a;
              }
              .blog-body-content h1 {
                font-size: 2.25em;
                font-weight: 900;
                letter-spacing: -0.02em;
                margin: 1.5em 0 0.5em;
                padding-bottom: 0.3em;
                border-bottom: 1px solid #e4e4e7;
                line-height: 1.25;
              }
              .blog-body-content h2 {
                font-size: 1.75em;
                font-weight: 800;
                letter-spacing: -0.015em;
                margin: 1.4em 0 0.5em;
                line-height: 1.3;
              }
              .blog-body-content h3 {
                font-size: 1.35em;
                font-weight: 700;
                margin: 1.2em 0 0.4em;
                line-height: 1.35;
              }
              .blog-body-content p {
                margin: 0 0 1.2em;
              }
              .blog-body-content a {
                color: #34c4f2;
                text-decoration: underline;
                font-weight: 500;
              }
              .blog-body-content ul, .blog-body-content ol {
                margin: 0 0 1.2em 1.5em;
                padding: 0;
              }
              .blog-body-content li {
                margin-bottom: 0.45em;
              }
              .blog-body-content blockquote {
                margin: 1.5em 0;
                padding: 1em 1.25em;
                border-left: 4px solid #34c4f2;
                background: rgba(52, 196, 242, 0.04);
                border-radius: 0 16px 16px 0;
                color: #4b5563;
                font-style: italic;
              }
              .blog-body-content img {
                max-width: 100%;
                height: auto;
                border-radius: 16px;
                margin: 2em auto;
                display: block;
                box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05);
              }
              .blog-body-content hr {
                border: none;
                border-top: 1px solid #e4e4e7;
                margin: 2.5em 0;
              }
              .blog-body-content p > code,
              .blog-body-content li > code {
                background: #f4f4f5;
                color: #a855f7;
                padding: 2px 6px;
                border-radius: 6px;
                font-size: 0.9em;
                font-weight: 600;
              }
              /* Tables */
              .blog-body-content table {
                width: 100%;
                border-collapse: collapse;
                margin: 1.5em 0;
                font-size: 0.95em;
              }
              .blog-body-content th,
              .blog-body-content td {
                padding: 10px 14px;
                border: 1px solid #e4e4e7;
                text-align: left;
              }
              .blog-body-content th {
                background: #f4f4f5;
                font-weight: 700;
              }
              .blog-body-content tr:nth-child(even) td {
                background: #fafafa;
              }
              /* Raw pre blocks that weren't enhanced by JS */
              .blog-body-content pre:not(.code-block-wrapper pre) {
                background: #0f0f11 !important;
                color: #e4e4e7 !important;
                padding: 20px !important;
                border-radius: 12px !important;
                border: 1px solid #27272a !important;
                font-size: 13px !important;
                line-height: 1.6 !important;
                overflow-x: auto !important;
                margin: 24px 0 !important;
              }
              .blog-body-content pre code {
                background: transparent !important;
                color: inherit !important;
                padding: 0 !important;
                font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace !important;
                font-size: 13px !important;
              }
            `}</style>
            <div
              className="blog-body-content"
              dangerouslySetInnerHTML={{
                __html: sanitizeBlogHtml(blog.body_html || '') || '<p class="text-zinc-400 italic">No content.</p>',
              }}
            />
          </div>
        </div>
      </motion.article>
    </div>
  );
}
