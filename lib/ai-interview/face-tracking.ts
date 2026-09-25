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
  category: 'gaze_away' | 'reading_suspected' | 'no_face' | 'multi_face' | 'none';
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

  const eyesClosed = facePresent && (leftBlink > 0.75 || rightBlink > 0.75);
  const eyeDistance =
    leftEye && rightEye
      ? Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y)
      : 0;

  const completeSideGaze = Math.max(lookLeft, lookRight);
  const sideGaze = Math.max(lookLeft, lookRight, lookUp);
  const irisRatios = computeIrisRatio(landmarks);

  let irisRatioOffset = 0;
  if (baseline) {
    const leftDiffX = Math.abs(irisRatios.leftIrisRatio.x - baseline.leftIrisRatio.x);
    const leftDiffY = Math.abs(irisRatios.leftIrisRatio.y - baseline.leftIrisRatio.y);
    const rightDiffX = Math.abs(irisRatios.rightIrisRatio.x - baseline.rightIrisRatio.x);
    const rightDiffY = Math.abs(irisRatios.rightIrisRatio.y - baseline.rightIrisRatio.y);
    irisRatioOffset = (leftDiffX + leftDiffY + rightDiffX + rightDiffY) / 4;
  }

  // Only trigger lookingAway when candidate completely shifts gaze left or right away from screen (or up)
  // Reading questions on-screen naturally produces modest horizontal movements (0.2-0.45), so we use a high threshold (0.68)
  const lookingAway = facePresent && (completeSideGaze > 0.68 || lookUp > 0.68 || eyeDistance < 0.08 || irisRatioOffset > 0.35);

  const { yaw, pitch } = getHeadYaw(matrix ?? []);
  const relativeYaw = baseline ? yaw - baseline.yaw : yaw;
  const relativePitch = baseline ? pitch - baseline.pitch : pitch;

  const headTurnedAway = facePresent && (Math.abs(relativeYaw) > 25 || Math.abs(relativePitch) > 22);

  // Reading on screen is expected behavior. Only flag if eyes point completely down off-screen (e.g. lap/desk)
  const readingSuspected =
    facePresent &&
    !headTurnedAway &&
    !lookingAway &&
    lookDown > 0.75;

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

  if (multiFaceDetected) {
    return {
      facePresent: true,
      eyesClosed,
      lookingAway,
      headTurnedAway,
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

  return {
    facePresent: true,
    eyesClosed: false,
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

export class ProctoringTimeTracker {
  private categoryStartTime: Map<string, number> = new Map();
  private lastWarningTime: Map<string, number> = new Map();
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

  public processResult(
    result: ExtendedFaceTrackingResult,
    nowMs: number = Date.now(),
    options: {
      gazeAwayThresholdMs?: number; // default 1200ms
      readingThresholdMs?: number; // default 1200ms
      noFaceThresholdMs?: number; // default 1000ms
      multiFaceThresholdMs?: number; // default 1500ms
      debounceMs?: number; // default 5000ms
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
      gazeAwayThresholdMs = 3000,
      readingThresholdMs = 4500,
      noFaceThresholdMs = 1500,
      multiFaceThresholdMs = 2000,
      debounceMs = 5000,
    } = options;

    const currentCategory = result.category;

    if (currentCategory === 'none') {
      this.noneFrameCount += 1;
      if (this.noneFrameCount >= 2) {
        this.categoryStartTime.clear();
      }
      return { shouldTriggerWarning: false, category: 'none', warningCount: this.warningCount, reason: '' };
    }
    this.noneFrameCount = 0;

    // Determine required threshold
    let requiredMs = 1200;
    if (currentCategory === 'no_face') requiredMs = noFaceThresholdMs;
    else if (currentCategory === 'multi_face') requiredMs = multiFaceThresholdMs;
    else if (currentCategory === 'gaze_away') requiredMs = gazeAwayThresholdMs;
    else if (currentCategory === 'reading_suspected') requiredMs = readingThresholdMs;

    if (!this.categoryStartTime.has(currentCategory)) {
      this.categoryStartTime.set(currentCategory, nowMs);
    }

    const elapsed = nowMs - (this.categoryStartTime.get(currentCategory) ?? nowMs);

    if (elapsed >= requiredMs) {
      const lastTrigger = this.lastWarningTime.get(currentCategory);
      const timeSinceLast = lastTrigger === undefined ? Infinity : nowMs - lastTrigger;

      if (timeSinceLast >= debounceMs) {
        if (this.warningCount >= 3) {
          return { shouldTriggerWarning: false, category: currentCategory, warningCount: 3, reason: '' };
        }
        this.lastWarningTime.set(currentCategory, nowMs);
        this.faceWarningCount += 1;

        let reason = 'Keep your eyes on the screen during the interview.';
        if (currentCategory === 'no_face') reason = 'No face detected in webcam frame.';
        else if (currentCategory === 'multi_face') reason = 'Multiple faces detected in frame.';
        else if (currentCategory === 'reading_suspected') reason = 'Suspected reading off-screen.';

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
   * Object and voice warnings are counted in the SAME warningCount as face events.
   * There is no separate counter — all proctoring alerts share one unified count.
   * Max warnings is strictly 3.
   *
   * @param category  e.g. 'object_detected' | 'background_voice'
   * @param subKey    differentiates objects within a category (e.g. 'phone', 'book')
   * @param reason    human-readable reason shown in the warning toast
   * @param thresholdMs how long (ms) the condition must persist before firing
   * @param debounceMs  min gap (ms) between consecutive warnings for this subKey
   * @param nowMs     current timestamp (injectable for testing)
   */
  public processGenericEvent(
    category: string,
    subKey: string,
    reason: string,
    thresholdMs: number,
    debounceMs = 5000,
    nowMs: number = Date.now(),
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

    if (elapsed >= thresholdMs) {
      const lastTrigger = this.lastWarningTime.get(key);
      const timeSinceLast = lastTrigger === undefined ? Infinity : nowMs - lastTrigger;

      if (timeSinceLast >= debounceMs) {
        if (this.warningCount >= 3) {
          return { shouldTriggerWarning: false, category, warningCount: 3, reason: '' };
        }
        this.lastWarningTime.set(key, nowMs);
        this.categoryStartTime.delete(key); // reset after trigger
        // Route increment to the correct per-type counter
        if (category === 'object_detected') {
          this.objectWarningCount += 1;
        } else if (category === 'background_voice' || category === 'unauthorized_voice') {
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

  public getWarningCount(): number {
    return this.warningCount;
  }

  public reset(): void {
    this.categoryStartTime.clear();
    this.lastWarningTime.clear();
    this.faceWarningCount = 0;
    this.objectWarningCount = 0;
    this.voiceWarningCount = 0;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
