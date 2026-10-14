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

  it('flags major cheating objects (phone, books, earphones, pens, paper, laptop) while ignoring chairs, clocks, watches, and cups', () => {
    const rawDetections = [
      { class: 'person', score: 0.95, bbox: [0, 0, 100, 100] as [number, number, number, number] },
      { class: 'chair', score: 0.85, bbox: [10, 10, 50, 50] as [number, number, number, number] }, // Ignored
      { class: 'clock', score: 0.90, bbox: [5, 5, 20, 20] as [number, number, number, number] }, // Ignored
      { class: 'watch', score: 0.80, bbox: [12, 12, 15, 15] as [number, number, number, number] }, // Ignored
      { class: 'cup', score: 0.75, bbox: [20, 20, 30, 30] as [number, number, number, number] }, // Ignored
      { class: 'pen', score: 0.80, bbox: [15, 15, 25, 25] as [number, number, number, number] }, // Flagged
      { class: 'cell phone', score: 0.85, bbox: [30, 30, 40, 40] as [number, number, number, number] }, // Flagged
      { class: 'book', score: 0.88, bbox: [40, 40, 60, 60] as [number, number, number, number] }, // Flagged
      { class: 'paper', score: 0.70, bbox: [50, 50, 70, 70] as [number, number, number, number] }, // Flagged
      { class: 'earphones', score: 0.78, bbox: [60, 60, 30, 30] as [number, number, number, number] }, // Flagged
    ];

    const results = filterTrackedObjects(rawDetections);
    expect(results).toHaveLength(5); // pen, cell phone, book, paper, earphones
    const labels = results.map((r) => r.label);
    expect(labels).toContain('pen');
    expect(labels).toContain('cell phone');
    expect(labels).toContain('book');
    expect(labels).toContain('paper');
    expect(labels).toContain('earphones');

    expect(labels).not.toContain('chair');
    expect(labels).not.toContain('clock');
    expect(labels).not.toContain('watch');
    expect(labels).not.toContain('cup');
    expect(labels).not.toContain('person');

    for (const r of results) {
      expect(r.rule.reason).toBe(
        'Prohibited object detected. Please remove it from your surroundings before continuing.',
      );
    }
  });

  it('detects cheating objects (calculator, keyboard, mouse, laptop, headphones) and strictly ignores environmental items (mug, sofa, couch, bottle, table)', () => {
    const rawDetections = [
      { class: 'person', score: 0.95, bbox: [0, 0, 100, 100] as [number, number, number, number] }, // Candidate
      { class: 'mug', score: 0.85, bbox: [10, 10, 20, 20] as [number, number, number, number] }, // Environmental -> Ignore
      { class: 'sofa', score: 0.90, bbox: [20, 20, 150, 150] as [number, number, number, number] }, // Environmental -> Ignore
      { class: 'couch', score: 0.80, bbox: [30, 30, 120, 120] as [number, number, number, number] }, // Environmental -> Ignore
      { class: 'bottle', score: 0.85, bbox: [40, 40, 30, 80] as [number, number, number, number] }, // Environmental -> Ignore
      { class: 'table', score: 0.88, bbox: [50, 50, 200, 100] as [number, number, number, number] }, // Environmental -> Ignore
      { class: 'calculator', score: 0.82, bbox: [60, 60, 40, 60] as [number, number, number, number] }, // Cheating -> Detect
      { class: 'keyboard', score: 0.85, bbox: [70, 70, 120, 40] as [number, number, number, number] }, // Cheating -> Detect
      { class: 'mouse', score: 0.78, bbox: [80, 80, 30, 40] as [number, number, number, number] }, // Cheating -> Detect
      { class: 'laptop', score: 0.92, bbox: [90, 90, 140, 100] as [number, number, number, number] }, // Cheating -> Detect
      { class: 'headphones', score: 0.89, bbox: [100, 100, 50, 50] as [number, number, number, number] }, // Cheating -> Detect
    ];

    const results = filterTrackedObjects(rawDetections);
    expect(results).toHaveLength(5); // calculator, keyboard, mouse, laptop, headphones
    const labels = results.map((r) => r.label);
    expect(labels).toContain('calculator');
    expect(labels).toContain('keyboard');
    expect(labels).toContain('mouse');
    expect(labels).toContain('laptop');
    expect(labels).toContain('headphones');

    expect(labels).not.toContain('mug');
    expect(labels).not.toContain('sofa');
    expect(labels).not.toContain('couch');
    expect(labels).not.toContain('bottle');
    expect(labels).not.toContain('table');
    expect(labels).not.toContain('person');
  });

  it('selectively ignores headphones when allowHeadphones is enabled, but still detects other cheating objects', () => {
    const rawDetections = [
      { class: 'person', score: 0.95, bbox: [0, 0, 100, 100] as [number, number, number, number] },
      { class: 'headphones', score: 0.88, bbox: [20, 20, 50, 50] as [number, number, number, number] },
      { class: 'earphones', score: 0.82, bbox: [30, 30, 40, 40] as [number, number, number, number] },
      { class: 'cell phone', score: 0.91, bbox: [50, 50, 60, 60] as [number, number, number, number] },
      { class: 'laptop', score: 0.85, bbox: [70, 70, 100, 80] as [number, number, number, number] },
    ];

    // When candidate uses Bluetooth/headset audio (allowHeadphones: true)
    const results = filterTrackedObjects(rawDetections, { allowHeadphones: true });
    expect(results).toHaveLength(2); // cell phone and laptop
    const labels = results.map((r) => r.label);
    expect(labels).toContain('cell phone');
    expect(labels).toContain('laptop');
    expect(labels).not.toContain('headphones');
    expect(labels).not.toContain('earphones');
  });

  it('flags when another person is detected in the camera frame along with candidate', () => {
    const rawDetections = [
      { class: 'person', score: 0.95, bbox: [0, 0, 100, 100] as [number, number, number, number] }, // Candidate
      { class: 'person', score: 0.88, bbox: [120, 0, 100, 100] as [number, number, number, number] }, // Second person!
    ];

    const results = filterTrackedObjects(rawDetections);
    expect(results).toHaveLength(1);
    expect(results[0].label).toBe('second person');
    expect(results[0].rule.object).toBe('multiple_persons');
    expect(results[0].rule.reason).toBe(
      'Multiple persons detected in camera view. Please ensure that only you are present during the interview.',
    );
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
    expect(results[0].rule?.reason).toContain('Prohibited object detected');
    expect(results[1].label).toBe('book');
    expect(results[1].rule?.object).toBe('book');
    expect(results[1].rule?.reason).toContain('Prohibited object detected');
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
    expect(result.reason).toBe(
      'Prohibited object detected. Please remove it from your surroundings before continuing.',
    );
  });

  it('triggers on single frame immediately without requiring multiple consecutive frames', () => {
    const rawDetections = [
      { class: 'cell phone', score: 0.25, bbox: [50, 50, 100, 150] as [number, number, number, number] },
    ];
    const filtered = filterTrackedObjects(rawDetections);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].label).toBe('cell phone');
    expect(filtered[0].rule.thresholdMs).toBe(0);

    const tracker = new ProctoringTimeTracker();
    const event = tracker.processGenericEvent(
      filtered[0].rule.category,
      filtered[0].rule.object,
      filtered[0].rule.reason,
      filtered[0].rule.thresholdMs,
      5000,
      Date.now(),
    );
    expect(event.shouldTriggerWarning).toBe(true);
    expect(event.warningCount).toBe(1);
  });
});

