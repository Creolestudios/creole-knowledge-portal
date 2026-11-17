export interface PullRequestEvidence {
  url: string;
  prNumber: number;
  verificationStatus: 'VERIFIED' | 'COWORKER_PR' | 'EMPTY_PR' | 'FAILED_TO_VERIFY' | 'UNVERIFIED';
  authorLogin?: string;
  userCommitCount?: number;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}
