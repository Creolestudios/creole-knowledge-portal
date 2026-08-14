'use client';

import { useRef } from 'react';
import {
  Bot,
  Clock,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  Eye,
} from 'lucide-react';
import { useBlogContentEnhancer, sanitizeBlogHtml } from '@/hooks/useBlogContentEnhancer';

interface PreviewPaneProps {
  html: string;
  title: string;
  seoTitle: string;
  tldr: string;
  aiScore: number | null;
  aiSignals: string[];
  readingTime: number;
}

/**
 * Client-side preview pane that renders blog HTML with Mermaid diagram
 * support and metadata overlay. Toggles in place of the TinyMCE editor.
 */
export default function PreviewPane({
  html,
  title,
  seoTitle,
  tldr,
  aiScore,
  aiSignals,
  readingTime,
}: PreviewPaneProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useBlogContentEnhancer(contentRef, [html]);

  const aiStatus: 'danger' | 'warn' | 'safe' | 'idle' =
    aiScore === null ? 'idle' : aiScore >= 80 ? 'danger' : aiScore >= 60 ? 'warn' : 'safe';
  const aiColors = {
    danger: 'bg-red-50 border-red-200 text-red-700',
    warn: 'bg-amber-50 border-amber-200 text-amber-700',
    safe: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    idle: 'bg-zinc-50 border-zinc-200 text-zinc-500',
  };
  const aiIcons = {
    danger: AlertTriangle,
    warn: AlertTriangle,
    safe: CheckCircle2,
    idle: Bot,
  };
  const AiIcon = aiIcons[aiStatus];

  const wordCount = html
    .replace(/<[^>]{1,10000}>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return (
    <div className="bg-white rounded-[28px] border border-zinc-100 shadow-card overflow-hidden">
      {/* Preview header bar */}
      <div className="px-8 py-4 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-400 text-xs font-bold uppercase tracking-widest">
          <Eye size={14} />
          Blog Preview
        </div>
        <div className="flex items-center gap-4 text-[11px] text-zinc-400 font-medium">
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {readingTime} min read
          </span>
          <span>{wordCount} words</span>
        </div>
      </div>

      {/* AI score banner */}
      <div
        className={`mx-8 mt-6 px-5 py-3 rounded-xl border text-sm font-semibold flex items-start gap-3 ${aiColors[aiStatus]}`}
      >
        <AiIcon size={18} className="shrink-0 mt-0.5" />
        <div>
          {aiScore === null ? (
            <span>AI detection not yet run — content will be scanned automatically.</span>
          ) : (
            <span>
              AI detection score: <strong>{aiScore}%</strong>
              {aiStatus === 'safe'
                ? ' — looks human-written'
                : aiStatus === 'warn'
                  ? ' — borderline, review suggested'
                  : ' — likely AI-generated, revise content'}
            </span>
          )}
          {aiSignals.length > 0 && (
            <ul className="mt-1.5 text-[11px] opacity-80 space-y-0.5 list-disc list-inside">
              {aiSignals.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* SEO metadata card */}
      <div className="mx-8 mt-4 p-4 bg-zinc-50 rounded-xl border border-zinc-100">
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">
          SEO Preview
        </p>
        <p className="text-lg font-black text-brand leading-tight">
          {seoTitle || title}
        </p>
        <p className="text-sm text-zinc-600 line-clamp-2">{tldr || 'No TL;DR provided.'}</p>
      </div>

      {/* Rendered blog content — mirrors TinyMCE editor styling exactly */}
      <div className="px-8 py-6" ref={contentRef}>
        <style>{`
          .preview-content {
            font-family: Inter, system-ui, sans-serif;
            font-size: 15px;
            line-height: 1.7;
            color: #27272a;
          }
          .preview-content h1 {
            font-size: 2em;
            font-weight: 900;
            letter-spacing: -0.02em;
            margin: 1.2em 0 0.4em;
            padding-bottom: 0.3em;
            border-bottom: 1px solid #e4e4e7;
            line-height: 1.3;
          }
          .preview-content h2 {
            font-size: 1.5em;
            font-weight: 800;
            letter-spacing: -0.01em;
            margin: 1.1em 0 0.4em;
            line-height: 1.35;
          }
          .preview-content h3 {
            font-size: 1.17em;
            font-weight: 700;
            margin: 0.9em 0 0.3em;
            line-height: 1.4;
          }
          .preview-content p {
            margin: 0 0 1em;
          }
          .preview-content a {
            color: #34c4f2;
            text-decoration: underline;
          }
          .preview-content ul, .preview-content ol {
            margin: 0 0 1em 1.5em;
            padding: 0;
          }
          .preview-content li {
            margin-bottom: 0.35em;
          }
          .preview-content blockquote {
            margin: 1.2em 0;
            padding: 0.75em 1em;
            border-left: 4px solid #34c4f2;
            background: rgba(52, 196, 242, 0.04);
            border-radius: 0 12px 12px 0;
            color: #52525b;
            font-style: italic;
          }
          .preview-content img {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
            margin: 1.5em auto;
            display: block;
          }
          .preview-content hr {
            border: none;
            border-top: 1px solid #e4e4e7;
            margin: 2em 0;
          }
          .preview-content p > code,
          .preview-content li > code {
            background: #f4f4f5;
            color: #a855f7;
            padding: 2px 6px;
            border-radius: 6px;
            font-size: 0.9em;
            font-weight: 600;
          }
          /* Tables */
          .preview-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 1em 0;
            font-size: 0.9em;
          }
          .preview-content th,
          .preview-content td {
            padding: 8px 12px;
            border: 1px solid #e4e4e7;
            text-align: left;
          }
          .preview-content th {
            background: #f4f4f5;
            font-weight: 700;
          }
          .preview-content tr:nth-child(even) td {
            background: #fafafa;
          }
          /* Raw pre blocks that weren't enhanced by JS */
          .preview-content pre:not(.code-block-wrapper pre) {
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
          .preview-content pre code {
            background: transparent !important;
            color: inherit !important;
            padding: 0 !important;
            font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace !important;
            font-size: 13px !important;
          }
          .preview-content :not(pre) > code {
            background: #f4f4f5;
            color: #a855f7;
            padding: 2px 6px;
            border-radius: 6px;
            font-size: 0.9em;
            font-weight: 600;
          }
        `}</style>
        <div
          className="preview-content"
          dangerouslySetInnerHTML={{
            __html: sanitizeBlogHtml(html) || '<p class="text-zinc-400 italic" style="color:#a1a1aa">No content yet.</p>',
          }}
        />
      </div>
    </div>
  );
}
