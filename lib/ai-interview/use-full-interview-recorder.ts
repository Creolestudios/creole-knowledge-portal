'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

export interface UseFullInterviewRecorderOptions {
  interviewId: string;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  enabled?: boolean;
}

export interface UploadResult {
  success: boolean;
  fileId?: string;
  webViewLink?: string;
  previewUrl?: string;
  error?: string;
}

const PREFERRED_MIME_TYPES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4',
];

function pickSupportedMimeType(): string {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return 'video/webm';
  }
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

/**
 * useFullInterviewRecorder
 *
 * Implements the full video recording architecture:
 * 1. Off-screen canvas compositor (1280x720 @ 15fps) combining Screen (full) + Camera (PiP) + Audio.
 * 2. MediaRecorder collecting the complete continuous video in browser memory.
 * 3. Single whole-video direct upload to Google Drive via resumable upload session,
 *    bypassing Next.js 4.5MB payload limits with 0%-100% progress tracking.
 */
export function useFullInterviewRecorder({
  interviewId,
  cameraStream,
  screenStream,
  enabled = true,
}: UseFullInterviewRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState('');

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);

  // Setup offscreen canvas and video elements for compositing
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (!hiddenCanvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      hiddenCanvasRef.current = canvas;
    }

    if (!screenVideoRef.current) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      screenVideoRef.current = v;
    }

    if (!cameraVideoRef.current) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      cameraVideoRef.current = v;
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, []);

  // Update source streams on the hidden video elements
  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      if (screenVideoRef.current.srcObject !== screenStream) {
        screenVideoRef.current.srcObject = screenStream;
        try {
          void screenVideoRef.current.play()?.catch(() => {});
        } catch {
          // Ignore JSDOM synchronous play not implemented
        }
      }
    }
  }, [screenStream]);

  useEffect(() => {
    if (cameraVideoRef.current && cameraStream) {
      if (cameraVideoRef.current.srcObject !== cameraStream) {
        cameraVideoRef.current.srcObject = cameraStream;
        try {
          void cameraVideoRef.current.play()?.catch(() => {});
        } catch {
          // Ignore JSDOM synchronous play not implemented
        }
      }
    }
  }, [cameraStream]);

  /**
   * Starts the offscreen canvas render loop (15 FPS target)
   */
  const startCompositorLoop = useCallback(() => {
    const canvas = hiddenCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = (time: number) => {
      // Throttle to 15 FPS (~66.6ms) to prevent CPU overload and thermal throttling
      if (time - lastFrameTimeRef.current >= 66) {
        lastFrameTimeRef.current = time;

        const screenVid = screenVideoRef.current;
        const camVid = cameraVideoRef.current;

        // Background: Screen share
        if (screenVid && screenVid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          ctx.drawImage(screenVid, 0, 0, canvas.width, canvas.height);
        } else if (camVid && camVid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          // If no screen share, draw camera full screen
          ctx.drawImage(camVid, 0, 0, canvas.width, canvas.height);
        } else {
          // Placeholder dark slate background
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Picture-in-Picture: Candidate Camera in bottom-right corner
        if (
          screenVid &&
          screenVid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          camVid &&
          camVid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          const pipWidth = 320;
          const pipHeight = 180;
          const pipMargin = 24;
          const pipX = canvas.width - pipWidth - pipMargin;
          const pipY = canvas.height - pipHeight - pipMargin;

          // Draw subtle drop shadow / border
          ctx.fillStyle = '#000000';
          ctx.fillRect(pipX - 2, pipY - 2, pipWidth + 4, pipHeight + 4);

          // Draw camera frame
          ctx.drawImage(camVid, pipX, pipY, pipWidth, pipHeight);
        }
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    animFrameRef.current = requestAnimationFrame(render);
  }, []);

  /**
   * Starts full-session recording
   */
  const startRecording = useCallback(() => {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
      console.warn('[useFullInterviewRecorder] MediaRecorder not supported');
      return;
    }
    if (isRecordingRef.current) return;
    if (!enabled) return;

    try {
      startCompositorLoop();

      const canvas = hiddenCanvasRef.current;
      if (!canvas) return;

      // Capture 15fps composite video stream
      const stream = (canvas as any).captureStream ? (canvas as any).captureStream(15) : null;
      if (!stream) {
        console.warn('[useFullInterviewRecorder] canvas.captureStream not supported');
        return;
      }

      // Attach audio tracks (candidate mic + screen audio)
      const micAudioTracks = cameraStream?.getAudioTracks() ?? [];
      const screenAudioTracks = screenStream?.getAudioTracks() ?? [];
      [...micAudioTracks, ...screenAudioTracks].forEach((track) => {
        stream.addTrack(track);
      });

      compositeStreamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickSupportedMimeType();
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 500_000, // 500 kbps for optimal compression & minimal RAM
      });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      // Output chunk every 5 seconds so data is flushed safely
      recorder.start(5000);

      recorderRef.current = recorder;
      isRecordingRef.current = true;
      setIsRecording(true);
      console.info('[useFullInterviewRecorder] Recording started successfully');
    } catch (err) {
      console.error('[useFullInterviewRecorder] Failed to start recording:', err);
    }
  }, [enabled, cameraStream, screenStream, startCompositorLoop]);

  /**
   * Stops recording and uploads the WHOLE single video directly to Google Drive
   */
  const stopAndUploadRecording = useCallback(async (): Promise<UploadResult> => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder) {
      return { success: false, error: 'No active recorder' };
    }

    setIsRecording(false);
    isRecordingRef.current = false;
    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatusText('Preparing full interview video recording...');

    return new Promise<UploadResult>((resolve) => {
      recorder.onstop = async () => {
        try {
          const mimeType = recorder.mimeType || 'video/webm';
          const fullVideoBlob = new Blob(chunksRef.current, { type: mimeType });

          if (fullVideoBlob.size === 0) {
            console.warn('[useFullInterviewRecorder] Recorded video size is 0 bytes.');
            setIsUploading(false);
            resolve({ success: false, error: 'Empty recording' });
            return;
          }

          setUploadStatusText('Requesting secure Google Drive upload session...');
          setUploadProgress(5);

          // 1. Request Google Drive Resumable Upload Session from backend
          const sessionRes = await fetch('/api/interview/recording/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interviewId,
              fileSize: fullVideoBlob.size,
              mimeType,
            }),
          });

          const sessionJson = await sessionRes.json().catch(() => null);

          if (!sessionRes.ok || !sessionJson) {
            const errMsg = sessionJson?.error || 'Failed to initialize Drive session';
            console.warn('[useFullInterviewRecorder]', errMsg);
            setIsUploading(false);
            resolve({ success: false, error: errMsg });
            return;
          }

          if (sessionJson.notConfigured) {
            console.info('[useFullInterviewRecorder] Drive credentials not configured. Skipping upload.');
            setIsUploading(false);
            resolve({ success: true, error: 'Drive not configured' });
            return;
          }

          const { uploadUrl, fileName } = sessionJson;

          setUploadStatusText('Uploading full interview video to Google Drive...');
          setUploadProgress(10);

          // 2. Direct upload WHOLE video Blob to Google Drive with real-time progress
          const uploadPromise = new Promise<{ fileId?: string }>((uploadResolve, uploadReject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', uploadUrl, true);
            xhr.setRequestHeader('Content-Type', mimeType);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable && event.total > 0) {
                // Map progress from 10% to 90%
                const percent = Math.round(10 + (event.loaded / event.total) * 80);
                setUploadProgress(percent);
                setUploadStatusText(`Uploading full interview video to Google Drive... ${percent}%`);
              }
            };

            xhr.onload = () => {
              if (xhr.status === 200 || xhr.status === 201) {
                try {
                  const driveFile = JSON.parse(xhr.responseText);
                  uploadResolve({ fileId: driveFile.id });
                } catch {
                  uploadResolve({});
                }
              } else {
                uploadReject(new Error(`Drive direct upload returned HTTP ${xhr.status}: ${xhr.responseText}`));
              }
            };

            xhr.onerror = () => {
              uploadReject(new Error('Network error occurred during Google Drive upload'));
            };

            xhr.send(fullVideoBlob);
          });

          const { fileId } = await uploadPromise;

          // 3. Drop in-memory blobs immediately for instant garbage collection (OOM prevention)
          chunksRef.current = [];

          if (!fileId) {
            setUploadStatusText('Upload complete, finalizing video link...');
          }

          setUploadProgress(95);
          setUploadStatusText('Finalizing video permissions and saving to dashboard...');

          // 4. Notify backend to finalize permissions and record event in interview_events
          const completeRes = await fetch('/api/interview/recording/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interviewId,
              fileId: fileId || 'pending_drive_file',
              fileName,
            }),
          });

          const completeJson = await completeRes.json().catch(() => null);

          setUploadProgress(100);
          setUploadStatusText('Interview recording secured successfully!');
          setIsUploading(false);

          resolve({
            success: true,
            fileId: completeJson?.fileId || fileId,
            webViewLink: completeJson?.webViewLink,
            previewUrl: completeJson?.previewUrl,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[useFullInterviewRecorder] Upload error:', errMsg);
          setIsUploading(false);
          resolve({ success: false, error: errMsg });
        }
      };

      try {
        recorder.stop();
      } catch (err) {
        console.warn('[useFullInterviewRecorder] recorder.stop exception:', err);
        setIsUploading(false);
        resolve({ success: false, error: 'Stop recorder failed' });
      }
    });
  }, [interviewId]);

  return {
    isRecording,
    isUploading,
    uploadProgress,
    uploadStatusText,
    startRecording,
    stopAndUploadRecording,
  };
}
