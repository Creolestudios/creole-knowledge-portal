import { ShieldAlert, ArrowLeft } from 'lucide-react';

interface TerminatedInterviewProps {
  terminationReason: string | null;
  isAdmin?: boolean;
  onLeave?: () => void;
}

export function TerminatedInterview({ terminationReason, isAdmin = false, onLeave }: TerminatedInterviewProps) {
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
