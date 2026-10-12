'use client';

import { Mic, MicOff, Video, Settings, Lock, LogOut } from 'lucide-react';

interface MeetingControlBarProps {
  micOn: boolean;
  onToggleMic: () => void;
  onOpenSettings?: () => void;
  /** Device switching is only offered pre-join, to avoid disrupting the
   * proctoring watchdog's track listeners once the interview is live. */
  settingsEnabled?: boolean;
  onLeave?: () => void;
}

/**
 * Zoom/Google-Meet-style control bar: mic mute toggle, a camera indicator
 * (always on and locked — this interview's proctoring policy requires the
 * webcam to stay on for the full session, so unlike mic there is no
 * candidate-facing camera-off control), a settings button for picking
 * which camera/microphone to use, and an optional leave button.
 */
export function MeetingControlBar({
  micOn,
  onToggleMic,
  onOpenSettings,
  settingsEnabled = true,
  onLeave,
}: MeetingControlBarProps) {
  return (
    <div className="flex items-center justify-center gap-3 p-3 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm transition-colors">
      <button
        id="meeting-toggle-mic"
        type="button"
        onClick={onToggleMic}
        aria-pressed={micOn}
        title={micOn ? 'Mute microphone' : 'Unmute microphone'}
        className={`flex items-center justify-center w-11 h-11 rounded-full transition-all cursor-pointer ${
          micOn
            ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700'
            : 'bg-red-500 text-white hover:bg-red-400'
        }`}
      >
        {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
      </button>

      <button
        id="meeting-camera-locked"
        type="button"
        disabled
        title="Camera must stay on for the duration of the interview"
        className="relative flex items-center justify-center w-11 h-11 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-white opacity-60 cursor-not-allowed"
      >
        <Video className="w-5 h-5" />
        <Lock className="w-2.5 h-2.5 absolute -bottom-0.5 -right-0.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded-full p-0.5" />
      </button>

      {onOpenSettings && (
        <button
          id="meeting-open-settings"
          type="button"
          onClick={onOpenSettings}
          disabled={!settingsEnabled}
          title={settingsEnabled ? 'Camera & microphone settings' : 'Device settings are only available before you join'}
          className="flex items-center justify-center w-11 h-11 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
        >
          <Settings className="w-5 h-5" />
        </button>
      )}

      {onLeave && (
        <button
          id="meeting-control-leave-btn"
          type="button"
          onClick={onLeave}
          title="Exit interview session"
          className="flex items-center justify-center gap-1.5 px-4 h-11 rounded-full bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer ml-1"
        >
          <LogOut className="w-4 h-4" />
          <span>Exit</span>
        </button>
      )}
    </div>
  );
}
