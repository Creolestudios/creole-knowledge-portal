import { ExternalLink } from 'lucide-react';
import { type ReactNode } from 'react';
import { TECH_KEYWORDS, textHasTechSignal, isSourceTitleJunk } from '@/lib/tech-keywords';

/** Rebuild headings/lists when a scraped body was flattened into one line. */
export function restoreArticleMarkdown(content: string): string {
  if (!content) return '';
  let text = content;

  // Convert common HTML tags to markdown if HTML tags are detected
  if (/<[a-z][^>]*>/i.test(text)) {
    text = text.replaceAll(/<h[1-6][^>]*>([\s\S]{0,1000}?)<\/h[1-6]>/gi, '\n\n## $1\n\n');
    text = text.replaceAll(/<p[^>]*>([\s\S]{0,1000}?)<\/p>/gi, '\n\n$1\n\n');
    text = text.replaceAll(/<li[^>]*>([\s\S]{0,1000}?)<\/li>/gi, '\n- $1');
    text = text.replaceAll(/<code[^>]*>([\s\S]{0,1000}?)<\/code>/gi, '`$1`');
    text = text.replaceAll(/<strong[^>]*>([\s\S]{0,1000}?)<\/strong>/gi, '**$1**');
    text = text.replaceAll(/<b[^>]*>([\s\S]{0,1000}?)<\/b>/gi, '**$1**');
    text = text.replaceAll(/<em[^>]*>([\s\S]{0,1000}?)<\/em>/gi, '*$1*');
    text = text.replaceAll(/<br\s*\/?>/gi, '\n');
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
    return text.replaceAll(/\n{3,}/g, '\n\n');
  }

  text = text.replaceAll(' #', '\n\n#');
  text = text.replaceAll(' ```', '\n\n```');
  text = text.replaceAll(/ Step (\d+:)/gi, '\n\n### Step $1');
  // Real CLI only — never fence mid-prose words like "learn python asyncio".
  text = text.replaceAll(
    /(^|[\s.])(curl -[A-Za-z0-9][^\n]{8,})/gi,
    '$1\n\n```bash\n$2\n```\n\n',
  );
  text = text.replaceAll(
    /(^|\n)[ \t]*(uv |npm |npx |pipx |pip install |git clone |git commit |docker (?:run|build|compose) |python3? -\w)([^\n]+)/gi,
    '$1\n\n```bash\n$2$3\n```\n\n',
  );
  text = text.replaceAll(/ (\d+\. )/g, '\n$1');
  text = text.replaceAll(/ ([-*] )/g, '\n$1');
  if (!text.includes('\n\n') && text.length > 280) {
    text = text.replaceAll(/([.!?])\s+(?=[A-Z#])/g, '$1\n\n');
  }
  return text.replaceAll(/\n{3,}/g, '\n\n').trim();
}

/** Turn one-line "dir/ ├── a/ | └── b/" dumps into a vertical tree diagram. */
export function restoreFlattenedTreeDiagram(content: string): string {
  const raw = String(content || '');
  if (!raw) return raw;

  // Caption → folder rows from mangled README maps (not ASCII +--+ boxes)
  // Each segment starts with a character the previous one cannot match, so the
  // engine never has to backtrack across the caption (linear, not super-linear).
  const mapLine =
    /^\*{0,2}([^*|\n]+)(?:\*{1,2}[ \t]*)?(?:\|[ \t]*){1,6}(?:—{1,2}|├─{1,2}|└─{1,2})[ \t]*([\w.@/-]+)$/;

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
      const caption = mapMatch[1].replaceAll('**', '').replace(/^#{1,6}\s+/, '').trim();
      const folder = mapMatch[2].trim();
      diagramBuf.push(caption);
      diagramBuf.push(`  └── ${folder}`);
      continue;
    }

    // Only unicode tree branches — never ASCII +---+ box borders
    if (markers >= 2 || (markers >= 1 && pipeRuns >= 1)) {
      let working = line.replaceAll('**', '');
      working = working.replaceAll(
        /([^\n \t|])([ \t|]*)(├─{1,2}|└─{1,2})[ \t]*/g,
        (_m, before: string, spacesAndPipes: string, branch: string) => {
          const indent = spacesAndPipes.replaceAll(/[^\|]/g, '').length;
          const pad = '  '.repeat(Math.min(indent, 6));
          return `${before}\n${pad}${branch} `;
        },
      );
      working = working.replaceAll(/\/[ \t]+(?=[├└]─)/g, '/\n');
      working = working.replaceAll(/\|([ \t]*\|)+/g, '\n');
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
  // Links first — otherwise **[title](url)** swallows the whole link as bold plain text.
  const regex =
    /(\[([^\]]{1,300})\]\(([^)]{1,1000})\)|\*\*([^*]{1,500})\*\*|`([^`]{1,500})`|(?<!\w)_([^_]{1,500})_(?!\w)|(?<!\w)\*([^*]{1,500})\*(?!\*|\w))/g;
  const parts: ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null = regex.exec(text);

  while (match !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }
    if (match[2] && match[3]) {
      parts.push(
        <a
          key={match.index}
          href={match[3]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand hover:underline font-bold inline-flex items-center gap-0.5"
        >
          {match[2]}
          <ExternalLink size={10} className="inline opacity-60" />
        </a>
      );
    } else if (match[4]) {
      const boldText = match[4];
      // Teaching steps like **Step 1:** should stay normal weight
      if (/^(step\s+\d+|phase\s+\d+|part\s+\d+|\d+\.\s)/i.test(boldText.trim())) {
        parts.push(boldText);
      } else {
        parts.push(
          <strong key={match.index} className="font-extrabold text-zinc-900">
            {parseInlineMarkdown(boldText)}
          </strong>,
        );
      }
    } else if (match[5]) {
      parts.push(
        <code
          key={match.index}
          className="bg-zinc-100 text-brand px-1.5 py-0.5 rounded text-xs font-mono border border-zinc-200"
        >
          {match[5]}
        </code>
      );
    } else if (match[6] || match[7]) {
      parts.push(
        <em key={match.index} className="italic text-zinc-600">
          {match[6] || match[7]}
        </em>
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
  if (/^[-_=─–—.]{4,}$/.test(trimmed)) return true;
  if (/^(?:\.\s*){4,}\.?$/.test(trimmed)) return true;
  if (/^(?:·\s*){3,}·?$/.test(trimmed)) return true;
  if (!/[a-zA-Z0-9]/.test(trimmed) && /^([-*_=─.·]\s*){3,}$/.test(trimmed)) return true;
  return false;
}

/** Single-line architecture / queue flows belong in a diagram box. */
export function looksLikeFlowLine(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || t.length < 16) return false;
  // Prose sentences are never flow diagrams
  if (t.split(/\s+/).length >= 14 && /[.!?]$/.test(t)) return false;
  if (/\b(==>|-->|<-+>|=>)\b/.test(t)) return true;
  if (/==[ \t]*\[[^\]]+\][ \t]*==/.test(t)) return true;
  if (/\bArchitecture\b/i.test(t) && /\[[^\]]{1,200}\]/.test(t) && /==|->|→/.test(t)) return true;
  if ((t.match(/\[[^\]]{2,40}\]/g) || []).length >= 2 && /==|->|→|⇒/.test(t)) return true;
  // Chunking / slice diagrams: [--- Slice 1 ---][--- Slice 2 ---]
  const bracketSlices = t.match(/\[[^\]]{3,100}\]/g) || [];
  if (
    bracketSlices.length >= 2 &&
    (/---|–––|—{2,}|═{2,}/.test(t) || /slice|section|part\s*[ab0-9]/i.test(t))
  ) {
    return true;
  }
  if (bracketSlices.length >= 3 && t.length >= 40 && !/[.!?]$/.test(t)) return true;
  return false;
}


function alphaDensityOk(raw: string): boolean {
  const alpha = (raw.match(/[A-Za-z0-9]/g) || []).length;
  const unicode = (raw.match(/[│┌┐└┘├┤┬┴┼─━═╔╗╚╝╠╣╦╩╬]/g) || []).length;
  return alpha >= 40 && (unicode === 0 || alpha >= unicode * 0.35);
}

/** Markdown table alignment / data rows — must never become Diagram boxes. */
export function looksLikeMarkdownTableRow(line: string): boolean {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/^\|?[ \t]*:?-{3,}:?(?:[ \t]*\|[ \t]*:?-{3,}:?)+[ \t]*\|?$/.test(t)) return true;
  if (!t.includes('|')) return false;
  const cells = t
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
  if (cells.length >= 3) return true;
  if (
    cells.length === 2 &&
    cells.every((c) => c.length >= 3 && c.split(/\s+/).length >= 2) &&
    !/[─━+]/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Two-column pipe rows (often inside broken ASCII table fences). */
export function looksLikePipeComparisonTable(text: string): boolean {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const dataRows = lines.filter((l) => {
    if (/^\+[-=+]/.test(l)) return false;
    if (!l.includes('|')) return false;
    const cells = l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length >= 2);
    return cells.length >= 2;
  });
  return dataRows.length >= 2 && dataRows.length >= Math.max(2, Math.ceil(lines.length * 0.3));
}

/** Parse a broken pipe table (ASCII borders optional) into table rows. */
export function parseComparisonTableRows(text: string): string[][] | null {
  if (!looksLikePipeComparisonTable(text)) return null;
  const rows: string[][] = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t || /^\+[-=+]/.test(t)) continue;
    if (!t.includes('|')) continue;
    const cells = t
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length >= 2);
    if (cells.length >= 2) rows.push(cells);
  }
  return rows.length >= 2 ? rows : null;
}

const FENCE_LANG_TAG =
  /^(python|javascript|typescript|js|ts|tsx|jsx|bash|sh|shell|text|json|yaml|yml|sql|go|rust|java|ruby|php|csharp|cpp|c|html|css|markdown|md)$/i;

/** Dev.to / Hugo / Jekyll metadata keys — never show as digest body text. */
const BLOG_FRONTMATTER_KEY =
  /^(title|published|description|tags|series|cover_image|canonical_url|date|author|slug|layout|cover_image_url|reading_time_minutes|organization_id|crossposted|edited_at|created_at|updated_at|published_at|social_image|meta_title|meta_description|subtitle|excerpt|summary|headline|locale|lang|language|category|type|url|id|uuid|path|source|source_url|source_domain|tag_list|topic|topics|collection_id|body_markdown|body_html|markdown|content|version|revision|license|copyright|seo_title|seo_description|seo_keywords|og_image|og_title|og_description|twitter_image|twitter_card|twitter_site|twitter_creator|featured|featured_image|image|thumbnail|status|visibility|name):/i;

/**
 * Gemini sometimes emits bare `python` / `text` lines without ``` fences,
 * which merges code, diagrams, and prose into one broken black box.
 */
export function restoreMissingCodeFences(content: string): string {
  const lines = String(content || '').split('\n');
  const out: string[] = [];
  let inFence = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (t.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }

    if (FENCE_LANG_TAG.test(t)) {
      const lang = t.toLowerCase();
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        const nt = next.trim();
        if (nt.startsWith('```')) break;
        if (FENCE_LANG_TAG.test(nt) && body.length > 0) break;
        if (/^#{1,6}\s+/.test(nt)) break;
        if (body.length > 0 && nt === '') {
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j += 1;
          if (j < lines.length) {
            const after = lines[j].trim();
            if (FENCE_LANG_TAG.test(after)) break;
            if (/^#{1,6}\s+/.test(after)) break;
            if (after.split(/\s+/).length >= 12 && /[.!?]/.test(after) && !/^(import |from |def |class |const |let )/.test(after)) break;
          }
        }
        body.push(next);
        i += 1;
      }
      if (body.some((l) => l.trim().length > 0)) {
        out.push(`\`\`\`${lang}`);
        out.push(...body);
        out.push('```');
        continue;
      }
    }

    out.push(line);
    i += 1;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Strip Dev.to metadata key blocks anywhere in the body (not only at the top). */
export function stripEmbeddedFrontmatter(content: string): string {
  const lines = String(content || '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (BLOG_FRONTMATTER_KEY.test(t)) {
      let j = i;
      let count = 0;
      while (j < lines.length) {
        const row = lines[j].trim();
        if (!row) {
          j += 1;
          continue;
        }
        if (BLOG_FRONTMATTER_KEY.test(row)) {
          count += 1;
          j += 1;
          continue;
        }
        break;
      }
      if (count >= 2) {
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i += 1;
  }
  return out.join('\n');
}

export function looksLikeMarkdownTable(text: string): boolean {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const tableLines = lines.filter((l) => looksLikeMarkdownTableRow(l));
  return tableLines.length >= 2 && tableLines.length >= Math.ceil(lines.length * 0.6);
}

/** Wide Unicode shells or misaligned ASCII — should be rebuilt, not shown raw. */
export function looksLikeBrokenAsciiDiagram(text: string): boolean {
  const raw = String(text || '');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;

  const plusBoxes = (raw.match(/\+[-=]{2,}\+/g) || []).length;
  const maxLen = Math.max(...lines.map((l) => l.length), 0);
  const alpha = (raw.match(/[A-Za-z0-9]/g) || []).length;
  const unicode = (raw.match(/[│┌┐└┘├┤┬┴┼─━═╔╗╚╝╠╣╦╩╬]/g) || []).length;

  // Misaligned ASCII: wide layout or labels sitting outside box borders
  const looseLabelLines = lines.filter((l) => {
    const t = l.trim();
    if (/^\+[-=]+\+/.test(t)) return false;
    if (/^[\|v^<>\-=\s]+$/.test(t)) return false;
    if (/^\|[^|]+\|$/.test(t)) return false;
    return /[A-Za-z]{3,}/.test(t);
  }).length;
  if (plusBoxes >= 1 && maxLen > 58) return true;
  if (plusBoxes >= 2 && looseLabelLines >= 2) return true;
  if (plusBoxes >= 1 && looseLabelLines >= 3) return true;

  if (plusBoxes >= 1 && unicode < 8 && looseLabelLines === 0) return false;

  if (unicode < 8) return false;
  if (maxLen > 72 && alpha < 100 && unicode > alpha) return true;
  if (unicode >= 20 && alpha < unicode * 0.5) return true;
  const emptyish = lines.filter((l) => {
    const letters = (l.match(/[A-Za-z0-9]/g) || []).length;
    return letters <= 2 && /[│┌┐└┘├┤─━]/.test(l);
  }).length;
  return emptyish >= 4 && emptyish >= lines.length * 0.5;
}

function cleanDiagramLabel(raw: string): string | null {
  let label = String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
  // Trim leading/trailing '*' with string ops — a `/^\*+|\*+$/` regex backtracks
  // super-linearly on long runs of asterisks.
  let start = 0;
  let end = label.length;
  while (start < end && label[start] === '*') start += 1;
  while (end > start && label[end - 1] === '*') end -= 1;
  label = label.slice(start, end);
  if (label.length < 3 || label.length > 58) return null;
  if (!/[A-Za-z]{2,}/.test(label)) return null;
  if (/^:?-{3,}:?$/.test(label)) return null;
  if (/^[-=+|v^<>\\\/]+$/.test(label)) return null;
  if (/^\([^)]{1,40}\)$/.test(label) && !/[A-Z]/.test(label)) return null;
  return label;
}

/** Pull readable labels out of a broken or misaligned diagram. */
export function salvageDiagramLabels(text: string): string[] {
  const labels: string[] = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t || looksLikeMarkdownTableRow(t)) continue;
    if (/^\+[-=]+\+/.test(t)) continue;
    if (/^[\|v^<>\-=\s]{2,}$/.test(t)) continue;

    for (const m of t.matchAll(/\|([^|]{2,60})\|/g)) {
      const label = cleanDiagramLabel(m[1]);
      if (label && !labels.includes(label)) labels.push(label);
    }

    if (/^[A-Za-z(]/.test(t) && !/^\|/.test(t) && !/^\+/.test(t)) {
      const label = cleanDiagramLabel(t);
      if (label && !labels.includes(label)) labels.push(label);
    }
  }
  return labels.slice(0, 10);
}

/** Rebuild a compact vertical ASCII diagram from salvaged labels. */
export function rebuildSimpleAsciiDiagram(labels: string[]): string {
  if (labels.length === 0) return '';
  const inner = Math.min(52, Math.max(16, ...labels.map((l) => l.length)));
  const border = `+${'-'.repeat(inner + 2)}+`;
  const lines: string[] = [];
  labels.forEach((label, idx) => {
    const clipped = label.length > inner ? `${label.slice(0, inner - 1)}…` : label;
    const pad = inner - clipped.length;
    const left = Math.floor(pad / 2);
    const right = pad - left;
    lines.push(border);
    lines.push(`| ${' '.repeat(left)}${clipped}${' '.repeat(right)} |`);
    lines.push(border);
    if (idx < labels.length - 1) {
      const mid = Math.floor((inner + 4) / 2);
      lines.push(`${' '.repeat(mid)}|`);
      lines.push(`${' '.repeat(mid)}v`);
    }
  });
  return lines.join('\n');
}

/** Bracket/paren decision trees: [ Step ] and ( Action ) — not box ASCII. */
export function looksLikeBracketFlowDiagram(text: string): boolean {
  const raw = String(text || '');
  const brackets = (raw.match(/\[[^\]]{3,58}\]/g) || []).length;
  if (brackets < 2) return false;
  if (/^\+[-=]/m.test(raw) && brackets < 4) return false;
  return brackets >= 2;
}

/** Extract ordered steps from [ bracket ] / ( paren ) flow text. */
export function salvageBracketFlowSteps(text: string): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    // cleanDiagramLabel collapses whitespace, so a plain string swap is enough.
    const label = cleanDiagramLabel(String(raw || '').replace(/^#\s*/, '').replaceAll('-->', ' → '));
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    steps.push(label);
  };

  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t || /^\+[-=+]/.test(t)) continue;
    if (looksLikeMarkdownTableRow(t)) continue;

    for (const m of t.matchAll(/\[([^\]]{2,58})\]|\(([^(][^)]{2,58})\)/g)) {
      push(m[1] || m[2] || '');
    }

    if (/-->/.test(t) && /[A-Za-z]/.test(t)) {
      push(t);
      continue;
    }

    if (/^[|v↓\s]+$/.test(t)) continue;
    if (/^\[/.test(t) || /^\(/.test(t)) continue;
    if (t.split(/\s+/).length >= 12 && /[.!?]/.test(t)) continue;
    if (/^[A-Za-z(]/.test(t) && t.length >= 4 && t.length <= 58) {
      push(t);
    }
  }
  return steps.slice(0, 12);
}

/** Drop duplicate / near-duplicate steps from repeated Gemini diagram blocks. */
export function dedupeFlowSteps(steps: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const key = step.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(step);
  }
  return out;
}

/** Best-effort step list for arrow / line flow cards. */
export function extractFlowSteps(text: string): string[] {
  const raw = String(text || '').trim();
  if (!raw || looksLikeDirectoryTreeDiagram(raw)) return [];

  const isProseLine = (line: string) => {
    const t = line.trim();
    return t.split(/\s+/).length >= 12 && /[.!?]/.test(t);
  };

  let steps = salvageDiagramLabels(raw);
  if (steps.length < 2) {
    steps = salvageBracketFlowSteps(raw);
  }
  if (steps.length < 2 && (looksLikeSimpleArrowFlow(raw) || looksLikeBrokenAsciiDiagram(raw))) {
    steps = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l &&
          !isProseLine(l) &&
          !/^v$|^\|$|^↓$/.test(l) &&
          !/^\+[-=+]/.test(l) &&
          !/^\s+[|v↓]\s*$/.test(l) &&
          !looksLikeMarkdownTableRow(l),
      )
      .map((l) => l.replaceAll('-->', ' → ').replace(/\s+/g, ' ').trim());
  }
  return dedupeFlowSteps(steps).slice(0, 12);
}

/** Compact vertical flow — labels with | and v only (no broken boxes). */
export function rebuildArrowFlowDiagram(steps: string[]): string {
  if (steps.length === 0) return '';
  const lines: string[] = [];
  steps.forEach((step, idx) => {
    const clipped = step.length > 48 ? `${step.slice(0, 47)}…` : step;
    lines.push(clipped);
    if (idx < steps.length - 1) {
      lines.push('        |');
      lines.push('        v');
    }
  });
  return lines.join('\n');
}

export function looksLikeSimpleArrowFlow(text: string): boolean {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return false;
  const arrows = lines.filter((l) => /^v$|^\|$|^↓$/.test(l) || /^\s+[|v↓]\s*$/.test(l)).length;
  return arrows >= 2 && !/^\+[-=]/m.test(text);
}

/** Chunking walkthrough prose with --- Chunk N --- markers. */
export function looksLikeChunkDemoText(text: string): boolean {
  return /---\s*Chunk\s+\d+\s*\(\s*\d+\s*chars?\s*\)\s*---/i.test(String(text || ''));
}

export function extractChunkDemoSteps(text: string): string[] {
  const raw = String(text || '');
  if (!looksLikeChunkDemoText(raw)) return [];
  const parts = raw.split(/---\s*Chunk\s+\d+\s*\(\s*\d+\s*chars?\s*\)\s*---/gi);
  const steps: string[] = [];
  parts.forEach((part, idx) => {
    const snippet = part.replace(/\s+/g, ' ').trim();
    if (!snippet) return;
    const words = snippet.split(/\s+/);
    const preview = words.slice(0, 10).join(' ');
    steps.push(`Chunk ${idx + 1}: ${preview}${words.length > 10 ? '…' : ''}`);
  });
  return steps.filter(Boolean);
}

const CHUNK_DEMO_MARKER = /^---\s*Chunk\s+\d+\s*\(\s*\d+\s*chars?\s*\)\s*---\s*$/i;

/** Merge split chunk-demo paragraphs into one fenced architecture flow block. */
export function coalesceChunkDemoSections(content: string): string {
  if (!looksLikeChunkDemoText(content)) return content;

  const lines = String(content).split('\n');
  const markerIdxs = lines
    .map((l, idx) => (CHUNK_DEMO_MARKER.test(l.trim()) ? idx : -1))
    .filter((idx) => idx >= 0);
  if (markerIdxs.length === 0) return content;

  const regions: Array<[number, number]> = [];
  let regionStart = markerIdxs[0];
  let regionEnd = markerIdxs[0];
  for (let m = 1; m < markerIdxs.length; m++) {
    if (markerIdxs[m] - regionEnd <= 6) {
      regionEnd = markerIdxs[m];
    } else {
      regions.push([regionStart, regionEnd]);
      regionStart = markerIdxs[m];
      regionEnd = markerIdxs[m];
    }
  }
  regions.push([regionStart, regionEnd]);

  const out: string[] = [];
  let cursor = 0;
  for (const [firstIdx, lastIdx] of regions) {
    let start = firstIdx;
    while (start > 0) {
      const prev = lines[start - 1]?.trim() || '';
      if (!prev) {
        start -= 1;
        continue;
      }
      if (/^#{1,6}\s/.test(prev) || CHUNK_DEMO_MARKER.test(prev)) break;
      start -= 1;
    }

    let end = lastIdx;
    while (end + 1 < lines.length) {
      let j = end + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j >= lines.length) break;
      const ahead = lines[j].trim();
      if (/^#{1,6}\s/.test(ahead)) break;
      if (CHUNK_DEMO_MARKER.test(ahead)) {
        end = j;
        continue;
      }
      end = j;
      break;
    }

    out.push(...lines.slice(cursor, start));
    out.push('```flow-architecture');
    out.push(...lines.slice(start, end + 1));
    out.push('```');
    cursor = end + 1;
  }
  out.push(...lines.slice(cursor));
  return out.join('\n');
}

/** Split inline markdown headings that were flattened into prose lines. */
export function normalizeInlineHeadings(content: string): string {
  return String(content || '')
    .replace(/([.!?:])\s+(#{1,6}\s+[A-Za-z])/g, '$1\n\n$2')
    .replace(/([^\n#\s])\s+(#{1,6}\s+[A-Za-z][^\n]{4,100})/g, '$1\n\n$2');
}

function FlowStepsCard({ steps, title = 'Flow' }: { steps: string[]; title?: string }) {
  const displaySteps = dedupeFlowSteps(steps);
  if (displaySteps.length === 0) return null;
  return (
    <div className="my-4 rounded-2xl border border-zinc-200 bg-gradient-to-b from-zinc-50 to-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 bg-white/80">
        <span className="text-[10px] uppercase font-bold tracking-wider text-brand">{title}</span>
        <span className="text-[10px] text-zinc-400 font-medium">{displaySteps.length} steps</span>
      </div>
      <ol className="px-5 py-4 space-y-0">
        {displaySteps.map((step, idx) => (
          <li key={idx} className="flex flex-col items-center">
            <div className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 text-center shadow-sm font-medium leading-snug">
              {step.split(' → ').map((part, pi, arr) => (
                <span key={pi}>
                  {parseInlineMarkdown(part.trim())}
                  {pi < arr.length - 1 && (
                    <span className="mx-2 text-brand font-bold" aria-hidden>
                      →
                    </span>
                  )}
                </span>
              ))}
            </div>
            {idx < displaySteps.length - 1 && (
              <div className="flex flex-col items-center py-1.5 text-brand/70" aria-hidden>
                <span className="h-4 w-px bg-brand/30" />
                <span className="text-base leading-none font-bold">↓</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Repo / directory tree layouts should stay as-is, not vertical box stacks. */
export function looksLikeDirectoryTreeDiagram(text: string): boolean {
  if (/(?:├──|└──|├─|└─)/.test(text)) return true;
  if (/(?:^|\s)[\w.-]+\/[\s|│]/.test(text)) return true;
  if (/\|\s*(?:——|—)\s*[\w.-]+\//.test(text)) return true;
  return false;
}

/** Already a tidy vertical +---+ stack with labels inside pipes. */
export function looksLikeCleanVerticalAsciiDiagram(text: string): boolean {
  const lines = String(text || '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length < 3) return false;
  const plusBoxes = (text.match(/\+[-=]{2,}\+/g) || []).length;
  if (plusBoxes < 2) return false;
  const maxLen = Math.max(...lines.map((l) => l.length), 0);
  if (maxLen > 58) return false;
  const looseLabelLines = lines.filter((l) => {
    const t = l.trim();
    if (/^\+[-=]+\+/.test(t)) return false;
    if (/^[\|v^<>\-=\s]+$/.test(t)) return false;
    if (/^\|[^|]+\|$/.test(t)) return false;
    return /[A-Za-z]{3,}/.test(t);
  }).length;
  return looseLabelLines === 0;
}

/** Replace broken/misaligned diagram text with a clean vertical stack or arrow flow. */
export function normalizeDiagramContent(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  if (looksLikeDirectoryTreeDiagram(raw)) return raw;

  const flowSteps = extractFlowSteps(raw);
  if (flowSteps.length >= 2) {
    return rebuildArrowFlowDiagram(flowSteps);
  }

  if (looksLikeCleanVerticalAsciiDiagram(raw)) return raw;
  if (!looksLikeBrokenAsciiDiagram(raw)) return raw;

  const labels = salvageDiagramLabels(raw);
  if (labels.length >= 2) {
    return rebuildArrowFlowDiagram(dedupeFlowSteps(labels));
  }
  return raw;
}

/** Pull markdown tables out of fences so they render as tables. */
export function extractTablesFromFences(content: string): string {
  return String(content || '').replace(/```[\w+-]*\n([\s\S]*?)```/g, (full, body: string) => {
    const lines = String(body).split('\n');
    const tableIdx = lines.findIndex((l) => looksLikeMarkdownTableRow(l.trim()));
    if (tableIdx < 0) return full;
    const nonEmpty = lines.filter((l) => l.trim());
    const tableCount = nonEmpty.filter((l) => looksLikeMarkdownTableRow(l.trim())).length;
    if (tableCount >= Math.ceil(nonEmpty.length * 0.5)) {
      return `\n${body.trim()}\n`;
    }
    const before = lines.slice(0, tableIdx).join('\n').trim();
    const afterStart = lines.slice(tableIdx);
    let end = 0;
    while (end < afterStart.length && looksLikeMarkdownTableRow(afterStart[end].trim())) {
      end += 1;
    }
    const table = afterStart.slice(0, end).join('\n');
    const after = afterStart.slice(end).join('\n').trim();
    const parts = [
      before ? `\`\`\`\n${before}\n\`\`\`` : '',
      table,
      after ? `\`\`\`\n${after}\n\`\`\`` : '',
    ].filter(Boolean);
    return `\n${parts.join('\n\n')}\n`;
  });
}

/** Box-drawing / pipe trees — only real structure, not prose with hyphens. */
export function looksLikeAsciiDiagram(text: string): boolean {
  const raw = String(text || '');
  if (looksLikeMarkdownTable(raw)) return false;
  if (looksLikePipeComparisonTable(raw)) return false;
  if (looksLikeBrokenAsciiDiagram(raw)) return false;
  const proseLines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !isDecorativeSeparator(l) && !looksLikeMarkdownTableRow(l));
  // ASCII hyphen or Unicode box-drawing horizontals
  const plusBoxes = (raw.match(/\+[-=─━]{2,}\+/g) || []).length;
  const pipeRows = proseLines.filter((l) => /^\|/.test(l) && !looksLikeMarkdownTableRow(l)).length;
  const artLineCount = proseLines.filter((l) => looksLikeAsciiArtLine(l)).length;

  // Classic +---+ / | label | ASCII flowcharts (RAG pipelines, etc.)
  if (plusBoxes >= 2) return true;
  if (plusBoxes >= 1 && pipeRows >= 1) return true;
  if (artLineCount >= 4 && plusBoxes >= 1) return true;
  if (/PIPELINE|STEP\s+\d+/i.test(raw) && (plusBoxes >= 1 || pipeRows >= 2)) return true;
  // Only treat as a multi-line diagram when every content line looks like art/flow
  if (
    proseLines.length >= 1 &&
    proseLines.length <= 8 &&
    proseLines.every((l) => looksLikeFlowLine(l) || looksLikeAsciiArtLine(l))
  ) {
    return true;
  }

  // Long teaching sentences must stay as paragraphs, never Diagram boxes
  const wordyProse = proseLines.filter((l) => {
    if (/^\|/.test(l) || /^\+[-=─━+]+\+$/.test(l)) return false;
    const words = l.split(/\s+/);
    return words.length >= 12 && /[a-zA-Z]/.test(l) && /[.!?]/.test(l);
  }).length;
  const treeBranches = (raw.match(/├──|└──|├─|└─/g) || []).length;
  const boxDrawing = (raw.match(/[│┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬]/g) || []).length;
  if (wordyProse >= 1 && treeBranches === 0 && boxDrawing < 4 && plusBoxes === 0) {
    return false;
  }

  if (looksLikeFlowLine(raw)) return true;


  if (treeBranches >= 2) return true;

  const lines = proseLines;
  if (lines.length < 2) {
    // Single flattened tree line still counts as a diagram
    return treeBranches >= 1 && /\/\s+(?:├|└|\|)/.test(raw);
  }

  // Count structural art only — do NOT count plain -, _, /, <, > (those appear in prose).
  const asciiBoxes = (raw.match(/\+[-=─━]{2,}\+|[|=]{2,}|\|[^|\n]{2,}\|/g) || []).length;
  const arrowLines = lines.filter((l) => /(?:-->|==>|<-+|⇒|→|\bv\b|\^)/.test(l)).length;
  const indentedBoxes = lines.filter(
    (l) => /^\s{2,}/.test(l) && /[|+]/.test(l),
  ).length;
  const treeLines = lines.filter((l) => /(?:├─{1,2}|└─{1,2})/.test(l)).length;

  // Prefer classic ASCII +---+ diagrams over sparse Unicode shells
  if (boxDrawing >= 8 && plusBoxes >= 1) return true;
  if (boxDrawing >= 12 && artLineCount >= 4 && alphaDensityOk(raw)) return true;
  if (treeLines >= 2) return true;
  if (asciiBoxes >= 2 && lines.length >= 3) return true;
  if (indentedBoxes >= 3 && asciiBoxes >= 1) return true;
  if (arrowLines >= 2 && asciiBoxes >= 1) return true;
  return false;
}

/** Single line that belongs to an ASCII box / flow diagram. */
export function looksLikeAsciiArtLine(line: string): boolean {
  const t = String(line || '').trim();
  if (!t) return false;
  if (looksLikeMarkdownTableRow(t)) return false;
  // ASCII or Unicode box borders: +---+  +───+
  if (/^\+[-=─━+]+\+?$/.test(t)) return true;
  if (/\+[-=─━]{2,}\+/.test(t)) return true;
  // Single-cell ASCII boxes only (not multi-column markdown tables)
  if (/^\|[^|]+\|?$/.test(t) && (t.match(/\|/g) || []).length <= 2) return true;
  if (/^[|]+$/.test(t)) return true;
  if (/^v$/i.test(t)) return true;
  if (/^\|\s*v\s*$/i.test(t)) return true;
  if (/^(?:-->|==>|←|→|⇒)\s*$/.test(t)) return true;
  if (/^STEP\s+\d+/i.test(t)) return true;
  // [--- Slice 1 ---][--- Slice 2 ---] chunking diagrams
  if (looksLikeFlowLine(t)) return true;
  return false;
}

/** True when a block is mostly CJK (non-English digests are English-only). */
export function looksLikeNonEnglishJunk(text: string): boolean {
  const raw = String(text || '');
  const cjk = (raw.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) || []).length;
  if (cjk >= 12) return true;
  if (cjk >= 4 && cjk >= (raw.match(/[A-Za-z]/g) || []).length * 0.35) return true;
  return false;
}

/**
 * Allowlist uses shared/tech-keywords.json — not duplicated in this file.
 */
export { TECH_KEYWORDS, textHasTechSignal };

/** @deprecated Use textHasTechSignal — kept for legacy tests. */
export const TECH_CONTENT_SIGNAL = new RegExp(
  `\\b(${TECH_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  'i',
);

const DIGEST_HEADING_TITLES =
  /^(Daily Overview|Brief|Overview\s*\/\s*Summary|Code Snippet|Sources\s*&\s*Citations|Key Actionable)/i;

const SOURCES_HEADING = /^sources\s*&\s*citations/i;

/**
 * Remove YAML frontmatter scraped from Dev.to / static-site posts.
 * Handles both --- fenced blocks and bare key: value headers at the top.
 */
export function stripBlogFrontmatter(content: string): string {
  let raw = String(content || '').trim();
  if (!raw) return raw;

  if (/^---\s*\n/.test(raw)) {
    const end = raw.indexOf('\n---', 4);
    if (end >= 0) {
      raw = raw.slice(end + 4).trimStart();
    }
  }

  const lines = raw.split('\n');
  let i = 0;
  let metaCount = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      if (metaCount > 0) {
        i += 1;
        continue;
      }
      break;
    }
    if (BLOG_FRONTMATTER_KEY.test(t)) {
      metaCount += 1;
      i += 1;
      continue;
    }
    break;
  }

  if (metaCount >= 2 && i < lines.length) {
    return lines.slice(i).join('\n').trim();
  }
  return raw;
}

const CANONICAL_DIGEST_H2 =
  /^(Daily Overview\s*\(TL;DR\)|Brief|Overview\s*\/\s*Summary|Code Snippet|Key Actionable Takeaways|Sources\s*&\s*Citations)$/i;

export function isCanonicalDigestHeading(title: string): boolean {
  return CANONICAL_DIGEST_H2.test(String(title || '').trim());
}

export function looksLikeInstructionHeading(title: string): boolean {
  const t = String(title || '').trim();
  if (!t || isCanonicalDigestHeading(t)) return false;
  if (/^\d+\.\s/.test(t)) return true;
  if (/^step\s+\d+/i.test(t)) return true;
  if (
    /^(safeguard|note|tip|warning|example|if |when |search |move |calculate |locate |extract |yield |prevent |return )/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^[a-z]/.test(t)) return true;
  if (/\b(we |the |from |up to |minus |back to |characters from)\b/i.test(t)) return true;
  return false;
}

export function demoteInstructionHeadings(content: string): string {
  const lines = String(content || '').split('\n');
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const headingMatch = trimmed.match(/^#{1,6}\s+(\S.*)$/);
    if (headingMatch) {
      const title = headingMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
      if (isCanonicalDigestHeading(title)) {
        out.push(`## ${title}`);
        continue;
      }
      if (looksLikeInstructionHeading(title)) {
        out.push(title);
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

export function normalizeDigestFormatting(content: string): string {
  return demoteInstructionHeadings(
    stripEmbeddedFrontmatter(
      stripBlogFrontmatter(
        coalesceChunkDemoSections(
          normalizeInlineHeadings(
            String(content || '')
              .replace(/([.!?])\s+(#{1,6}\s+)/g, '$1\n\n$2')
              .replace(/^\+[-=+|\t ]{6,}$/gm, ''),
          ),
        )
          .replace(/\*\*(Step\s+\d+[^*]{0,120})\*\*/gi, '$1')
          .replace(/\*\*(Phase\s+\d+[^*]{0,120})\*\*/gi, '$1')
          .replace(/\*\*(Part\s+\d+[^*]{0,120})\*\*/gi, '$1')
          .replace(/\*\*(\d+\.\s[^*]{5,160})\*\*/gi, '$1')
          .replace(/\n{3,}/g, '\n\n')
          .trim(),
      ),
    ),
  );
}

/** True when text looks like technology learning content (shared allowlist). */
export function looksLikeTechContent(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (looksLikeNonEnglishJunk(raw)) return false;
  if (looksLikeAsciiDiagram(raw) || looksLikeFlowLine(raw) || looksLikeSourceCode(raw)) return true;
  if (/^```/.test(raw)) {
    const inner = raw.replace(/^```[\w+-]*\n?/, '').replace(/\n?```$/, '');
    if (looksLikeNonEnglishJunk(inner)) return false;
    return looksLikeAsciiDiagram(inner) || looksLikeSourceCode(inner) || textHasTechSignal(inner);
  }
  return textHasTechSignal(raw);
}

/** Non-tech prose that should be hidden in digest rendering. */
export function looksLikeOffTopicJunk(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (looksLikeNonEnglishJunk(raw)) return true;
  // Structural chrome / digest section titles without body are fine
  if (/^#{1,6}\s+\S/.test(raw) && raw.split('\n').length === 1) return false;
  if (DIGEST_HEADING_TITLES.test(raw) && raw.split('\n').length === 1) return false;
  if (looksLikeAsciiDiagram(raw) || looksLikeFlowLine(raw) || looksLikeSourceCode(raw)) return false;
  return !looksLikeTechContent(raw);
}

/** True when markdown looks like a morning digest (not a generic snippet). */
export function looksLikeDigestDocument(content: string): boolean {
  return /^##\s+(Daily Overview|Brief|Overview\s*\/\s*Summary|Code Snippet|Sources\s*&\s*Citations|Key Actionable)/im.test(
    String(content || ''),
  );
}

/**
 * Wrap loose +---+ ASCII pipelines in fences so they always render as Diagram,
 * even when Gemini left them unfenced or mixed with bullets.
 */
export function fenceLooseAsciiDiagrams(content: string): string {
  const lines = String(content || '').split('\n');
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;

  const flushBuf = () => {
    if (buf.length === 0) return;
    const block = buf.join('\n');
    const artLines = buf.filter((l) => looksLikeAsciiArtLine(l)).length;
    if (looksLikeAsciiDiagram(block) || artLines >= 3) {
      out.push('```');
      out.push(...buf);
      out.push('```');
    } else {
      out.push(...buf);
    }
    buf = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flushBuf();
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const art = looksLikeAsciiArtLine(line);
    const isProseFollowOn =
      trimmed.split(/\s+/).length >= 5 && /[.!?]$/.test(trimmed) && !looksLikeFlowLine(trimmed);
    if (isProseFollowOn && buf.length > 0) {
      flushBuf();
      out.push(line);
      continue;
    }
    const continuing =
      buf.length > 0 &&
      !isProseFollowOn &&
      (art ||
        trimmed === '' ||
        /^\s*[-*]\s+/.test(line) ||
        /^STEP\s+\d+/i.test(trimmed) ||
        looksLikeAsciiDiagram(`${buf.join('\n')}\n${line}`));

    if (art || continuing) {
      buf.push(line);
      continue;
    }
    flushBuf();
    out.push(line);
  }
  flushBuf();
  return out.join('\n');
}

/**
 * Keep only technology-related body content (allowlist).
 * Brief / TL;DR / Key Takeaways stay (short synthesized meta).
 * Overview paragraphs must carry a tech signal; code/diagrams always kept when real.
 */
export function stripOffTopicBodyContent(content: string): string {
  const raw = String(content || '');
  if (!raw.trim()) return raw;
  // Only apply allowlist filtering to full digests — leave generic markdown alone
  if (!looksLikeDigestDocument(raw)) return raw;

  const sourcesSplit = raw.split(/(?=^##\s+Sources\s*&\s*Citations\s*$)/im);
  const main = sourcesSplit[0] || '';
  const sourcesTail = sourcesSplit.slice(1).join('');

  const parts = main.split(/(?=^##\s+)/m);
  const keptParts: string[] = [];

  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split('\n');
    const heading = (lines[0] || '').trim();
    const isMetaSection = /^##\s+(Daily Overview|Brief|Key Actionable)/i.test(heading);
    const isCodeSection = /^##\s+Code Snippet/i.test(heading);
    const isCanonical =
      isMetaSection || isCodeSection || /^##\s+(Overview)/i.test(heading);

    if (isCodeSection) {
      const cleaned = part
        .split('\n')
        .filter((line) => !looksLikeNonEnglishJunk(line.trim()))
        .join('\n')
        .trim();
      if (cleaned) keptParts.push(cleaned);
      continue;
    }

    // Drop unknown ## sections that have no tech signal at all
    if (/^##\s+/.test(heading) && !isCanonical && !looksLikeTechContent(part)) {
      continue;
    }

    const paragraphs = part.split(/\n{2,}/);
    const cleanParas = paragraphs.filter((para) => {
      const p = para.trim();
      if (!p) return false;
      if (looksLikeNonEnglishJunk(p)) return false;
      // Keep section headings
      if (/^##\s+/.test(p) && p.split('\n').length === 1) return true;
      // Meta sections (Brief / TL;DR / Takeaways): keep concise lines
      if (isMetaSection) return true;
      // Fenced blocks: allowlist the body (lang tag alone is not enough)
      if (/^```/.test(p)) {
        const inner = p.replace(/^```[\w+-]*\n?/, '').replace(/\n?```$/, '');
        if (looksLikeNonEnglishJunk(inner)) return false;
        return (
          looksLikeAsciiDiagram(inner) ||
          looksLikeSourceCode(inner) ||
          looksLikeTechContent(inner)
        );
      }
      if (looksLikeAsciiDiagram(p) || looksLikeFlowLine(p) || looksLikeSourceCode(p)) {
        return true;
      }
      // Allowlist: must look like technology learning
      return looksLikeTechContent(p);
    });

    const body = cleanParas.join('\n\n').trim();
    if (!body) continue;
    if (isCanonical && body.split('\n').filter((l) => l.trim()).length <= 1 && /^##\s+/.test(body)) {
      continue;
    }
    keptParts.push(body);
  }

  return `${keptParts.join('\n\n')}\n\n${sourcesTail}`.replace(/\n{3,}/g, '\n\n').trim();
}

export function sanitizeDigestSources(content: string): string {
  const raw = String(content || '');
  if (!raw) return raw;
  const marker = /^##\s+Sources\s*&\s*Citations\s*$/im;
  const match = marker.exec(raw);
  if (!match || match.index === undefined) return raw;

  const before = raw.slice(0, match.index + match[0].length);
  const after = raw.slice(match.index + match[0].length);
  const nextH2 = after.search(/\n##\s+/);
  const sectionBody = nextH2 >= 0 ? after.slice(0, nextH2) : after;
  const rest = nextH2 >= 0 ? after.slice(nextH2) : '';

  const kept = sectionBody.split('\n').filter((line) => {
    const t = line.trim();
    if (!t.startsWith('- ') && !t.startsWith('* ')) return true;
    if (!/\[[^\][]+\]\(https?:\/\/[^()]+\)/.test(t)) return false;
    const titleMatch = t.match(/\[([^\][]+)\]\(/);
    const title = titleMatch?.[1] || '';
    return !isSourceTitleJunk(title);
  });

  return `${before}\n${kept.join('\n').replace(/^\n+/, '\n')}${rest}`.replace(/\n{3,}/g, '\n\n');
}

/** Move / keep Sources & Citations as the final section of the digest. */
export function ensureSourcesAtEnd(content: string): string {
  const raw = String(content || '').trim();
  if (!raw) return raw;
  const marker = /^##\s+Sources\s*&\s*Citations\s*$/im;
  const match = marker.exec(raw);
  if (!match || match.index === undefined) {
    return raw;
  }

  const before = raw.slice(0, match.index).trimEnd();
  const fromSources = raw.slice(match.index);
  const nextH2 = fromSources.search(/\n##\s+(?!Sources)/i);
  let sourcesSection: string;
  let middle: string;
  if (nextH2 >= 0) {
    sourcesSection = fromSources.slice(0, nextH2).trim();
    middle = fromSources.slice(nextH2).trim();
  } else {
    sourcesSection = fromSources.trim();
    middle = '';
  }

  // Drop empty Sources headings with no links
  const hasLink = /\[[^\][]+\]\(https?:\/\/[^()]+\)/.test(sourcesSection);
  if (!hasLink) {
    return [before, middle].filter(Boolean).join('\n\n').trim();
  }

  return [before, middle, sourcesSection].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
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
  if (looksLikeAsciiDiagram(text)) return false;
  if (looksLikeOffTopicJunk(text)) return true;
  if (looksLikeSourceCode(text)) return false;

  const lines = String(text || '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return true;

  // Legal / contract clauses are never code
  if (/article\s+\d+|indemnification|limitation of liability|whereas\b/i.test(text)) {
    return true;
  }

  let proseSignals = 0;
  for (const line of lines) {
    const t = line.trim();
    if (/^#{1,6}\s+\S/.test(t)) proseSignals += 2;
    if (/^[-*]\s+\S/.test(t) && t.split(/\s+/).length >= 6) proseSignals += 1;
    if (/^\d+\.\s+\S/.test(t) && t.split(/\s+/).length >= 6) proseSignals += 1;
    if (t.split(/\s+/).length >= 16 && /[.!?]/.test(t)) proseSignals += 1;
    if (t.split(/\s+/).length >= 40) proseSignals += 2; // long legal/teaching paragraph
  }

  return proseSignals >= 1;
}

/** Only real code or ASCII diagrams may use the dark boxed UI. */
export function shouldRenderAsBoxedCode(text: string, label?: string, section?: string): boolean {
  if (looksLikeOffTopicJunk(text)) return false;
  if (looksLikeNonEnglishJunk(text)) return false;
  if (looksLikeMarkdownTable(text) || looksLikePipeComparisonTable(text) || looksLikeBrokenAsciiDiagram(text)) return false;
  if (label === 'Diagram' || looksLikeAsciiDiagram(text) || looksLikeFlowLine(text)) return true;
  if (section === 'code' && !looksLikeProseMistakenlyFenced(text)) {
    return looksLikeSourceCode(text) || /[{};=]/.test(text);
  }
  if (looksLikeProseMistakenlyFenced(text)) return false;
  return looksLikeSourceCode(text);
}

function looksLikeRealHeading(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (looksLikeInstructionHeading(trimmed)) return false;
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

type MdBlock = { type: string; content: string; label?: string; rows?: string[][]; flowSteps?: string[] };

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function isTableSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function tryPushTableBlock(content: string, blocks: MdBlock[]): boolean {
  const comparison = parseComparisonTableRows(content);
  if (comparison && comparison.length >= 2) {
    blocks.push({ type: 'table', content, rows: comparison });
    return true;
  }
  if (looksLikeMarkdownTable(content)) {
    const rows = content
      .split('\n')
      .map(parseTableRow)
      .filter((cells) => cells.length > 0 && !isTableSeparatorRow(cells));
    if (rows.length >= 2) {
      blocks.push({ type: 'table', content, rows });
      return true;
    }
  }
  return false;
}

/** Split a fence that mixes prose, diagrams, and code into separate segments. */
export function splitMixedFencedContent(content: string): string[] {
  const raw = String(content || '').trim();
  if (!raw) return [];
  const hasCode = looksLikeSourceCode(raw);
  const hasDiagram =
    (looksLikeAsciiDiagram(raw) || looksLikeFlowLine(raw)) && !looksLikePipeComparisonTable(raw);
  const hasProse = looksLikeProseMistakenlyFenced(raw);
  if (!(hasCode && hasDiagram) && !(hasCode && hasProse) && !(hasDiagram && hasProse)) {
    return [raw];
  }

  const lines = raw.split('\n');
  const chunks: string[][] = [];
  let buf: string[] = [];
  let mode: 'prose' | 'diagram' | 'code' = 'prose';

  const detectMode = (line: string, prev: 'prose' | 'diagram' | 'code'): 'prose' | 'diagram' | 'code' => {
    const t = line.trim();
    if (!t) return prev;
    if (BLOG_FRONTMATTER_KEY.test(t)) return 'prose';
    if (looksLikeCodeLine(line) || /^(import |from |def |class |const |let |async def |@)/.test(t)) {
      return 'code';
    }
    if (
      looksLikeAsciiArtLine(t) ||
      /^\+[-=]/.test(t) ||
      /^\[/.test(t) ||
      (/^\|/.test(t) && /\+[-=]/.test(raw))
    ) {
      return 'diagram';
    }
    if (t.split(/\s+/).length >= 10 && /[.!?]/.test(t) && !looksLikeFlowLine(t)) return 'prose';
    return prev;
  };

  for (const line of lines) {
    const nextMode: 'prose' | 'diagram' | 'code' = line.trim() ? detectMode(line, mode) : mode;
    if (buf.length > 0 && line.trim() && nextMode !== mode) {
      chunks.push(buf);
      buf = [];
    }
    mode = nextMode;
    buf.push(line);
  }
  if (buf.length) chunks.push(buf);

  const segments = chunks.map((c) => c.join('\n').trim()).filter(Boolean);
  return segments.length > 1 ? segments : [raw];
}

/**
 * Digest body cleanup: dotted separators gone; mid-body links become plain text;
 * bare URLs removed. Sources & Citations keep real clickable links.
 */
export function stripDigestBodyChrome(content: string): string {
  const raw = String(content || '');
  if (!raw.trim()) return raw;
  if (!looksLikeDigestDocument(raw)) {
    return raw
      .split('\n')
      .filter((line) => !isDecorativeSeparator(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  const marker = /^##\s+Sources\s*&\s*Citations\s*$/im;
  const match = marker.exec(raw);
  const main = match && match.index !== undefined ? raw.slice(0, match.index) : raw;
  const sourcesTail = match && match.index !== undefined ? raw.slice(match.index) : '';

  const cleanedMain = main
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (isDecorativeSeparator(t)) return '';
      if (/^\[([^\]]{1,300})\]\((https?:\/\/[^)]+)\)$/.test(t)) return '';
      if (/^https?:\/\/\S+$/i.test(t)) return '';
      if (/^[-*]\s+\[([^\]]{1,300})\]\((https?:\/\/[^)]+)\)$/.test(t)) return '';
      return line
        .replace(/\[([^\]]{1,300})\]\((https?:\/\/[^)]+)\)/g, '$1')
        .replace(/https?:\/\/\S+/gi, '');
    })
    .join('\n');

  return `${cleanedMain}\n${sourcesTail}`.replace(/\n{3,}/g, '\n\n').trim();
}

/** Drop mid-blog "From [title](url):" attribution lines (sources belong at the end). */
export function stripMidBlogSourceLines(content: string): string {
  return String(content || '')
    .replaceAll(/^[ \t]*\*\*From[ \t]+\[[^\]]+\]\([^)]*\)(?:[ \t]*\(continued\))?:\*\*[ \t\r]*$/gim, '')
    .replaceAll(/^[ \t]*From[ \t]+\[[^\]]+\]\([^)]*\)(?:[ \t]*\(continued\))?:[ \t\r]*$/gim, '')
    .replaceAll(/\n{3,}/g, '\n\n')
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
        merged.label === 'Diagram' ||
        (looksLikeAsciiDiagram(merged.content) && !looksLikeSourceCode(merged.content));
      const nextIsDiagram =
        next.label === 'Diagram' ||
        (looksLikeAsciiDiagram(next.content) && !looksLikeSourceCode(next.content));
      if (mergedIsDiagram && nextIsDiagram === false) break;
      if (mergedIsDiagram === false && nextIsDiagram) break;
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
  let currentSection: 'body' | 'code' | 'sources' = 'body';

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const joined = currentParagraph
        .filter((l) => !isDecorativeSeparator(l))
        .join('\n')
        .trim();
      currentParagraph = [];
      if (!joined) return;
      if (looksLikeChunkDemoText(joined)) {
        const steps = extractChunkDemoSteps(joined);
        if (steps.length >= 2) {
          blocks.push({ type: 'flow', content: joined, flowSteps: steps, label: 'Architecture' });
          return;
        }
      }
      if (tryPushTableBlock(joined, blocks)) return;
      if (looksLikeMarkdownTable(joined)) {
        const rows = joined
          .split('\n')
          .map(parseTableRow)
          .filter((cells) => cells.length > 0 && !isTableSeparatorRow(cells));
        if (rows.length) {
          blocks.push({ type: 'table', content: joined, rows });
          return;
        }
      }
      if (looksLikeBrokenAsciiDiagram(joined)) {
        const labels = salvageDiagramLabels(joined);
        if (labels.length >= 2) {
          blocks.push({
            type: 'code',
            content: normalizeDiagramContent(joined),
            label: 'Diagram',
          });
        } else if (labels.length === 1) {
          blocks.push({ type: 'p', content: labels[0] });
        }
        return;
      }
      if (looksLikeAsciiDiagram(joined) || looksLikeFlowLine(joined)) {
        blocks.push({ type: 'code', content: normalizeDiagramContent(joined), label: 'Diagram' });
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
    if (tryPushTableBlock(content, blocks)) return;
    if (looksLikeMarkdownTable(content) || looksLikeBrokenAsciiDiagram(content)) {
      if (looksLikeBrokenAsciiDiagram(content) && !looksLikeMarkdownTable(content)) {
        const labels = salvageDiagramLabels(content);
        if (labels.length >= 2) {
          blocks.push({
            type: 'code',
            content: normalizeDiagramContent(content),
            label: 'Diagram',
          });
          return;
        }
      }
      if (depth < 2) {
        blocks.push(...parseMarkdownBlocks(content.split('\n'), depth + 1));
      } else {
        blocks.push({ type: 'p', content });
      }
      return;
    }
    if (looksLikeAsciiDiagram(content)) {
      blocks.push({ type: 'code', content: normalizeDiagramContent(content), label: 'Diagram' });
      return;
    }
    if (
      currentSection === 'code' &&
      !looksLikeProseMistakenlyFenced(content) &&
      (looksLikeSourceCode(content) || /[{};=]/.test(content))
    ) {
      blocks.push({ type: 'code', content, label: 'Code Snippet' });
      return;
    }
    if (looksLikeProseMistakenlyFenced(content) || !looksLikeSourceCode(content)) {
      if (depth < 2) {
        blocks.push(...parseMarkdownBlocks(content.split('\n'), depth + 1));
      } else {
        blocks.push({ type: 'p', content });
      }
      return;
    }
    blocks.push({ type: 'code', content, label: 'Code Snippet' });
  };

  const pushFencedContent = (content: string) => {
    if (!content.trim()) return;
    if (looksLikeNonEnglishJunk(content)) return;

    if (looksLikeChunkDemoText(content)) {
      const steps = extractChunkDemoSteps(content);
      if (steps.length >= 2) {
        blocks.push({ type: 'flow', content, flowSteps: steps, label: 'Architecture' });
        return;
      }
    }
    if (
      looksLikeSourceCode(content) &&
      !looksLikeBracketFlowDiagram(content) &&
      !looksLikeBrokenAsciiDiagram(content) &&
      !looksLikeSimpleArrowFlow(content)
    ) {
      blocks.push({ type: 'code', content, label: 'Code Snippet' });
      return;
    }

    const segments = splitMixedFencedContent(content);
    if (segments.length > 1) {
      for (const seg of segments) {
        if (depth < 2) {
          blocks.push(...parseMarkdownBlocks(seg.split('\n'), depth + 1));
        } else if (looksLikeProseMistakenlyFenced(seg)) {
          blocks.push({ type: 'p', content: seg });
        } else {
          pushFencedContent(seg);
        }
      }
      return;
    }

    if (tryPushTableBlock(content, blocks)) return;
    if (looksLikeMarkdownTable(content) || looksLikeBrokenAsciiDiagram(content)) {
      if (looksLikeBrokenAsciiDiagram(content) && !looksLikeMarkdownTable(content)) {
        const labels = salvageDiagramLabels(content);
        if (labels.length >= 2) {
          blocks.push({
            type: 'code',
            content: normalizeDiagramContent(content),
            label: 'Diagram',
          });
          return;
        }
      }
      if (depth < 2) {
        blocks.push(...parseMarkdownBlocks(content.split('\n'), depth + 1));
      } else {
        blocks.push({ type: 'p', content });
      }
      return;
    }
    if (looksLikeAsciiDiagram(content)) {
      blocks.push({ type: 'code', content: normalizeDiagramContent(content), label: 'Diagram' });
      return;
    }
    if (
      currentSection === 'code' &&
      !looksLikeProseMistakenlyFenced(content) &&
      (looksLikeSourceCode(content) || /[{};=]/.test(content))
    ) {
      blocks.push({ type: 'code', content, label: 'Code Snippet' });
      return;
    }
    if (looksLikeProseMistakenlyFenced(content) || !looksLikeSourceCode(content)) {
      if (depth < 2) {
        blocks.push(...parseMarkdownBlocks(content.split('\n'), depth + 1));
      } else if (!looksLikeNonEnglishJunk(content)) {
        blocks.push({ type: 'p', content });
      }
      return;
    }
    blocks.push({ type: 'code', content, label: 'Code Snippet' });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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
      if (pendingCode.length > 0) {
        pendingCode.push(line);
        continue;
      }
      flushParagraph();
      continue;
    }

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

    if (looksLikeMarkdownTableRow(trimmed)) {
      flushParagraph();
      const tableLines: string[] = [trimmed];
      while (i + 1 < lines.length && looksLikeMarkdownTableRow(lines[i + 1].trim())) {
        i += 1;
        tableLines.push(lines[i].trim());
      }
      const rows = tableLines
        .map(parseTableRow)
        .filter((cells) => cells.length > 0 && !isTableSeparatorRow(cells));
      if (rows.length >= 1) {
        blocks.push({ type: 'table', content: tableLines.join('\n'), rows });
      }
      continue;
    }

    if (trimmed.startsWith('# ') && looksLikeRealHeading(trimmed.substring(2))) {
      flushParagraph();
      currentSection = 'body';
      blocks.push({ type: 'h2', content: trimmed.substring(2) });
    } else if (trimmed.startsWith('## ') && looksLikeRealHeading(trimmed.substring(3))) {
      flushParagraph();
      const title = trimmed.substring(3);
      if (/^code snippet/i.test(title)) currentSection = 'code';
      else if (SOURCES_HEADING.test(title)) currentSection = 'sources';
      else currentSection = 'body';
      blocks.push({ type: 'h2', content: title });
    } else if (trimmed.startsWith('### ') && looksLikeRealHeading(trimmed.substring(4))) {
      flushParagraph();
      blocks.push({ type: 'h3', content: trimmed.substring(4) });
    } else if (trimmed.startsWith('#### ') && looksLikeRealHeading(trimmed.substring(5))) {
      flushParagraph();
      blocks.push({ type: 'h3', content: trimmed.substring(5) });
    } else if (
      (trimmed.startsWith('- ') || trimmed.startsWith('* ')) &&
      !(
        currentParagraph.some((l) => looksLikeAsciiArtLine(l)) ||
        looksLikeAsciiDiagram(currentParagraph.join('\n'))
      )
    ) {
      flushParagraph();
      blocks.push({ type: 'li', content: trimmed.substring(2) });
    } else if (
      /^\d+\.\s/.test(trimmed) &&
      !(
        currentParagraph.some((l) => looksLikeAsciiArtLine(l)) ||
        looksLikeAsciiDiagram(currentParagraph.join('\n'))
      )
    ) {
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
      blocks.push({ type: 'code', content: normalizeDiagramContent(trimmed), label: 'Diagram' });
    } else if (looksLikeAsciiArtLine(trimmed)) {
      currentParagraph.push(line);
    } else if (trimmed === '') {
      if (
        currentParagraph.length > 0 &&
        (looksLikeAsciiDiagram(currentParagraph.join('\n')) ||
          currentParagraph.some((l) => looksLikeAsciiArtLine(l)))
      ) {
        currentParagraph.push(line);
        continue;
      }
      flushParagraph();
      blocks.push({ type: 'empty', content: '' });
    } else if (
      currentParagraph.length > 0 &&
      (looksLikeAsciiArtLine(currentParagraph[currentParagraph.length - 1] || '') ||
        looksLikeAsciiDiagram(currentParagraph.join('\n')))
    ) {
      currentParagraph.push(line);
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

type RenderSection = 'body' | 'code' | 'sources';

/** Apply digest section context and normalize blocks before React render. */
function prepareRenderableBlocks(rawBlocks: MdBlock[], isDigest: boolean): MdBlock[] {
  let renderSection: RenderSection = 'body';
  return rawBlocks
    .map((block) => {
      if (block.type === 'h2') {
        if (/^code snippet/i.test(block.content)) renderSection = 'code';
        else if (SOURCES_HEADING.test(block.content)) renderSection = 'sources';
        else renderSection = 'body';
      }
      if (looksLikeNonEnglishJunk(block.content)) {
        return null;
      }
      if (block.type === 'p' && CHUNK_DEMO_MARKER.test(block.content.trim())) {
        return null;
      }
      if (block.type === 'code' && block.label === 'Diagram') {
        if (
          looksLikeSourceCode(block.content) &&
          !looksLikeBracketFlowDiagram(block.content) &&
          !looksLikeSimpleArrowFlow(block.content)
        ) {
          return { ...block, label: 'Code Snippet' };
        }
        const tableRows = parseComparisonTableRows(block.content);
        if (tableRows && tableRows.length >= 2) {
          return { type: 'table', content: block.content, rows: tableRows };
        }
        return { ...block, content: normalizeDiagramContent(block.content) };
      }
      if (
        isDigest &&
        renderSection !== 'sources' &&
        renderSection !== 'code' &&
        block.type !== 'h1' &&
        block.type !== 'h2' &&
        block.type !== 'h3' &&
        block.type !== 'empty' &&
        block.type !== 'table' &&
        looksLikeOffTopicJunk(block.content)
      ) {
        return null;
      }
      if (block.type === 'code' && !shouldRenderAsBoxedCode(block.content, block.label, renderSection)) {
        return { type: 'p', content: block.content } as typeof block;
      }
      if (block.type === 'blockquote') {
        return { type: 'p', content: block.content } as typeof block;
      }
      return block;
    })
    .filter((block): block is MdBlock => block != null);
}

export function PremiumMarkdownRenderer({ content }: { content: string }) {
  const isDigest = looksLikeDigestDocument(content);
  const prepared = fenceLooseAsciiDiagrams(
    extractTablesFromFences(
      restoreMissingCodeFences(
        ensureSourcesAtEnd(
          sanitizeDigestSources(
            stripOffTopicBodyContent(
              stripDigestBodyChrome(stripMidBlogSourceLines(normalizeDigestFormatting(content))),
            ),
          ),
        ),
      ),
    ),
  );
  const blocks = prepareRenderableBlocks(
    parseMarkdownBlocks(restoreArticleMarkdown(prepared).split('\n')),
    isDigest,
  );

  return (
    <div className="space-y-5 text-zinc-700 leading-relaxed font-sans">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'flow':
            return (
              <FlowStepsCard
                key={idx}
                steps={block.flowSteps || extractChunkDemoSteps(block.content)}
                title={block.label || 'Architecture'}
              />
            );
          case 'code': {
            if (block.label === 'Diagram') {
              const flowSteps = extractFlowSteps(block.content);
              if (flowSteps.length >= 2) {
                return <FlowStepsCard key={idx} steps={flowSteps} title="Diagram" />;
              }
            }
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
          }
          case 'table': {
            const rows = block.rows || [];
            const header = rows[0] || [];
            const body = rows.slice(1);
            return (
              <div key={idx} className="my-4 overflow-x-auto rounded-xl border border-zinc-200">
                <table className="min-w-full text-sm text-left">
                  <thead className="bg-zinc-50 text-zinc-800">
                    <tr>
                      {header.map((cell, ci) => (
                        <th key={ci} className="px-4 py-2.5 font-semibold border-b border-zinc-200">
                          {parseInlineMarkdown(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.map((row, ri) => (
                      <tr key={ri} className="odd:bg-white even:bg-zinc-50/60">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-4 py-2.5 text-zinc-600 border-b border-zinc-100 align-top">
                            {parseInlineMarkdown(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case 'h1':
          case 'h2': {
            const canonical = !isDigest || isCanonicalDigestHeading(block.content);
            if (!canonical) {
              return (
                <p key={idx} className="text-zinc-700 text-[15px] leading-7 font-medium mt-3 mb-1">
                  {parseInlineMarkdown(block.content)}
                </p>
              );
            }
            return (
              <h2
                key={idx}
                className="text-xl font-extrabold text-zinc-900 mt-8 mb-4 border-b pb-3 border-zinc-100 tracking-tight leading-tight flex items-center gap-2"
              >
                <span className="w-1.5 h-6 bg-brand rounded-full inline-block" />
                {block.content}
              </h2>
            );
          }
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
