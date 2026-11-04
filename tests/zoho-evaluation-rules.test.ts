import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockRequireAdminUser = vi.fn().mockResolvedValue({ userId: 'admin-123' });

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
  requireAdminUser: () => mockRequireAdminUser(),
}));

import {
  DEFAULT_ZOHO_RULES,
  getZohoEvaluationRules,
  saveZohoEvaluationRules,
  type ZohoEvaluationRulesConfig,
} from '@/lib/zoho/rules-store';
import {
  calculateTimeAdherence,
  computeCompositeTaskScore,
} from '@/lib/zoho/heuristics';
import { GET, POST } from '@/app/api/admin/zoho/rules/route';

describe('Global Zoho Evaluation Rules Engine', () => {
  it('provides sensible default criteria values', () => {
    expect(DEFAULT_ZOHO_RULES.nonQAReviewDeduction).toBe(1.0);
    expect(DEFAULT_ZOHO_RULES.overtimeGraceMinutes).toBe(5);
    expect(DEFAULT_ZOHO_RULES.overtimeBreachDeduction).toBe(2.0);
    expect(DEFAULT_ZOHO_RULES.earlyCompletionBufferMinutes).toBe(15);
    expect(DEFAULT_ZOHO_RULES.earlyGapDeduction).toBe(2.0);
    expect(DEFAULT_ZOHO_RULES.workMatchWeight).toBe(0.45);
    expect(DEFAULT_ZOHO_RULES.timeAdherenceWeight).toBe(0.35);
    expect(DEFAULT_ZOHO_RULES.complexityWeight).toBe(0.10);
    expect(DEFAULT_ZOHO_RULES.repetitionWeight).toBe(0.10);
  });

  it('computes composite task score with default rules (1.0 deduction for non-QA review)', () => {
    const scoreInQA = computeCompositeTaskScore({
      timeScore: 10,
      commentQualityScore: 10,
      complexityScore: 8,
      repetitionScore: 10,
      isQAReview: true,
    });
    // (10 * 0.45) + (10 * 0.35) + (8 * 0.10) + (10 * 0.10) = 4.5 + 3.5 + 0.8 + 1.0 = 9.8
    expect(scoreInQA).toBe(9.8);

    const scoreNotInQA = computeCompositeTaskScore({
      timeScore: 10,
      commentQualityScore: 10,
      complexityScore: 8,
      repetitionScore: 10,
      isQAReview: false,
    });
    // 9.8 - 1.0 = 8.8
    expect(scoreNotInQA).toBe(8.8);
  });

  it('computes composite task score with custom admin rules (e.g. 0.5 deduction)', () => {
    const customRules: Partial<ZohoEvaluationRulesConfig> = {
      nonQAReviewDeduction: 0.5,
    };

    const scoreNotInQA = computeCompositeTaskScore({
      timeScore: 10,
      commentQualityScore: 10,
      complexityScore: 8,
      repetitionScore: 10,
      isQAReview: false,
      rules: customRules,
    });
    // 9.8 - 0.5 = 9.3
    expect(scoreNotInQA).toBe(9.3);
  });

  it('computes composite task score with custom weights (e.g. 60% work, 20% time)', () => {
    const customWeights: Partial<ZohoEvaluationRulesConfig> = {
      workMatchWeight: 0.60,
      timeAdherenceWeight: 0.20,
      complexityWeight: 0.10,
      repetitionWeight: 0.10,
      nonQAReviewDeduction: 1.0,
    };

    const scoreInQA = computeCompositeTaskScore({
      timeScore: 5,
      commentQualityScore: 10,
      complexityScore: 10,
      repetitionScore: 10,
      isQAReview: true,
      rules: customWeights,
    });
    // (10 * 0.60) + (5 * 0.20) + (10 * 0.10) + (10 * 0.10) = 6.0 + 1.0 + 1.0 + 1.0 = 9.0
    expect(scoreInQA).toBe(9.0);
  });

  it('applies custom overtime grace buffer and breach deduction in time adherence calculation', () => {
    // 240m planned, 250m actual (+10m overtime, 5m beyond default 5m buffer)
    const defaultAdh = calculateTimeAdherence(240, 250);
    expect(defaultAdh.assessmentLabel).toBe('OVERDUE');
    // Buffer breach penalty (10 - 2.0 = 8.0 minus scaled late ratio) = 7.8
    expect(defaultAdh.timeScore).toBe(7.8);

    // With custom buffer of 15m -> within grace buffer, full 10/10 awarded
    const customAdh = calculateTimeAdherence(240, 250, { overtimeGraceMinutes: 15 });
    expect(customAdh.timeScore).toBe(10);
    expect(customAdh.assessmentLabel).toBe('SLIGHT_OVERRUN_TOLERATED');

    // With custom breach deduction of 1.0 point instead of 2.0
    const customDed = calculateTimeAdherence(240, 250, { overtimeBreachDeduction: 1.0 });
    // Drops to max 9.0 instead of 8.0 -> 9.0 - 0.2 = 8.8
    expect(customDed.timeScore).toBe(8.8);
  });

  it('applies custom early completion buffer and early gap deduction in time adherence calculation', () => {
    // 240m planned, 215m actual (-25m early, 10m beyond default 15m buffer)
    const defaultAdh = calculateTimeAdherence(240, 215);
    expect(defaultAdh.assessmentLabel).toBe('UNEXPECTED_EARLY');
    // Buffer breach penalty (10 - 2.0 = 8.0 minus scaled early ratio) = 7.6
    expect(defaultAdh.timeScore).toBe(7.6);

    // With custom buffer of 30m -> within early buffer, full 10/10 awarded
    const customAdh = calculateTimeAdherence(240, 215, { earlyCompletionBufferMinutes: 30 });
    expect(customAdh.timeScore).toBe(10);
    expect(customAdh.assessmentLabel).toBe('ON_TIME');

    // With custom early gap deduction of 1.0 point instead of 2.0
    const customEarlyDed = calculateTimeAdherence(240, 215, { earlyGapDeduction: 1.0 });
    // Drops to max 9.0 instead of 8.0 -> 9.0 - 0.4 = 8.6
    expect(customEarlyDed.timeScore).toBe(8.6);
  });
});

describe('Admin Rules API Endpoint (/api/admin/zoho/rules)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/admin/zoho/rules returns current active rules with 200 OK', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toBeDefined();
    expect(body.rules.nonQAReviewDeduction).toBeDefined();
    expect(body.rules.workMatchWeight).toBeDefined();
  });

  it('POST /api/admin/zoho/rules updates criteria and persists successfully', async () => {
    const request = new Request('http://localhost:3000/api/admin/zoho/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: {
          nonQAReviewDeduction: 0.7,
          overtimeGraceMinutes: 8,
          overtimeBreachDeduction: 1.5,
          earlyGapDeduction: 1.5,
        },
      }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.rules.nonQAReviewDeduction).toBe(0.7);
    expect(body.rules.overtimeGraceMinutes).toBe(8);
    expect(body.rules.overtimeBreachDeduction).toBe(1.5);
    expect(body.rules.earlyGapDeduction).toBe(1.5);
  });

  it('POST /api/admin/zoho/rules normalizes percentage weights (e.g. 45 -> 0.45)', async () => {
    const request = new Request('http://localhost:3000/api/admin/zoho/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: {
          workMatchWeight: 50,
          timeAdherenceWeight: 30,
          complexityWeight: 10,
          repetitionWeight: 10,
        },
      }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.rules.workMatchWeight).toBe(0.5);
    expect(body.rules.timeAdherenceWeight).toBe(0.3);
  });

  it('POST /api/admin/zoho/rules resets criteria back to default when reset=true', async () => {
    const request = new Request('http://localhost:3000/api/admin/zoho/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reset: true }),
    });

    const res = await POST(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.rules.nonQAReviewDeduction).toBe(1.0);
    expect(body.rules.overtimeGraceMinutes).toBe(5);
  });
});
