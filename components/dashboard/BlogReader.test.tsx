// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BlogReader from './BlogReader';

describe('BlogReader', () => {
  it('renders headings at each level', () => {
    render(<BlogReader content={'# H1 Title\n## H2 Title\n### H3 Title'} />);
    expect(screen.getByRole('heading', { level: 1, name: 'H1 Title' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'H2 Title' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'H3 Title' })).toBeInTheDocument();
  });

  it('renders list items and blockquotes', () => {
    render(<BlogReader content={'- Item one\n* Item two\n> A quote'} />);
    expect(screen.getByText('Item one')).toBeInTheDocument();
    expect(screen.getByText('Item two')).toBeInTheDocument();
    expect(screen.getByText('A quote')).toBeInTheDocument();
  });

  it('renders a plain paragraph', () => {
    render(<BlogReader content="Just a regular paragraph." />);
    expect(screen.getByText('Just a regular paragraph.')).toBeInTheDocument();
  });

  it('renders a fenced code block with a copy button', () => {
    render(<BlogReader content={'```\nconst x = 1;\n```'} />);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('copies code to the clipboard when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<BlogReader content={'```\nconsole.log(1);\n```'} />);
    screen.getByText('Copy').click();
    expect(writeText).toHaveBeenCalledWith('console.log(1);');
  });

  it('renders bold inline markdown', () => {
    render(<BlogReader content="This is **bold text** here." />);
    expect(screen.getByText('bold text')).toBeInTheDocument();
  });

  it('renders inline markdown links with the external-link icon', () => {
    render(<BlogReader content="Check out [our docs](https://example.com/docs)." />);
    const link = screen.getByRole('link', { name: /our docs/ });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('supports nested bold text inside a link-free sentence', () => {
    render(<BlogReader content="**Nested bold** and normal text." />);
    expect(screen.getByText('Nested bold')).toBeInTheDocument();
    expect(screen.getByText(/and normal text\./)).toBeInTheDocument();
  });

  it('handles empty content without crashing', () => {
    const { container } = render(<BlogReader content="" />);
    expect(container).toBeInTheDocument();
  });
});
