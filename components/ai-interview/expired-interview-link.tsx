import { ClockAlert, CheckCircle2, ShieldAlert, Lock, AlertTriangle, Loader2 } from 'lucide-react';

export type ExpirationReason = 'completed' | 'violation' | 'time_expired' | 'already_used';

interface ExpiredInterviewLinkProps {
  note?: string;
  isUsed?: boolean;
  reason?: ExpirationReason | string;
  reasonTitle?: string;
  reasonDetail?: string;
  violationReason?: string;
  warningCount?: number;
  isUploading?: boolean;
  uploadProgress?: number;
  uploadStatusText?: string;
}

export function ExpiredInterviewLink({
  note,
  isUsed = true,
  reason,
  reasonTitle,
  reasonDetail,
  violationReason,
  warningCount,
  isUploading = false,
  uploadProgress = 0,
  uploadStatusText = '',
}: ExpiredInterviewLinkProps) {
  // Normalize reason from prop or note keywords
  const lowerNote = (note || '').toLowerCase();
  const lowerReason = (reason || '').toLowerCase();
  const lowerDetail = (reasonDetail || '').toLowerCase();
  const lowerViolation = (violationReason || '').toLowerCase();
  const lowerTitle = (reasonTitle || '').toLowerCase();

  const isWarningIssued = Boolean(
    lowerNote.includes('warning') ||
    lowerDetail.includes('warning') ||
    lowerViolation.includes('warning') ||
    (warningCount !== undefined && warningCount > 0)
  );

  const isCompleted = Boolean(
    lowerReason === 'completed' ||
    lowerTitle.includes('completed') ||
    lowerNote.includes('already completed') ||
    lowerNote.includes('interview is completed') ||
    lowerDetail.includes('completed')
  );

  const isTerminated = Boolean(
    lowerReason === 'violation' ||
    lowerReason === 'terminated' ||
    lowerReason === 'cancelled' ||
    lowerTitle.includes('terminated') ||
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

  // Configuration per expiration reason (yellow/amber theme for link expiration)
  const configs = {
    completed: {
      icon: CheckCircle2,
      iconContainer: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
      title: reasonTitle || 'Link is expired',
      badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
      badgeLabel: '✅ Interview Completed',
      box: 'bg-amber-50/80 border-amber-200/60 dark:bg-amber-950/30 dark:border-amber-800/60',
      titleColor: 'text-amber-950 dark:text-amber-200',
      textColor: 'text-amber-800/90 dark:text-amber-300',
      primaryMessage:
        'This link is expired it is one time use , your interview is completed we will get back to you soon',
      helper:
        'Your responses have been securely submitted and delivered to the recruitment team. No further action or re-submission is required.',
    },
    violation: {
      icon: AlertTriangle,
      iconContainer: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
      title: reasonTitle || 'Link is expired',
      badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
      badgeLabel: `⚠️ ${categoryBadge}`,
      box: 'bg-amber-50/80 border-amber-200/60 dark:bg-amber-950/30 dark:border-amber-800/60',
      titleColor: 'text-amber-950 dark:text-amber-200',
      textColor: 'text-amber-800/90 dark:text-amber-300',
      primaryMessage:
        'This link is expired it is one time use',
      helper:
        'This session has ended and cannot be resumed. If you believe this occurred due to a technical error or hardware malfunction, please reach out to your recruitment coordinator at Creole Studios.',
    },
    time_expired: {
      icon: ClockAlert,
      iconContainer: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
      title: reasonTitle || 'Assessment Deadline Expired',
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
      iconContainer: 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400',
      title: reasonTitle || 'Link is expired',
      badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800',
      badgeLabel: '🔒 Single-Use Consumed',
      box: 'bg-amber-50/80 border-amber-200/60 dark:bg-amber-950/30 dark:border-amber-800/60',
      titleColor: 'text-amber-950 dark:text-amber-200',
      textColor: 'text-amber-800/90 dark:text-amber-300',
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

          {/* Prominent Individual Termination Reason Card when terminated/violation or violationReason is present */}
          {(resolvedReason === 'violation' || Boolean(violationReason)) && (
            <div className="p-3.5 rounded-lg bg-amber-100/90 dark:bg-amber-950/70 border border-amber-300 dark:border-amber-800 text-left space-y-2 shadow-xs">
              <div className="flex items-center gap-1.5 text-amber-900 dark:text-amber-200 font-bold text-xs uppercase tracking-wide">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span>Reason for Termination</span>
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed font-semibold">
                {effectiveTerminationReason}
              </p>
              {warningCount !== undefined && warningCount > 0 && (
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-900/60 text-[11px] font-bold text-amber-900 dark:text-amber-200">
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

        {/* Video recording upload progress indicator */}
        {isUploading && (
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
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight">
              Please do not close this window until your video upload is saved.
            </p>
          </div>
        )}

        {!isUploading && uploadProgress === 100 && (
          <div className="mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200 dark:border-emerald-800 flex items-center justify-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
            <span>Interview video recording safely saved to Google Drive</span>
          </div>
        )}

        {/* Bottom Help Text */}
        <p className="text-xs text-zinc-400 dark:text-[#9f9f9f] leading-relaxed">
          Questions regarding this evaluation? Reach out to your coordinator at Creole Studios.
        </p>
      </div>
    </main>
  );
}

