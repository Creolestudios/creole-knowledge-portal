'use client';

import { Mic, MicOff, Video, Settings, Lock } from 'lucide-react';

interface MeetingControlBarProps {
  micOn: boolean;
  onToggleMic: () => void;
  onOpenSettings?: () => void;
  /** Device switching is only offered pre-join, to avoid disrupting the
   * proctoring watchdog's track listeners once the interview is live. */
  settingsEnabled?: boolean;
}

/**
 * Zoom/Google-Meet-style control bar: mic mute toggle, a camera indicator
 * (always on and locked — this interview's proctoring policy requires the
 * webcam to stay on for the full session, so unlike mic there is no
 * candidate-facing camera-off control), and a settings button for picking
 * which camera/microphone to use.
 */
export function MeetingControlBar({ micOn, onToggleMic, onOpenSettings, settingsEnabled = true }: MeetingControlBarProps) {
  return (
    <div className="flex items-center justify-center gap-3 p-3 bg-zinc-900 rounded-2xl border border-zinc-800">
      <button
        id="meeting-toggle-mic"
        type="button"
        onClick={onToggleMic}
        aria-pressed={micOn}
        title={micOn ? 'Mute microphone' : 'Unmute microphone'}
        className={`flex items-center justify-center w-11 h-11 rounded-full transition-all ${
          micOn ? 'bg-zinc-800 text-white hover:bg-zinc-700' : 'bg-red-500 text-white hover:bg-red-400'
        }`}
      >
        {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      </button>

      <button
        id="meeting-camera-locked"
        type="button"
        disabled
        title="Camera must stay on for the duration of the interview"
        className="relative flex items-center justify-center w-11 h-11 rounded-full bg-zinc-800 text-white opacity-60 cursor-not-allowed"
      >
        <Video className="w-5 h-5" />
        <Lock className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 bg-zinc-700 rounded-full p-0.5" />
      </button>

      {onOpenSettings && (
        <button
          id="meeting-open-settings"
          type="button"
          onClick={onOpenSettings}
          disabled={!settingsEnabled}
          title={settingsEnabled ? 'Camera & microphone settings' : 'Device settings are only available before you join'}
          className="flex items-center justify-center w-11 h-11 rounded-full bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <Settings className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
