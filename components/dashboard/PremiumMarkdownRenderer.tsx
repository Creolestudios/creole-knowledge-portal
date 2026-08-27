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

  // Flattened repo trees: "pkg/ ├── a/ | └── b/" → real multiline diagram
  text = restoreFlattenedTreeDiagram(text);

  const newlineCount = (text.match(/\n/g) || []).length;
  if (newlineCount >= 3) {
    return text.replace(/\n{3,}/g, '\n\n');
  }

  text = text.replaceAll(' #', '\n\n#');
  text = text.replaceAll(' ```', '\n\n```');
  text = text.replace(/ Step (\d+:)/gi, '\n\n### Step $1');
  // Open AND close a bash fence for a single command (never leave fences unclosed).
  text = text.replace(
    / (curl |uv |npm |npx |pip |git |docker |python3? )([^\n]+)/gi,
    '\n\n```bash\n$1$2\n```\n\n',
  );
  text = text.replace(/ (\d+\. )/g, '\n$1');
  text = text.replace(/ ([-*] )/g, '\n$1');
  if (!text.includes('\n\n') && text.length > 280) {
    text = text.replace(/([.!?])\s+(?=[A-Z#])/g, '$1\n\n');
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** Turn one-line "dir/ ├── a/ | └── b/" dumps into a vertical tree diagram. */
export function restoreFlattenedTreeDiagram(content: string): string {
  const raw = String(content || '');
  if (!raw) return raw;

  // Caption → folder rows from mangled README maps (not ASCII +--+ boxes)
  const mapLine =
    /^(#{1,6}\s+)?\*{0,2}(.+?)\*{0,2}\s+(?:\|\s*){1,6}(?:——|—|├──|└──|├─|└─)\s*([A-Za-z0-9_.@/-]+\/?)\s*$/;

  const lines = raw.split('\n');
  const out: string[] = [];
  let diagramBuf: string[] = [];

  const flushDiagram = () => {
    if (diagramBuf.length === 0) return;
    out.push('```');
    out.push(...diagramBuf);
    out.push('```');
    diagramBuf = [];
  };

  for (const line of lines) {
    const markers = (line.match(/├──|└──|├─|└─/g) || []).length;
    const pipeRuns = (line.match(/\|\s+\|/g) || []).length;
    const mapMatch = line.trim().match(mapLine);

    if (mapMatch) {
      const caption = mapMatch[2].replace(/\*\*/g, '').trim();
      const folder = mapMatch[3].trim();
      diagramBuf.push(caption);
      diagramBuf.push(`  └── ${folder}`);
      continue;
    }

    // Only unicode tree branches — never ASCII +---+ box borders
    if (markers >= 2 || (markers >= 1 && pipeRuns >= 1)) {
      let working = line.replace(/\*\*/g, '');
      working = working.replace(
        /([^\n])(\s*)(\|[\s|]*)?(├──|└──|├─|└─)\s*/g,
        (_m, before: string, _sp: string, pipes: string | undefined, branch: string) => {
          const indent = pipes ? pipes.replace(/[^\|]/g, '').length : 0;
          const pad = '  '.repeat(Math.min(indent, 6));
          return `${before}\n${pad}${branch} `;
        },
      );
      working = working.replace(/([/\w.-]+\/)\s+(?=├──|└──|├─|└─)/g, '$1\n');
      working = working.replace(/\s+\|\s+\|\s+\|\s+/g, '\n');
      working = working.replace(/\s+\|\s+\|\s+/g, '\n');
      for (const part of working.split('\n')) {
        if (part.trim()) diagramBuf.push(part.trimEnd());
      }
      continue;
    }

    flushDiagram();
    out.push(line);
  }
  flushDiagram();
  return out.join('\n');
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
        <code
          key={match.index}
          className="bg-zinc-100 text-brand px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-200"
        >
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

/** Markdown HRs and decorative dash/equals rulers — never show as literal text. */
export function isDecorativeSeparator(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/^([-_*])\1{2,}$/.test(trimmed)) return true;
  if (/^[-_=─–—]{4,}$/.test(trimmed)) return true;
  if (!/[a-zA-Z0-9]/.test(trimmed) && /^([-*_=─]\s*){3,}$/.test(trimmed)) return true;
  return false;
}

/** Single-line architecture / queue flows belong in a diagram box. */
export function looksLikeFlowLine(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || t.length < 24) return false;
  if (/\b(==>|-->|<-+>|=>)\b/.test(t)) return true;
  if (/==[ \t]*\[[^\]]+\][ \t]*==/.test(t)) return true;
  if (/\bArchitecture\b/i.test(t) && /\[[^\]]{1,200}\]/.test(t) && /==|->|→/.test(t)) return true;
  if ((t.match(/\[[^\]]{2,40}\]/g) || []).length >= 2 && /==|->|→|⇒/.test(t)) return true;
  return false;
}

/** Box-drawing / pipe trees — only real structure, not prose with hyphens. */
export function looksLikeAsciiDiagram(text: string): boolean {
  const raw = String(text || '');
  if (looksLikeFlowLine(raw)) return true;

  const treeBranches = (raw.match(/├──|└──|├─|└─/g) || []).length;
  if (treeBranches >= 2) return true;

  const lines = raw
    .split('\n')
    .filter((l) => l.trim().length > 0 && !isDecorativeSeparator(l));
  if (lines.length < 2) {
    // Single flattened tree line still counts as a diagram
    return treeBranches >= 1 && /\/\s+(?:├|└|\|)/.test(raw);
  }

  // Count structural art only — do NOT count plain -, _, /, <, > (those appear in prose).
  const boxDrawing = (raw.match(/[│┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]/g) || []).length;
  const asciiBoxes = (raw.match(/\+[-=]{2,}\+|[|=]{2,}|\|[^|\n]{2,}\|/g) || []).length;
  const arrowLines = lines.filter((l) => /(?:-->|==>|<-+|⇒|→|\bv\b|\^)/.test(l)).length;
  const indentedBoxes = lines.filter(
    (l) => /^\s{2,}/.test(l) && /[|+]/.test(l),
  ).length;
  const treeLines = lines.filter((l) => /(?:├──|└──|├─|└─)/.test(l)).length;

  if (boxDrawing >= 4) return true;
  if (treeLines >= 2) return true;
  if (asciiBoxes >= 2 && lines.length >= 3) return true;
  if (indentedBoxes >= 3 && asciiBoxes >= 1) return true;
  if (arrowLines >= 2 && asciiBoxes >= 1) return true;
  return false;
}

/** Real source / shell — belongs in the black box. */
export function looksLikeSourceCode(text: string): boolean {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !isDecorativeSeparator(l));
  if (lines.length === 0) return false;

  let hits = 0;
  for (const line of lines) {
    const t = line.trim();
    if (REAL_COMMAND.test(t)) {
      hits += 2;
      continue;
    }
    if (
      /^(def |async def |class |import |from \w+ import |const |let |var |function |export |return |await |async |try:|except |elif |else:|if __name__|for \w+ in |for .+ in |while |with |console\.|asyncio\.|npm |yarn |pnpm )/.test(
        t,
      )
    ) {
      hits += 2;
      continue;
    }
    if (/^\w[\w.]*\([^)]*\)\s*:$/.test(t)) {
      hits += 2;
      continue;
    }
    // Indented continuation typical of code blocks
    if (/^( {2,}|\t)/.test(line) && /[(){}[\]=.;:]/.test(t) && t.split(/\s+/).length <= 14) {
      hits += 1;
      continue;
    }
    if (/[{};]$/.test(t) && /[=()[\]{}]/.test(t) && t.split(/\s+/).length <= 12) {
      hits += 1;
    }
  }

  const wordyProse = lines.filter((l) => {
    const words = l.trim().split(/\s+/);
    return words.length >= 14 && /[.!?]$/.test(l.trim());
  }).length;

  if (wordyProse >= 2 && hits < 3) return false;
  return hits >= 2 || (lines.length <= 8 && hits >= 1 && wordyProse === 0);
}

/**
 * Fenced blocks that are really markdown prose (Gemini often wraps teaching text in ```).
 * Those must render as normal text, not CODE SNIPPET.
 */
export function looksLikeProseMistakenlyFenced(text: string): boolean {
  if (looksLikeAsciiDiagram(text) || looksLikeSourceCode(text)) return false;

  const lines = String(text || '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return true;

  let proseSignals = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^#{1,6}\s+\S/.test(t)) proseSignals += 2;
    if (/^[-*]\s+\S/.test(t) && t.split(/\s+/).length >= 6) proseSignals += 1;
    if (/^\d+\.\s+\S/.test(t) && t.split(/\s+/).length >= 6) proseSignals += 1;
    if (t.split(/\s+/).length >= 16 && /[.!?]/.test(t)) proseSignals += 1;
  }

  return proseSignals >= 2;
}

function looksLikeRealHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/^((enter|exit) fullscreen|report abuse|copy link|like|comment|bookmark)$/i.test(trimmed)) {
    return false;
  }
  return true;
}

function looksLikeCodeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (REAL_COMMAND.test(t)) return true;
  if (
    /^(def |async def |class |import |from \w+ import |const |let |var |function |export |return |await |asyncio\.|console\.|for \w+ in |for .+ in |while |try:|except |elif |else:)/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^\w[\w.]*\([^)]*\)\s*:$/.test(t)) return true;
  if (/^( {4}|\t)/.test(line) && /[(){}[\]=.;:]/.test(t) && t.split(/\s+/).length <= 14) {
    return true;
  }
  return false;
}

type MdBlock = { type: string; content: string; label?: string };

/** Drop mid-blog "From [title](url):" attribution lines (sources belong at the end). */
export function stripMidBlogSourceLines(content: string): string {
  return String(content || '')
    .replace(/^[ \t]*\*\*From[ \t]+\[[^\]]+\]\([^)]*\)(?:[ \t]*\(continued\))?:\*\*[ \t\r]*$/gim, '')
    .replace(/^[ \t]*From[ \t]+\[[^\]]+\]\([^)]*\)(?:[ \t]*\(continued\))?:[ \t\r]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isShortCodeAnnotation(block: MdBlock): boolean {
  if (!['h2', 'h3', 'p'].includes(block.type)) return false;
  const t = block.content.trim();
  if (!t || t.length > 120) return false;
  if (/\n/.test(t)) return false;
  // Full teaching paragraphs stay outside; short labels mid-code fold in.
  if (t.split(/\s+/).length > 18) return false;
  return true;
}

function isCodeContinuation(text: string): boolean {
  const raw = String(text || '');
  const firstLine = raw.split('\n')[0] || '';
  const t = firstLine.trim();
  if (/^( {2,}|\t)/.test(firstLine)) return true;
  if (
    /^(await |return |else:|elif |except |finally:|yield |pass$|break$|continue$|\)|:|,)/.test(t)
  ) {
    return true;
  }
  if (/^(import |from |async def |def |class |const |let |var |function )/.test(t)) return true;
  return looksLikeSourceCode(raw) || looksLikeAsciiDiagram(raw);
}

/** Keep one logical code/diagram in a single black box (no half-split boxes). */
export function coalesceFragmentedCodeBlocks(blocks: MdBlock[]): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type !== 'code') {
      out.push(block);
      i += 1;
      continue;
    }

    let merged: MdBlock = { ...block, content: block.content };
    let j = i + 1;
    while (j < blocks.length) {
      let k = j;
      while (k < blocks.length && blocks[k].type === 'empty') k += 1;

      const middles: MdBlock[] = [];
      while (
        k < blocks.length &&
        isShortCodeAnnotation(blocks[k]) &&
        k + 1 < blocks.length
      ) {
        // Peek: only swallow annotation if a code block follows
        let peek = k + 1;
        while (peek < blocks.length && blocks[peek].type === 'empty') peek += 1;
        if (peek >= blocks.length || blocks[peek].type !== 'code') break;
        if (!isCodeContinuation(blocks[peek].content) && !looksLikeAsciiDiagram(blocks[peek].content)) {
          break;
        }
        middles.push(blocks[k]);
        k = peek;
      }

      if (k >= blocks.length || blocks[k].type !== 'code') break;
      const next = blocks[k];

      const mergedIsDiagram =
        merged.label === 'Diagram' || looksLikeAsciiDiagram(merged.content);
      const nextIsDiagram = next.label === 'Diagram' || looksLikeAsciiDiagram(next.content);
      const bothDiagram = mergedIsDiagram && nextIsDiagram;
      const onlyEmptiesBetween = middles.length === 0;
      const continuation = isCodeContinuation(next.content);

      if (!bothDiagram && !onlyEmptiesBetween && !continuation) break;
      if (!bothDiagram && !onlyEmptiesBetween && middles.length > 0 && !continuation) break;

      const commentLines = middles.map((m) => `# ${m.content.replace(/^#+\s*/, '').trim()}`);
      const label = bothDiagram
        ? 'Diagram'
        : merged.label === 'Diagram' || next.label === 'Diagram'
          ? 'Diagram'
          : merged.label || next.label || 'Code Snippet';
      merged = {
        type: 'code',
        label,
        content: [merged.content, ...commentLines, next.content].filter((p) => p.length > 0).join('\n'),
      };
      j = k + 1;
    }

    out.push(merged);
    i = j > i ? j : i + 1;
  }
  return out;
}

function parseMarkdownBlocks(lines: string[], depth = 0): MdBlock[] {
  const blocks: MdBlock[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let currentParagraph: string[] = [];
  let pendingCode: string[] = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const joined = currentParagraph
        .filter((l) => !isDecorativeSeparator(l))
        .join('\n')
        .trim();
      currentParagraph = [];
      if (!joined) return;
      if (looksLikeAsciiDiagram(joined) || looksLikeFlowLine(joined)) {
        blocks.push({ type: 'code', content: joined, label: 'Diagram' });
      } else if (looksLikeSourceCode(joined)) {
        blocks.push({ type: 'code', content: joined, label: 'Code Snippet' });
      } else {
        blocks.push({ type: 'p', content: joined });
      }
    }
  };

  const flushPendingCode = () => {
    if (pendingCode.length === 0) return;
    const content = pendingCode.join('\n');
    pendingCode = [];
    if (looksLikeProseMistakenlyFenced(content)) {
      if (depth < 2) {
        blocks.push(...parseMarkdownBlocks(content.split('\n'), depth + 1));
      } else {
        blocks.push({ type: 'p', content });
      }
      return;
    }
    const label = looksLikeAsciiDiagram(content) ? 'Diagram' : 'Code Snippet';
    blocks.push({ type: 'code', content, label });
  };

  const pushFencedContent = (content: string) => {
    if (!content.trim()) return;
    if (looksLikeProseMistakenlyFenced(content) && depth < 2) {
      blocks.push(...parseMarkdownBlocks(content.split('\n'), depth + 1));
      return;
    }
    if (looksLikeProseMistakenlyFenced(content)) {
      blocks.push({ type: 'p', content });
      return;
    }
    const label = looksLikeAsciiDiagram(content) ? 'Diagram' : 'Code Snippet';
    blocks.push({ type: 'code', content, label });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        pushFencedContent(codeLines.join('\n'));
        codeLines = [];
      } else {
        flushPendingCode();
        flushParagraph();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (isDecorativeSeparator(trimmed)) {
      // Keep separators from splitting diagrams/code; treat like blank inside pending code
      if (pendingCode.length > 0) {
        pendingCode.push(line);
        continue;
      }
      flushParagraph();
      continue;
    }

    // Accumulate unfenced source lines; blank lines stay inside the same box
    if (
      looksLikeCodeLine(line) ||
      (pendingCode.length > 0 &&
        (trimmed === '' || /^( {2,}|\t)/.test(line) || looksLikeCodeLine(line)))
    ) {
      if (pendingCode.length === 0) {
        flushParagraph();
      }
      pendingCode.push(line);
      continue;
    }
    if (pendingCode.length > 0) {
      flushPendingCode();
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
      blocks.push({ type: 'code', content: trimmed, label: 'Code Snippet' });
    } else if (looksLikeFlowLine(trimmed)) {
      flushParagraph();
      blocks.push({ type: 'code', content: trimmed, label: 'Diagram' });
    } else if (trimmed === '') {
      // Keep blank lines inside a growing ASCII diagram paragraph
      if (
        currentParagraph.length > 0 &&
        looksLikeAsciiDiagram(currentParagraph.join('\n'))
      ) {
        currentParagraph.push(line);
        continue;
      }
      flushParagraph();
      blocks.push({ type: 'empty', content: '' });
    } else {
      currentParagraph.push(line);
    }
  }

  if (inCodeBlock) {
    pushFencedContent(codeLines.join('\n'));
  } else {
    flushPendingCode();
    flushParagraph();
  }

  return coalesceFragmentedCodeBlocks(blocks);
}

export function PremiumMarkdownRenderer({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(
    restoreArticleMarkdown(stripMidBlogSourceLines(content)).split('\n'),
  );

  return (
    <div className="space-y-5 text-zinc-700 leading-relaxed font-sans">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'code':
            return (
              <div
                key={idx}
                className="relative group rounded-2xl overflow-hidden border border-zinc-800 bg-[#0f0f11] my-4 font-mono text-xs shadow-lg max-w-full"
              >
                <div className="flex items-center justify-between px-6 py-3 bg-[#16161a] border-b border-zinc-800 text-zinc-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-brand">
                    {block.label || 'Code Snippet'}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(block.content)}
                    className="hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
                <pre className="p-6 overflow-x-auto text-zinc-300 whitespace-pre font-mono text-[11px] leading-5 tabular-nums">
                  <code className="font-mono whitespace-pre">{block.content}</code>
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
