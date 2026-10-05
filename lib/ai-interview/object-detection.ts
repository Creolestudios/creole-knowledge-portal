/**
 * object-detection.ts
 *
 * Maps COCO-SSD detected object labels to proctoring categories, severity levels,
 * and per-object sustained-detection thresholds.
 *
 * Fast object detection flow:
 * - Immediate alert triggers (thresholdMs = 0) so warnings & snapshots fire instantaneously.
 * - Allows ONLY the candidate's body ('person').
 * - Flags any other detected unauthorized object (phone, book, remote, laptop, etc.).
 */

export type ObjectAlertSeverity = 'warning';

export interface ObjectRule {
  /** Proctoring category emitted on alert */
  category: 'object_detected';
  /** Human-readable label for the detected object */
  object: string;
  /** Alert severity */
  severity: ObjectAlertSeverity;
  /** How many ms the object must be continuously present to fire a warning (0 for instant) */
  thresholdMs: number;
  /** Warning reason shown in the toast */
  reason: string;
}

/**
 * Default generalized warning reason for any unauthorized object detected.
 */
export const GENERAL_UNAUTHORIZED_OBJECT_REASON = 'Unauthorized object detected in camera view.';

/**
 * The ONLY allowed detection class is the user/candidate themselves ('person').
 * Any other object detected in the frame is considered an unauthorized object.
 */
export const ALLOWED_USER_CLASSES = new Set<string>(['person']);

/**
 * Known default proctoring classes for enumerability in OBJECT_RULES.
 */
const DEFAULT_OBJECT_CLASSES = [
  'cell phone',
  'headphones',
  'book',
  'laptop',
  'tv',
  'remote',
];

/**
 * Dynamic Object Rule generator for any detected object other than the user's body.
 * Every detected object receives the standardized warning reason and 0ms immediate threshold.
 */
export function getOrCreateObjectRule(className: string): ObjectRule {
  const normalized = className.toLowerCase().trim();
  return {
    category: 'object_detected',
    object: normalized,
    severity: 'warning',
    thresholdMs: 0,
    reason: GENERAL_UNAUTHORIZED_OBJECT_REASON,
  };
}

const baseRules: Record<string, ObjectRule> = Object.fromEntries(
  DEFAULT_OBJECT_CLASSES.map((key) => [key, getOrCreateObjectRule(key)]),
);

/**
 * Proxy-based OBJECT_RULES mapping:
 * Dynamically resolves ANY object name into an unauthorized object rule with 0ms threshold.
 * Enumerates default proctoring classes when iterated with Object.entries/Object.keys.
 */
export const OBJECT_RULES: Record<string, ObjectRule> = new Proxy(baseRules, {
  get: (target, prop: string | symbol) => {
    if (typeof prop === 'string') {
      const normalized = prop.toLowerCase().trim();
      return target[normalized] ?? getOrCreateObjectRule(prop);
    }
    return Reflect.get(target, prop);
  },
});

export interface DetectedObjectEvent {
  /** COCO-SSD class label */
  label: string;
  confidence: number;
  /** Normalised bounding box [x, y, width, height] */
  boundingBox: [number, number, number, number];
  /** Resolved rule, undefined if the object is not tracked */
  rule: ObjectRule;
}

/**
 * Filters raw COCO-SSD detections:
 * Allows ONLY the candidate's body ('person').
 * If ANY other object is detected, it is flagged as an unauthorized object immediately.
 */
export function filterTrackedObjects(
  detections: Array<{ class: string; score: number; bbox: [number, number, number, number] }>,
  minConfidence = 0.28,
): DetectedObjectEvent[] {
  return detections
    .filter((d) => {
      const normalizedClass = d.class.toLowerCase().trim();
      // Allow only the candidate/user body
      if (ALLOWED_USER_CLASSES.has(normalizedClass)) {
        return false;
      }
      return d.score >= minConfidence;
    })
    .map((d) => ({
      label: d.class,
      confidence: d.score,
      boundingBox: d.bbox,
      rule: getOrCreateObjectRule(d.class),
    }));
}
