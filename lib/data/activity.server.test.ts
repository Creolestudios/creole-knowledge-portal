import { describe, it, expect } from 'vitest';
import { getActivity, getDayStatuses, getWeeklyStats, logActivity } from './activity';
import seed from '@/lib/mock/activity.json';

// This file runs in the default 'node' environment (no `window`), so it
// exercises the server/SSR code path: readStore()/writeStore() no-op and
// getActivity() falls back to the seed fixture untouched.

describe('getActivity (no browser/localStorage)', () => {
  it('returns the seed fixture sorted newest first', async () => {
    const records = await getActivity();
    expect(records).toHaveLength(seed.length);
    for (let i = 1; i < records.length; i++) {
      expect(records[i - 1].date >= records[i].date).toBe(true);
    }
  });
});

describe('getDayStatuses', () => {
  it('maps every seed date to a status', async () => {
    const statuses = await getDayStatuses();
    for (const record of seed) {
      expect(statuses[record.date]).toMatch(/completed|partial|missed/);
    }
  });
});

describe('getWeeklyStats', () => {
  it('aggregates the trailing 7 days from a reference date', async () => {
    const stats = await getWeeklyStats(new Date('2026-06-29T12:00:00Z'));
    expect(stats.daysRead).toBeGreaterThan(0);
    expect(stats.quizzesSubmitted).toBeGreaterThan(0);
  });

  it('defaults the reference date to now when omitted', async () => {
    const stats = await getWeeklyStats();
    expect(stats).toHaveProperty('daysRead');
    expect(stats).toHaveProperty('quizzesSubmitted');
  });
});

describe('logActivity (no browser/localStorage)', () => {
  it('resolves without throwing when localStorage is unavailable', async () => {
    await expect(
      logActivity({ date: '2026-07-01', readSeconds: 60 }),
    ).resolves.toBeUndefined();
  });
});
