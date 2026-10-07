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
export const GENERAL_UNAUTHORIZED_OBJECT_REASON =
  'Prohibited object detected. Please remove it from your surroundings before continuing.';

/**
 * Standard environmental furniture, fixtures, timepieces, and mundane background items.
 * These are normally present in an office or room and must NEVER trigger proctoring violations.
 */
export const ROOM_ENVIRONMENT_CLASSES = new Set<string>([
  // Furniture & seating
  'chair',
  'couch',
  'sofa',
  'bed',
  'bench',
  'dining table',
  'desk',
  'table',
  // Timepieces
  'clock',
  'watch',
  // Ambient decor & kitchen/hydration
  'potted plant',
  'plant',
  'vase',
  'bottle',
  'cup',
  'mug',
  'bowl',
  'wine glass',
  // Clothing / bags
  'tie',
  'backpack',
  'handbag',
  'suitcase',
  'umbrella',
  'sink',
  'refrigerator',
]);

/** Backward-compatibility aliases */
export const ALLOWED_ENVIRONMENT_CLASSES = ROOM_ENVIRONMENT_CLASSES;
export const ALLOWED_USER_CLASSES = new Set<string>(['person', ...ROOM_ENVIRONMENT_CLASSES]);

/**
 * Evaluates whether an object is a standard background room fixture / furniture / timepiece
 * that should not trigger cheating violations.
 */
export function isRoomEnvironment(className: string): boolean {
  const lower = (className || '').toLowerCase().trim();

  if (ROOM_ENVIRONMENT_CLASSES.has(lower)) {
    return true;
  }

  // Substring matches for common household furniture and ambient items
  return (
    lower.includes('chair') ||
    lower.includes('clock') ||
    lower.includes('watch') ||
    lower.includes('couch') ||
    lower.includes('sofa') ||
    lower.includes('table') ||
    lower.includes('plant') ||
    lower.includes('bottle') ||
    lower.includes('cup')
  );
}

/**
 * Dynamic Object Rule generator for any detected object.
 * Every detected unauthorized object receives the standardized warning reason and 0ms immediate threshold.
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

const DEFAULT_OBJECT_CLASSES = [
  'cell phone',
  'headphones',
  'book',
  'laptop',
  'tv',
  'remote',
  'pen',
  'paper',
  'earphones',
];

const baseRules: Record<string, ObjectRule> = Object.fromEntries(
  DEFAULT_OBJECT_CLASSES.map((key) => [key, getOrCreateObjectRule(key)]),
);

/**
 * Proxy-based OBJECT_RULES mapping:
 * Dynamically resolves ANY object name into an unauthorized object rule with 0ms threshold.
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
  /** Detected class label */
  label: string;
  confidence: number;
  /** Normalised bounding box [x, y, width, height] */
  boundingBox: [number, number, number, number];
  /** Resolved rule */
  rule: ObjectRule;
}

/**
 * Filters raw object detections dynamically:
 * 1. Checks candidate presence: The first 'person' is the candidate themselves (allowed).
 * 2. Checks multi-person presence: If an additional 'person' is detected in camera view, it flags as violation!
 * 3. Filters out mundane room fixtures (chair, clock, watch, desk, couch, cup, etc.).
 * 4. Flags any other detected object (phone, laptop, book, earphones, notes, pen, paper, remote, or any suspicious item) dynamically.
 */
export function filterTrackedObjects(
  detections: Array<{ class: string; score: number; bbox: [number, number, number, number] }>,
  minConfidence = 0.22,
): DetectedObjectEvent[] {
  let candidateFound = false;

  const results: DetectedObjectEvent[] = [];

  for (const d of detections) {
    const normalizedClass = (d.class || '').toLowerCase().trim();

    // ── Person Handling ──
    if (normalizedClass === 'person') {
      if (!candidateFound) {
        // The first person detected is the candidate themselves
        candidateFound = true;
        continue;
      }

      // Another person is detected in the camera view!
      if (d.score >= Math.max(0.45, minConfidence)) {
        results.push({
          label: 'second person',
          confidence: d.score,
          boundingBox: d.bbox,
          rule: {
            category: 'object_detected',
            object: 'multiple_persons',
            severity: 'warning',
            thresholdMs: 0,
            reason:
              'Multiple persons detected in camera view. Please ensure that only you are present during the interview.',
          },
        });
      }
      continue;
    }

    // ── Ignore Room Environment & Furniture (chair, clock, watch, etc.) ──
    if (isRoomEnvironment(normalizedClass)) {
      continue;
    }

    // ── Any Other Suspicious Object (Phone, Book, Laptop, Earphones, Pen, Paper, etc.) ──
    if (d.score >= minConfidence) {
      results.push({
        label: d.class,
        confidence: d.score,
        boundingBox: d.bbox,
        rule: getOrCreateObjectRule(d.class),
      });
    }
  }

  return results;
}
