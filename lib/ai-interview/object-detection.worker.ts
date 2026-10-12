/**
 * object-detection.worker.ts
 *
 * Web Worker that loads TensorFlow.js COCO-SSD model and runs object detection
 * inference on camera frames every ~2 seconds. Runs off the main thread to
 * avoid blocking the interview UI.
 *
 * Messages IN  (from page):
 *   { type: 'init' }
 *   { type: 'frame', bitmap: ImageBitmap, timestamp: number }
 *
 * Messages OUT (to page):
 *   { type: 'ready' }
 *   { type: 'result', detections: DetectedObjectEvent[] }
 *   { type: 'error', message: string }
 */

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { filterTrackedObjects, type DetectedObjectEvent } from './object-detection';

let model: cocoSsd.ObjectDetection | null = null;
let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
let isBusy = false;

console.log('[ObjectDetection Worker] Worker script evaluated, ready for init');

self.onmessage = async (event: MessageEvent<{ type: string; bitmap?: ImageBitmap; timestamp?: number }>) => {
  const message = event.data;

  // ─── INIT ────────────────────────────────────────────────────────────────
  if (message.type === 'init') {
    try {
      console.log('[ObjectDetection Worker] Setting backend and loading COCO-SSD model...');
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      // Load fast lite_mobilenet_v2 COCO-SSD model (~1.8MB vs 15MB) for instant detection
      try {
        model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      } catch {
        try {
          model = await cocoSsd.load({ base: 'mobilenet_v2' });
        } catch {
          model = await cocoSsd.load();
        }
      }

      // Warmup WebGL shaders with a dummy frame so inference is instantaneous from frame 1
      if (typeof OffscreenCanvas !== 'undefined') {
        try {
          const warmupCanvas = new OffscreenCanvas(320, 240);
          await model.detect(warmupCanvas as unknown as HTMLCanvasElement, 1, 0.5);
        } catch {
          // Warmup silent failover
        }
      }

      console.log('[ObjectDetection Worker] Model loaded successfully! Active backend:', tf.getBackend());
      self.postMessage({ type: 'ready' });
    } catch (err) {
      console.error('[ObjectDetection Worker] Failed to load model:', err);
      self.postMessage({
        type: 'error',
        message: `Object detection model failed to load: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return;
  }

  // ─── FRAME ───────────────────────────────────────────────────────────────
  if (message.type !== 'frame' || !model || !message.bitmap) return;

  // Drop frame if previous inference is still in flight to avoid backpressure
  if (isBusy) {
    message.bitmap.close();
    return;
  }

  isBusy = true;

  try {
    let rawDetections;

    // Use 320px resolution for ultra-fast MobileNet inference (< 15ms) while retaining phone/book edges
    const targetW = 320;
    const aspect = message.bitmap.height / (message.bitmap.width || 1);
    const targetH = Math.max(240, Math.round(targetW * aspect));

    if (typeof OffscreenCanvas !== 'undefined') {
      if (!offscreenCanvas || offscreenCanvas.width !== targetW || offscreenCanvas.height !== targetH) {
        offscreenCanvas = new OffscreenCanvas(targetW, targetH);
        offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
      }
      if (offscreenCtx && offscreenCanvas) {
        offscreenCtx.drawImage(message.bitmap, 0, 0, targetW, targetH);
        try {
          rawDetections = await model.detect(offscreenCanvas as unknown as HTMLCanvasElement, 20, 0.22);
        } catch {
          const imgData = offscreenCtx.getImageData(0, 0, targetW, targetH);
          rawDetections = await model.detect(imgData, 20, 0.22);
        }
      }
    }

    if (!rawDetections) {
      rawDetections = await model.detect(message.bitmap as unknown as ImageData, 20, 0.22);
    }

    const detections: DetectedObjectEvent[] = filterTrackedObjects(rawDetections, 0.22);
    if (detections.length > 0) {
      console.log(
        '[ObjectDetection Worker] Found tracked objects:',
        detections.map((d) => `${d.label} (${Math.round(d.confidence * 100)}%)`).join(', '),
      );
    }

    self.postMessage({ type: 'result', detections });
  } catch (err) {
    console.error('[ObjectDetection Worker] Inference error:', err);
    self.postMessage({
      type: 'error',
      message: `Object detection inference failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    message.bitmap.close();
    isBusy = false;
  }
};
