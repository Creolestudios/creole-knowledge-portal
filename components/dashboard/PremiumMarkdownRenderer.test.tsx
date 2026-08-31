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

  it('does not wrap mid-prose python/git words as Code Snippet', () => {
    render(
      <PremiumMarkdownRenderer content="Learn python asyncio for network IO and then ship. Use git only when ready." />,
    );
    expect(screen.queryByText('Code Snippet')).not.toBeInTheDocument();
    expect(screen.queryByText('Diagram')).not.toBeInTheDocument();
    expect(screen.getByText(/Learn python asyncio/)).toBeInTheDocument();
  });

  it('restores flattened headings and command lines', () => {
    render(
      <PremiumMarkdownRenderer
        content="Intro sentence. Step 1: Installing uv curl -LsSf https://astral.sh/uv/install.sh | sh Next paragraph starts here."
      />
    );
    expect(screen.queryByRole('heading', { name: /Step 1:/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Step 1:/i)).toBeInTheDocument();
    expect(screen.getByText(/curl -LsSf/)).toBeInTheDocument();
  });

  it('renders markdown links', () => {
    render(<PremiumMarkdownRenderer content={'See [uv](https://docs.astral.sh/uv/).'} />);
    const link = screen.getByRole('link', { name: /uv/i });
    expect(link).toHaveAttribute('href', 'https://docs.astral.sh/uv/');
  });

  it('renders links even when wrapped in bold (sources list style)', () => {
    render(
      <PremiumMarkdownRenderer
        content={'- **[React hooks guide](https://dev.to/hooks)** — Published on *dev.to*'}
      />,
    );
    const link = screen.getByRole('link', { name: /React hooks guide/i });
    expect(link).toHaveAttribute('href', 'https://dev.to/hooks');
    expect(screen.queryByText(/\[React hooks guide\]/)).not.toBeInTheDocument();
  });

  it('boxes ASCII +---+ pipeline diagrams as Diagram', () => {
    const diagram = [
      '+---------------------------+',
      '|   RAG INGESTION PIPELINE  |',
      '+---------------------------+',
      '            |',
      '            v',
      '+------------------------------------------+',
      '| STEP 1: Text Sanitization & Encoding     |',
      '|  - Convert UTF-8 / UTF-16                |',
      '+------------------------------------------+',
    ].join('\n');
    const { container } = render(<PremiumMarkdownRenderer content={diagram} />);
    expect(screen.getByText(/Diagram/i)).toBeInTheDocument();
    expect(container.querySelector('ol')).toBeTruthy();
    expect(container.textContent).toMatch(/RAG INGESTION PIPELINE/);
  });

  it('hides Korean / legal contract junk from code fences', () => {
    const junk = [
      '```python',
      'sample_contract = """',
      '계약서 기초: 사업 성공의 첫걸음 – 법률 상식 및 공급 계약서',
      'SECTION 1: DEFINITIONS',
      '본 계약은 공급자와 구매자 간의 제품 공급 조건을 규정한다.',
      '"""',
      '```',
    ].join('\n');
    render(<PremiumMarkdownRenderer content={junk} />);
    expect(screen.queryByText(/계약서/)).not.toBeInTheDocument();
    expect(screen.queryByText(/sample_contract/)).not.toBeInTheDocument();
  });

  it('hides indemnification legal text and does not put prose in a code block', () => {
    const legal = [
      '## Overview / Summary',
      '```',
      'ARTICLE 3: INDEMNIFICATION AND LIMITATION OF LIABILITY',
      'The Supplying Party shall indemnify the Purchasing Entity against all losses.',
      'Neither party is liable for consequential damages or loss of profit.',
      '```',
      '',
      'This is normal teaching prose about React hooks.',
    ].join('\n');
    const { container } = render(<PremiumMarkdownRenderer content={legal} />);
    expect(screen.queryByText(/INDEMNIFICATION/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Supplying Party/i)).not.toBeInTheDocument();
    expect(screen.getByText(/React hooks/i)).toBeInTheDocument();
    const pres = container.querySelectorAll('pre');
    for (const pre of pres) {
      expect(pre.textContent || '').not.toMatch(/React hooks/);
    }
  });

  it('only boxes real code, not teaching paragraphs', () => {
    const md = [
      '## Overview / Summary',
      'Hooks let you reuse stateful logic across components.',
      '',
      '```ts',
      'useEffect(() => { return () => {}; }, []);',
      '```',
    ].join('\n');
    const { container } = render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.getByText(/Diagram|Code Snippet/i)).toBeInTheDocument();
    expect(container.querySelector('pre')?.textContent).toMatch(/useEffect/);
    expect(container.querySelector('pre')?.textContent).not.toMatch(/reuse stateful/);
  });

  it('boxes [--- Slice ---] chunking diagrams', () => {
    const md = [
      'NAIVE CHARACTER CHUNKING (Arbitrary Window Slicing):',
      '[--- Slice 1 (500 chars) ---][--- Slice 2 (500 chars) ---][--- Slice 3 (500 chars) ---]',
      'Result: Split sentences, lost context.',
    ].join('\n');
    const { container } = render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.getByText(/Diagram/i)).toBeInTheDocument();
    expect(screen.getByText(/Slice 1/i)).toBeInTheDocument();
  });

  it('keeps Sources & Citations at the end with links', () => {
    const md = `## Brief
Intro text about React hooks.

## Sources & Citations
- [React hooks guide](https://dev.to/hooks) — dev.to

## Overview / Summary
More teaching about TypeScript generics.
`;
    render(<PremiumMarkdownRenderer content={md} />);
    const link = screen.getByRole('link', { name: /React hooks/i });
    expect(link).toHaveAttribute('href', 'https://dev.to/hooks');
    const body = document.body.textContent || '';
    expect(body.lastIndexOf('Sources')).toBeGreaterThan(body.lastIndexOf('More teaching'));
  });

  it('drops lifestyle junk from Sources & Citations', () => {
    const md = `## Overview / Summary
Keep this.

## Sources & Citations
- [React hooks guide](https://dev.to/a) — Published on *dev.to*
- [Early Golf Habits](https://dev.to/golf) — Published on *dev.to*
- [How to Take a Screenshot on Windows 11](https://dev.to/ss) — Published on *dev.to*
- [I benchmarked 5 managed graph databases](https://dev.to/db) — Published on *dev.to*
`;
    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.getByRole('link', { name: /React hooks/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /graph databases/i })).toBeInTheDocument();
    expect(screen.queryByText(/Golf/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Screenshot/i)).not.toBeInTheDocument();
  });

  it('strips golf / jump-start / pricing junk paragraphs from body', () => {
    const md = `## Overview / Summary
Introduction: The Value of Early Habits in Golf
Imagine spending years perfecting a golf swing.

The local cafe scores 56 on the hospitality index.
Pricing is $0.00 per meal for loyalty members.

A dead battery picks mornings. Knowing the right cable order helps.
Park the donor car close, both engines off.

React useEffect cleanup runs after unmount and prevents memory leaks.
`;
    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.queryByText(/golf swing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hospitality index/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/donor car/i)).not.toBeInTheDocument();
    expect(screen.getByText(/useEffect cleanup/i)).toBeInTheDocument();
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

  it('renders unfenced ASCII diagrams as vertical flow cards', () => {
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
    expect(container.querySelector('ol')).toBeTruthy();
    expect(container.textContent).toMatch(/Dense Retrieval/);
    expect(container.textContent).toMatch(/Rank Fusion/);
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
    expect(screen.queryByRole('heading', { name: /Queue Sizing/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Queue Sizing/i)).toBeInTheDocument();
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
    expect(container.textContent).toContain('Asyncio Event Loop Thread');
    expect(container.textContent).toContain('OS Network Protocol Stack');
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

  it('restores flattened directory trees into one Diagram box', () => {
    const content = [
      'openexecutive/ ├── packages/ | ├── core/ | | └── openexecutive/ | | └── orchestrator/',
      '**Executive persona + routing loop** | | | —— agents/',
      '**8 specialist agents** | | | —— knowledge/',
      '**ChromaDB store + RAG pipeline** | | | —— memory/',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={content} />);
    expect(screen.getByText('Diagram')).toBeInTheDocument();
    const pre = container.querySelector('pre');
    expect(pre?.textContent).toMatch(/openexecutive\//);
    expect(pre?.textContent).toMatch(/agents\//);
    expect(pre?.textContent).toMatch(/knowledge\//);
    expect(pre?.textContent).toMatch(/\n/);
    // Must not render as a chain of blue-bar headings
    expect(screen.queryByRole('heading', { name: /Executive persona/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /ChromaDB/i })).not.toBeInTheDocument();
  });

  it('renders chunking algorithm steps as prose, not blue-bar headings', () => {
    const md = [
      '## Code Snippet',
      '## 1. Calculate raw target end boundary',
      'If we reached the end of the text, yield the remainder and terminate',
      '```python',
      'if raw_end == text_length:',
      '    yield text[start:raw_end]',
      '    break',
      '```',
      'Search backward up to overlap characters from raw_end',
      '## 3. Locate the natural boundary point',
      'Safeguard: prevent zero-length progress if boundary matches start',
      '```python',
      'if actual_end <= start:',
      '    actual_end = raw_end',
      '```',
      '## Sources & Citations',
      '- [Text chunking guide](https://dev.to/chunking) — dev.to',
    ].join('\n');

    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.queryByRole('heading', { name: /Calculate raw target/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Locate the natural/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Calculate raw target end boundary/)).toBeInTheDocument();
    expect(screen.getByText(/Search backward up to overlap/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Code Snippet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Text chunking guide/i })).toBeInTheDocument();
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

  it('hides dotted leaders and mid-body links; keeps Sources links only', () => {
    const md = [
      '## Brief',
      'Learn React hooks for shared state.',
      '........',
      '· · · · ·',
      'See also [random mid link](https://dev.to/noise) for more.',
      'https://example.com/stray',
      '',
      '## Overview / Summary',
      '+------------------+',
      '| React hooks flow |',
      '+--------+---------+',
      '         |',
      '         v',
      '+--------+---------+',
      '| useEffect cleanup|',
      '+------------------+',
      '',
      '```',
      'This is a long teaching paragraph about hooks that should never sit in a dark code box because it is prose explaining concepts in detail to the reader.',
      'Another sentence continues the lesson with even more explanation about React rendering and cleanup timing for beginners.',
      '```',
      '',
      '## Sources & Citations',
      '- [React hooks guide](https://dev.to/hooks) — dev.to',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={md} />);
    expect(container.textContent).not.toMatch(/\.{4,}/);
    expect(container.textContent).not.toMatch(/· · ·/);
    expect(screen.queryByRole('link', { name: /random mid link/i })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('https://example.com/stray');
    expect(screen.getByRole('link', { name: /React hooks guide/i })).toHaveAttribute(
      'href',
      'https://dev.to/hooks',
    );
    expect(screen.getByText('Diagram')).toBeInTheDocument();
    expect(container.textContent).toMatch(/React hooks flow/);
    expect(screen.getByText(/long teaching paragraph/i)).toBeInTheDocument();
  });

  it('renders markdown comparison tables as HTML tables, not Diagram boxes', () => {
    const md = [
      '## Overview / Summary',
      '| Capability | Kubernetes Kubeflow | Gubernator MLOps |',
      '| :--- | :--- | :--- |',
      '| Control Plane Overhead | 16 GB – 32 GB RAM | < 200 MB RAM |',
      '| Deployment Time | 30–45 minutes | < 60 seconds |',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={md} />);
    expect(container.querySelector('table')).toBeTruthy();
    expect(screen.getByText(/Control Plane Overhead/)).toBeInTheDocument();
    expect(screen.getByText(/< 200 MB RAM/)).toBeInTheDocument();
    expect(screen.queryByText(/Diagram/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain(':---');
  });

  it('strips Dev.to YAML frontmatter from scraped blog bodies', () => {
    const md = [
      'title: Kubeflow Without Kubernetes? Deploy a Complete MLOps Suite in 60 Seconds with Gubernator',
      'published: true',
      'description: Run JupyterLab, MLflow, MinIO S3, and Ollama Inference on a lightweight cluster using pure Docker Compose and <2GB RAM.',
      'tags: #gubernator #docker #antigravity #orquestador',
      'series: gubernator',
      '',
      "The 'Kubernetes Tax' on Modern Machine Learning",
      '',
      "If you've ever tried setting up Kubeflow on Kubernetes, you know the drill:",
      '- 16 GB to 32 GB of RAM consumed before you even write a single line of Python',
      '- Days spent debugging webhook admission controllers and Kustomize overlays.',
    ].join('\n');

    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.queryByText(/^published:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^tags:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^series:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Run JupyterLab, MLflow, MinIO S3/)).not.toBeInTheDocument();
    expect(screen.getByText(/Kubernetes Tax/)).toBeInTheDocument();
    expect(screen.getByText(/webhook admission controllers/)).toBeInTheDocument();
  });

  it('rebuilds misaligned wide ASCII RAG diagrams into a clean vertical stack', () => {
    const broken = [
      '```',
      '+-- ---------+     +-- ---------+',
      '| Raw Data    | --> | Data Ingestion |',
      '+-- ---------+     +-- ---------+',
      '(Documents, PDFs)',
      'Vector Database',
      '(Embeddings, Index)',
      '| -- ----> | Query Time |<------+',
      'User Query',
      '+--------------------------------+',
      '| Query Embedding + Similarity Search |',
      '+--------------------------------+',
      'Retrieved Context Assembly',
      '```',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={broken} />);
    expect(screen.getByText('Diagram')).toBeInTheDocument();
    expect(container.querySelector('ol')).toBeTruthy();
  });

  it('restores bare python/text language labels into proper fenced blocks', () => {
    const md = [
      'python',
      'sample_text = "hello world"',
      'for chunk in chunks:',
      '    print(len(chunk))',
      '',
      'text',
      '+------------------+',
      '| Input Text       |',
      '+------------------+',
      '',
      'python',
      'from typing import List',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={md} />);
    expect(container.querySelectorAll('pre').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/sample_text/)).toBeInTheDocument();
    expect(screen.getByText(/from typing import List/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/^python$/m);
  });

  it('renders broken pipe comparison tables as HTML tables, not Diagram boxes', () => {
    const md = [
      '```',
      '+-- -----------------------',
      '+-- ----------------------------+',
      '| Pure ASCII / Latin-1 | 1 byte per character (PyUcs1)',
      'Basic Multilingual    | 2 bytes per character (PyUcs2)',
      'Extended / Emoji      | 4 bytes per character (PyUcs4)',
      '+-- -----------------------',
      '```',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={md} />);
    expect(container.querySelector('table')).toBeTruthy();
    expect(screen.getByText(/Pure ASCII \/ Latin-1/)).toBeInTheDocument();
    expect(screen.getByText(/PyUcs4/)).toBeInTheDocument();
    expect(screen.queryByText(/^Diagram$/)).not.toBeInTheDocument();
  });

  it('strips embedded Dev.to frontmatter blocks mid digest', () => {
    const md = [
      '## Overview / Summary',
      'Some teaching about Kubernetes.',
      '',
      'title: Kubeflow Without Kubernetes',
      'description: Run JupyterLab and MLflow',
      'tags: docker mlops',
      '',
      'More teaching prose about Kubernetes pods and services.',
    ].join('\n');

    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.queryByText(/^title:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^tags:/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Kubernetes pods and services/)).toBeInTheDocument();
  });

  it('deduplicates repeated bracket flow sections into one vertical path', () => {
    const md = [
      '```',
      '+-- ------------',
      '[ Fragment <= max_size ]',
      '        v',
      '( Keep Fragment )',
      '[ Fragment > max_size ]',
      '        v',
      '[ Try split by "\\n" ]',
      '+-- ------------',
      '[ Fragment <= max_size ]',
      '        v',
      '( Keep Fragment )',
      '[ Fragment > max_size ]',
      '        v',
      '[ Try split by ". " ]',
      '```',
    ].join('\n');

    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.getByText('Diagram')).toBeInTheDocument();
    expect(screen.getAllByText(/Fragment <= max_size/i)).toHaveLength(1);
    expect(screen.getAllByText(/Try split by/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders bracket decision trees as vertical flow cards', () => {
    const md = [
      '```',
      '+-- ------------',
      '[ Fragment <= max_size ]',
      '        v',
      '( Keep Fragment )',
      '[ Fragment > max_size ]',
      '        v',
      '[ Try split by "\\n" ]',
      '```',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.getByText(/Fragment <= max_size/i)).toBeInTheDocument();
    expect(screen.getByText(/Try split by/i)).toBeInTheDocument();
    expect(container.querySelector('ol')).toBeTruthy();
  });

  it('renders chunk demo markers as architecture flow cards', () => {
    const md = [
      'The core engine uses high-performance I/O.',
      '--- Chunk 1 (114 chars) ---',
      'The core engine uses validation on every frame.',
      '--- Chunk 2 (118 chars) ---',
      'Authentication requires HMAC-SHA256 signatures.',
    ].join('\n');

    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.getByText(/Chunk 1:/i)).toBeInTheDocument();
    expect(screen.getByText(/Chunk 2:/i)).toBeInTheDocument();
    expect(screen.getByText(/Architecture/i)).toBeInTheDocument();
  });

  it('coalesces split chunk-demo paragraphs and hides raw marker lines', () => {
    const md = [
      'The core engine uses high-performance I/O routines. All incoming',
      '',
      '--- Chunk 1 (114 chars) ---',
      '',
      'The core engine uses validation on every frame.',
      '',
      '--- Chunk 2 (118 chars) ---',
      '',
      'Authentication requires HMAC-SHA256 signatures.',
    ].join('\n');

    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.getByText(/Chunk 1:/i)).toBeInTheDocument();
    expect(screen.getByText(/Chunk 2:/i)).toBeInTheDocument();
    expect(screen.queryByText(/--- Chunk 1 \(114 chars\) ---/)).not.toBeInTheDocument();
  });

  it('renders bare javascript import as code snippet not diagram', () => {
    const md = [
      '### The Traditional Approach: useEffect and useState',
      '',
      'javascript',
      "import React, { useState, useEffect } from 'react';",
    ].join('\n');

    render(<PremiumMarkdownRenderer content={md} />);
    expect(screen.getByText(/Traditional Approach/i)).toBeInTheDocument();
    expect(screen.getByText(/Code Snippet/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Diagram$/i)).not.toBeInTheDocument();
  });

  it('rebuilds broken Unicode diagrams into compact ASCII boxes', () => {
    const broken = [
      '```',
      '┌──────────────────────────────┐     ┌──────────────────────────────┐',
      '│                              │     │ Data Scientist / AI Engineer │',
      '└──────────────────────────────┘     └──────────────────────────────┘',
      '┌──────────┐',
      '│          │',
      '└──────────┘',
      '| Capability | Kubernetes Kubeflow | Gubernator MLOps |',
      '```',
      '| :--- | :--- | :--- |',
      '| Control Plane Overhead | 16 GB RAM | < 200 MB RAM |',
    ].join('\n');

    const { container } = render(<PremiumMarkdownRenderer content={broken} />);
    expect(container.querySelector('table')).toBeTruthy();
    expect(screen.getByText(/Control Plane Overhead/)).toBeInTheDocument();
    // Salvaged diagram should be classic +---+ ASCII, not Unicode shells
    const pre = container.querySelector('pre');
    if (pre) {
      expect(pre.textContent).toMatch(/\+/);
      expect(pre.textContent).not.toMatch(/┌/);
    }
  });
});
