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

  const isCompleted = Boolean(
    lowerReason === 'completed' ||
    lowerNote.includes('already completed') ||
    lowerNote.includes('interview is completed') ||
    lowerDetail.includes('completed')
  );

  const isTerminated = Boolean(
    lowerReason === 'violation' ||
    lowerReason === 'terminated' ||
    lowerReason === 'cancelled' ||
    lowerNote.includes('terminated') ||
    lowerDetail.includes('terminated') ||
    lowerViolation.length > 0 ||
    isWarningIssued ||
    lowerNote.includes('proctoring') ||
    lowerNote.includes('violation') ||
    lowerNote.includes('switched tabs') ||
    lowerNote.includes('refresh')
  );

  let resolvedReason: ExpirationReason = 'already_used';
  if (isCompleted) {
    resolvedReason = 'completed';
  } else if (isTerminated) {
    resolvedReason = 'violation';
  } else if (
    lowerReason === 'time_expired' ||
    lowerNote.includes('window expired') ||
    lowerNote.includes('deadline') ||
    lowerNote.includes('schedule')
  ) {
    resolvedReason = 'time_expired';
  } else {
    resolvedReason = 'already_used';
  }

  // Derive the effective individual termination reason
  const effectiveTerminationReason =
    violationReason ||
    (lowerNote.includes('switched tabs') || lowerNote.includes('clicked outside') || lowerNote.includes('minimized') ? note : undefined) ||
    (lowerNote.includes('refresh') || lowerNote.includes('closed the page') ? note : undefined) ||
    (lowerNote.includes('warning') || lowerNote.includes('strike') ? note : undefined) ||
    (lowerDetail.includes('switched tabs') || lowerDetail.includes('clicked outside') || lowerDetail.includes('minimized') ? reasonDetail : undefined) ||
    (lowerDetail.includes('refresh') || lowerDetail.includes('closed the page') ? reasonDetail : undefined) ||
    (lowerDetail.includes('warning') || lowerDetail.includes('strike') ? reasonDetail : undefined) ||
    (lowerDetail.includes('proctoring') || lowerDetail.includes('violation') ? reasonDetail : undefined) ||
    'The interview session was terminated due to a proctoring policy violation.';

  let categoryBadge = 'Proctoring Policy Violation';
  const reasonToInspect = `${effectiveTerminationReason} ${violationReason || ''} ${reasonDetail || ''} ${note || ''}`.toLowerCase();
  if (reasonToInspect.includes('refresh') || reasonToInspect.includes('closed the page')) {
    categoryBadge = 'Session Refresh / Exit Violation';
  } else if (
    reasonToInspect.includes('switched tabs') ||
    reasonToInspect.includes('clicked outside') ||
    reasonToInspect.includes('minimized') ||
    reasonToInspect.includes('background')
  ) {
    categoryBadge = 'Tab Switch & Focus Policy Violation';
  } else if (reasonToInspect.includes('three proctoring warnings') || reasonToInspect.includes('3 strikes') || isWarningIssued) {
    categoryBadge = 'Proctoring Limit Exceeded (3 Strikes)';
  } else if (reasonToInspect.includes('screen shar')) {
    categoryBadge = 'Screen Share Policy Violation';
  } else if (reasonToInspect.includes('another device') || reasonToInspect.includes('simultaneous')) {
    categoryBadge = 'Multiple Device Access Violation';
  }

  // Configuration per expiration reason
  const configs = {
    completed: {
      icon: CheckCircle2,
      iconContainer: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
      title: reasonTitle || 'Interview Completed',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800',
      badgeLabel: '✅ Interview Completed',
      box: 'bg-emerald-50/80 border-emerald-200/60 dark:bg-emerald-950/30 dark:border-emerald-800/60',
      titleColor: 'text-emerald-950 dark:text-emerald-200',
      textColor: 'text-emerald-800/90 dark:text-emerald-300',
      primaryMessage:
        'This link is expired it is one time use , your interview is completed we will get back to you soon',
      helper:
        'Your responses have been securely submitted and delivered to the recruitment team. No further action or re-submission is required.',
    },
    violation: {
      icon: ShieldAlert,
      iconContainer: 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400',
      title: reasonTitle || 'Interview Terminated',
      badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800',
      badgeLabel: `🚫 ${categoryBadge}`,
      box: 'bg-red-50/80 border-red-200/60 dark:bg-red-950/30 dark:border-red-800/60',
      titleColor: 'text-red-950 dark:text-red-200',
      textColor: 'text-red-800/90 dark:text-red-300',
      primaryMessage:
        'This link is expired it is one time use',
      helper:
        'This session has ended and cannot be resumed. If you believe this occurred due to a technical error or hardware malfunction, please reach out to your recruitment coordinator at Creole Studios.',
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
      primaryMessage:
        'This link is expired. The scheduled invitation window to access and take this interview has elapsed.',
      helper:
        'If you require a deadline extension or a refreshed link, please contact your recruiter at Creole Studios.',
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
      primaryMessage:
        'This link is expired it is one time use',
      helper:
        'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been opened or completed, it cannot be accessed again.',
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
        <div className={`border rounded-xl p-4 text-left space-y-3 ${cfg.box}`}>
          <p className={`text-sm font-bold leading-relaxed ${cfg.titleColor}`}>
            {cfg.primaryMessage}
          </p>

          {/* Prominent Individual Termination Reason Card when terminated/violation */}
          {resolvedReason === 'violation' && (
            <div className="p-3.5 rounded-lg bg-red-100/90 dark:bg-red-950/70 border border-red-300 dark:border-red-800 text-left space-y-2 shadow-xs">
              <div className="flex items-center gap-1.5 text-red-900 dark:text-red-200 font-bold text-xs uppercase tracking-wide">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <span>Reason for Termination</span>
              </div>
              <p className="text-xs text-red-800 dark:text-red-300 leading-relaxed font-semibold">
                {effectiveTerminationReason}
              </p>
              {warningCount !== undefined && warningCount > 0 && (
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-200 dark:bg-red-900/60 text-[11px] font-bold text-red-900 dark:text-red-200">
                  <span>Warnings Logged: {warningCount}</span>
                </div>
              )}
            </div>
          )}

          {note && note !== cfg.primaryMessage && !effectiveTerminationReason.includes(note) && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
              {note}
            </p>
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

