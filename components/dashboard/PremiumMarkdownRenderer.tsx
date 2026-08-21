import { ExternalLink } from 'lucide-react';
import { type ReactNode } from 'react';

/** Rebuild headings/lists when a scraped body was flattened into one line. */
export function restoreArticleMarkdown(content: string): string {
  if (!content) return '';
  let text = content;

  // Convert common HTML tags to markdown if HTML tags are detected
  if (/<[a-z][^>]*>/i.test(text)) {
    text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n## $1\n\n');
    text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n\n$1\n\n');
    text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1');
    text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
    text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    let clean = '';
    let inTag = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '<') {
        inTag = true;
      } else if (text[i] === '>') {
        inTag = false;
      } else if (!inTag) {
        clean += text[i];
      }
    }
    text = clean;
  }

  const newlineCount = (text.match(/\n/g) || []).length;
  if (newlineCount >= 3) {
    return text.replace(/\n{3,}/g, '\n\n');
  }

  text = text.replaceAll(' #', '\n\n#');
  text = text.replaceAll(' ```', '\n\n```');
  text = text.replace(/ Step (\d+:)/gi, '\n\n### Step $1');
  text = text.replace(/ (curl |uv |npm |npx |pip |git |docker |python3? )/gi, '\n\n```bash\n$1');
  text = text.replace(/ (\d+\. )/g, '\n$1');
  text = text.replace(/ ([-*] )/g, '\n$1');
  if (!text.includes('\n\n') && text.length > 280) {
    text = text.replace(/([.!?])\s+(?=[A-Z#])/g, '$1\n\n');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function parseInlineMarkdown(text: string): ReactNode {
  const regex = /(\*\*([^*]{1,500})\*\*|`([^`]{1,500})`|\[([^\]]{1,300})\]\(([^)]{1,1000})\))/g;
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
    } else if (match[3]) {
      parts.push(
        <code key={match.index} className="bg-zinc-100 text-brand px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-200">
          {match[3]}
        </code>
      );
    } else if (match[4] && match[5]) {
      parts.push(
        <a
          key={match.index}
          href={match[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand hover:underline font-bold inline-flex items-center gap-0.5"
        >
          {match[4]}
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

const REAL_COMMAND = /^(curl |uv |npm |npx |pipx |pip install |git clone |git commit |docker |python3? -\w)/;

function looksLikeRealHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/^(enter|exit) fullscreen|report abuse|^copy link$|^like$|^comment$|^bookmark$/i.test(trimmed)) {
    return false;
  }
  return true;
}

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

    if (trimmed.startsWith('# ') && looksLikeRealHeading(trimmed.substring(2))) {
      flushParagraph();
      blocks.push({ type: 'h2', content: trimmed.substring(2) });
    } else if (trimmed.startsWith('## ') && looksLikeRealHeading(trimmed.substring(3))) {
      flushParagraph();
      blocks.push({ type: 'h2', content: trimmed.substring(3) });
    } else if (trimmed.startsWith('### ') && looksLikeRealHeading(trimmed.substring(4))) {
      flushParagraph();
      blocks.push({ type: 'h3', content: trimmed.substring(4) });
    } else if (trimmed.startsWith('#### ') && looksLikeRealHeading(trimmed.substring(5))) {
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
    } else if (REAL_COMMAND.test(trimmed)) {
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
          case 'h2':
            return (
              <h2
                key={idx}
                className="text-xl font-extrabold text-zinc-900 mt-8 mb-4 border-b pb-3 border-zinc-100 tracking-tight leading-tight flex items-center gap-2"
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
              <p key={idx} className="text-zinc-600 text-[15px] leading-7 whitespace-pre-wrap">
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
