'use client';

import { useEffect, useRef } from 'react';
import { Camera } from 'lucide-react';

interface QuizCameraPreviewProps {
  stream: MediaStream | null;
  visible: boolean;
}

/**
 * Meet-style PIP camera tile. Preview only — does not record or upload.
 */
export function QuizCameraPreview({ stream, visible }: QuizCameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (visible && stream) {
      el.srcObject = stream;
      try {
        const playResult = el.play();
        if (playResult && typeof (playResult as Promise<void>).catch === 'function') {
          void (playResult as Promise<void>).catch(() => {
            // Autoplay can fail if the tab is backgrounded; stream is still live.
          });
        }
      } catch {
        // jsdom / restricted autoplay — stream still attached for preview.
      }
    } else {
      el.srcObject = null;
    }

    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream, visible]);

  if (!visible || !stream) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 w-36 sm:w-44 overflow-hidden rounded-2xl border border-zinc-700/80 bg-black shadow-2xl shadow-black/50"
      aria-label="Your camera preview"
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="aspect-[3/4] h-full w-full object-cover scale-x-[-1]"
      />
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
        <Camera size={10} />
        You
      </div>
    </div>
  );
}
