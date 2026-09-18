import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
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

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  if (message.type === 'init') {
    try {
      const origin = typeof self !== 'undefined' && self.location ? self.location.origin : '';
      const wasmPath = `${origin}/mediapipe/wasm`;

      const filesetResolver = await FilesetResolver.forVisionTasks(wasmPath);
      faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 2, // Enable multi-face detection
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
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
    const numFaces = result.faceLandmarks?.length ?? 0;
    const landmark = result.faceLandmarks?.[0];
    const blendshapes = result.faceBlendshapes?.[0]?.categories ?? [];
    const matrix = result.facialTransformationMatrixes?.[0]?.data ?? [];
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
