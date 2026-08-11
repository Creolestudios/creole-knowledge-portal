'use client';

import { ExternalLink } from 'lucide-react';
import { type ReactNode } from 'react';

type Block =
  | { kind: 'h1' | 'h2' | 'h3' | 'li' | 'quote' | 'p'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'space' };

/**
 * Parse Markdown into a flat list of block descriptors. Kept as a pure
 * function so the component renders without mutating closure state mid-render.
 */
function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let inCode = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        blocks.push({ kind: 'code', text: codeLines.join('\n') });
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (trimmed.startsWith('# ')) blocks.push({ kind: 'h1', text: trimmed.slice(2) });
    else if (trimmed.startsWith('## ')) blocks.push({ kind: 'h2', text: trimmed.slice(3) });
    else if (trimmed.startsWith('### ')) blocks.push({ kind: 'h3', text: trimmed.slice(4) });
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* '))
      blocks.push({ kind: 'li', text: trimmed.slice(2) });
    else if (trimmed.startsWith('> ')) blocks.push({ kind: 'quote', text: trimmed.slice(2) });
    else if (trimmed === '') blocks.push({ kind: 'space' });
    else blocks.push({ kind: 'p', text: line });
  }

  return blocks;
}

/**
 * High-fidelity, zero-dependency Markdown renderer for blog content.
 * Shared by every tab so blog bodies render identically.
 */
export default function BlogReader({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-6 text-zinc-700 leading-relaxed font-sans">
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case 'code':
            return <CodeBlock key={idx} code={block.text} />;
          case 'h1':
            return (
              <h1
                key={idx}
                className="text-2xl sm:text-3xl font-black text-zinc-900 mt-10 mb-4 tracking-tight leading-tight"
              >
                {block.text}
              </h1>
            );
          case 'h2':
            return (
              <h2
                key={idx}
                className="text-xl sm:text-2xl font-black text-zinc-900 mt-8 mb-4 border-b pb-3 border-zinc-100 tracking-tight leading-tight flex items-center gap-2"
              >
                <span className="w-1.5 h-6 bg-brand rounded-full inline-block" />
                {block.text}
              </h2>
            );
          case 'h3':
            return (
              <h3
                key={idx}
                className="text-lg font-extrabold text-zinc-900 mt-6 mb-3 tracking-tight"
              >
                {block.text}
              </h3>
            );
          case 'li':
            return (
              <li
                key={idx}
                className="ml-6 list-disc text-sm py-1.5 font-medium text-zinc-600 pl-2"
              >
                {parseInlineMarkdown(block.text)}
              </li>
            );
          case 'quote':
            return (
              <div
                key={idx}
                className="p-6 bg-brand/5 border-l-4 border-brand rounded-r-2xl my-6 text-zinc-700 italic text-sm shadow-sm"
              >
                {parseInlineMarkdown(block.text)}
              </div>
            );
          case 'space':
            return <div key={idx} className="h-2" />;
          default:
            return (
              <p key={idx} className="text-zinc-600 text-[15px] leading-relaxed">
                {parseInlineMarkdown(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative group rounded-2xl overflow-hidden border border-zinc-800 bg-[#0f0f11] my-6 font-mono text-xs shadow-lg">
      <div className="flex items-center justify-between px-6 py-3 bg-[#16161a] border-b border-zinc-800 text-zinc-400">
        <span className="text-[10px] uppercase font-bold tracking-wider text-brand">
          Code Snippet
        </span>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(code)}
          className="hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest cursor-pointer"
        >
          Copy
        </button>
      </div>
      <pre className="p-6 overflow-x-auto text-zinc-300">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Inline Markdown parser for bold (**text**) and links ([text](url)). */
function parseInlineMarkdown(text: string): ReactNode {
  const regex = /(\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\))/g;
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null = regex.exec(text);

  while (match !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }

    if (match[2]) {
      parts.push(
        <strong key={match.index} className="font-extrabold text-zinc-900">
          {parseInlineMarkdown(match[2])}
        </strong>
      );
    } else if (match[3] && match[4]) {
      parts.push(
        <a
          key={match.index}
          href={match[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand hover:underline font-bold inline-flex items-center gap-0.5 group"
        >
          {match[3]}
          <ExternalLink
            size={10}
            className="inline opacity-60 group-hover:opacity-100 transition-opacity"
          />
        </a>
      );
    }
    lastIdx = regex.lastIndex;
    match = regex.exec(text);
  }

  if (lastIdx < text.length) {
    parts.push(text.substring(lastIdx));
  }

  return parts.length > 0 ? parts : text;
}
