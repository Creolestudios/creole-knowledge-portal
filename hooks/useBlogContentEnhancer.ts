'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Wraps fenced code blocks with a copy-to-clipboard header and renders
 * Mermaid diagrams inside `root`. Exported separately from the hook so the
 * DOM-manipulation logic can be unit-tested without a React render pass.
 */
export async function enhanceBlogContent(
  root: HTMLElement,
  isCancelled: () => boolean,
): Promise<void> {
  // --- Enhance code sample blocks ---
  const codeBlocks = root.querySelectorAll<HTMLElement>(
    'pre[class*="language-"]',
  );
  for (const block of codeBlocks) {
    // Extract language from class e.g. "language-typescript"
    const lang =
      block.className
        .match(/language-(\w+)/)?.[1]
        ?.replace(/^[a-z]/, (c) => c.toUpperCase()) ?? 'Code';

    // Wrap the block in an enhanced container
    const wrapper = document.createElement('div');
    wrapper.className =
      'code-block-wrapper my-6 rounded-xl border border-zinc-800 bg-[#0f0f11] overflow-hidden shadow-lg';

    // Header bar: language label + copy button
    const header = document.createElement('div');
    header.className =
      'flex items-center justify-between px-5 py-2.5 bg-[#16161a] border-b border-zinc-800';
    header.innerHTML = `
      <span class="text-[10px] font-bold uppercase tracking-widest text-zinc-500">${lang}</span>
      <button class="code-copy-btn text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-brand transition-colors cursor-pointer">Copy</button>
    `;

    // Copy functionality
    header
      .querySelector('.code-copy-btn')
      ?.addEventListener('click', async () => {
        const code = block.querySelector('code')?.textContent ?? '';
        try {
          await navigator.clipboard.writeText(code);
          const btn = header.querySelector('.code-copy-btn');
          if (btn) {
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => (btn.textContent = orig), 1500);
          }
        } catch {
          /* silent */
        }
      });

    // Clone the pre/code inside the wrapper (strip original classes so
    // Tailwind prose doesn't double-style)
    const pre = document.createElement('pre');
    pre.className =
      'p-5 overflow-x-auto text-sm leading-relaxed m-0 !bg-transparent !border-0 !rounded-none';
    const code = block.querySelector('code');
    if (code) {
      code.className =
        'font-mono text-zinc-300 !bg-transparent !p-0 !text-sm';
      pre.appendChild(code.cloneNode(true));
    } else {
      pre.textContent = block.textContent ?? '';
    }

    wrapper.appendChild(header);
    wrapper.appendChild(pre);
    block.replaceWith(wrapper);
  }

  // --- Render Mermaid diagrams ---
  const mermaidBlocks = root.querySelectorAll<HTMLElement>(
    '.mermaid, pre.mermaid, code.language-mermaid',
  );

  if (mermaidBlocks.length > 0) {
    // Dynamic import mermaid (large library — code-split)
    let mermaid: typeof import('mermaid');
    try {
      mermaid = await import('mermaid');
    } catch {
      return; // mermaid not installed or failed to load
    }

    if (isCancelled()) return;

    mermaid.default.initialize({
      startOnLoad: false,
      theme: 'neutral',
      fontFamily: 'Inter, sans-serif',
      securityLevel: 'strict',
    });

    for (const block of mermaidBlocks) {
      try {
        const code = block.textContent ?? '';
        const { svg } = await mermaid.default.render(
          `mermaid-${crypto.randomUUID()}`,
          code,
        );
        const wrapper = document.createElement('div');
        wrapper.className =
          'mermaid-wrapper my-6 rounded-2xl overflow-hidden border border-zinc-200 bg-white p-6 shadow-sm';
        wrapper.innerHTML = svg;
        block.replaceWith(wrapper);
      } catch (err) {
        console.warn('[preview] mermaid render error', err);
      }
    }
  }
}

/**
 * Shared client-side enhancement for rendered blog HTML: wraps fenced code
 * blocks with a copy-to-clipboard header and renders Mermaid diagrams.
 * Used by both the editor preview pane and the published blog view so the
 * two stay visually identical.
 */
export function useBlogContentEnhancer(
  contentRef: RefObject<HTMLDivElement | null>,
  deps: readonly unknown[],
) {
  useEffect(() => {
    if (!contentRef.current) return;

    let cancelled = false;
    enhanceBlogContent(contentRef.current, () => cancelled);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Strips scripts and inline event handlers from blog HTML before render. */
export function sanitizeBlogHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/on\w+\s*=\s*\S+/gi, '');
}
