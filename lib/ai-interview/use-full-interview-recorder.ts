'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  saveRecordingChunk,
  getAllRecordingChunks,
  clearRecordingChunks,
} from './recording-storage';

export interface UseFullInterviewRecorderOptions {
  interviewId: string;
  cameraStream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStream?: MediaStream | null;
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

export function pickSupportedMimeType(): string {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return 'video/webm';
  }
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

/**
 * Recovers and uploads any cached video chunks left in IndexedDB
 * (e.g., following an abrupt browser reload, crash, or refresh termination).
 */
export async function flushAndUploadCachedRecording(
  interviewId: string,
  onProgress?: (progress: number, statusText: string) => void
): Promise<UploadResult> {
  if (typeof window === 'undefined') return { success: false, error: 'SSR environment' };
  try {
    let cachedChunks = await getAllRecordingChunks(interviewId);
    if (!cachedChunks || cachedChunks.length === 0) {
      // Retry once after 500ms in case the write was settling during page transition
      await new Promise((r) => setTimeout(r, 500));
      cachedChunks = await getAllRecordingChunks(interviewId);
    }
    if (!cachedChunks || cachedChunks.length === 0) {
      return { success: false, error: 'No cached recording chunks' };
    }

    onProgress?.(10, 'Finalizing assessment submission...');

    const mimeType = pickSupportedMimeType() || 'video/webm';
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const fullVideoBlob = new Blob(cachedChunks, { type: mimeType });

    if (fullVideoBlob.size === 0) {
      return { success: false, error: 'Empty cached recording' };
    }

    onProgress?.(25, 'Finalizing assessment submission...');

    const clientOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
    let fileId: string | undefined;
    let webViewLink: string | undefined;
    let previewUrl: string | undefined;

    // 1. Try direct Google Drive Resumable Upload session first (skip on localhost to avoid browser CORS stall)
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!isLocalhost) {
      try {
        const sessionRes = await fetch('/api/interview/recording/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interviewId,
            fileSize: fullVideoBlob.size,
            mimeType,
            origin: clientOrigin,
          }),
        });

        const sessionJson = await sessionRes.json().catch(() => null);
        if (sessionJson?.uploadUrl) {
          onProgress?.(40, 'Finalizing assessment submission...');
          const directResult = await new Promise<{ fileId?: string }>((resolveUpload, rejectUpload) => {
            const xhr = new XMLHttpRequest();
            const timer = setTimeout(() => {
              try { xhr.abort(); } catch {}
              rejectUpload(new Error('Direct Drive upload timed out'));
            }, 5000);

            xhr.open('PUT', sessionJson.uploadUrl, true);
            xhr.setRequestHeader('Content-Type', mimeType);

            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable && event.total > 0) {
                const percent = Math.min(95, Math.round(40 + (event.loaded / event.total) * 50));
                onProgress?.(percent, `Finalizing assessment submission... ${percent}%`);
              }
            };

            xhr.onload = () => {
              clearTimeout(timer);
              if (xhr.status === 200 || xhr.status === 201) {
                try {
                  const driveFile = JSON.parse(xhr.responseText);
                  resolveUpload({ fileId: driveFile.id });
                } catch {
                  resolveUpload({});
                }
              } else {
                rejectUpload(new Error(`Drive PUT returned ${xhr.status}`));
              }
            };

            xhr.onerror = () => {
              clearTimeout(timer);
              rejectUpload(new Error('Network error during direct Drive upload'));
            };
            xhr.ontimeout = () => {
              clearTimeout(timer);
              rejectUpload(new Error('Direct Drive upload timed out'));
            };
            xhr.send(fullVideoBlob);
          });

          fileId = directResult.fileId;
          if (fileId) {
            webViewLink = `https://drive.google.com/file/d/${fileId}/view`;
            previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
          }
        }
      } catch (directErr) {
        console.warn('[flushAndUploadCachedRecording] Direct Drive upload notice, falling back to server route:', directErr);
      }
    }

    // 2. Failsafe Fallback: server-side upload endpoint
    if (!fileId) {
      onProgress?.(50, 'Uploading video securely via interview server...');
      const fileName = `interview_${interviewId}_recovered.${ext}`;
      const formData = new FormData();
      formData.append('interviewId', interviewId);
      formData.append('file', fullVideoBlob, fileName);

      try {
        const res = await fetch('/api/interview/recording/upload', {
          method: 'POST',
          body: formData,
        });

        const json = await res.json().catch(() => null);
        if (res.ok && json?.ok) {
          fileId = json.fileId;
          webViewLink = json.webViewLink;
          previewUrl = json.previewUrl;
        } else {
          return { success: false, error: json?.error || 'Failed to upload recovered video' };
        }
      } catch (uploadFetchErr) {
        console.warn('[flushAndUploadCachedRecording] Server route fetch error:', uploadFetchErr);
        return { success: false, error: uploadFetchErr instanceof Error ? uploadFetchErr.message : 'Upload network error' };
      }
    }

    if (fileId) {
      await clearRecordingChunks(interviewId);
      try {
        await fetch('/api/interview/recording/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interviewId,
            fileId,
          }),
        });
      } catch (completeErr) {
        console.warn('[flushAndUploadCachedRecording] Failed to call complete route:', completeErr);
      }
      onProgress?.(100, 'Assessment submission completed');
      console.info('[useFullInterviewRecorder] Recovered video successfully uploaded to Google Drive:', fileId);
      return {
        success: true,
        fileId,
        webViewLink,
        previewUrl,
      };
    }

    return { success: false, error: 'Upload failed' };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * useFullInterviewRecorder
 *
 * Implements the full video recording architecture:
 * 1. Off-screen canvas compositor (1280x720 @ 15fps) combining Screen (full) + Camera + Remote Admin.
 * 2. Web Audio API mixer blending candidate mic, screen audio, and dynamic admin audio.
 * 3. MediaRecorder collecting the complete continuous video in browser memory.
 * 4. Single whole-video direct upload to Google Drive via resumable upload session,
 *    bypassing Next.js 4.5MB payload limits with 0%-100% progress tracking.
 */
export function useFullInterviewRecorder({
  interviewId,
  cameraStream,
  screenStream,
  remoteStream,
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
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const recordingStartTimeRef = useRef<number | null>(null);

  // Progressive live streaming refs
  const uploadUrlRef = useRef<string | null>(null);
  const uploadedByteOffsetRef = useRef<number>(0);
  const streamingBufferRef = useRef<Blob[]>([]);
  const isStreamingChunkRef = useRef<boolean>(false);

  // Web Audio mixing refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const remoteAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Setup offscreen canvas and video elements for compositing
  useEffect(() => {
    if (typeof document === 'undefined') return;

    let container = document.getElementById('interview-recorder-hidden-dom');
    if (!container) {
      container = document.createElement('div');
      container.id = 'interview-recorder-hidden-dom';
      container.style.position = 'fixed';
      container.style.top = '-9999px';
      container.style.left = '-9999px';
      container.style.width = '1px';
      container.style.height = '1px';
      container.style.opacity = '0.001';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '-9999';
      document.body.appendChild(container);
    }

    if (!hiddenCanvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      container.appendChild(canvas);
      hiddenCanvasRef.current = canvas;
    }

    if (!screenVideoRef.current) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      container.appendChild(v);
      screenVideoRef.current = v;
    }

    if (!cameraVideoRef.current) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      container.appendChild(v);
      cameraVideoRef.current = v;
    }

    if (!remoteVideoRef.current) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      container.appendChild(v);
      remoteVideoRef.current = v;
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (audioContextRef.current) {
        try {
          void audioContextRef.current.close();
        } catch {
          // ignore
        }
        audioContextRef.current = null;
      }
      if (container && container.parentNode) {
        try {
          container.parentNode.removeChild(container);
        } catch {
          // ignore
        }
      }
      hiddenCanvasRef.current = null;
      screenVideoRef.current = null;
      cameraVideoRef.current = null;
      remoteVideoRef.current = null;
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

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        try {
          void remoteVideoRef.current.play()?.catch(() => {});
        } catch {
          // Ignore JSDOM synchronous play not implemented
        }
      }
    }
  }, [remoteStream]);

  // Dynamically attach or detach remote admin audio when admin connects or leaves
  useEffect(() => {
    const audioCtx = audioContextRef.current;
    const destination = audioDestinationRef.current;

    // Disconnect previous remote source if any
    if (remoteAudioSourceRef.current) {
      try {
        remoteAudioSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      remoteAudioSourceRef.current = null;
    }

    if (!audioCtx || !destination || !remoteStream) return;

    if (remoteStream.getAudioTracks().length > 0) {
      try {
        if (audioCtx.state === 'suspended') {
          void audioCtx.resume();
        }
        const source = audioCtx.createMediaStreamSource(remoteStream);
        source.connect(destination);
        remoteAudioSourceRef.current = source;
      } catch (err) {
        console.warn('[useFullInterviewRecorder] Failed to dynamically connect remote audio:', err);
      }
    }
  }, [remoteStream]);

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
        const remoteVid = remoteVideoRef.current;

        // Clean single-screen recording:
        // Prioritize the interview screen share (which already contains the candidate webcam and question UI)
        if (screenVid && screenVid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          ctx.drawImage(screenVid, 0, 0, canvas.width, canvas.height);
        } else if (camVid && camVid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          // Fallback to candidate camera full-screen if no screen share is present
          ctx.drawImage(camVid, 0, 0, canvas.width, canvas.height);
          if (remoteVid && remoteVid.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const pipW = Math.round(canvas.width * 0.25);
            const pipH = Math.round(canvas.height * 0.25);
            ctx.drawImage(remoteVid, canvas.width - pipW - 16, 16, pipW, pipH);
          }
        } else {
          // Placeholder dark slate background
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
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
      let stream: MediaStream | null = null;
      try {
        const captureStreamFn =
          canvas ? ((canvas as any).captureStream || (canvas as any).mozCaptureStream) : null;
        if (captureStreamFn) {
          stream = captureStreamFn.call(canvas, 15);
        }
      } catch (err) {
        console.warn('[useFullInterviewRecorder] canvas.captureStream failed:', err);
      }

      // Robust cross-device fallback: if canvas.captureStream fails or is unsupported on mobile/Safari,
      // record screenStream or cameraStream directly so interview video is ALWAYS captured!
      if (!stream || stream.getVideoTracks().length === 0) {
        stream = screenStream || cameraStream || null;
      }
      if (!stream) {
        console.warn('[useFullInterviewRecorder] No video streams available for recording');
        return;
      }

      // Mix audio via AudioContext so candidate mic, screen audio, and dynamic admin audio blend seamlessly
      let mixedAudioTrack: MediaStreamTrack | null = null;
      try {
        const AudioContextClass =
          typeof window !== 'undefined'
            ? window.AudioContext || (window as any).webkitAudioContext
            : null;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          if (audioCtx.state === 'suspended') {
            void audioCtx.resume().catch(() => {});
          }
          audioContextRef.current = audioCtx;
          const destination = audioCtx.createMediaStreamDestination();
          audioDestinationRef.current = destination;

          if (cameraStream && cameraStream.getAudioTracks().length > 0) {
            try {
              const micSource = audioCtx.createMediaStreamSource(cameraStream);
              micSource.connect(destination);
            } catch (e) {
              console.warn('[useFullInterviewRecorder] Failed to connect camera audio:', e);
            }
          }

          if (screenStream && screenStream.getAudioTracks().length > 0) {
            try {
              const screenSource = audioCtx.createMediaStreamSource(screenStream);
              screenSource.connect(destination);
            } catch (e) {
              console.warn('[useFullInterviewRecorder] Failed to connect screen audio:', e);
            }
          }

          if (remoteStream && remoteStream.getAudioTracks().length > 0) {
            try {
              const remoteSource = audioCtx.createMediaStreamSource(remoteStream);
              remoteSource.connect(destination);
              remoteAudioSourceRef.current = remoteSource;
            } catch (e) {
              console.warn('[useFullInterviewRecorder] Failed to connect remote audio:', e);
            }
          }

          mixedAudioTrack = destination.stream.getAudioTracks()[0] || null;
        }
      } catch (err) {
        console.warn('[useFullInterviewRecorder] Web Audio API initialization failed, falling back:', err);
      }

      // Safely combine video and audio tracks into recordable stream
      const videoTracks = stream.getVideoTracks();
      const audioTracks = mixedAudioTrack
        ? [mixedAudioTrack]
        : [
            ...(cameraStream?.getAudioTracks() ?? []),
            ...(screenStream?.getAudioTracks() ?? []),
            ...(remoteStream?.getAudioTracks() ?? []),
          ];

      const recordableStream = new MediaStream([...videoTracks, ...audioTracks]);
      compositeStreamRef.current = recordableStream;
      chunksRef.current = [];

      const mimeType = pickSupportedMimeType();
      const recorderOptions: MediaRecorderOptions = {
        videoBitsPerSecond: 500_000, // 500 kbps for optimal compression & minimal RAM
      };
      if (mimeType) {
        recorderOptions.mimeType = mimeType;
      }
      const recorder = new MediaRecorder(recordableStream, recorderOptions);

      // Pre-initialize Google Drive Resumable Upload session in background
      uploadUrlRef.current = null;
      uploadedByteOffsetRef.current = 0;
      streamingBufferRef.current = [];
      isStreamingChunkRef.current = false;

      fetch('/api/interview/recording/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId, mimeType }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data?.uploadUrl) {
            uploadUrlRef.current = data.uploadUrl;
            console.info('[useFullInterviewRecorder] Live Drive upload session ready');
          }
        })
        .catch(() => {});

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
          streamingBufferRef.current.push(e.data);
          void saveRecordingChunk(interviewId, e.data);
          void drainStreamingBuffer(false);
        }
      };

      // Output chunk every 2.5 seconds so data is flushed safely into browser IndexedDB & live streamed
      recorder.start(2500);

      recorderRef.current = recorder;
      recordingStartTimeRef.current = Date.now();
      isRecordingRef.current = true;
      setIsRecording(true);
      console.info('[useFullInterviewRecorder] Recording started successfully');
    } catch (err) {
      console.error('[useFullInterviewRecorder] Failed to start recording:', err);
    }
  }, [enabled, cameraStream, screenStream, remoteStream, startCompositorLoop, interviewId]);

  /**
   * Progressively drains accumulated video buffer slices to Google Drive in multiples of 256 KiB.
   */
  const drainStreamingBuffer = useCallback(
    async (forceFinal = false): Promise<UploadResult | null> => {
      if (isStreamingChunkRef.current) return null;
      const currentChunks = [...streamingBufferRef.current];
      if (currentChunks.length === 0 && !forceFinal) return null;

      const totalPendingBytes = currentChunks.reduce((acc, c) => acc + c.size, 0);
      const CHUNK_UNIT = 262144; // 256 KiB required by Google Drive
      if (!forceFinal && totalPendingBytes < CHUNK_UNIT) {
        return null;
      }

      let sliceBytes = totalPendingBytes;
      if (!forceFinal) {
        sliceBytes = Math.floor(totalPendingBytes / CHUNK_UNIT) * CHUNK_UNIT;
      }

      if (sliceBytes === 0 && !forceFinal) return null;

      isStreamingChunkRef.current = true;
      try {
        const mimeType = recorderRef.current?.mimeType || pickSupportedMimeType() || 'video/webm';
        const combinedBlob = new Blob(currentChunks, { type: mimeType });
        const chunkBlob = combinedBlob.slice(0, sliceBytes);
        const remainingBlob = combinedBlob.slice(sliceBytes);

        const startByte = uploadedByteOffsetRef.current;
        const durationSeconds = recordingStartTimeRef.current
          ? Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000))
          : undefined;

        const payloadBytes = await chunkBlob.arrayBuffer();
        const useKeepalive = forceFinal && payloadBytes.byteLength <= 65536;

        const res = await fetch('/api/interview/recording/stream-chunk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-interview-id': interviewId,
            'x-upload-url': uploadUrlRef.current || '',
            'x-start-byte': String(startByte),
            'x-is-final': forceFinal ? 'true' : 'false',
            'x-mime-type': mimeType,
            ...(durationSeconds ? { 'x-duration-seconds': String(durationSeconds) } : {}),
            ...(recordingStartTimeRef.current ? { 'x-recording-start-time': String(recordingStartTimeRef.current) } : {}),
          },
          body: payloadBytes,
          ...(useKeepalive ? { keepalive: true } : {}),
        });

        const json = await res.json().catch(() => null);
        if (json?.uploadUrl && !uploadUrlRef.current) {
          uploadUrlRef.current = json.uploadUrl;
        }

        if (res.ok && (json?.ok || json?.status === 308)) {
          uploadedByteOffsetRef.current += sliceBytes;
          streamingBufferRef.current = remainingBlob.size > 0 ? [remainingBlob] : [];
          if (forceFinal && json?.isComplete && json?.fileId) {
            return {
              success: true,
              fileId: json.fileId,
              webViewLink: json.webViewLink,
              previewUrl: json.previewUrl,
            };
          }
        }
      } catch (err) {
        console.warn('[useFullInterviewRecorder] Live stream chunk notice:', err);
      } finally {
        isStreamingChunkRef.current = false;
      }
      return null;
    },
    [interviewId]
  );

  /**
   * Stops recording and uploads the WHOLE single video directly to Google Drive
   */
  const stopAndUploadRecording = useCallback(async (): Promise<UploadResult> => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    const recorder = recorderRef.current;
    if (!recorder && chunksRef.current.length === 0) {
      return { success: false, error: 'No active recorder' };
    }

    setIsRecording(false);
    isRecordingRef.current = false;
    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatusText('Preparing full interview video recording...');

    return new Promise<UploadResult>((resolve) => {
      let uploadHandled = false;

      const executeUpload = async () => {
        if (uploadHandled) return;
        uploadHandled = true;

        try {
          // Fast-path: If chunks were streamed to Drive in real time, finalize immediately (< 1s)
          if (uploadedByteOffsetRef.current > 0) {
            setUploadStatusText('Finalizing assessment submission...');
            setUploadProgress(95);

            const streamResult = await drainStreamingBuffer(true);
            if (streamResult?.success && streamResult?.fileId) {
              chunksRef.current = [];
              streamingBufferRef.current = [];
              void clearRecordingChunks(interviewId);
              setUploadProgress(100);
              setUploadStatusText('Assessment submission completed successfully!');
              setIsUploading(false);
              resolve(streamResult);
              return;
            }
          }

          if (chunksRef.current.length === 0) {
            const cached = await getAllRecordingChunks(interviewId);
            if (cached && cached.length > 0) {
              chunksRef.current = cached;
            }
          }

          const mimeType = recorder?.mimeType || pickSupportedMimeType() || 'video/webm';
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const fullVideoBlob = new Blob(chunksRef.current, { type: mimeType });

          if (fullVideoBlob.size === 0) {
            console.warn('[useFullInterviewRecorder] Recorded video size is 0 bytes.');
            setIsUploading(false);
            resolve({ success: false, error: 'Empty recording' });
            return;
          }

          setUploadStatusText('Finalizing assessment submission...');
          setUploadProgress(5);

          const clientOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;

          // 1. Request Google Drive Resumable Upload Session from backend
          const sessionRes = await fetch('/api/interview/recording/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interviewId,
              fileSize: fullVideoBlob.size,
              mimeType,
              origin: clientOrigin,
            }),
          });

          const sessionJson = await sessionRes.json().catch(() => null);

          if (sessionJson?.notConfigured) {
            console.info('[useFullInterviewRecorder] Drive credentials not configured. Skipping upload.');
            setIsUploading(false);
            resolve({ success: true, error: 'Drive not configured' });
            return;
          }

          const uploadUrl = sessionJson?.uploadUrl;
          const fileName = sessionJson?.fileName || `interview_${interviewId}.${ext}`;

          let fileId: string | undefined;
          const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

          if (uploadUrl && !isLocalhost) {
            try {
              setUploadStatusText('Finalizing assessment submission...');
              setUploadProgress(10);

              // 2. Direct upload WHOLE video Blob to Google Drive with real-time progress
              const directResult = await new Promise<{ fileId?: string }>((uploadResolve, uploadReject) => {
                const xhr = new XMLHttpRequest();
                const timer = setTimeout(() => {
                  try { xhr.abort(); } catch {}
                  uploadReject(new Error('Direct Drive upload timed out'));
                }, 5000);

                xhr.open('PUT', uploadUrl, true);
                xhr.setRequestHeader('Content-Type', mimeType);

                xhr.upload.onprogress = (event) => {
                  if (event.lengthComputable && event.total > 0) {
                    const percent = Math.round(10 + (event.loaded / event.total) * 80);
                    setUploadProgress(percent);
                    setUploadStatusText(`Finalizing assessment submission... ${percent}%`);
                  }
                };

                xhr.onload = () => {
                  clearTimeout(timer);
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
                  clearTimeout(timer);
                  uploadReject(new Error('CORS or network error occurred during Google Drive direct upload'));
                };

                xhr.ontimeout = () => {
                  clearTimeout(timer);
                  uploadReject(new Error('Direct Drive upload timed out'));
                };

                xhr.send(fullVideoBlob);
              });

              fileId = directResult.fileId;
            } catch (directUploadErr) {
              console.warn('[useFullInterviewRecorder] Direct upload encountered error, using server fallback:', directUploadErr);
            }
          }

          const durationSeconds = recordingStartTimeRef.current
            ? Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000))
            : undefined;
          const recordingStartTime = recordingStartTimeRef.current ?? undefined;

          // Failsafe fallback: when direct upload is blocked by browser CORS or session init was rejected, stream via server
          if (!fileId) {
            setUploadStatusText('Submitting assessment securely via server...');
            setUploadProgress(25);

            const formData = new FormData();
            formData.append('interviewId', interviewId);
            formData.append('file', fullVideoBlob, fileName);
            if (durationSeconds) formData.append('durationSeconds', String(durationSeconds));
            if (recordingStartTime) formData.append('recordingStartTime', String(recordingStartTime));

            const fallbackRes = await fetch('/api/interview/recording/upload', {
              method: 'POST',
              body: formData,
            });

            const fallbackJson = await fallbackRes.json().catch(() => null);
            if (!fallbackRes.ok || !fallbackJson?.ok) {
              const fallbackErrMsg = fallbackJson?.error || 'Server fallback upload failed';
              throw new Error(fallbackErrMsg);
            }

            chunksRef.current = [];
            void clearRecordingChunks(interviewId);
            setUploadProgress(100);
            setUploadStatusText('Assessment submission completed successfully!');
            setIsUploading(false);

            resolve({
              success: true,
              fileId: fallbackJson.fileId,
              webViewLink: fallbackJson.webViewLink,
              previewUrl: fallbackJson.previewUrl,
            });
            return;
          }

          // 3. Drop in-memory blobs immediately for instant garbage collection (OOM prevention)
          chunksRef.current = [];

          setUploadProgress(95);
          setUploadStatusText('Finalizing assessment submission...');

          // 4. Notify backend to finalize permissions and record event in interview_events
          const completeRes = await fetch('/api/interview/recording/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interviewId,
              fileId: fileId || 'pending_drive_file',
              fileName,
              durationSeconds,
              recordingStartTime,
            }),
          });

          const completeJson = await completeRes.json().catch(() => null);

          void clearRecordingChunks(interviewId);
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
          console.warn('[useFullInterviewRecorder] Upload notice:', errMsg);
          setIsUploading(false);
          resolve({ success: false, error: errMsg });
        }
      };

      if (!recorder) {
        void executeUpload();
        return;
      }

      recorder.onstop = () => {
        void executeUpload();
      };

      try {
        if (recorder.state === 'recording') {
          try {
            recorder.requestData();
          } catch {
            // ignore
          }
          recorder.stop();
        } else {
          // Recorder already inactive (e.g. tracks stopped), process collected chunks immediately
          void executeUpload();
        }
      } catch (err) {
        console.warn('[useFullInterviewRecorder] recorder.stop exception, executing upload on collected chunks:', err);
        void executeUpload();
      }
    });
  }, [interviewId]);

  // Flush pending MediaRecorder data to IndexedDB immediately on reload or page exit
  useEffect(() => {
    const handleUnloadFlush = () => {
      try {
        if (recorderRef.current && recorderRef.current.state === 'recording') {
          recorderRef.current.requestData();
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('beforeunload', handleUnloadFlush);
    window.addEventListener('pagehide', handleUnloadFlush);
    return () => {
      window.removeEventListener('beforeunload', handleUnloadFlush);
      window.removeEventListener('pagehide', handleUnloadFlush);
    };
  }, []);

  // Prevent accidental window close or navigation while video upload is in progress
  useEffect(() => {
    if (!isUploading) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Please wait until your assessment gets completely finished. Closing the tab will interrupt final submission.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isUploading]);

  /**
   * Returns current elapsed seconds of active recording (0 if not active)
   */
  const getRecordingOffsetSeconds = useCallback((): number => {
    if (!recordingStartTimeRef.current) return 0;
    return Math.max(0, Math.floor((Date.now() - recordingStartTimeRef.current) / 1000));
  }, []);

  return {
    isRecording,
    isUploading,
    uploadProgress,
    uploadStatusText,
    startRecording,
    stopAndUploadRecording,
    getRecordingOffsetSeconds,
  };
}
