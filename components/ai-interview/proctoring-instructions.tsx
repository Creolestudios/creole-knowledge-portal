import { CheckCircle2, Camera, Mic, MonitorUp, AlertCircle, Loader2, ListChecks } from 'lucide-react';

const INSTRUCTIONS = [
  'Find a quiet, well-lit room and sit facing your camera for the full duration of the interview.',
  'Keep your webcam, microphone, and screen-share on at all times — the session cannot continue if any of them is turned off.',
  'Do not switch tabs, minimize the window, or open other applications during the interview.',
  'Ensure a stable internet connection before you begin; the session cannot be paused once started.',
  'Answer every question yourself — the use of external help or additional devices is not permitted.',
];

export interface ProctoringInstructionsProps {
  cameraGranted: boolean;
  screenGranted: boolean;
  permissionError: string | null;
  requestingPermissions: boolean;
  onRequestPermissions: () => void;
  title?: string;
  subtitle?: string;
  customError?: string | null;
  buttonText?: string;
}

export function ProctoringInstructions({
  cameraGranted,
  screenGranted,
  permissionError,
  requestingPermissions,
  onRequestPermissions,
  title = 'Before you begin',
  subtitle = 'Please read the instructions below, then grant the required permissions.',
  customError,
  buttonText = 'Allow Camera, Mic & Screen Share',
}: ProctoringInstructionsProps) {
  return (
    <div className="max-w-lg w-full bg-white rounded-2xl shadow-card border border-zinc-100 p-8 space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 bg-[#34c4f2]/10 rounded-xl flex items-center justify-center mx-auto">
          <ListChecks className="w-6 h-6 text-[#34c4f2]" />
        </div>
        <h1 className="text-xl font-bold text-zinc-900">{title}</h1>
        <p className="text-sm text-zinc-500">{subtitle}</p>
      </div>

      <ul className="space-y-3">
        {INSTRUCTIONS.map((instruction) => (
          <li key={instruction} className="flex items-start space-x-3 text-sm text-zinc-700">
            <CheckCircle2 className="w-4 h-4 text-[#34c4f2] flex-shrink-0 mt-0.5" />
            <span>{instruction}</span>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
          Required permissions
        </p>
        <div className="flex items-center justify-between text-sm text-zinc-700">
          <span className="flex items-center space-x-2">
            <Camera className="w-4 h-4" />
            <Mic className="w-4 h-4" />
            <span>Webcam & microphone</span>
          </span>
          {cameraGranted ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <span className="text-xs text-zinc-400">Not granted</span>
          )}
        </div>
        <div className="flex items-center justify-between text-sm text-zinc-700">
          <span className="flex items-center space-x-2">
            <MonitorUp className="w-4 h-4" />
            <span>Entire screen share</span>
          </span>
          {screenGranted ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <span className="text-xs text-zinc-400">Not granted</span>
          )}
        </div>
      </div>

      {permissionError && (
        <div className="flex items-center space-x-2 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="font-medium">{permissionError}</p>
        </div>
      )}

      {customError && (
        <div className="flex items-center space-x-2 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="font-medium">{customError}</p>
        </div>
      )}

      <button
        id="assess-request-permissions"
        type="button"
        onClick={onRequestPermissions}
        disabled={requestingPermissions}
        className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
      >
        {requestingPermissions ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <span>{buttonText}</span>
        )}
      </button>
    </div>
  );
}
