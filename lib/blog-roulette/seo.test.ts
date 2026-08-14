import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('google-trends-api', () => ({
  default: {
    interestOverTime: vi.fn(),
  },
}));

import { suggestKeywords } from './seo';
import trendsApi from 'google-trends-api';

describe('suggestKeywords', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns an empty list when the autocomplete request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });

    const result = await suggestKeywords('react hooks');
    expect(result).toEqual([]);
  });

  it('returns an empty list when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await suggestKeywords('react hooks');
    expect(result).toEqual([]);
  });

  it('splits results into primary (trend-enriched) and long-tail keywords', async () => {
    const suggestions = Array.from({ length: 8 }, (_, i) => `keyword ${i}`);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['react hooks', suggestions],
    });
    (trendsApi.interestOverTime as any).mockResolvedValue('{}');

    const result = await suggestKeywords('react hooks');

    const primary = result.filter((r) => r.type === 'primary');
    const longTail = result.filter((r) => r.type === 'long_tail');
    expect(primary).toHaveLength(3);
    expect(longTail).toHaveLength(5);
    expect(longTail.every((r) => r.trend_direction === 'stable')).toBe(true);
  });

  it('classifies a rising trend when recent interest is meaningfully higher', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['x', ['solo-term']],
    });
    const timeline = [
      { value: [1] }, { value: [1] }, { value: [1] }, { value: [1] },
      { value: [50] }, { value: [50] }, { value: [50] }, { value: [50] },
    ];
    (trendsApi.interestOverTime as any).mockResolvedValue(
      JSON.stringify({ default: { timelineData: timeline } }),
    );

    const result = await suggestKeywords('solo-term');
    expect(result[0].trend_direction).toBe('rising');
  });

  it('classifies a falling trend when recent interest is meaningfully lower', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['x', ['solo-term']],
    });
    const timeline = [
      { value: [50] }, { value: [50] }, { value: [50] }, { value: [50] },
      { value: [1] }, { value: [1] }, { value: [1] }, { value: [1] },
    ];
    (trendsApi.interestOverTime as any).mockResolvedValue(
      JSON.stringify({ default: { timelineData: timeline } }),
    );

    const result = await suggestKeywords('solo-term');
    expect(result[0].trend_direction).toBe('falling');
  });

  it('defaults to stable when the trends API throws', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['x', ['solo-term']],
    });
    (trendsApi.interestOverTime as any).mockRejectedValue(new Error('trends down'));

    const result = await suggestKeywords('solo-term');
    expect(result[0].trend_direction).toBe('stable');
  });

  it('defaults to stable when there is not enough timeline data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ['x', ['solo-term']],
    });
    (trendsApi.interestOverTime as any).mockResolvedValue(
      JSON.stringify({ default: { timelineData: [{ value: [1] }] } }),
    );

    const result = await suggestKeywords('solo-term');
    expect(result[0].trend_direction).toBe('stable');
  });
});
