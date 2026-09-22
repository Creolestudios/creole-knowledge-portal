/**
 * object-detection.ts
 *
 * Maps COCO-SSD detected object labels to proctoring categories, severity levels,
 * and per-object sustained-detection thresholds.
 *
 * Earbuds/headphones are included via the 'headphones' COCO-SSD class.
 * All detected object warnings are counted in the shared ProctoringTimeTracker
 * warningCount — same counter as face-tracking alerts.
 */

export type ObjectAlertSeverity = 'warning' | 'error';

export interface ObjectRule {
  /** Proctoring category emitted on alert */
  category: 'object_detected';
  /** Human-readable label for the detected object */
  object: string;
  /** Alert severity */
  severity: ObjectAlertSeverity;
  /** How many ms the object must be continuously present to fire a warning */
  thresholdMs: number;
  /** Warning reason shown in the toast */
  reason: string;
}

/**
 * Map of COCO-SSD class names → proctoring rules.
 * Only classes listed here will trigger warnings.
 */
export const OBJECT_RULES: Record<string, ObjectRule> = {
  'cell phone': {
    category: 'object_detected',
    object: 'phone',
    severity: 'error',
    thresholdMs: 0,
    reason: 'Mobile phone detected in frame. External devices are not permitted.',
  },
  phone: {
    category: 'object_detected',
    object: 'phone',
    severity: 'error',
    thresholdMs: 0,
    reason: 'Mobile phone detected in frame. External devices are not permitted.',
  },
  headphones: {
    category: 'object_detected',
    object: 'earbuds',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Earbuds or headphones detected. Audio aids are not permitted.',
  },
  book: {
    category: 'object_detected',
    object: 'book',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Reading material detected. External notes are not permitted.',
  },
  tv: {
    category: 'object_detected',
    object: 'second_screen',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Additional screen detected in frame.',
  },
  laptop: {
    category: 'object_detected',
    object: 'second_screen',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Additional screen detected in frame.',
  },
  remote: {
    category: 'object_detected',
    object: 'remote',
    severity: 'error',
    thresholdMs: 0,
    reason: 'Remote or unauthorized device detected.',
  },
};

export interface DetectedObjectEvent {
  /** COCO-SSD class label */
  label: string;
  confidence: number;
  /** Normalised bounding box [x, y, width, height] */
  boundingBox: [number, number, number, number];
  /** Resolved rule, undefined if the object is not tracked */
  rule: ObjectRule | undefined;
}

/**
 * Filters raw COCO-SSD detections to only those we care about,
 * above a minimum confidence threshold.
 */
export function filterTrackedObjects(
  detections: Array<{ class: string; score: number; bbox: [number, number, number, number] }>,
  minConfidence = 0.28,
): DetectedObjectEvent[] {
  return detections
    .filter((d) => d.score >= minConfidence && d.class in OBJECT_RULES)
    .map((d) => ({
      label: d.class,
      confidence: d.score,
      boundingBox: d.bbox,
      rule: OBJECT_RULES[d.class],
    }));
}
