import { ShieldAlert } from 'lucide-react';

export function TerminatedInterview({ terminationReason }: { terminationReason: string | null }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-card border border-red-100 p-8 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
        <h1 className="text-xl font-bold text-zinc-900">Interview terminated</h1>
        <p className="text-sm text-zinc-500">
          {terminationReason ?? 'A monitoring rule was violated.'}
        </p>
        <p className="text-xs text-zinc-400">
          This session has ended and cannot be resumed. Please contact your interviewer if you
          believe this was a mistake.
        </p>
      </div>
    </main>
  );
}
