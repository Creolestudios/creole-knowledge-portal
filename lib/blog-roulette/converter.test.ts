import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExec, mockWriteFile, mockReadFile, mockUnlink } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockWriteFile: vi.fn(),
  mockReadFile: vi.fn(),
  mockUnlink: vi.fn(),
}));

// promisify(exec) is applied at module load, so exec must be a callback-style
// function that promisify can wrap.
vi.mock('child_process', () => ({
  exec: (cmd: string, cb: (err: unknown, out?: unknown) => void) => mockExec(cmd, cb),
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: (...a: any[]) => mockWriteFile(...a),
    readFile: (...a: any[]) => mockReadFile(...a),
    unlink: (...a: any[]) => mockUnlink(...a),
  },
}));

import { convertHtmlToMarkdown, convertMarkdownToDocx } from './converter';

describe('convertHtmlToMarkdown', () => {
  it('converts headings to ATX style', () => {
    expect(convertHtmlToMarkdown('<h1>Title</h1>')).toBe('# Title');
    expect(convertHtmlToMarkdown('<h2>Sub</h2>')).toBe('## Sub');
  });

  it('converts inline emphasis and links', () => {
    const md = convertHtmlToMarkdown('<p><strong>bold</strong> and <a href="https://x.com">link</a></p>');
    expect(md).toContain('**bold**');
    expect(md).toContain('[link](https://x.com)');
  });

  it('converts code blocks using fenced style', () => {
    const md = convertHtmlToMarkdown('<pre><code>const a = 1;</code></pre>');
    expect(md).toContain('```');
    expect(md).toContain('const a = 1;');
  });

  it('converts lists', () => {
    const md = convertHtmlToMarkdown('<ul><li>one</li><li>two</li></ul>');
    expect(md).toContain('one');
    expect(md).toContain('two');
  });

  it('converts GFM tables via the gfm plugin', () => {
    const md = convertHtmlToMarkdown(
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    );
    expect(md).toContain('|');
    expect(md).toContain('A');
  });

  it('returns an empty string for empty input', () => {
    expect(convertHtmlToMarkdown('')).toBe('');
  });
});

describe('convertMarkdownToDocx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(Buffer.from('DOCX-BYTES'));
    mockUnlink.mockResolvedValue(undefined);
    // promisify expects the callback signature (err, stdout, stderr)
    mockExec.mockImplementation((_cmd: string, cb: any) => cb(null, { stdout: '', stderr: '' }));
  });

  it('writes markdown, runs pandoc and returns the generated buffer', async () => {
    const buf = await convertMarkdownToDocx({
      id: 'b1',
      title: 'My Title',
      body_md: '# My Title\n\nBody',
    });

    expect(buf.toString()).toBe('DOCX-BYTES');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockExec.mock.calls[0][0]).toContain('pandoc');
  });

  it('derives markdown from body_html when body_md is absent', async () => {
    await convertMarkdownToDocx({
      id: 'b1',
      title: 'HTML Blog',
      body_md: null,
      body_html: '<h2>From HTML</h2>',
    });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written).toContain('## From HTML');
  });

  it('prepends the title as an H1 when the markdown does not start with one', async () => {
    await convertMarkdownToDocx({ id: 'b1', title: 'Prepended', body_md: 'Just body text' });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written.startsWith('# Prepended')).toBe(true);
  });

  it('does not double-prepend a title that is already an H1', async () => {
    await convertMarkdownToDocx({ id: 'b1', title: 'Already', body_md: '# Already\n\nBody' });

    const written = mockWriteFile.mock.calls[0][1] as string;
    expect(written.match(/# Already/g)).toHaveLength(1);
  });

  it('surfaces a clear error when pandoc is unavailable', async () => {
    mockExec.mockImplementation((_cmd: string, cb: any) => cb(new Error('pandoc: not found')));

    await expect(
      convertMarkdownToDocx({ id: 'b1', title: 'T', body_md: 'body' }),
    ).rejects.toThrow(/Pandoc conversion failed/);
  });

  it('cleans up both temp files even when the conversion fails', async () => {
    mockExec.mockImplementation((_cmd: string, cb: any) => cb(new Error('boom')));

    await expect(
      convertMarkdownToDocx({ id: 'b1', title: 'T', body_md: 'body' }),
    ).rejects.toThrow();
    expect(mockUnlink).toHaveBeenCalledTimes(2);
  });

  it('ignores cleanup failures', async () => {
    mockUnlink.mockRejectedValue(new Error('already gone'));

    const buf = await convertMarkdownToDocx({ id: 'b1', title: 'T', body_md: 'body' });
    expect(buf.toString()).toBe('DOCX-BYTES');
  });
});
