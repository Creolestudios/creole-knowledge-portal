'use client';

import { useEffect, useRef } from 'react';
import { Mic, MicOff, User } from 'lucide-react';

interface MeetingVideoTileProps {
  stream: MediaStream | null;
  label?: string;
  micOn: boolean;
  size?: 'large' | 'small';
}

/**
 * Self-view video tile for the candidate's own camera — the on-screen
 * preview is always rendered `muted` (standard for a local video tile, to
 * avoid feedback) regardless of `micOn`; `micOn` only reflects whether the
 * underlying audio track is actually enabled (i.e. what the interview
 * recording/monitoring receives).
 */
export function MeetingVideoTile({ stream, label = 'You', micOn, size = 'large' }: MeetingVideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = !!stream && stream.getVideoTracks().some((track) => track.enabled && track.readyState === 'live');

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (stream) {
      el.srcObject = stream;
      void (async () => {
        try {
          await el.play();
        } catch {
          // Preview only; playback failure (e.g. backgrounded tab) is not fatal.
        }
      })();
    } else {
      el.srcObject = null;
    }

    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream]);

  const dimensions = size === 'large' ? 'aspect-video w-full' : 'aspect-[4/3] w-40 sm:w-48';

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-lg ${dimensions}`}
      aria-label={`${label} camera preview`}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`h-full w-full object-cover scale-x-[-1] transition-opacity ${hasVideo ? 'opacity-100' : 'opacity-0'}`}
      />

      {!hasVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 text-zinc-500">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center">
            <User className="w-6 h-6" />
          </div>
          <span className="text-[10px] uppercase tracking-wider">Camera off</span>
        </div>
      )}

      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
        <span>{label}</span>
      </div>

      <div
        className={`absolute bottom-2 right-2 flex items-center justify-center w-6 h-6 rounded-full ${
          micOn ? 'bg-black/60' : 'bg-red-500'
        }`}
      >
        {micOn ? <Mic className="w-3 h-3 text-white" /> : <MicOff className="w-3 h-3 text-white" />}
      </div>
    </div>
  );
}
