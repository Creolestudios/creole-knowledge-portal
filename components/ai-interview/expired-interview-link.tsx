import { ClockAlert } from 'lucide-react';

interface ExpiredInterviewLinkProps {
  note?: string;
  isUsed?: boolean;
}

export function ExpiredInterviewLink({
  note = 'Note: This interview link has already been used and is expired.',
  isUsed = true,
}: ExpiredInterviewLinkProps) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-card border border-amber-200/80 p-8 text-center space-y-5">
        <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center mx-auto text-amber-600">
          <ClockAlert className="w-8 h-8" />
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Link is expired</h1>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">
            {isUsed ? 'Single-use link already accessed' : 'Interview link expired'}
          </p>
        </div>

        <div className="bg-amber-50/80 border border-amber-200/60 rounded-xl p-4 text-left">
          <p className="text-sm font-semibold text-amber-900 leading-snug">
            {note}
          </p>
          <p className="text-xs text-amber-700/90 mt-1.5 leading-relaxed">
            For security and assessment integrity, each interview link is strictly single-use. Because this link has already been accessed, it cannot be opened again.
          </p>
        </div>

        <p className="text-xs text-zinc-400 leading-relaxed">
          If you experienced technical issues or believe this was a mistake, please reach out to your interviewer or recruitment coordinator to request a new link.
        </p>
      </div>
    </main>
  );
}
