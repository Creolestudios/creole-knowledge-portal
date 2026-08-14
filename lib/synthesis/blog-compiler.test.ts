import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {},
}));

import { calculateReadingTime } from './blog-compiler';

describe('calculateReadingTime', () => {
  it('returns 0 for empty content', () => {
    expect(calculateReadingTime('')).toBe(0);
  });

  it('estimates prose-only reading time at 200 wpm, rounded up', () => {
    const words = new Array(201).fill('word').join(' ');
    // 201 words / 200 wpm = 1.005 -> ceil to 2
    expect(calculateReadingTime(words)).toBe(2);
  });

  it('estimates a short prose passage as at least 1 minute', () => {
    const words = new Array(50).fill('word').join(' ');
    expect(calculateReadingTime(words)).toBe(1);
  });

  it('weighs code blocks at 100 wpm, separately from prose', () => {
    const prose = new Array(200).fill('word').join(' '); // 1 min of prose
    const code = '```\n' + new Array(100).fill('code').join(' ') + '\n```'; // fence markers count as 2 extra words
    const markdown = `${prose}\n\n${code}`;

    // prose: 200/200 = 1.0; code: 102/100 = 1.02 -> ceil(2.02) = 3
    expect(calculateReadingTime(markdown)).toBe(3);
  });

  it('excludes code block content from the prose word count', () => {
    const code = '```\n' + new Array(400).fill('code').join(' ') + '\n```';
    // Without exclusion this would be counted as prose at 200wpm (~2 min);
    // excluded from prose and counted as code (402 words) at 100wpm instead.
    expect(calculateReadingTime(code)).toBe(5);
  });
});
