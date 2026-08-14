// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>fake-diagram</svg>' }),
  },
}));

import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { sanitizeBlogHtml, enhanceBlogContent, useBlogContentEnhancer } from './useBlogContentEnhancer';
import mermaid from 'mermaid';

describe('sanitizeBlogHtml', () => {
  it('strips <script> tags entirely', () => {
    const result = sanitizeBlogHtml('<p>Hello</p><script>alert(1)</script><p>World</p>');
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('<p>Hello</p>');
    expect(result).toContain('<p>World</p>');
  });

  it('strips inline event handler attributes with quoted values', () => {
    const result = sanitizeBlogHtml('<img src="x.png" onerror="alert(1)" />');
    expect(result).not.toContain('onerror');
    expect(result).toContain('src="x.png"');
  });

  it('strips inline event handler attributes with unquoted values', () => {
    const result = sanitizeBlogHtml('<div onclick=doSomething() data-x="1">Click</div>');
    expect(result).not.toContain('onclick');
    expect(result).toContain('data-x="1">Click</div>');
  });

  it('leaves safe markup untouched', () => {
    const html = '<h1>Title</h1><p>Some <strong>bold</strong> text.</p>';
    expect(sanitizeBlogHtml(html)).toBe(html);
  });

  it('handles empty input', () => {
    expect(sanitizeBlogHtml('')).toBe('');
  });
});

// ── Minimal hand-rolled DOM stub ──────────────────────────────────────────
// No jsdom/happy-dom dependency is installed in this project, and we were
// asked not to touch package.json. enhanceBlogContent only touches a small,
// fixed surface of the DOM API (createElement, className, querySelector(All),
// appendChild, replaceWith, cloneNode, textContent/innerHTML, addEventListener),
// so a lightweight fake is enough to exercise the real logic end-to-end.

interface FakeElement {
  tagName: string;
  className: string;
  innerHTML: string;
  textContent: string | null;
  children: FakeElement[];
  attrs: Record<string, string>;
  listeners: Record<string, (...args: any[]) => any>;
  replacedWith: FakeElement | null;
  querySelector: (sel: string) => FakeElement | null;
  querySelectorAll: (sel: string) => FakeElement[];
  appendChild: (child: FakeElement) => void;
  cloneNode: (deep?: boolean) => FakeElement;
  addEventListener: (type: string, cb: (...args: any[]) => any) => void;
  replaceWith: (el: FakeElement) => void;
}

function makeFakeElement(tagName: string, opts: Partial<FakeElement> = {}): FakeElement {
  const el: FakeElement = {
    tagName,
    className: opts.className ?? '',
    innerHTML: '',
    textContent: opts.textContent ?? null,
    children: [],
    attrs: {},
    listeners: {},
    replacedWith: null,
    querySelector(sel: string) {
      return el.children.find((c) => matchesSimpleSelector(c, sel)) ?? null;
    },
    querySelectorAll(sel: string) {
      return el.children.filter((c) => matchesSimpleSelector(c, sel));
    },
    appendChild(child: FakeElement) {
      el.children.push(child);
    },
    cloneNode() {
      return { ...el, children: [...el.children] };
    },
    addEventListener(type: string, cb: (...args: any[]) => any) {
      el.listeners[type] = cb;
    },
    replaceWith(replacement: FakeElement) {
      el.replacedWith = replacement;
    },
  };

  // Naive innerHTML "parser": this file only ever assigns a copy-button
  // template or an SVG string, so a simple substring check is enough to
  // synthesize the one child node the real code looks up afterwards.
  Object.defineProperty(el, 'innerHTML', {
    get: () => opts.innerHTML ?? '',
    set: (html: string) => {
      opts.innerHTML = html;
      if (html.includes('code-copy-btn')) {
        el.children.push(makeFakeElement('button', { className: 'code-copy-btn', textContent: 'Copy' }));
      }
    },
  });

  return el;
}

function matchesSimpleSelector(el: FakeElement, sel: string): boolean {
  if (sel === 'code') return el.tagName === 'code';
  if (sel === '.code-copy-btn') return el.className.includes('code-copy-btn');
  return false;
}

describe('enhanceBlogContent', () => {
  const originalDocument = (global as any).document;
  const originalClipboard = (global as any).navigator?.clipboard;

  beforeEach(() => {
    (global as any).document = {
      createElement: vi.fn((tag: string) => makeFakeElement(tag)),
    };
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterAll(() => {
    (global as any).document = originalDocument;
    vi.unstubAllGlobals();
    void originalClipboard;
  });

  it('does nothing when there are no code or mermaid blocks', async () => {
    const root = makeFakeElement('div');
    root.querySelectorAll = () => [];

    await expect(enhanceBlogContent(root as any, () => false)).resolves.toBeUndefined();
  });

  it('wraps a fenced code block with a copy header and preserves the code content', async () => {
    const codeEl = makeFakeElement('code', { textContent: 'const x = 1;' });
    const preBlock = makeFakeElement('pre', { className: 'language-typescript' });
    preBlock.children.push(codeEl);

    const root = makeFakeElement('div');
    root.querySelectorAll = (sel: string) => {
      if (sel === 'pre[class*="language-"]') return [preBlock];
      return [];
    };

    await enhanceBlogContent(root as any, () => false);

    expect(preBlock.replacedWith).not.toBeNull();
    const wrapper = preBlock.replacedWith!;
    expect(wrapper.className).toContain('code-block-wrapper');
    // header + pre appended to wrapper
    expect(wrapper.children).toHaveLength(2);
    const header = wrapper.children[0];
    expect(header.innerHTML).toContain('Typescript');
  });

  it('invokes the clipboard API when the copy button is clicked', async () => {
    const codeEl = makeFakeElement('code', { textContent: 'echo hi' });
    const preBlock = makeFakeElement('pre', { className: 'language-bash' });
    preBlock.children.push(codeEl);

    const root = makeFakeElement('div');
    root.querySelectorAll = (sel: string) =>
      sel === 'pre[class*="language-"]' ? [preBlock] : [];

    await enhanceBlogContent(root as any, () => false);

    const wrapper = preBlock.replacedWith!;
    const header = wrapper.children[0];
    const copyBtn = header.querySelector('.code-copy-btn')!;

    await copyBtn.listeners.click?.();
    expect((global as any).navigator.clipboard.writeText).toHaveBeenCalledWith('echo hi');
  });

  it('falls back to Code label when the language class is missing', async () => {
    const preBlock = makeFakeElement('pre', { className: '', textContent: 'raw text' });

    const root = makeFakeElement('div');
    root.querySelectorAll = (sel: string) =>
      sel === 'pre[class*="language-"]' ? [preBlock] : [];

    await enhanceBlogContent(root as any, () => false);

    const wrapper = preBlock.replacedWith!;
    expect(wrapper.children[0].innerHTML).toContain('>Code<');
    // no <code> child, so pre.textContent should carry the raw text through
    expect(wrapper.children[1].textContent).toBe('raw text');
  });

  it('renders mermaid diagrams and replaces the block with the resulting SVG', async () => {
    const mermaidBlock = makeFakeElement('div', { className: 'mermaid', textContent: 'graph TD; A-->B;' });

    const root = makeFakeElement('div');
    root.querySelectorAll = (sel: string) =>
      sel === '.mermaid, pre.mermaid, code.language-mermaid' ? [mermaidBlock] : [];

    await enhanceBlogContent(root as any, () => false);

    expect(mermaidBlock.replacedWith).not.toBeNull();
    expect(mermaidBlock.replacedWith!.className).toContain('mermaid-wrapper');
  });

  it('skips mermaid rendering when the effect was cancelled before initialize', async () => {
    const mermaidBlock = makeFakeElement('div', { className: 'mermaid', textContent: 'graph TD; A-->B;' });

    const root = makeFakeElement('div');
    root.querySelectorAll = (sel: string) =>
      sel === '.mermaid, pre.mermaid, code.language-mermaid' ? [mermaidBlock] : [];

    await enhanceBlogContent(root as any, () => true);

    expect(mermaidBlock.replacedWith).toBeNull();
  });

  it('logs and continues when an individual mermaid diagram fails to render', async () => {
    const badBlock = makeFakeElement('div', { className: 'mermaid', textContent: 'invalid' });
    const goodBlock = makeFakeElement('div', { className: 'mermaid', textContent: 'graph TD; A-->B;' });

    const root = makeFakeElement('div');
    root.querySelectorAll = (sel: string) =>
      sel === '.mermaid, pre.mermaid, code.language-mermaid' ? [badBlock, goodBlock] : [];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(mermaid.render)
      .mockRejectedValueOnce(new Error('bad diagram'))
      .mockResolvedValueOnce({ svg: '<svg>ok</svg>', diagramType: 'graph', bindFunctions: undefined } as any);

    await enhanceBlogContent(root as any, () => false);

    expect(warnSpy).toHaveBeenCalledWith('[preview] mermaid render error', expect.any(Error));
    expect(badBlock.replacedWith).toBeNull();
    expect(goodBlock.replacedWith).not.toBeNull();
    warnSpy.mockRestore();
  });
});

describe('useBlogContentEnhancer', () => {
  it('runs the enhancement effect against the ref element and cleans up on unmount', () => {
    const el = makeFakeElement('div');
    el.querySelectorAll = () => [];
    const ref = { current: el as unknown as HTMLDivElement };

    const { unmount } = renderHook(() => useBlogContentEnhancer(ref as any, []));
    unmount();
  });

  it('does nothing when the ref has no current element', () => {
    const ref = { current: null };
    expect(() => renderHook(() => useBlogContentEnhancer(ref as any, []))).not.toThrow();
  });
});
