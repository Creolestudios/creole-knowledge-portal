import { describe, it, expect } from 'vitest';
import { filterTrackedObjects, OBJECT_RULES } from './object-detection';
import { ProctoringTimeTracker } from './face-tracking';

describe('object-detection module', () => {
  it('defines rules for key unauthorized proctoring objects dynamically', () => {
    expect(OBJECT_RULES['cell phone']).toBeDefined();
    expect(OBJECT_RULES['cell phone'].object).toBe('cell phone');
    expect(OBJECT_RULES['cell phone'].thresholdMs).toBe(0);

    expect(OBJECT_RULES.headphones).toBeDefined();
    expect(OBJECT_RULES.headphones.object).toBe('headphones');

    expect(OBJECT_RULES.book).toBeDefined();
    expect(OBJECT_RULES.book.object).toBe('book');

    expect(OBJECT_RULES.laptop).toBeDefined();
    expect(OBJECT_RULES.tv).toBeDefined();
    expect(OBJECT_RULES.remote).toBeDefined();
  });

  it('allows only the user body (person) and flags any other detected object (chair, cup, pen, phone, etc.) as unauthorized', () => {
    const rawDetections = [
      { class: 'person', score: 0.95, bbox: [0, 0, 100, 100] as [number, number, number, number] },
      { class: 'chair', score: 0.85, bbox: [10, 10, 50, 50] as [number, number, number, number] },
      { class: 'cup', score: 0.75, bbox: [20, 20, 30, 30] as [number, number, number, number] },
      { class: 'pen', score: 0.80, bbox: [15, 15, 25, 25] as [number, number, number, number] },
    ];

    const results = filterTrackedObjects(rawDetections);
    expect(results).toHaveLength(3); // chair, cup, pen (only person excluded)
    expect(results[0].label).toBe('chair');
    expect(results[0].rule.reason).toBe('Unauthorized object detected in camera view.');
    expect(results[1].label).toBe('cup');
    expect(results[1].rule.reason).toBe('Unauthorized object detected in camera view.');
    expect(results[2].label).toBe('pen');
    expect(results[2].rule.reason).toBe('Unauthorized object detected in camera view.');
  });

  it('detects tracked objects at calibrated responsive confidence', () => {
    const rawDetections = [
      { class: 'cell phone', score: 0.35, bbox: [100, 120, 80, 140] as [number, number, number, number] },
      { class: 'book', score: 0.30, bbox: [50, 80, 120, 90] as [number, number, number, number] },
      { class: 'remote', score: 0.10, bbox: [10, 20, 30, 40] as [number, number, number, number] }, // Below threshold
    ];

    const results = filterTrackedObjects(rawDetections);
    expect(results).toHaveLength(2);
    expect(results[0].label).toBe('cell phone');
    expect(results[0].rule?.object).toBe('cell phone');
    expect(results[0].rule?.reason).toContain('Unauthorized object detected');
    expect(results[1].label).toBe('book');
    expect(results[1].rule?.object).toBe('book');
    expect(results[1].rule?.reason).toContain('Unauthorized object detected');
  });

  it('enforces thresholdMs === 0 for immediate proctoring alert triggers', () => {
    for (const [key, rule] of Object.entries(OBJECT_RULES)) {
      expect(rule.thresholdMs, `Expected ${key} thresholdMs to be 0 for instant warning`).toBe(0);
    }
  });

  it('triggers proctoring warning immediately on first detection frame with generalized reason', () => {
    const tracker = new ProctoringTimeTracker();
    const phoneRule = OBJECT_RULES['cell phone'];
    const now = Date.now();

    const result = tracker.processGenericEvent(
      phoneRule.category,
      phoneRule.object,
      phoneRule.reason,
      phoneRule.thresholdMs, // 0ms
      5000,
      now,
    );

    expect(result.shouldTriggerWarning).toBe(true);
    expect(result.warningCount).toBe(1);
    expect(result.reason).toBe('Unauthorized object detected in camera view.');
  });
});

