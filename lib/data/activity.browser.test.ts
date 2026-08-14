// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { getActivity, logActivity } from './activity';

describe('logActivity + getActivity (browser/localStorage)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists a new record and merges it into getActivity()', async () => {
    await logActivity({ date: '2026-07-05', readSeconds: 120, quizTaken: false });

    const records = await getActivity();
    const record = records.find((r) => r.date === '2026-07-05');
    expect(record).toBeDefined();
    expect(record?.readSeconds).toBe(120);
  });

  it('accumulates readSeconds across multiple calls for the same date', async () => {
    await logActivity({ date: '2026-07-06', readSeconds: 60 });
    await logActivity({ date: '2026-07-06', readSeconds: 40 });

    const records = await getActivity();
    const record = records.find((r) => r.date === '2026-07-06');
    expect(record?.readSeconds).toBe(100);
  });

  it('overwrites quiz fields only when a quiz is actually taken', async () => {
    await logActivity({ date: '2026-07-07', readSeconds: 60, quizTaken: true, quizScore: 3, quizTotal: 5 });
    await logActivity({ date: '2026-07-07', readSeconds: 10 }); // no quiz info this time

    const records = await getActivity();
    const record = records.find((r) => r.date === '2026-07-07');
    expect(record?.quizTaken).toBe(true);
    expect(record?.quizScore).toBe(3);
    expect(record?.readSeconds).toBe(70);
  });

  it('overrides a seed-date record when the same date is logged locally', async () => {
    await logActivity({ date: '2026-06-29', readSeconds: 1, quizTaken: false });

    const records = await getActivity();
    const matching = records.filter((r) => r.date === '2026-06-29');
    expect(matching).toHaveLength(1);
  });

  it('falls back gracefully when localStorage contains invalid JSON', async () => {
    window.localStorage.setItem('ckp.activity.v1', 'not json');
    const records = await getActivity();
    expect(Array.isArray(records)).toBe(true);
  });
});
