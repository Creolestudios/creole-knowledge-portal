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

export type ObjectAlertSeverity = 'warning';

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
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Mobile phone detected in frame. External devices are not permitted.',
  },
  phone: {
    category: 'object_detected',
    object: 'phone',
    severity: 'warning',
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
    reason: 'Reading material or notes detected. External aids are not permitted.',
  },
  tv: {
    category: 'object_detected',
    object: 'second_screen',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Additional screen or monitor detected in frame.',
  },
  laptop: {
    category: 'object_detected',
    object: 'second_screen',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Additional laptop or screen detected in frame.',
  },
  remote: {
    category: 'object_detected',
    object: 'remote',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Remote or unauthorized electronic device detected.',
  },
  tablet: {
    category: 'object_detected',
    object: 'tablet',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Tablet or mobile device detected in frame.',
  },
  mouse: {
    category: 'object_detected',
    object: 'device',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'Unauthorized electronic device detected.',
  },
  keyboard: {
    category: 'object_detected',
    object: 'device',
    severity: 'warning',
    thresholdMs: 0,
    reason: 'External keypad or device detected.',
  },
};

/**
 * Per-class confidence thresholds.
 * Calibrated for instant detection of prohibited items (phones, books, devices)
 * without latency when an object enters the camera view.
 */
export const CLASS_CONFIDENCE_THRESHOLDS: Record<string, number> = {
  'cell phone': 0.18,
  phone: 0.18,
  headphones: 0.20,
  book: 0.18,
  laptop: 0.22,
  tv: 0.22,
  remote: 0.20,
  tablet: 0.20,
  mouse: 0.25,
  keyboard: 0.25,
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
 * using per-class sensitivity thresholds so devices and objects are accurately detected.
 */
export function filterTrackedObjects(
  detections: Array<{ class: string; score: number; bbox: [number, number, number, number] }>,
  defaultMinConfidence = 0.10,
): DetectedObjectEvent[] {
  return detections
    .filter((d) => {
      if (!(d.class in OBJECT_RULES)) return false;
      const threshold = CLASS_CONFIDENCE_THRESHOLDS[d.class] ?? defaultMinConfidence;
      return d.score >= threshold;
    })
    .map((d) => ({
      label: d.class,
      confidence: d.score,
      boundingBox: d.bbox,
      rule: OBJECT_RULES[d.class],
    }));
}

