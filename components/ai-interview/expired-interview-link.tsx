import React from 'react';
import { ClockAlert, CheckCircle2, ShieldAlert, Lock, AlertTriangle } from 'lucide-react';

export type ExpirationReason = 'completed' | 'violation' | 'time_expired' | 'already_used';

interface ExpiredInterviewLinkProps {
  note?: string;
  isUsed?: boolean;
  reason?: ExpirationReason | string;
  reasonTitle?: string;
  reasonDetail?: string;
  violationReason?: string;
  warningCount?: number;
}

export function ExpiredInterviewLink({
  note,
  isUsed = true,
  reason,
  reasonTitle,
  reasonDetail,
  violationReason,
  warningCount,
}: ExpiredInterviewLinkProps) {
  // Normalize reason from prop or note keywords
  let resolvedReason: ExpirationReason = 'already_used';
  const lowerNote = (note || '').toLowerCase();
  const lowerReason = (reason || '').toLowerCase();
  const lowerDetail = (reasonDetail || '').toLowerCase();
  const lowerViolation = (violationReason || '').toLowerCase();

  const isWarningIssued = Boolean(
    lowerNote.includes('warning') ||
    lowerDetail.includes('warning') ||
    lowerViolation.includes('warning') ||
    (warningCount !== undefined && warningCount > 0)
  );

  if (
    lowerReason === 'completed' ||
    lowerNote.includes('completed') ||
    lowerNote.includes('already completed')
  ) {
    resolvedReason = 'completed';
  } else if (
    isWarningIssued ||
    lowerReason === 'violation' ||
    lowerReason === 'terminated' ||
    lowerReason === 'cancelled' ||
    lowerReason === 'revoked' ||
    lowerNote.includes('terminated') ||
    lowerNote.includes('violation') ||
    lowerNote.includes('proctoring')
  ) {
    resolvedReason = 'violation';
  } else if (
    lowerReason === 'time_expired' ||
    lowerNote.includes('window expired') ||
    lowerNote.includes('schedule') ||
    (!isUsed && lowerNote.includes('expired'))
  ) {
    resolvedReason = 'time_expired';
  }

  // Configuration per expiration reason
  const configs = {
    completed: {
      icon: CheckCircle2,
      iconContainer: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
      title: reasonTitle || 'Interview Already Completed',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
      badgeLabel: '✅ Submissions Finalized',
      box: 'bg-emerald-50/80 border-emerald-200/60 dark:bg-emerald-950/30 dark:border-emerald-800/60',
      titleColor: 'text-emerald-950 dark:text-emerald-200',
      textColor: 'text-emerald-800/90 dark:text-emerald-300',
      defaultDetail:
        reasonDetail ||
        'This interview session has already been successfully submitted and completed. All recorded answers are safely archived with recruitment review.',
      helper:
        'Your responses have been securely delivered to the hiring team. No further action or re-submission is required.',
    },
    violation: {
      icon: ShieldAlert,
      iconContainer: 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400',
      title: reasonTitle || (isWarningIssued ? 'Session Terminated by Proctoring Warning' : 'Session Terminated by Proctoring Guard'),
      badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800',
      badgeLabel: isWarningIssued ? '⚠️ Proctoring Warning Limit Reached' : '🚫 Proctoring Policy Enforcement',
      box: 'bg-red-50/80 border-red-200/60 dark:bg-red-950/30 dark:border-red-800/60',
      titleColor: 'text-red-950 dark:text-red-200',
      textColor: 'text-red-800/90 dark:text-red-300',
      defaultDetail:
        reasonDetail ||
        'This interview link expired because the session was terminated due to automated proctoring policy violations (e.g. eye gaze deviation, background audio, or unauthorized window switching).',
      helper:
        'If you encountered an unexpected system error or hardware malfunction, please contact your recruitment coordinator to explain the circumstances and request a new session.',
    },
    time_expired: {
      icon: ClockAlert,
      iconContainer: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
      title: reasonTitle || 'Interview Window Expired',
      badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
      badgeLabel: '⏳ Access Deadline Passed',
      box: 'bg-amber-50/80 border-amber-200/60 dark:bg-amber-950/30 dark:border-amber-800/60',
      titleColor: 'text-amber-950 dark:text-amber-200',
      textColor: 'text-amber-800/90 dark:text-amber-300',
      defaultDetail:
        reasonDetail ||
        'The scheduled invitation window to access and take this interview has elapsed. Access to this link has been closed.',
      helper:
        'If you require a deadline extension or a refreshed link, please contact your recruiter.',
    },
    already_used: {
      icon: Lock,
      iconContainer: 'bg-zinc-500/10 border-zinc-500/20 text-zinc-600 dark:text-zinc-400',
      title: reasonTitle || 'Link is expired',
      badge: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700',
      badgeLabel: '🔒 Single-Use Consumed',
      box: 'bg-zinc-50 border-zinc-200 dark:bg-zinc-800/50 dark:border-zinc-700',
      titleColor: 'text-zinc-900 dark:text-zinc-100',
      textColor: 'text-zinc-700 dark:text-zinc-300',
      defaultDetail:
        reasonDetail ||
        note ||
        'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been opened or completed, it cannot be accessed again.',
      helper:
        'If you believe this link was consumed in error or disconnected prematurely, please reach out to your recruitment coordinator.',
    },
  };

  const cfg = configs[resolvedReason];
  const Icon = cfg.icon;

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] dark:bg-[#1f1f1f] px-4 py-8">
      <div className="max-w-md w-full bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-card border border-zinc-200 dark:border-[#4a4a4a] p-8 text-center space-y-6">
        {/* Dynamic Icon */}
        <div
          className={`w-16 h-16 border rounded-2xl flex items-center justify-center mx-auto shadow-sm transition-transform duration-300 ${cfg.iconContainer}`}
        >
          <Icon className="w-8 h-8" />
        </div>

        {/* Header & Category Badge */}
        <div className="space-y-2">
          <span
            className={`inline-block px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-wider ${cfg.badge}`}
          >
            {cfg.badgeLabel}
          </span>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
            {cfg.title}
          </h1>
        </div>

        {/* Detailed Reason Explanation Box */}
        <div className={`border rounded-xl p-4 text-left space-y-2.5 ${cfg.box}`}>
          <p className={`text-xs font-semibold leading-relaxed ${cfg.titleColor}`}>
            {note || cfg.defaultDetail}
          </p>

          {/* Prominent Warning Callout Banner when terminated by warning or violation */}
          {(isWarningIssued || violationReason || (warningCount !== undefined && warningCount > 0)) && (
            <div className="p-3 rounded-lg bg-red-100/90 dark:bg-red-950/70 border border-red-300 dark:border-red-800 text-left space-y-1.5 shadow-xs">
              <div className="flex items-center gap-1.5 text-red-900 dark:text-red-200 font-bold text-xs uppercase tracking-wide">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <span>Proctoring Warning Issued</span>
              </div>
              <p className="text-xs text-red-800 dark:text-red-300 leading-relaxed font-semibold">
                {violationReason ||
                  (lowerNote.includes('warning') ? note : null) ||
                  (lowerDetail.includes('warning') ? reasonDetail : null) ||
                  'Automated proctoring warnings were triggered during this interview, resulting in session termination.'}
              </p>
              {warningCount !== undefined && warningCount > 0 && (
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-200 dark:bg-red-900/60 text-[11px] font-bold text-red-900 dark:text-red-200">
                  <span>Warnings Logged: {warningCount}</span>
                </div>
              )}
            </div>
          )}

          <p className={`text-[11px] leading-relaxed pt-1 border-t border-zinc-200/50 dark:border-zinc-700/50 ${cfg.textColor}`}>
            {cfg.helper}
          </p>
        </div>

        {/* Bottom Help Text */}
        <p className="text-xs text-zinc-400 dark:text-[#9f9f9f] leading-relaxed">
          Questions regarding this evaluation? Reach out to your coordinator at Creole Studios.
        </p>
      </div>
    </main>
  );
}
