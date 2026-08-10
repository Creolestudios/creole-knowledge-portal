export function PremiumMarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: any[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let currentParagraph: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        blocks.push({ type: 'code', content: codeLines.join('\n') });
        codeLines = [];
      } else {
        inCodeBlock = true;
        // flush any pending paragraph
        if (currentParagraph.length > 0) {
          blocks.push({ type: 'p', content: currentParagraph.join('\n') });
          currentParagraph = [];
        }
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      if (currentParagraph.length > 0) { blocks.push({ type: 'p', content: currentParagraph.join('\n') }); currentParagraph = []; }
      blocks.push({ type: 'h1', content: trimmed.substring(2) });
    } else if (trimmed.startsWith('## ')) {
      if (currentParagraph.length > 0) { blocks.push({ type: 'p', content: currentParagraph.join('\n') }); currentParagraph = []; }
      blocks.push({ type: 'h2', content: trimmed.substring(3) });
    } else if (trimmed.startsWith('### ')) {
      if (currentParagraph.length > 0) { blocks.push({ type: 'p', content: currentParagraph.join('\n') }); currentParagraph = []; }
      blocks.push({ type: 'h3', content: trimmed.substring(4) });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (currentParagraph.length > 0) { blocks.push({ type: 'p', content: currentParagraph.join('\n') }); currentParagraph = []; }
      blocks.push({ type: 'li', content: trimmed.substring(2) });
    } else if (trimmed.startsWith('> ')) {
      if (currentParagraph.length > 0) { blocks.push({ type: 'p', content: currentParagraph.join('\n') }); currentParagraph = []; }
      blocks.push({ type: 'blockquote', content: trimmed.substring(2) });
    } else if (trimmed === '') {
      if (currentParagraph.length > 0) { blocks.push({ type: 'p', content: currentParagraph.join('\n') }); currentParagraph = []; }
      blocks.push({ type: 'empty', content: '' });
    } else {
      currentParagraph.push(line);
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({ type: 'code', content: codeLines.join('\n') });
  } else if (currentParagraph.length > 0) {
    blocks.push({ type: 'p', content: currentParagraph.join('\n') });
  }

  function parseInlineMarkdown(text: string) {
    const boldRegex = /\*\*([^*]+)\*\*/g;
    let match;
    const parts = [];
    let lastIdx = 0;

    while ((match = boldRegex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(text.substring(lastIdx, match.index));
      }
      parts.push(
        <strong key={match.index} className="font-extrabold text-zinc-900">
          {match[1]}
        </strong>
      );
      lastIdx = boldRegex.lastIndex;
    }

    if (lastIdx < text.length) {
      parts.push(text.substring(lastIdx));
    }

    return parts.length > 0 ? parts : text;
  }

  return (
    <div className="space-y-6 text-zinc-700 leading-relaxed font-sans">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'code':
            return (
              <div key={idx} className="relative group rounded-2xl overflow-hidden border border-zinc-800 bg-[#0f0f11] my-6 font-mono text-xs shadow-lg">
                <div className="flex items-center justify-between px-6 py-3 bg-[#16161a] border-b border-zinc-800 text-zinc-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-brand">Code Snippet</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(block.content)}
                    className="hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
                <pre className="p-6 overflow-x-auto text-zinc-300">
                  <code>{block.content}</code>
                </pre>
              </div>
            );
          case 'h1':
            return (
              <h1 key={idx} className="text-3xl font-black text-zinc-900 mt-10 mb-4 tracking-tight leading-tight">
                {block.content}
              </h1>
            );
          case 'h2':
            return (
              <h2 key={idx} className="text-2xl font-black text-zinc-900 mt-8 mb-4 border-b pb-3 border-zinc-100 tracking-tight leading-tight flex items-center gap-2">
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
              <div key={idx} className="p-6 bg-brand/5 border-l-4 border-brand rounded-r-2xl my-6 text-zinc-700 italic text-sm shadow-sm">
                {parseInlineMarkdown(block.content)}
              </div>
            );
          case 'empty':
            return <div key={idx} className="h-2" />;
          case 'p':
            return (
              <p key={idx} className="text-zinc-600 text-[15px] leading-relaxed whitespace-pre-wrap">
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
