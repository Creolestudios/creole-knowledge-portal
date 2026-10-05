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

  it('does NOT count natural eye blinks as gaze_away or eye movement deviation', () => {
    const landmarks = createMockLandmarks();
    // Simulate candidate blinking naturally (high eyeBlink blendshapes)
    const blendshapes = [
      { categoryName: 'eyeBlinkLeft', score: 0.9 },
      { categoryName: 'eyeBlinkRight', score: 0.9 },
      { categoryName: 'eyeLookOutLeft', score: 0.6 }, // blendshape artifact during lid closure
    ];
    const identityMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];

    const result = analyzeFaceMetrics(landmarks, blendshapes, identityMatrix);
    expect(result.eyesClosed).toBe(true);
    expect(result.lookingAway).toBe(false);
    expect(result.readingSuspected).toBe(false);
    expect(result.category).toBe('none');
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

    it('enforces a category break between different face conditions (gaze_away then no_face)', () => {
      const tracker = new ProctoringTimeTracker();
      const gazeAwayResult: ExtendedFaceTrackingResult = {
        facePresent: true,
        eyesClosed: false,
        lookingAway: true,
        headTurnedAway: false,
        eyeConfidence: 0.9,
        alert: 'warning',
        numFaces: 1,
        multiFaceDetected: false,
        readingSuspected: false,
        mouthMoving: false,
        relativeYaw: 0,
        relativePitch: 0,
        irisRatioOffset: 0.25,
        expression: { smileScore: 0, stressScore: 0, eyeContactPct: 0, blinkRate: 0 },
        category: 'gaze_away',
      };

      const noFaceResult: ExtendedFaceTrackingResult = {
        facePresent: false,
        eyesClosed: false,
        lookingAway: false,
        headTurnedAway: false,
        eyeConfidence: 0,
        alert: 'error',
        numFaces: 0,
        multiFaceDetected: false,
        readingSuspected: false,
        mouthMoving: false,
        relativeYaw: 0,
        relativePitch: 0,
        irisRatioOffset: 0,
        expression: { smileScore: 0, stressScore: 0, eyeContactPct: 0, blinkRate: 0 },
        category: 'no_face',
      };

      // 1. Trigger gaze_away warning at 2000ms
      tracker.processResult(gazeAwayResult, 1000, { gazeAwayThresholdMs: 1000, debounceMs: 5000 });
      const status1 = tracker.processResult(gazeAwayResult, 2001, { gazeAwayThresholdMs: 1000, debounceMs: 5000 });
      expect(status1.shouldTriggerWarning).toBe(true);
      expect(status1.warningCount).toBe(1);

      // 2. Candidate changes posture 1 second later (3000ms) resulting in no_face.
      // Even though no_face is a different subcategory, it is the SAME 'face' category and must take a break.
      tracker.processResult(noFaceResult, 3000, { noFaceThresholdMs: 500, debounceMs: 5000 });
      const status2 = tracker.processResult(noFaceResult, 4000, { noFaceThresholdMs: 500, debounceMs: 5000 });
      expect(status2.shouldTriggerWarning).toBe(false);
      expect(status2.warningCount).toBe(1);

      // 3. After 5000ms category break has elapsed (2001 + 5000 = 7001ms), a sustained violation can fire
      const status3 = tracker.processResult(noFaceResult, 7500, { noFaceThresholdMs: 500, debounceMs: 5000 });
      expect(status3.shouldTriggerWarning).toBe(true);
      expect(status3.warningCount).toBe(2);
    });

    it('enforces a category break between different objects in object detection (cell phone then remote)', () => {
      const tracker = new ProctoringTimeTracker();

      // 1. Phone detected and triggers warning #1 at t = 1000ms
      const status1 = tracker.processGenericEvent(
        'object_detected',
        'cell phone',
        'Unauthorized object detected in camera view.',
        0,
        5000,
        1000,
      );
      expect(status1.shouldTriggerWarning).toBe(true);
      expect(status1.warningCount).toBe(1);

      // 2. 1 second later (t = 2000ms), model classifies object as 'remote'
      // Because 'object' is in its 5000ms break, NO warning should trigger!
      const status2 = tracker.processGenericEvent(
        'object_detected',
        'remote',
        'Unauthorized object detected in camera view.',
        0,
        5000,
        2000,
      );
      expect(status2.shouldTriggerWarning).toBe(false);
      expect(status2.warningCount).toBe(1);

      // 3. 3 seconds later (t = 4000ms), candidate holds 'book'
      const status3 = tracker.processGenericEvent(
        'object_detected',
        'book',
        'Unauthorized object detected in camera view.',
        0,
        5000,
        4000,
      );
      expect(status3.shouldTriggerWarning).toBe(false);
      expect(status3.warningCount).toBe(1);

      // 4. After 5000ms break has passed (t = 6001ms), another object warning CAN trigger
      const status4 = tracker.processGenericEvent(
        'object_detected',
        'book',
        'Unauthorized object detected in camera view.',
        0,
        5000,
        6001,
      );
      expect(status4.shouldTriggerWarning).toBe(true);
      expect(status4.warningCount).toBe(2);
    });

    it('enforces voice break and allows independent alerts across categories up to 3 strikes', () => {
      const tracker = new ProctoringTimeTracker();

      // 1. Voice alert at 1000ms
      const v1 = tracker.processGenericEvent('unauthorized_voice', 'voice', 'Background voice', 0, 10000, 1000);
      expect(v1.shouldTriggerWarning).toBe(true);
      expect(v1.warningCount).toBe(1);

      // 2. Voice alert 4 seconds later (5000ms) blocked by 10s voice cooldown break
      const v2 = tracker.processGenericEvent('unauthorized_voice', 'voice', 'Background voice', 0, 10000, 5000);
      expect(v2.shouldTriggerWarning).toBe(false);
      expect(v2.warningCount).toBe(1);

      // 3. Different category (object) can trigger its own first warning
      const o1 = tracker.processGenericEvent('object_detected', 'phone', 'Unauthorized object', 0, 5000, 5500);
      expect(o1.shouldTriggerWarning).toBe(true);
      expect(o1.warningCount).toBe(2);

      // 4. Another object at 7000ms blocked by 5s object break
      const o2 = tracker.processGenericEvent('object_detected', 'remote', 'Unauthorized object', 0, 5000, 7000);
      expect(o2.shouldTriggerWarning).toBe(false);
      expect(o2.warningCount).toBe(2);

      // 5. Face alert at 8000ms triggers strike 3
      const mockResult = analyzeFaceMetrics(undefined, [], []);
      tracker.processResult(mockResult, 7000, { noFaceThresholdMs: 1000 });
      const f1 = tracker.processResult(mockResult, 8100, { noFaceThresholdMs: 1000 });
      expect(f1.shouldTriggerWarning).toBe(true);
      expect(f1.warningCount).toBe(3);

      // 6. Any further event across any category is blocked at max 3 warnings
      const f2 = tracker.processResult(mockResult, 20000, { noFaceThresholdMs: 1000 });
      expect(f2.shouldTriggerWarning).toBe(false);
      expect(f2.warningCount).toBe(3);

      const counts = tracker.getWarningCounts();
      expect(counts.voice).toBe(1);
      expect(counts.object).toBe(1);
      expect(counts.face).toBe(1);
      expect(counts.total).toBe(3);
    });
  });
});
