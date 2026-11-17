export * from './pr-types';

export function extractPrUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/gi);
  return matches ? Array.from(new Set(matches)) : [];
}

export async function batchVerifyPrUrls(
  _prUrls: string[],
  _expectedAuthor?: string
): Promise<import('./pr-types').PullRequestEvidence[]> {
  return [];
}
