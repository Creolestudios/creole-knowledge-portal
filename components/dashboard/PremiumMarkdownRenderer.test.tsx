// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PremiumMarkdownRenderer } from './PremiumMarkdownRenderer';

describe('PremiumMarkdownRenderer', () => {
  it('renders headings h1-h3', () => {
    render(<PremiumMarkdownRenderer content={'# H1\n## H2\n### H3'} />);
    expect(screen.getByRole('heading', { level: 2, name: 'H1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'H2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'H3' })).toBeInTheDocument();
  });

  it('renders list items and blockquotes', () => {
    render(<PremiumMarkdownRenderer content={'- One\n* Two\n> A quote'} />);
    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
    expect(screen.getByText('A quote')).toBeInTheDocument();
  });

  it('groups consecutive plain lines into a single paragraph', () => {
    render(<PremiumMarkdownRenderer content={'Line one\nLine two'} />);
    expect(screen.getByText(/Line one/)).toBeInTheDocument();
  });

  it('renders a fenced code block with a copy button', () => {
    render(<PremiumMarkdownRenderer content={'```\nconst a = 1;\n```'} />);
    expect(screen.getByText('const a = 1;')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('handles an unterminated code block gracefully by flushing at end of input', () => {
    render(<PremiumMarkdownRenderer content={'```\nunterminated code'} />);
    expect(screen.getByText('unterminated code')).toBeInTheDocument();
  });

  it('copies code to the clipboard when the copy button is clicked', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<PremiumMarkdownRenderer content={'```\nhello();\n```'} />);
    screen.getByText('Copy').click();
    expect(writeText).toHaveBeenCalledWith('hello();');
  });

  it('renders bold inline markdown within a paragraph', () => {
    render(<PremiumMarkdownRenderer content="Some **bold** word." />);
    expect(screen.getByText('bold')).toBeInTheDocument();
  });

  it('renders blank-line spacers between blocks', () => {
    const { container } = render(<PremiumMarkdownRenderer content={'Para one\n\nPara two'} />);
    expect(container.querySelectorAll('.h-2')).toHaveLength(1);
  });

  it('restores flattened headings and command lines', () => {
    render(
      <PremiumMarkdownRenderer
        content="Intro sentence. Step 1: Installing uv curl -LsSf https://astral.sh/uv/install.sh | sh Next paragraph starts here."
      />
    );
    expect(screen.getByRole('heading', { name: /Step 1:/i })).toBeInTheDocument();
    expect(screen.getByText(/curl -LsSf/)).toBeInTheDocument();
  });

  it('renders markdown links', () => {
    render(<PremiumMarkdownRenderer content={'See [uv](https://docs.astral.sh/uv/).'} />);
    const link = screen.getByRole('link', { name: /uv/i });
    expect(link).toHaveAttribute('href', 'https://docs.astral.sh/uv/');
  });

  it('returns nothing for empty content and skips chrome headings', () => {
    const { container } = render(<PremiumMarkdownRenderer content="" />);
    expect(container.querySelector('p')).toBeNull();

    render(<PremiumMarkdownRenderer content={'# Copy link\n#### Real heading\n1. First\ncurl -LsSf https://example.com/install.sh'} />);
    expect(screen.getByRole('heading', { name: 'Real heading' })).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('curl -LsSf https://example.com/install.sh')).toBeInTheDocument();
  });

  it('keeps already-structured markdown and splits long flattened prose', () => {
    render(<PremiumMarkdownRenderer content={'Line one\n\n\nLine two\n\nLine three'} />);
    expect(screen.getByText('Line one')).toBeInTheDocument();

    const long = 'A'.repeat(40) + '. Next sentence starts here and keeps going so the flattened body is over two hundred eighty characters in total for the splitter. More words follow after that period.';
    render(<PremiumMarkdownRenderer content={long} />);
    expect(screen.getByText(/Next sentence starts here/)).toBeInTheDocument();
  });

  it('renders unfenced ASCII diagrams as monospace pre without wrapping', () => {
    const diagram = [
      '  +------------------+',
      '  | Dense Retrieval  |',
      '  +--------+---------+',
      '           |',
      '           v',
      '  +--------+---------+',
      '  | Rank Fusion      |',
      '  +------------------+',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={diagram} />);
    expect(screen.getByText('Diagram')).toBeInTheDocument();
    const pre = container.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre?.className).toContain('whitespace-pre');
    expect(pre?.className).not.toContain('whitespace-pre-wrap');
  });

  it('renders prose that was wrongly wrapped in fences as normal text, not CODE SNIPPET', () => {
    const mistenced = [
      '```',
      '- Prefer ThreadPoolExecutor for I/O bound work that shares memory.',
      '- Prefer ProcessPoolExecutor for CPU bound work that needs isolation.',
      '### 3. Queue Sizing and Preventing Unbounded Task Execution',
      'A common anti-pattern in concurrent Python code is spawning unlimited tasks.',
      '```',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={mistenced} />);
    expect(screen.queryByText('Code Snippet')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Queue Sizing/i })).toBeInTheDocument();
    expect(screen.getByText(/Prefer ThreadPoolExecutor/i)).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('puts unfenced Python in a black code box and keeps nearby prose outside', () => {
    const content = [
      '## ANTI-PATTERN: Will cause memory bloat and OOM on 1,000,000 documents',
      'for doc in massive_document_list:',
      '    asyncio.create_task(process_doc(doc))',
      '',
      '## Unbounded memory growth!',
      'This paragraph explains why the loop above is dangerous in production.',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={content} />);
    expect(screen.getByText('Code Snippet')).toBeInTheDocument();
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('asyncio.create_task');
    expect(pre?.textContent).toContain('for doc in massive_document_list:');
    expect(screen.getByText(/explains why the loop above/i)).toBeInTheDocument();
    const prose = Array.from(container.querySelectorAll('p')).map((p) => p.textContent || '');
    expect(prose.some((t) => /explains why/.test(t))).toBe(true);
  });

  it('renders architecture flow lines as Diagram boxes', () => {
    const flow =
      'ProcessPoolExecutor Architecture: Main Process Thread == [ Pickle Pipe Queue ] == [ Worker Process 1 (Isolated RAM) ]';
    render(<PremiumMarkdownRenderer content={flow} />);
    expect(screen.getByText('Diagram')).toBeInTheDocument();
    expect(screen.getByText(/Pickle Pipe Queue/)).toBeInTheDocument();
  });

  it('merges split fenced code and mid-code headings into one CODE SNIPPET', () => {
    const content = [
      '```python',
      'import asyncio',
      'import time',
      '```',
      '',
      '```python',
      'async def fetch_vector(doc_id: int) -> list[float]:',
      '```',
      '',
      '## Non-blocking yield: Control releases back to event loop immediately',
      '',
      '```python',
      '    await asyncio.sleep(0.1)',
      '    return [0.12, 0.45, 0.78]',
      '```',
      '',
      '```python',
      'async def main():',
      '```',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={content} />);
    expect(screen.getAllByText('Code Snippet')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /Non-blocking yield/i })).not.toBeInTheDocument();
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('import asyncio');
    expect(pre?.textContent).toContain('await asyncio.sleep');
    expect(pre?.textContent).toContain('async def main');
    expect(pre?.textContent).toMatch(/Non-blocking yield/);
  });

  it('merges split ASCII diagram halves into one Diagram box', () => {
    const content = [
      '```',
      '+-------------------------------------+',
      '|     Asyncio Event Loop Thread      |',
      '```',
      '',
      '```',
      '|  Event Loop (epoll/kqueue)         |',
      '|           |                        |',
      '|           v                        |',
      '|  OS Network Protocol Stack         |',
      '+-------------------------------------+',
      '```',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={content} />);
    expect(screen.getAllByText('Diagram')).toHaveLength(1);
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toContain('Asyncio Event Loop Thread');
    expect(pre?.textContent).toContain('OS Network Protocol Stack');
  });

  it('strips mid-blog From [source] attribution lines', () => {
    const content = [
      'Teaching paragraph about asyncio.',
      '',
      '**From [Python Concurrency](https://dev.to/example):**',
      '',
      'More teaching after the source line.',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={content} />);
    expect(container.textContent).not.toMatch(/From \[Python Concurrency\]/);
    expect(screen.getByText(/Teaching paragraph/)).toBeInTheDocument();
    expect(screen.getByText(/More teaching after/)).toBeInTheDocument();
  });

  it('hides decorative dash separators and markdown horizontal rules', () => {
    const content = [
      'Intro text.',
      '--------------------',
      '---',
      '## Data Models',
      '--------------------',
      '---',
      'Body after heading.',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={content} />);
    expect(screen.getByRole('heading', { name: 'Data Models' })).toBeInTheDocument();
    expect(screen.getByText('Intro text.')).toBeInTheDocument();
    expect(screen.getByText('Body after heading.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/-{4,}/);
    expect(container.textContent).not.toContain('---');
  });
});
