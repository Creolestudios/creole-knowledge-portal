// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  identifyFillerSpans,
  countFillerWords,
} from '@/lib/ai-interview/fluency-calculator';
import { HighlightedVerbatimAnswer } from '@/components/ai-interview/highlighted-verbatim-answer';

describe('Filler Words Detection & Highlighting', () => {
  it('correctly identifies single-word and two-word filler tokens', () => {
    const text = 'Well, um, I think that, you know, we should basically use Redis, like, for caching.';
    const result = countFillerWords(text);

    expect(result.count).toBeGreaterThanOrEqual(4);
    expect(result.breakdown['um']).toBe(1);
    expect(result.breakdown['you know']).toBe(1);
    expect(result.breakdown['basically']).toBe(1);
    expect(result.breakdown['like']).toBe(1);
  });

  it('losslessly segments text into spans preserving whitespace, quotes, and punctuation', () => {
    const raw = 'Well, umm... I was, like, thinking "you know" we need Kafka.';
    const spans = identifyFillerSpans(raw);

    // Reconstructing the text from spans must be identical to raw
    const reconstructed = spans.map((s) => s.text).join('');
    expect(reconstructed).toBe(raw);

    const fillerSpans = spans.filter((s) => s.isFiller);
    expect(fillerSpans.length).toBe(3);
    expect(fillerSpans.map((s) => s.text)).toEqual(['umm', 'like', 'you know']);
  });

  it('renders HighlightedVerbatimAnswer with tilted italic styling and badge for fillers', () => {
    const answer = 'Actually, uh, I configured Kafka with partitioned topics.';
    render(<HighlightedVerbatimAnswer text={answer} />);

    // Verifies full content is in document
    expect(screen.getByText(/I configured Kafka with partitioned topics/i)).toBeInTheDocument();

    // Verifies filler spans have italic styling and hover title
    const uhElement = screen.getByText('uh');
    expect(uhElement).toBeInTheDocument();
    expect(uhElement.className).toContain('italic');
    expect(uhElement.className).toContain('text-amber-700');
    expect(uhElement).toHaveAttribute('title', expect.stringContaining('Verbal filler hesitation'));

    const actuallyElement = screen.getByText('Actually');
    expect(actuallyElement).toBeInTheDocument();
    expect(actuallyElement.className).toContain('italic');

    // Legend is rendered
    expect(
      screen.getByText(/Tilted font highlights detected verbal filler words/i)
    ).toBeInTheDocument();
  });
});
