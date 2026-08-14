// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PremiumMarkdownRenderer } from './PremiumMarkdownRenderer';

describe('PremiumMarkdownRenderer', () => {
  it('renders headings h1-h3', () => {
    render(<PremiumMarkdownRenderer content={'# H1\n## H2\n### H3'} />);
    expect(screen.getByRole('heading', { level: 1, name: 'H1' })).toBeInTheDocument();
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
});
