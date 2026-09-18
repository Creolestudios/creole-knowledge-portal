import { describe, expect, it } from 'vitest';
import {
  analyzeFaceMetrics,
  CandidateBaseline,
  computeIrisRatio,
  getHeadYaw,
  ProctoringTimeTracker,
} from './face-tracking';

const createMockLandmarks = () => {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  landmarks[468] = { x: 0.4, y: 0.5 };
  landmarks[473] = { x: 0.6, y: 0.5 };
  return landmarks;
};

describe('face-tracking module', () => {
  it('computes head yaw and pitch correctly from a transformation matrix', () => {
    const identityMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const { yaw, pitch } = getHeadYaw(identityMatrix);
    expect(yaw).toBe(0);
    expect(pitch).toBe(0);
  });

  it('calculates iris ratios correctly from landmark points', () => {
    const mockLandmarks = createMockLandmarks();
    mockLandmarks[33] = { x: 0.3, y: 0.5 };
    mockLandmarks[133] = { x: 0.5, y: 0.5 };
    mockLandmarks[468] = { x: 0.4, y: 0.5 };

    const ratios = computeIrisRatio(mockLandmarks);
    expect(ratios.leftIrisRatio.x).toBeCloseTo(0.5);
  });

  it('detects no face present when landmarks array is empty or undefined', () => {
    const result = analyzeFaceMetrics(undefined, [], []);
    expect(result.facePresent).toBe(false);
    expect(result.alert).toBe('error');
    expect(result.category).toBe('no_face');
  });

  it('detects head turned away using relative yaw and pitch', () => {
    const landmarks = createMockLandmarks();
    const matrix = [
      0.866, 0, 0.5, 0,
      0, 1, 0, 0,
      -0.5, 0, 0.866, 0,
      0, 0, 0, 1,
    ];

    const baseline: CandidateBaseline = {
      yaw: 0,
      pitch: 0,
      leftIrisRatio: { x: 0.5, y: 0.5 },
      rightIrisRatio: { x: 0.5, y: 0.5 },
    };

    const result = analyzeFaceMetrics(landmarks, [], matrix, baseline);
    expect(result.headTurnedAway).toBe(true);
    expect(result.alert).toBe('warning');
    expect(result.category).toBe('gaze_away');
  });

  it('detects multi-face condition when 2 faces are reported', () => {
    const landmarks = createMockLandmarks();
    const result = analyzeFaceMetrics(landmarks, [], [], null, 2);

    expect(result.multiFaceDetected).toBe(true);
    expect(result.numFaces).toBe(2);
    expect(result.category).toBe('multi_face');
  });

  it('detects reading_suspected when lookDown blendshape is high', () => {
    const landmarks = createMockLandmarks();
    const blendshapes = [
      { categoryName: 'eyeLookDownLeft', score: 0.8 },
      { categoryName: 'eyeLookDownRight', score: 0.8 },
    ];
    const identityMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];

    const result = analyzeFaceMetrics(landmarks, blendshapes, identityMatrix);
    expect(result.readingSuspected).toBe(true);
    expect(result.category).toBe('reading_suspected');
  });

  describe('ProctoringTimeTracker', () => {
    it('requires sustained violation duration before triggering warning', () => {
      const tracker = new ProctoringTimeTracker();
      const mockResult = analyzeFaceMetrics(undefined, [], []);

      let status = tracker.processResult(mockResult, 1000, { noFaceThresholdMs: 3000 });
      expect(status.shouldTriggerWarning).toBe(false);

      status = tracker.processResult(mockResult, 3000, { noFaceThresholdMs: 3000 });
      expect(status.shouldTriggerWarning).toBe(false);

      status = tracker.processResult(mockResult, 4001, { noFaceThresholdMs: 3000 });
      expect(status.shouldTriggerWarning).toBe(true);
      expect(status.warningCount).toBe(1);
    });

    it('debounces warnings of the same category within debounce window', () => {
      const tracker = new ProctoringTimeTracker();
      const mockResult = analyzeFaceMetrics(undefined, [], []);

      let status = tracker.processResult(mockResult, 1000, { noFaceThresholdMs: 3000 });
      status = tracker.processResult(mockResult, 4001, { noFaceThresholdMs: 3000, debounceMs: 20000 });
      expect(status.shouldTriggerWarning).toBe(true);
      expect(status.warningCount).toBe(1);

      status = tracker.processResult(mockResult, 10000, { noFaceThresholdMs: 3000, debounceMs: 20000 });
      expect(status.shouldTriggerWarning).toBe(false);
      expect(status.warningCount).toBe(1);

      status = tracker.processResult(mockResult, 25000, { noFaceThresholdMs: 3000, debounceMs: 20000 });
      expect(status.shouldTriggerWarning).toBe(true);
      expect(status.warningCount).toBe(2);
    });
  });
});
