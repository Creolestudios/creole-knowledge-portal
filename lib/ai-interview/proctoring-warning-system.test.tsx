// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { ProctoringTimeTracker, analyzeFaceMetrics } from './face-tracking';
import { filterTrackedObjects, GENERAL_UNAUTHORIZED_OBJECT_REASON } from './object-detection';

describe('AI Interview Proctoring Warning System - Complete Workflow', () => {
  describe('Global Warning Counter & 3-Strike Policy', () => {
    it('maintains strictly ONE global counter across voice, object, and face violations', () => {
      const tracker = new ProctoringTimeTracker();

      // 1. First violation: General Background Voice at t = 1000
      const voiceAlert = tracker.processGenericEvent(
        'unauthorized_voice',
        'voice',
        'Background voice detected. Please ensure that no other person or voice is present during the interview.',
        0,
        5000,
        1000,
      );
      expect(voiceAlert.shouldTriggerWarning).toBe(true);
      expect(voiceAlert.warningCount).toBe(1);
      expect(voiceAlert.reason).toContain('Background voice detected');

      // 2. Second violation: Prohibited Object at t = 6500 (after resume)
      const objectAlert = tracker.processGenericEvent(
        'object_detected',
        'cell phone',
        GENERAL_UNAUTHORIZED_OBJECT_REASON,
        0,
        5000,
        6500,
      );
      expect(objectAlert.shouldTriggerWarning).toBe(true);
      expect(objectAlert.warningCount).toBe(2);
      expect(objectAlert.reason).toBe(
        'Prohibited object detected. Please remove it from your surroundings before continuing.',
      );

      // 3. Third violation: Multiple Faces at t = 12000
      const mockMultiFace = analyzeFaceMetrics(
        Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 })),
        [],
        [],
        null,
        2,
      );
      expect(mockMultiFace.category).toBe('multi_face');

      // Sustain multi-face threshold (1000ms)
      tracker.processResult(mockMultiFace, 12000, { multiFaceThresholdMs: 500 });
      const faceAlert = tracker.processResult(mockMultiFace, 12600, { multiFaceThresholdMs: 500 });
      expect(faceAlert.shouldTriggerWarning).toBe(true);
      expect(faceAlert.warningCount).toBe(3);
      expect(faceAlert.reason).toBe(
        'Multiple faces detected. Please ensure that only you are present during the interview.',
      );

      // 4. Verify overall warning counts share the same global limit of 3
      const counts = tracker.getWarningCounts();
      expect(counts.voice).toBe(1);
      expect(counts.object).toBe(1);
      expect(counts.face).toBe(1);
      expect(counts.total).toBe(3);

      // 5. Subsequent violation is blocked at max 3 warnings
      const extraAlert = tracker.processGenericEvent('object_detected', 'laptop', 'test', 0, 5000, 20000);
      expect(extraAlert.shouldTriggerWarning).toBe(false);
      expect(extraAlert.warningCount).toBe(3);
    });

    it('re-triggers warning and increases counter when the same violation persists after resuming', () => {
      const tracker = new ProctoringTimeTracker();

      // Warning 1: Object detected at t = 1000
      const alert1 = tracker.processGenericEvent(
        'object_detected',
        'cell phone',
        GENERAL_UNAUTHORIZED_OBJECT_REASON,
        0,
        5000,
        1000,
      );
      expect(alert1.shouldTriggerWarning).toBe(true);
      expect(alert1.warningCount).toBe(1);

      // Candidate resumes at t = 3000, but same object is still present at t = 6500 (after 5s debounce)
      const alert2 = tracker.processGenericEvent(
        'object_detected',
        'cell phone',
        GENERAL_UNAUTHORIZED_OBJECT_REASON,
        0,
        5000,
        6500,
      );
      expect(alert2.shouldTriggerWarning).toBe(true);
      expect(alert2.warningCount).toBe(2);

      // Candidate resumes, object still present at t = 12000 -> Warning 3
      const alert3 = tracker.processGenericEvent(
        'object_detected',
        'cell phone',
        GENERAL_UNAUTHORIZED_OBJECT_REASON,
        0,
        5000,
        12000,
      );
      expect(alert3.shouldTriggerWarning).toBe(true);
      expect(alert3.warningCount).toBe(3);
    });
  });

  describe('Object Detection Specifications', () => {
    it('uses the generalized warning reason for every prohibited object', () => {
      expect(GENERAL_UNAUTHORIZED_OBJECT_REASON).toBe(
        'Prohibited object detected. Please remove it from your surroundings before continuing.',
      );

      const detections = [
        { class: 'person', score: 0.95, bbox: [0, 0, 100, 100] as [number, number, number, number] },
        { class: 'cell phone', score: 0.85, bbox: [10, 10, 50, 50] as [number, number, number, number] },
        { class: 'laptop', score: 0.80, bbox: [20, 20, 60, 60] as [number, number, number, number] },
        { class: 'book', score: 0.75, bbox: [30, 30, 40, 40] as [number, number, number, number] },
      ];

      const tracked = filterTrackedObjects(detections);
      expect(tracked).toHaveLength(3); // person filtered out
      for (const item of tracked) {
        expect(item.rule.reason).toBe(
          'Prohibited object detected. Please remove it from your surroundings before continuing.',
        );
        expect(item.rule.thresholdMs).toBe(0); // immediate trigger
      }
    });
  });

  describe('Face & Presence Detection Specifications', () => {
    it('generates the exact condition-specific warning message for each face condition', () => {
      const tracker = new ProctoringTimeTracker();

      // 1. No face
      const noFaceResult = analyzeFaceMetrics(undefined, [], []);
      tracker.processResult(noFaceResult, 1000, { noFaceThresholdMs: 500 });
      const noFaceAlert = tracker.processResult(noFaceResult, 1600, { noFaceThresholdMs: 500 });
      expect(noFaceAlert.shouldTriggerWarning).toBe(true);
      expect(noFaceAlert.reason).toBe(
        'Your face is not clearly visible. Please position yourself properly in front of the camera.',
      );

      // Reset for clean testing of other categories
      tracker.reset();

      // 2. Gaze away
      const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
      const gazeAwayResult = analyzeFaceMetrics(
        landmarks,
        [{ categoryName: 'eyeLookOutLeft', score: 0.8 }],
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      );
      tracker.processResult(gazeAwayResult, 1000, { gazeAwayThresholdMs: 500 });
      const gazeAlert = tracker.processResult(gazeAwayResult, 1600, { gazeAwayThresholdMs: 500 });
      expect(gazeAlert.shouldTriggerWarning).toBe(true);
      expect(gazeAlert.reason).toBe('Please keep your attention focused on the interview screen.');

      tracker.reset();

      // 3. Suspected reading off-screen
      const readingResult = analyzeFaceMetrics(
        landmarks,
        [
          { categoryName: 'eyeLookDownLeft', score: 0.85 },
          { categoryName: 'eyeLookDownRight', score: 0.85 },
        ],
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      );
      tracker.processResult(readingResult, 1000, { readingThresholdMs: 500 });
      const readingAlert = tracker.processResult(readingResult, 1600, { readingThresholdMs: 500 });
      expect(readingAlert.shouldTriggerWarning).toBe(true);
      expect(readingAlert.reason).toBe(
        'Please avoid looking away or reading from another source during the interview.',
      );

      tracker.reset();

      // 4. Framing issue
      const shiftedLandmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
      shiftedLandmarks[468] = { x: 0.4, y: 0.5 };
      shiftedLandmarks[473] = { x: 0.6, y: 0.5 };
      shiftedLandmarks[1] = { x: 0.05, y: 0.5 }; // Nose at extreme border (framing issue)
      const framingResult = analyzeFaceMetrics(
        shiftedLandmarks,
        [],
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      );
      expect(framingResult.category).toBe('framing_issue');
      tracker.processResult(framingResult, 1000, { framingThresholdMs: 500 });
      const framingAlert = tracker.processResult(framingResult, 1600, { framingThresholdMs: 500 });
      expect(framingAlert.shouldTriggerWarning).toBe(true);
      expect(framingAlert.reason).toBe('Please adjust your position so your face remains clearly visible.');
    });

    it('does NOT trigger violations for natural eye blinking or brief glances', () => {
      const tracker = new ProctoringTimeTracker();
      const blinkingLandmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
      const blinkingResult = analyzeFaceMetrics(
        blinkingLandmarks,
        [
          { categoryName: 'eyeBlinkLeft', score: 0.95 },
          { categoryName: 'eyeBlinkRight', score: 0.95 },
        ],
        [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      );

      expect(blinkingResult.category).toBe('none');
      const alert = tracker.processResult(blinkingResult, 1000);
      expect(alert.shouldTriggerWarning).toBe(false);
    });

    it('clears in-flight violation accumulation when clearActiveViolations is invoked on resume', () => {
      const tracker = new ProctoringTimeTracker();
      const noFaceResult = analyzeFaceMetrics(undefined, [], []);

      // Start accumulating no_face at t = 1000 with a 1500ms threshold
      tracker.processResult(noFaceResult, 1000, { noFaceThresholdMs: 1500 });
      // At t = 2000 (1000ms elapsed), still no trigger
      const alertBefore = tracker.processResult(noFaceResult, 2000, { noFaceThresholdMs: 1500 });
      expect(alertBefore.shouldTriggerWarning).toBe(false);

      // Candidate resumes: clear active in-flight violations
      tracker.clearActiveViolations();

      // At t = 2100 (only 100ms elapsed after clear), it should NOT trigger immediately
      const alertAfterResume = tracker.processResult(noFaceResult, 2100, { noFaceThresholdMs: 1500 });
      expect(alertAfterResume.shouldTriggerWarning).toBe(false);

      // Must accumulate full 1500ms from t = 2100 (i.e. at or after t = 3600)
      const alertFinal = tracker.processResult(noFaceResult, 3600, { noFaceThresholdMs: 1500 });
      expect(alertFinal.shouldTriggerWarning).toBe(true);
      expect(alertFinal.warningCount).toBe(1);
    });
  });
});

