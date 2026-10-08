import { ShieldAlert, ArrowLeft, Loader2, CheckCircle2 } from 'lucide-react';

interface TerminatedInterviewProps {
  terminationReason: string | null;
  isAdmin?: boolean;
  onLeave?: () => void;
  isUploading?: boolean;
  uploadProgress?: number;
  uploadStatusText?: string;
}

export function TerminatedInterview({
  terminationReason,
  isAdmin = false,
  onLeave,
  isUploading = false,
  uploadProgress = 0,
  uploadStatusText = '',
}: TerminatedInterviewProps) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="max-w-md w-full bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-card border border-red-100 p-8 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Interview terminated</h1>
        <p className="text-sm text-zinc-600 font-medium">
          {terminationReason ?? 'A monitoring rule was violated.'}
        </p>
        <p className="text-xs text-zinc-400 dark:text-[#9f9f9f]">
          {isAdmin
            ? "The candidate's interview session has been terminated in accordance with proctoring policy."
            : 'This session has ended and cannot be resumed. Please contact your interviewer if you believe this was a mistake.'}
        </p>

        {/* Video recording upload progress indicator */}
        {!isAdmin && isUploading && (
          <div className="mt-4 p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 text-left space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#34c4f2]" />
              <span>{uploadStatusText || 'Securing video recording to Google Drive...'}</span>
            </div>
            <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-[#34c4f2] h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.max(uploadProgress, 5)}%` }}
              />
            </div>
            <p className="text-[11px] text-zinc-400 leading-tight">
              Please do not close this window until your video upload is saved.
            </p>
          </div>
        )}

        {!isAdmin && !isUploading && uploadProgress === 100 && (
          <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Interview video recording safely saved to Google Drive</span>
          </div>
        )}

        {isAdmin && onLeave && (
          <button
            type="button"
            onClick={onLeave}
            className="w-full mt-4 py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Admin Dashboard</span>
          </button>
        )}
      </div>
    </main>
  );
}
