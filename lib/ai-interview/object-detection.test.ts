import { describe, it, expect } from 'vitest';
import { filterTrackedObjects, OBJECT_RULES } from './object-detection';

describe('object-detection module', () => {
  it('defines rules for key unauthorized proctoring objects', () => {
    expect(OBJECT_RULES['cell phone']).toBeDefined();
    expect(OBJECT_RULES['cell phone'].object).toBe('phone');
    expect(OBJECT_RULES['cell phone'].thresholdMs).toBe(0);

    expect(OBJECT_RULES.headphones).toBeDefined();
    expect(OBJECT_RULES.headphones.object).toBe('earbuds');

    expect(OBJECT_RULES.book).toBeDefined();
    expect(OBJECT_RULES.book.object).toBe('book');

    expect(OBJECT_RULES.laptop).toBeDefined();
    expect(OBJECT_RULES.tv).toBeDefined();
    expect(OBJECT_RULES.remote).toBeDefined();
  });

  it('filters out untracked objects like person, chair, cup', () => {
    const rawDetections = [
      { class: 'person', score: 0.95, bbox: [0, 0, 100, 100] as [number, number, number, number] },
      { class: 'chair', score: 0.85, bbox: [10, 10, 50, 50] as [number, number, number, number] },
      { class: 'cup', score: 0.75, bbox: [20, 20, 30, 30] as [number, number, number, number] },
    ];

    const results = filterTrackedObjects(rawDetections);
    expect(results).toHaveLength(0);
  });

  it('detects tracked objects above minimum confidence and filters below', () => {
    const rawDetections = [
      { class: 'cell phone', score: 0.52, bbox: [100, 120, 80, 140] as [number, number, number, number] },
      { class: 'book', score: 0.45, bbox: [50, 80, 120, 90] as [number, number, number, number] },
      { class: 'remote', score: 0.10, bbox: [10, 20, 30, 40] as [number, number, number, number] }, // Below threshold
    ];

    const results = filterTrackedObjects(rawDetections);
    expect(results).toHaveLength(2);
    expect(results[0].label).toBe('cell phone');
    expect(results[0].rule?.object).toBe('phone');
    expect(results[1].label).toBe('book');
    expect(results[1].rule?.object).toBe('book');
  });
});
