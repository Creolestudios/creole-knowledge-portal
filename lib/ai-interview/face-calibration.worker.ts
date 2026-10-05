import { Category, FaceLandmarker, FilesetResolver, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { analyzeFaceMetrics, CandidateBaseline, computeIrisRatio, getHeadYaw } from './face-tracking';

type CalibrationFrame = {
  type: 'frame';
  bitmap: ImageBitmap;
  timestamp: number;
};

type WorkerMessage =
  | { type: 'init' }
  | { type: 'start_calibration' }
  | { type: 'set_baseline'; baseline: CandidateBaseline }
  | CalibrationFrame;

let faceLandmarker: FaceLandmarker | null = null;
let currentBaseline: CandidateBaseline | null = null;

let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

// Calibration accumulator
let isCalibrating = false;
let calibrationSamples: Array<{
  yaw: number;
  pitch: number;
  leftIrisRatio: { x: number; y: number };
  rightIrisRatio: { x: number; y: number };
}> = [];

// Persistence buffer to prevent frame drops during eye or head movement
let consecutiveMissingFrames = 0;
let lastKnownLandmark: NormalizedLandmark[] | undefined = undefined;
let lastKnownBlendshapes: Category[] = [];
let lastKnownMatrix: number[] = [];

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    try {
      const origin = typeof self !== 'undefined' && self.location ? self.location.origin : '';
      const wasmPath = `${origin}/mediapipe/wasm`;

      const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath);
      try {
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 4, // Track multiple faces robustly (up to 4)
          minFaceDetectionConfidence: 0.65,
          minFacePresenceConfidence: 0.65,
          minTrackingConfidence: 0.65,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      } catch (gpuErr) {
        console.warn('FaceLandmarker GPU delegate failed, falling back to CPU:', gpuErr);
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 4,
          minFaceDetectionConfidence: 0.65,
          minFacePresenceConfidence: 0.65,
          minTrackingConfidence: 0.65,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      }
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: `Face tracking failed: ${error instanceof Error ? error.message : String(error)}. Check that /public/mediapipe/wasm files are deployed.`,
      });
    }
    return;
  }

  if (message.type === 'start_calibration') {
    isCalibrating = true;
    calibrationSamples = [];
    self.postMessage({ type: 'calibration_started' });
    return;
  }

  if (message.type === 'set_baseline') {
    currentBaseline = message.baseline;
    isCalibrating = false;
    self.postMessage({ type: 'baseline_updated', baseline: currentBaseline });
    return;
  }

  if (message.type !== 'frame' || !faceLandmarker) return;

  let inputSource: ImageBitmap | OffscreenCanvas = message.bitmap;

  // Perform 320x240 downscaling on OffscreenCanvas if supported
  if (typeof OffscreenCanvas !== 'undefined') {
    if (!offscreenCanvas) {
      offscreenCanvas = new OffscreenCanvas(320, 240);
      offscreenCtx = offscreenCanvas.getContext('2d');
    }
    if (offscreenCtx && offscreenCanvas) {
      offscreenCtx.drawImage(message.bitmap, 0, 0, 320, 240);
      inputSource = offscreenCanvas;
    }
  }

  try {
    const result = faceLandmarker.detectForVideo(inputSource, message.timestamp);
    const rawFaces = result.faceLandmarks ?? [];
    let numFaces = rawFaces.length;

    // Filter out phantom profile splits where 2 face detections are on the same person (< 0.22 distance)
    if (rawFaces.length >= 2) {
      const f0 = rawFaces[0];
      const f1 = rawFaces[1];
      if (f0 && f1 && f0[1] && f1[1] && f0[152] && f1[152]) {
        const c0x = (f0[1].x + f0[152].x) / 2;
        const c0y = (f0[1].y + f0[152].y) / 2;
        const c1x = (f1[1].x + f1[152].x) / 2;
        const c1y = (f1[1].y + f1[152].y) / 2;
        const faceSeparation = Math.hypot(c0x - c1x, c0y - c1y);
        if (faceSeparation < 0.22) {
          numFaces = 1;
        }
      }
    }

    let landmark: NormalizedLandmark[] | undefined = result.faceLandmarks?.[0];
    let blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
    let matrix = result.facialTransformationMatrixes?.[0]?.data ?? [];

    if (landmark && landmark.length > 0) {
      consecutiveMissingFrames = 0;
      lastKnownLandmark = landmark;
      lastKnownBlendshapes = blendshapes;
      lastKnownMatrix = matrix;
    } else {
      consecutiveMissingFrames++;
      // Do not fake numFaces when camera has no face; allow ProctoringTimeTracker to handle time threshold
      landmark = undefined;
      blendshapes = [];
      matrix = [];
      lastKnownLandmark = undefined;
    }

    const iris = landmark
      ? [landmark[468], landmark[473]].filter(Boolean).map((point) => ({ x: point.x, y: point.y }))
      : [];

    const irisRatios = computeIrisRatio(landmark);
    const { yaw, pitch } = getHeadYaw(matrix);

    if (isCalibrating && landmark && landmark.length > 0) {
      calibrationSamples.push({
        yaw,
        pitch,
        leftIrisRatio: irisRatios.leftIrisRatio,
        rightIrisRatio: irisRatios.rightIrisRatio,
      });

      self.postMessage({
        type: 'calibration_progress',
        sampleCount: calibrationSamples.length,
      });

      if (calibrationSamples.length >= 15) {
        // Compute averages over calibration samples
        const avgYaw = calibrationSamples.reduce((sum, s) => sum + s.yaw, 0) / calibrationSamples.length;
        const avgPitch = calibrationSamples.reduce((sum, s) => sum + s.pitch, 0) / calibrationSamples.length;
        const avgLeftRatioX =
          calibrationSamples.reduce((sum, s) => sum + s.leftIrisRatio.x, 0) / calibrationSamples.length;
        const avgLeftRatioY =
          calibrationSamples.reduce((sum, s) => sum + s.leftIrisRatio.y, 0) / calibrationSamples.length;
        const avgRightRatioX =
          calibrationSamples.reduce((sum, s) => sum + s.rightIrisRatio.x, 0) / calibrationSamples.length;
        const avgRightRatioY =
          calibrationSamples.reduce((sum, s) => sum + s.rightIrisRatio.y, 0) / calibrationSamples.length;

        currentBaseline = {
          yaw: avgYaw,
          pitch: avgPitch,
          leftIrisRatio: { x: avgLeftRatioX, y: avgLeftRatioY },
          rightIrisRatio: { x: avgRightRatioX, y: avgRightRatioY },
        };
        isCalibrating = false;

        self.postMessage({
          type: 'calibration_complete',
          baseline: currentBaseline,
        });
      }
    }

    const analysis = analyzeFaceMetrics(landmark, blendshapes, matrix, currentBaseline, numFaces);

    self.postMessage({
      type: 'result',
      facePresent: analysis.facePresent,
      numFaces: analysis.numFaces,
      multiFaceDetected: analysis.multiFaceDetected,
      readingSuspected: analysis.readingSuspected,
      eyesClosed: analysis.eyesClosed,
      lookingAway: analysis.lookingAway,
      headTurnedAway: analysis.headTurnedAway,
      alert: analysis.alert,
      category: analysis.category,
      eyeConfidence: analysis.eyeConfidence,
      headPose: matrix.slice(0, 16),
      relativeYaw: analysis.relativeYaw,
      relativePitch: analysis.relativePitch,
      irisRatioOffset: analysis.irisRatioOffset,
      expression: analysis.expression,
      iris,
      eyeOpen: blendshapes
        .filter((shape) => shape.categoryName === 'eyeBlinkLeft' || shape.categoryName === 'eyeBlinkRight')
        .map((shape) => 1 - shape.score),
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Face tracking frame failed.',
    });
  } finally {
    message.bitmap.close();
  }
};
