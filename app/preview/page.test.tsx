import { describe, it, expect, vi } from 'vitest';

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: (...args: unknown[]) => notFound(...args),
}));

describe('PreviewPage', () => {
  it('calls notFound because the unauthenticated preview is disabled', async () => {
    const { default: PreviewPage } = await import('./page');
    expect(() => PreviewPage()).toThrow(/NEXT_NOT_FOUND/);
    expect(notFound).toHaveBeenCalled();
  });
});
