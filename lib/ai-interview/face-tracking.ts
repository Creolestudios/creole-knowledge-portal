export type FaceTrackingAlert = 'stable' | 'warning' | 'error';

export type CandidateBaseline = {
  yaw: number;
  pitch: number;
  leftIrisRatio: { x: number; y: number };
  rightIrisRatio: { x: number; y: number };
};

export type ExpressionMetrics = {
  smileScore: number;
  stressScore: number;
  eyeContactPct: number;
  blinkRate: number;
};

export type FaceTrackingResult = {
  facePresent: boolean;
  eyesClosed: boolean;
  lookingAway: boolean;
  headTurnedAway: boolean;
  eyeConfidence: number;
  alert: FaceTrackingAlert;
};

export type ExtendedFaceTrackingResult = FaceTrackingResult & {
  numFaces: number;
  multiFaceDetected: boolean;
  readingSuspected: boolean;
  mouthMoving: boolean;
  relativeYaw: number;
  relativePitch: number;
  irisRatioOffset: number;
  expression: ExpressionMetrics;
  category: 'gaze_away' | 'reading_suspected' | 'no_face' | 'multi_face' | 'framing_issue' | 'none';
};

const toScore = (categories: Array<{ categoryName?: string; score?: number }>, names: string[]) => {
  const value = categories.find((category) => names.includes(category.categoryName ?? ''));
  return Number.isFinite(value?.score) ? Number(value?.score ?? 0) : 0;
};

export const getHeadYaw = (matrix: number[]) => {
  if (matrix.length < 16) return { yaw: 0, pitch: 0 };

  const yawVal = Math.atan2(matrix[2] ?? 0, matrix[10] ?? 1) * (180 / Math.PI);
  const pitchVal = Math.atan2(-(matrix[8] ?? 0), Math.sqrt((matrix[9] ?? 0) ** 2 + (matrix[10] ?? 0) ** 2)) * (180 / Math.PI);

  const yaw = Math.abs(yawVal) < 1e-6 ? 0 : yawVal;
  const pitch = Math.abs(pitchVal) < 1e-6 ? 0 : pitchVal;

  return { yaw, pitch };
};

export const computeIrisRatio = (
  landmarks: Array<{ x: number; y: number }> | undefined,
) => {
  if (!landmarks || landmarks.length < 478) {
    return {
      leftIrisRatio: { x: 0.5, y: 0.5 },
      rightIrisRatio: { x: 0.5, y: 0.5 },
    };
  }

  // Left Eye: outer = 33, inner = 133, iris = 468
  const leftOuter = landmarks[33];
  const leftInner = landmarks[133];
  const leftIris = landmarks[468];

  // Right Eye: inner = 362, outer = 263, iris = 473
  const rightInner = landmarks[362];
  const rightOuter = landmarks[263];
  const rightIris = landmarks[473];

  const calculateRatio = (outer?: { x: number; y: number }, inner?: { x: number; y: number }, iris?: { x: number; y: number }) => {
    if (!outer || !inner || !iris) return { x: 0.5, y: 0.5 };
    const dx = inner.x - outer.x;
    const dy = inner.y - outer.y;
    const dist = Math.hypot(dx, dy) || 1;
    const rx = (iris.x - outer.x) / (dx || 1);
    const ry = (iris.y - outer.y) / (dist || 1);
    return {
      x: clamp(rx, 0, 1),
      y: clamp(ry, 0, 1),
    };
  };

  return {
    leftIrisRatio: calculateRatio(leftOuter, leftInner, leftIris),
    rightIrisRatio: calculateRatio(rightOuter, rightInner, rightIris),
  };
};

export function analyzeFaceMetrics(
  landmarks: Array<{ x: number; y: number }> | undefined,
  blendshapes: Array<{ categoryName?: string; score?: number }> | undefined,
  matrix: number[] | undefined,
  baseline?: CandidateBaseline | null,
  numDetectedFaces: number = 1,
): ExtendedFaceTrackingResult {
  const facePresent = Boolean(landmarks && landmarks.length > 0);
  const numFaces = facePresent ? Math.max(1, numDetectedFaces) : 0;
  const multiFaceDetected = numFaces >= 2;

  const leftEye = landmarks?.[468] ?? null;
  const rightEye = landmarks?.[473] ?? null;
  const leftBlink = toScore(blendshapes ?? [], ['eyeBlinkLeft']);
  const rightBlink = toScore(blendshapes ?? [], ['eyeBlinkRight']);
  const lookLeft = toScore(blendshapes ?? [], ['eyeLookOutLeft', 'eyeLookInLeft']);
  const lookRight = toScore(blendshapes ?? [], ['eyeLookOutRight', 'eyeLookInRight']);
  const lookUp = toScore(blendshapes ?? [], ['eyeLookUpLeft', 'eyeLookUpRight']);
  const lookDown = toScore(blendshapes ?? [], ['eyeLookDownLeft', 'eyeLookDownRight']);

  // Blendshapes for expression scoring
  const smileLeft = toScore(blendshapes ?? [], ['mouthSmileLeft']);
  const smileRight = toScore(blendshapes ?? [], ['mouthSmileRight']);
  const browDownLeft = toScore(blendshapes ?? [], ['browDownLeft']);
  const browDownRight = toScore(blendshapes ?? [], ['browDownRight']);
  const mouthPressLeft = toScore(blendshapes ?? [], ['mouthPressLeft']);
  const mouthPressRight = toScore(blendshapes ?? [], ['mouthPressRight']);

  const smileScore = (smileLeft + smileRight) / 2;
  const stressScore = (browDownLeft + browDownRight + mouthPressLeft + mouthPressRight) / 4;

  const isBlinking = leftBlink > 0.45 || rightBlink > 0.45;
  const eyesClosed = facePresent && isBlinking;
  const eyeDistance =
    leftEye && rightEye
      ? Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y)
      : 0;

  const completeSideGaze = Math.max(lookLeft, lookRight);
  const sideGaze = Math.max(lookLeft, lookRight, lookUp);
  const irisRatios = computeIrisRatio(landmarks);

  let irisRatioOffset = 0;
  if (baseline && !isBlinking) {
    const leftDiffX = Math.abs(irisRatios.leftIrisRatio.x - baseline.leftIrisRatio.x);
    const leftDiffY = Math.abs(irisRatios.leftIrisRatio.y - baseline.leftIrisRatio.y);
    const rightDiffX = Math.abs(irisRatios.rightIrisRatio.x - baseline.rightIrisRatio.x);
    const rightDiffY = Math.abs(irisRatios.rightIrisRatio.y - baseline.rightIrisRatio.y);
    irisRatioOffset = (leftDiffX + leftDiffY + rightDiffX + rightDiffY) / 4;
  }

  // Trigger lookingAway when candidate shifts gaze left or right (> 0.38), up (> 0.42), or deviates from calibrated baseline (> 0.18).
  // CRITICAL: NEVER count natural eye blinks as eye movement or gaze away!
  const lookingAway = facePresent && !isBlinking && (completeSideGaze > 0.38 || lookUp > 0.42 || irisRatioOffset > 0.18);

  const { yaw, pitch } = getHeadYaw(matrix ?? []);
  const relativeYaw = baseline ? yaw - baseline.yaw : yaw;
  const relativePitch = baseline ? pitch - baseline.pitch : pitch;

  const headTurnedAway = facePresent && (Math.abs(relativeYaw) > 14 || Math.abs(relativePitch) > 13);

  // Reading on screen is expected behavior. Only flag if eyes point completely down off-screen (e.g. lap/desk)
  // Blinking must never trigger reading suspected
  const readingSuspected =
    facePresent &&
    !isBlinking &&
    !headTurnedAway &&
    !lookingAway &&
    lookDown > 0.78;

  const eyeConfidence = clamp(
    1 - Math.max(leftBlink, rightBlink, sideGaze, lookDown, eyeDistance < 0.12 ? 0.7 : 0),
    0,
    1,
  );

  const eyeContactPct = facePresent && !lookingAway && !headTurnedAway && !readingSuspected ? 1 : 0;
  const blinkRate = (leftBlink + rightBlink) / 2;

  const jawOpen = toScore(blendshapes ?? [], ['jawOpen']);
  const mouthPucker = toScore(blendshapes ?? [], ['mouthPucker', 'mouthFunnel', 'mouthRollLower', 'mouthRollUpper']);
  const mouthMoving = facePresent && (jawOpen > 0.08 || mouthPucker > 0.12);

  const expression: ExpressionMetrics = {
    smileScore,
    stressScore,
    eyeContactPct,
    blinkRate,
  };

  if (!facePresent) {
    return {
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
      expression,
      category: 'no_face',
    };
  }

  // 1. If head is turned away or candidate's eyes look away, it is an eye movement / attention violation (gaze_away)
  if (headTurnedAway || lookingAway) {
    return {
      facePresent: true,
      eyesClosed,
      lookingAway,
      headTurnedAway,
      eyeConfidence,
      alert: 'warning',
      numFaces: 1,
      multiFaceDetected: false,
      readingSuspected,
      mouthMoving,
      relativeYaw,
      relativePitch,
      irisRatioOffset,
      expression,
      category: 'gaze_away',
    };
  }

  // 2. Multi-face: Only trigger when more than one distinct person is present in frame while candidate is facing camera
  if (multiFaceDetected) {
    return {
      facePresent: true,
      eyesClosed,
      lookingAway: false,
      headTurnedAway: false,
      eyeConfidence,
      alert: 'warning',
      numFaces,
      multiFaceDetected: true,
      readingSuspected: false,
      mouthMoving,
      relativeYaw,
      relativePitch,
      irisRatioOffset,
      expression,
      category: 'multi_face',
    };
  }

  if (readingSuspected) {
    return {
      facePresent: true,
      eyesClosed,
      lookingAway,
      headTurnedAway,
      eyeConfidence,
      alert: 'warning',
      numFaces: 1,
      multiFaceDetected: false,
      readingSuspected: true,
      mouthMoving,
      relativeYaw,
      relativePitch,
      irisRatioOffset,
      expression,
      category: 'reading_suspected',
    };
  }

  // 4. Framing / Position issue: Face is visible, but poorly positioned in frame or distance is abnormal
  const nose = landmarks?.[1];
  const isFramingIssue =
    facePresent &&
    !isBlinking &&
    !lookingAway &&
    !headTurnedAway &&
    !readingSuspected &&
    !multiFaceDetected &&
    nose !== undefined &&
    eyeDistance > 0 &&
    (nose.x < 0.16 || nose.x > 0.84 || nose.y < 0.14 || nose.y > 0.86 || eyeDistance < 0.07 || eyeDistance > 0.44);

  if (isFramingIssue) {
    return {
      facePresent: true,
      eyesClosed,
      lookingAway: false,
      headTurnedAway: false,
      eyeConfidence,
      alert: 'warning',
      numFaces: 1,
      multiFaceDetected: false,
      readingSuspected: false,
      mouthMoving,
      relativeYaw,
      relativePitch,
      irisRatioOffset,
      expression,
      category: 'framing_issue',
    };
  }

  return {
    facePresent: true,
    eyesClosed,
    lookingAway: false,
    headTurnedAway: false,
    eyeConfidence,
    alert: 'stable',
    numFaces: 1,
    multiFaceDetected: false,
    readingSuspected: false,
    mouthMoving,
    relativeYaw,
    relativePitch,
    irisRatioOffset,
    expression,
    category: 'none',
  };
}

export interface WarningCounts {
  face: number;
  object: number;
  voice: number;
  total: number;
}

/**
 * Normalizes any proctoring violation category into broad categories:
 * - 'face': no_face, gaze_away, reading_suspected, multi_face, framing_issue, face
 * - 'object': object_detected, object
 * - 'voice': unauthorized_voice, background_voice, voice
 */
export function getBroadCategory(category: string): 'face' | 'object' | 'voice' | string {
  const lower = (category || '').toLowerCase().trim();
  if (lower.startsWith('object') || lower.includes('object')) return 'object';
  if (lower.startsWith('voice') || lower.includes('voice')) return 'voice';
  if (
    lower.startsWith('face') ||
    lower === 'no_face' ||
    lower === 'gaze_away' ||
    lower === 'multi_face' ||
    lower === 'reading_suspected' ||
    lower === 'framing_issue'
  ) {
    return 'face';
  }
  return category;
}

export class ProctoringTimeTracker {
  private categoryStartTime: Map<string, number> = new Map();
  private lastWarningTime: Map<string, number> = new Map();
  private lastCategoryWarningTime: Map<string, number> = new Map();
  private noneFrameCount = 0;
  private faceWarningCount = 0;
  private objectWarningCount = 0;
  private voiceWarningCount = 0;

  /** Backward-compatible getter — total across all three types (capped strictly at 3) */
  public get warningCount(): number {
    return Math.min(3, this.faceWarningCount + this.objectWarningCount + this.voiceWarningCount);
  }

  /** Returns individual counts per warning type */
  public getWarningCounts(): WarningCounts {
    return {
      face: this.faceWarningCount,
      object: this.objectWarningCount,
      voice: this.voiceWarningCount,
      total: Math.min(3, this.faceWarningCount + this.objectWarningCount + this.voiceWarningCount),
    };
  }

  /** Returns the timestamp (ms) of the last warning issued for the given category */
  public getLastCategoryWarningTime(category: string): number | undefined {
    return this.lastCategoryWarningTime.get(getBroadCategory(category));
  }

  public processResult(
    result: ExtendedFaceTrackingResult,
    nowMs: number = Date.now(),
    options: {
      gazeAwayThresholdMs?: number; // default 1500ms
      readingThresholdMs?: number; // default 3500ms
      noFaceThresholdMs?: number; // default 1500ms
      multiFaceThresholdMs?: number; // default 1000ms
      framingThresholdMs?: number; // default 2000ms
      debounceMs?: number; // default 5000ms
      categoryBreakMs?: number; // default 5000ms cooldown between face warnings
    } = {},
  ): {
    shouldTriggerWarning: boolean;
    category: string;
    warningCount: number;
    reason: string;
  } {
    if (this.warningCount >= 3) {
      return { shouldTriggerWarning: false, category: 'none', warningCount: 3, reason: '' };
    }

    const {
      gazeAwayThresholdMs = 1500,
      readingThresholdMs = 3500,
      noFaceThresholdMs = 1500,
      multiFaceThresholdMs = 1000,
      framingThresholdMs = 2000,
      debounceMs = 5000,
      categoryBreakMs,
    } = options;

    const currentCategory = result.category;

    if (currentCategory === 'none') {
      this.noneFrameCount += 1;
      // Require 5 consecutive stable frames (~500ms) before wiping violation timers,
      // preventing momentary 1-frame jitter from resetting a sustained violation.
      if (this.noneFrameCount >= 5) {
        this.categoryStartTime.clear();
      }
      return { shouldTriggerWarning: false, category: 'none', warningCount: this.warningCount, reason: '' };
    }
    this.noneFrameCount = 0;

    // Determine required threshold
    let requiredMs = 1500;
    if (currentCategory === 'no_face') requiredMs = noFaceThresholdMs;
    else if (currentCategory === 'multi_face') requiredMs = multiFaceThresholdMs;
    else if (currentCategory === 'gaze_away') requiredMs = gazeAwayThresholdMs;
    else if (currentCategory === 'reading_suspected') requiredMs = readingThresholdMs;
    else if (currentCategory === 'framing_issue') requiredMs = framingThresholdMs;

    if (!this.categoryStartTime.has(currentCategory)) {
      this.categoryStartTime.set(currentCategory, nowMs);
    }

    const elapsed = nowMs - (this.categoryStartTime.get(currentCategory) ?? nowMs);

    // Enforce category break for 'face' detections
    const breakWindow = categoryBreakMs ?? debounceMs;
    const lastCategoryTrigger = this.lastCategoryWarningTime.get('face');
    const timeSinceLastCategory = lastCategoryTrigger === undefined ? Infinity : nowMs - lastCategoryTrigger;

    if (timeSinceLastCategory < breakWindow) {
      // Still in break / cooldown window for face proctoring
      return { shouldTriggerWarning: false, category: currentCategory, warningCount: this.warningCount, reason: '' };
    }

    if (elapsed >= requiredMs) {
      const lastTrigger = this.lastWarningTime.get(currentCategory);
      const timeSinceLast = lastTrigger === undefined ? Infinity : nowMs - lastTrigger;

      if (timeSinceLast >= debounceMs) {
        if (this.warningCount >= 3) {
          return { shouldTriggerWarning: false, category: currentCategory, warningCount: 3, reason: '' };
        }
        this.lastWarningTime.set(currentCategory, nowMs);
        this.lastCategoryWarningTime.set('face', nowMs);
        this.faceWarningCount += 1;

        let reason = 'Please keep your attention focused on the interview screen.';
        if (currentCategory === 'no_face') {
          reason = 'Your face is not clearly visible. Please position yourself properly in front of the camera.';
        } else if (currentCategory === 'multi_face') {
          reason = 'Multiple faces detected. Please ensure that only you are present during the interview.';
        } else if (currentCategory === 'gaze_away') {
          reason = 'Please keep your attention focused on the interview screen.';
        } else if (currentCategory === 'reading_suspected') {
          reason = 'Please avoid looking away or reading from another source during the interview.';
        } else if (currentCategory === 'framing_issue') {
          reason = 'Please adjust your position so your face remains clearly visible.';
        }

        return {
          shouldTriggerWarning: true,
          category: currentCategory,
          warningCount: this.warningCount,
          reason,
        };
      }
    }

    return { shouldTriggerWarning: false, category: currentCategory, warningCount: this.warningCount, reason: '' };
  }

  /**
   * processGenericEvent — used by object detection and voice detection.
   *
   * All proctoring alerts share one unified total count capped at 3 strikes.
   * Enforces a mandatory break / cooldown window between warnings of the same category,
   * preventing rapid-fire consecutive warnings when model outputs oscillate.
   *
   * @param category  e.g. 'object_detected' | 'unauthorized_voice'
   * @param subKey    differentiates items within category (e.g. 'cell phone', 'remote')
   * @param reason    human-readable reason shown in warning toast
   * @param thresholdMs how long (ms) the condition must persist before firing
   * @param debounceMs  min gap (ms) between consecutive warnings for this subKey
   * @param nowMs     current timestamp (injectable for testing)
   * @param categoryBreakMs optional override for category break window (defaults to debounceMs)
   */
  public processGenericEvent(
    category: string,
    subKey: string,
    reason: string,
    thresholdMs: number,
    debounceMs = 5000,
    nowMs: number = Date.now(),
    categoryBreakMs?: number,
  ): {
    shouldTriggerWarning: boolean;
    category: string;
    warningCount: number;
    reason: string;
  } {
    if (this.warningCount >= 3) {
      return { shouldTriggerWarning: false, category, warningCount: 3, reason: '' };
    }

    const key = `${category}:${subKey}`;

    if (!this.categoryStartTime.has(key)) {
      this.categoryStartTime.set(key, nowMs);
    }

    const elapsed = nowMs - (this.categoryStartTime.get(key) ?? nowMs);

    const broadCategory = getBroadCategory(category);
    const breakWindow = categoryBreakMs ?? debounceMs;

    // Check same-category break / cooldown
    const lastCategoryTrigger = this.lastCategoryWarningTime.get(broadCategory);
    const timeSinceLastCategory = lastCategoryTrigger === undefined ? Infinity : nowMs - lastCategoryTrigger;

    if (timeSinceLastCategory < breakWindow) {
      // In cooldown / break window for this detection category
      return { shouldTriggerWarning: false, category, warningCount: this.warningCount, reason: '' };
    }

    if (elapsed >= thresholdMs) {
      const lastTrigger = this.lastWarningTime.get(key);
      const timeSinceLast = lastTrigger === undefined ? Infinity : nowMs - lastTrigger;

      if (timeSinceLast >= debounceMs) {
        if (this.warningCount >= 3) {
          return { shouldTriggerWarning: false, category, warningCount: 3, reason: '' };
        }
        this.lastWarningTime.set(key, nowMs);
        this.lastCategoryWarningTime.set(broadCategory, nowMs);
        this.categoryStartTime.delete(key); // reset after trigger

        // Route increment to the correct per-type counter
        if (broadCategory === 'object') {
          this.objectWarningCount += 1;
        } else if (broadCategory === 'voice') {
          this.voiceWarningCount += 1;
        } else {
          this.faceWarningCount += 1;
        }

        return {
          shouldTriggerWarning: true,
          category,
          warningCount: this.warningCount,
          reason,
        };
      }
    }

    return { shouldTriggerWarning: false, category, warningCount: this.warningCount, reason: '' };
  }

  /**
   * clearGenericKey — call when an object/voice condition is no longer active
   * so the sustained-duration timer resets correctly.
   */
  public clearGenericKey(category: string, subKey: string): void {
    this.categoryStartTime.delete(`${category}:${subKey}`);
  }

  public clearActiveViolations(): void {
    this.categoryStartTime.clear();
    this.noneFrameCount = 0;
  }

  public getWarningCount(): number {
    return this.warningCount;
  }

  public reset(): void {
    this.categoryStartTime.clear();
    this.lastWarningTime.clear();
    this.lastCategoryWarningTime.clear();
    this.faceWarningCount = 0;
    this.objectWarningCount = 0;
    this.voiceWarningCount = 0;
    this.noneFrameCount = 0;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
