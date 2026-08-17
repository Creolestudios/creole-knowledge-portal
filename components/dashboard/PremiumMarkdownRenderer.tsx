import { ExternalLink } from 'lucide-react';
import { type ReactNode } from 'react';

/** Rebuild headings/lists when a scraped body was flattened into one line. */
export function restoreArticleMarkdown(content: string): string {
  if (!content) return '';
  const newlineCount = (content.match(/\n/g) || []).length;
  if (newlineCount >= 3) {
    return content.replace(/\n{3,}/g, '\n\n');
  }

  let text = content;
  text = text.replace(/[ \t]+(#{1,6} )/g, '\n\n$1');
  text = text.replace(/[ \t]+(```)/g, '\n\n$1');
  text = text.replace(
    /[ \t]+(Step\s+\d+:\s+[A-Z][^.\n]{3,80}?)(?=\s+(?:curl|uv |npm |npx |pip |git |docker |python)|\s+[A-Z]|$)/gi,
    '\n\n### $1\n\n'
  );
  text = text.replace(/[ \t]+(Step\s+\d+:)/gi, '\n\n### $1');
  text = text.replace(
    /\s+((?:curl|uv |npm |npx |pip |git |docker |python3? )\S.{8,200}?)(?=\s+[A-Z]|$)/g,
    '\n\n```bash\n$1\n```\n\n'
  );
  text = text.replace(/[ \t]+(\d+\.\s+)/g, '\n$1');
  text = text.replace(/[ \t]+([-*] )/g, '\n$1');
  if (!text.includes('\n\n') && text.length > 280) {
    text = text.replace(/([.!?])\s+(?=[A-Z#])/g, '$1\n\n');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function parseInlineMarkdown(text: string): ReactNode {
  const regex = /(\*\*([^*]{1,500})\*\*|\[([^\]]{1,300})\]\(([^)]{1,1000})\))/g;
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
          {match[2]}
        </strong>
      );
    } else if (match[3] && match[4]) {
      parts.push(
        <a
          key={match.index}
          href={match[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand hover:underline font-bold inline-flex items-center gap-0.5"
        >
          {match[3]}
          <ExternalLink size={10} className="inline opacity-60" />
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

const COMMAND_RE = /^(curl |uv |npm |npx |pip |pipx |git |docker |python3? |pnpm |yarn )/;

export function PremiumMarkdownRenderer({ content }: { content: string }) {
  const lines = restoreArticleMarkdown(content).split('\n');
  const blocks: Array<{ type: string; content: string }> = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let currentParagraph: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      blocks.push({ type: 'p', content: currentParagraph.join('\n') });
      currentParagraph = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        blocks.push({ type: 'code', content: codeLines.join('\n') });
        codeLines = [];
      } else {
        flushParagraph();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushParagraph();
      blocks.push({ type: 'h1', content: trimmed.substring(2) });
    } else if (trimmed.startsWith('## ')) {
      flushParagraph();
      blocks.push({ type: 'h2', content: trimmed.substring(3) });
    } else if (trimmed.startsWith('### ')) {
      flushParagraph();
      blocks.push({ type: 'h3', content: trimmed.substring(4) });
    } else if (trimmed.startsWith('#### ')) {
      flushParagraph();
      blocks.push({ type: 'h3', content: trimmed.substring(5) });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph();
      blocks.push({ type: 'li', content: trimmed.substring(2) });
    } else if (/^\d+\.\s/.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'li', content: trimmed.replace(/^\d+\.\s/, '') });
    } else if (trimmed.startsWith('> ')) {
      flushParagraph();
      blocks.push({ type: 'blockquote', content: trimmed.substring(2) });
    } else if (COMMAND_RE.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'code', content: trimmed });
    } else if (trimmed === '') {
      flushParagraph();
      blocks.push({ type: 'empty', content: '' });
    } else {
      currentParagraph.push(line);
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({ type: 'code', content: codeLines.join('\n') });
  } else {
    flushParagraph();
  }

  return (
    <div className="space-y-5 text-zinc-700 leading-relaxed font-sans">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'code':
            return (
              <div
                key={idx}
                className="relative group rounded-2xl overflow-hidden border border-zinc-800 bg-[#0f0f11] my-4 font-mono text-xs shadow-lg"
              >
                <div className="flex items-center justify-between px-6 py-3 bg-[#16161a] border-b border-zinc-800 text-zinc-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-brand">
                    Code Snippet
                  </span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(block.content)}
                    className="hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
                <pre className="p-6 overflow-x-auto text-zinc-300 whitespace-pre-wrap">
                  <code>{block.content}</code>
                </pre>
              </div>
            );
          case 'h1':
            return (
              <h1
                key={idx}
                className="text-3xl font-black text-zinc-900 mt-10 mb-4 tracking-tight leading-tight"
              >
                {block.content}
              </h1>
            );
          case 'h2':
            return (
              <h2
                key={idx}
                className="text-2xl font-black text-zinc-900 mt-8 mb-4 border-b pb-3 border-zinc-100 tracking-tight leading-tight flex items-center gap-2"
              >
                <span className="w-1.5 h-6 bg-brand rounded-full inline-block" />
                {block.content}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={idx} className="text-lg font-extrabold text-zinc-900 mt-6 mb-3 tracking-tight">
                {block.content}
              </h3>
            );
          case 'li':
            return (
              <li key={idx} className="ml-6 list-disc text-sm py-1.5 font-medium text-zinc-600 pl-2">
                {parseInlineMarkdown(block.content)}
              </li>
            );
          case 'blockquote':
            return (
              <div
                key={idx}
                className="p-6 bg-brand/5 border-l-4 border-brand rounded-r-2xl my-6 text-zinc-700 italic text-sm shadow-sm"
              >
                {parseInlineMarkdown(block.content)}
              </div>
            );
          case 'empty':
            return <div key={idx} className="h-2" />;
          case 'p':
            return (
              <p key={idx} className="text-zinc-600 text-[15px] leading-7">
                {parseInlineMarkdown(block.content)}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
