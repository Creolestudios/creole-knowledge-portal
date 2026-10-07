import {
  CheckCircle2,
  Camera,
  Mic,
  MonitorUp,
  AlertCircle,
  Loader2,
  ListChecks,
  Eye,
  Smartphone,
  ShieldAlert,
} from 'lucide-react';

const INSTRUCTIONS = [
  'Find a quiet, well-lit room and sit facing your camera directly for the full duration of the interview.',
  'Keep your webcam, microphone, and entire screen-share on at all times — the session cannot continue if any is turned off.',
  'Do not switch tabs, minimize the window, or open other applications during the assessment.',
  'Ensure a stable internet connection before you begin; the session cannot be paused once started.',
  'Answer every question yourself in your own voice — external help, notes, or additional devices are strictly prohibited.',
  'When you finish speaking your answer, click "Next Question" to proceed, or the interview will automatically advance when your answer is complete or time expires.',
];

const DETECTION_RULES = [
  {
    icon: 'Eye',
    title: 'Face & Gaze Tracking',
    description:
      'Keep your eyes on the screen and face centered. Turning away, repeatedly looking away, or multiple people in camera frame will trigger warnings.',
  },
  {
    icon: 'Smartphone',
    title: 'Object Detection',
    description:
      'Phones, books, handwritten notes, headphones, earbuds, and secondary screens are actively detected and strictly prohibited.',
  },
  {
    icon: 'Mic',
    title: 'Voice Guard & Audio Analysis',
    description:
      'Background voices, second persons speaking, music, or external AI voice assistants will trigger proctoring flags.',
  },
  {
    icon: 'ShieldAlert',
    title: '3-Warning Termination Policy',
    description:
      'Up to 3 warnings are issued for proctoring infractions. A 4th violation or interrupting media streams will immediately end your interview.',
  },
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
    <div className="max-w-lg w-full bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-card border border-zinc-100 dark:border-[#4a4a4a] p-8 space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 bg-[#34c4f2]/10 rounded-xl flex items-center justify-center mx-auto">
          <ListChecks className="w-6 h-6 text-[#34c4f2]" />
        </div>
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">{title}</h1>
        <p className="text-sm text-zinc-500 dark:text-[#9f9f9f]">{subtitle}</p>
      </div>

      <ul className="space-y-3">
        {INSTRUCTIONS.map((instruction) => (
          <li key={instruction} className="flex items-start space-x-3 text-sm text-zinc-700 dark:text-[#d9d9d9]">
            <CheckCircle2 className="w-4 h-4 text-[#34c4f2] flex-shrink-0 mt-0.5" />
            <span>{instruction}</span>
          </li>
        ))}
      </ul>

      {/* ── Active Proctoring & AI Detections Notice ── */}
      <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-sky-700 shrink-0" />
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-sky-900">
            Active Proctoring & AI Detections
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          {DETECTION_RULES.map((rule) => {
            const IconComponent =
              rule.icon === 'Eye'
                ? Eye
                : rule.icon === 'Smartphone'
                ? Smartphone
                : rule.icon === 'Mic'
                ? Mic
                : ShieldAlert;
            return (
              <div
                key={rule.title}
                className="bg-white dark:bg-[#2b2b2b]/95 border border-sky-100 rounded-lg p-2.5 space-y-1 shadow-2xs"
              >
                <div className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-white text-[11px]">
                  <IconComponent className="w-3.5 h-3.5 text-[#0c7ea6] shrink-0" />
                  <span>{rule.title}</span>
                </div>
                <p className="text-[11px] text-zinc-600 leading-snug">{rule.description}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-100 dark:border-[#4a4a4a] bg-zinc-50 dark:bg-[#1f1f1f] p-4 space-y-3">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-[#9f9f9f]">
          Required permissions
        </p>
        <div className="flex items-center justify-between text-sm text-zinc-700 dark:text-[#d9d9d9]">
          <span className="flex items-center space-x-2">
            <Camera className="w-4 h-4" />
            <Mic className="w-4 h-4" />
            <span>Webcam & microphone</span>
          </span>
          {cameraGranted ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <span className="text-xs text-zinc-400 dark:text-[#9f9f9f]">Not granted</span>
          )}
        </div>
        <div className="flex items-center justify-between text-sm text-zinc-700 dark:text-[#d9d9d9]">
          <span className="flex items-center space-x-2">
            <MonitorUp className="w-4 h-4" />
            <span>Entire screen share</span>
          </span>
          {screenGranted ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          ) : (
            <span className="text-xs text-zinc-400 dark:text-[#9f9f9f]">Not granted</span>
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
        onClick={() => onRequestPermissions()}
        disabled={requestingPermissions}
        className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 dark:text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
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
