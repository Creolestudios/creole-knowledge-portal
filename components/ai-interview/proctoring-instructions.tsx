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
  'Keep your webcam, microphone, and entire screen-share (with system audio enabled) on at all times — the session cannot continue if any is turned off.',
  'Do not switch tabs, minimize the window, or open other applications during the assessment.',
  'Ensure a stable internet connection before you begin; the session cannot be paused once started.',
  'Answer every question yourself in your own voice — external help, notes, or additional devices are strictly prohibited.',
  '3-Warning Termination Policy: Any proctoring infraction triggers a strike. On the 3rd warning, the interview is immediately and permanently terminated with no option to resume.',
  '30-Second Auto-Resume: If an infraction pauses your interview (warnings 1 or 2), you have up to 30 seconds to click "Resume Interview". If not clicked within 30 seconds, the session will automatically resume.',
  'When you finish speaking your answer, click "Next Question" to proceed to the next question. If the question time limit expires before you click, the session will automatically advance.',
  'After submitting your final answer, do NOT close or refresh this tab. Your interview recording will be securely transferred to our servers — a progress indicator will appear and the page will automatically confirm once the upload is complete.',
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
      'Warnings 1 & 2 offer a 30s resume window (auto-resumes if unclicked). A 3rd warning terminates the interview immediately with no resume alert.',
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
    <div className="w-full max-w-5xl xl:max-w-6xl bg-white dark:bg-[#2b2b2b] rounded-3xl shadow-xl border border-zinc-200 dark:border-[#4a4a4a] p-6 sm:p-8 lg:p-10 space-y-8 transition-colors">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-zinc-100 dark:border-zinc-800 gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 bg-[#34c4f2]/10 dark:bg-[#34c4f2]/20 rounded-2xl flex items-center justify-center text-[#1689aa] dark:text-[#34c4f2] shadow-sm flex-shrink-0">
            <ListChecks className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white leading-tight">
              {title}
            </h1>
            <p className="text-xs sm:text-sm text-zinc-500 dark:text-[#9f9f9f] font-medium mt-0.5">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 self-start sm:self-auto px-3.5 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 text-xs font-bold uppercase tracking-wider">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Active AI Proctoring</span>
        </div>
      </div>

      {/* ── Responsive Two-Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: 8 Guidelines (lg:col-span-7) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-zinc-500 dark:text-[#9f9f9f]">
            <CheckCircle2 className="w-4 h-4 text-[#34c4f2]" />
            <span>Interview Guidelines & Candidate Code of Conduct</span>
          </div>

          <ul className="space-y-2.5">
            {INSTRUCTIONS.map((instruction, idx) => (
              <li
                key={instruction}
                className="flex items-start gap-3 p-3 sm:p-3.5 rounded-xl bg-zinc-50/80 dark:bg-[#1f1f1f]/80 border border-zinc-100 dark:border-zinc-800 text-xs sm:text-sm text-zinc-700 dark:text-[#d9d9d9] leading-relaxed transition-colors hover:border-[#34c4f2]/40"
              >
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#34c4f2]/10 text-[#1689aa] dark:text-[#34c4f2] text-xs font-black shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="flex-1">{instruction}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Right Column: AI Detections & Permissions & Action Button (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Active Proctoring & AI Detections Notice */}
          <div className="rounded-2xl border border-sky-100 dark:border-sky-900/40 bg-sky-50/70 dark:bg-sky-950/30 p-5 space-y-3.5 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-sky-900 dark:text-sky-200">
                Active Proctoring & AI Detections
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5 text-xs">
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
                    className="bg-white dark:bg-[#1f1f1f] border border-sky-100 dark:border-sky-900/30 rounded-xl p-3 space-y-1 shadow-xs"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-white text-xs">
                      <IconComponent className="w-3.5 h-3.5 text-[#0c7ea6] dark:text-[#34c4f2] shrink-0" />
                      <span>{rule.title}</span>
                    </div>
                    <p className="text-[11px] sm:text-xs text-zinc-600 dark:text-zinc-300 leading-snug">
                      {rule.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Required Permissions Box */}
          <div className="rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] bg-zinc-50 dark:bg-[#1f1f1f] p-5 space-y-3.5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500 dark:text-[#9f9f9f]">
              Required permissions
            </p>
            <div className="flex items-center justify-between text-xs sm:text-sm text-zinc-700 dark:text-[#d9d9d9]">
              <span className="flex items-center space-x-2.5">
                <Camera className="w-4 h-4 text-zinc-500" />
                <Mic className="w-4 h-4 text-zinc-500" />
                <span className="font-medium">Webcam & microphone</span>
              </span>
              {cameraGranted ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Granted
                </span>
              ) : (
                <span className="text-xs font-medium text-zinc-400 dark:text-[#9f9f9f]">Not granted</span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs sm:text-sm text-zinc-700 dark:text-[#d9d9d9]">
              <span className="flex items-center space-x-2.5">
                <MonitorUp className="w-4 h-4 text-zinc-500" />
                <span className="font-medium">Entire screen share (with system audio)</span>
              </span>
              {screenGranted ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Granted
                </span>
              ) : (
                <span className="text-xs font-medium text-zinc-400 dark:text-[#9f9f9f]">Not granted</span>
              )}
            </div>
          </div>

          {/* Errors (if any) */}
          {permissionError && (
            <div className="flex items-center space-x-2.5 p-4 text-xs sm:text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-900/40">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="font-medium">{permissionError}</p>
            </div>
          )}

          {customError && (
            <div className="flex items-center space-x-2.5 p-4 text-xs sm:text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 dark:border-red-900/40">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="font-medium">{customError}</p>
            </div>
          )}

          {/* Action CTA Button */}
          <button
            id="assess-request-permissions"
            type="button"
            onClick={() => onRequestPermissions()}
            disabled={requestingPermissions}
            className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm cursor-pointer"
          >
            {requestingPermissions ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <span>{buttonText}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
