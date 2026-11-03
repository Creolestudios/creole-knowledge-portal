export interface DailyDigestUserRow {
  userId?: string;
  userName: string;
  userEmail: string;
  role?: string;
  seniorityLevel?: string;
  totalTasks: number;
  doneTasks: number;
  delayedTasks: number;
  qaTasks: number;
  totalPlannedHours: number;
  totalActualHours: number;
  dailyScore: number; // 0 to 10 or 0 to 100
  reason: string; // Evaluative explanation / performance summary
  summaryPointers?: string[]; // 3-4 bullet points: what is done, what not, why this score
  importantNotes?: string[];
  timeAssessmentLabel?: string;
  taskStatuses?: string[];
}

export interface DailyDigestEmailPayload {
  date: string;
  teamAvgScore: number;
  totalUsersEvaluated: number;
  totalTasks: number;
  totalDoneTasks: number;
  totalDelayedTasks: number;
  totalActualHours: number;
  totalPlannedHours: number;
  users: DailyDigestUserRow[];
  portalUrl?: string;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getScoreBadgeColor(score: number): { bg: string; text: string; border: string; label: string } {
  const normalized = score > 10 ? score / 10 : score;
  if (normalized >= 8.5) {
    return { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0', label: 'Excellent' };
  }
  if (normalized >= 7.0) {
    return { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe', label: 'Good' };
  }
  if (normalized >= 5.0) {
    return { bg: '#fffbeb', text: '#d97706', border: '#fde68a', label: 'Moderate' };
  }
  return { bg: '#fef2f2', text: '#dc2626', border: '#fecaca', label: 'Needs Attention' };
}

/**
 * Constructs 3-4 concise, clear bullet pointers for a user's daily evaluation:
 * 1. What was done (completed tasks / submitted QA / hours logged)
 * 2. What was not done / pending / delayed (pending QA, in progress, overdue)
 * 3. Why this score (rationale explaining high score or deductions)
 * 4. Action / Focus (recommended next step / blocker resolution)
 */
export function buildEvaluationSummaryPointers(user: DailyDigestUserRow): string[] {
  if (user.summaryPointers && user.summaryPointers.length > 0) {
    return user.summaryPointers;
  }

  const pointers: string[] = [];
  const normScore = user.dailyScore > 10
    ? (user.dailyScore / 10).toFixed(1)
    : user.dailyScore.toFixed(1);
  const scoreNum = Number(normScore);

  // 1. What is done
  if (user.doneTasks > 0 && user.doneTasks === user.totalTasks) {
    pointers.push(`Done: All ${user.totalTasks} task(s) completed on schedule (${user.totalActualHours.toFixed(1)}h logged).`);
  } else if (user.doneTasks > 0) {
    pointers.push(`Done: ${user.doneTasks}/${user.totalTasks} task(s) completed (${user.totalActualHours.toFixed(1)}h logged).`);
  } else if (user.qaTasks > 0) {
    pointers.push(`Done: ${user.qaTasks}/${user.totalTasks} task(s) submitted to QA Review (${user.totalActualHours.toFixed(1)}h logged).`);
  } else if (user.totalActualHours > 0) {
    pointers.push(`Done: Progress logged on ${user.totalTasks} active task(s) (${user.totalActualHours.toFixed(1)}h recorded).`);
  } else {
    pointers.push(`Done: 0 tasks completed; no timelog recorded today.`);
  }

  // 2. What is not done / pending / delayed
  const pendingCount = Math.max(0, user.totalTasks - user.doneTasks - user.qaTasks);
  if (user.delayedTasks > 0) {
    pointers.push(`Pending: ${user.delayedTasks} task(s) delayed/overdue beyond planned hours.`);
  } else if (user.totalActualHours === 0) {
    pointers.push(`Pending: Incomplete timelog entries for ${user.totalTasks} assigned task(s).`);
  } else if (user.qaTasks > 0 && user.doneTasks === 0) {
    pointers.push(`Pending: Final QA review & verification pending on ${user.qaTasks} task(s).`);
  } else if (pendingCount > 0) {
    pointers.push(`Pending: ${pendingCount} task(s) in progress, pending completion.`);
  } else if (user.doneTasks === user.totalTasks && user.totalTasks > 0) {
    pointers.push(`Pending: None — all assigned tasks delivered.`);
  } else {
    pointers.push(`Pending: Ongoing execution across assigned tasks.`);
  }

  // 3. Why this score
  const isGenericReason = !user.reason ||
    /^completed \d+\/\d+ task/i.test(user.reason.trim()) ||
    /^daily evaluation completed/i.test(user.reason.trim()) ||
    /^task activity evaluated/i.test(user.reason.trim());

  if (!isGenericReason && user.reason.length > 10) {
    pointers.push(`Why this score (${normScore}/10): ${user.reason}`);
  } else if (scoreNum >= 8.5) {
    pointers.push(`Why this score (${normScore}/10): High adherence to timeline with comprehensive technical progress comments.`);
  } else if (scoreNum >= 7.0) {
    pointers.push(`Why this score (${normScore}/10): Good task progress with minor deductions for time variance or brief comments.`);
  } else if (scoreNum >= 5.0) {
    pointers.push(`Why this score (${normScore}/10): Score reduced due to overtime hours or lack of progress comments in Zoho.`);
  } else {
    pointers.push(`Why this score (${normScore}/10): Low score due to missing timelogs, unresolved delays, or unlogged updates.`);
  }

  // 4. Action / Focus item (ensuring 3-4 pointers)
  if (user.totalActualHours === 0) {
    pointers.push(`Action: Ensure daily hours and task progress are logged in Zoho Projects.`);
  } else if (user.delayedTasks > 0) {
    pointers.push(`Action: Proactively communicate blockers and adjust task estimates.`);
  } else if (user.qaTasks > 0 && user.doneTasks === 0) {
    pointers.push(`Action: Follow up with QA to complete verification and close tickets.`);
  } else if (user.importantNotes && user.importantNotes.length > 0 && user.importantNotes[0]) {
    pointers.push(`Action: ${user.importantNotes[0]}`);
  } else if (scoreNum < 7.0) {
    pointers.push(`Action: Always log progress comments describing implementation and test status.`);
  }

  return pointers;
}

function renderPointerHtml(pointer: string): string {
  const colonIdx = pointer.indexOf(':');
  if (colonIdx > 0 && colonIdx < 35) {
    const label = pointer.substring(0, colonIdx);
    const rest = pointer.substring(colonIdx + 1);
    return `<strong>${escapeHtml(label)}:</strong>${escapeHtml(rest)}`;
  }
  return escapeHtml(pointer);
}

/**
 * Generates an executive, mobile-friendly HTML & plain-text email for
 * the consolidated Daily Team Zoho Task Performance Digest for Admins & Managers.
 * Built 100% with email-safe tables and high readability.
 */
export function generateDailyDigestEmail(payload: DailyDigestEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const rawPortalUrl =
    payload.portalUrl ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000';
  const portalUrl = rawPortalUrl.replace(/\/+$/, '');
  const evaluationLink = `${portalUrl}/admin/dashboard?tab=zoho`;

  const subject = `[Daily Zoho Digest] Team Performance Report - ${payload.date}`;

  // Generate table rows for users
  const tableRowsHtml = payload.users.length === 0
    ? `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #71717a; font-style: italic; font-size: 13px;">No employee activity recorded or evaluated for ${escapeHtml(payload.date)}.</td></tr>`
    : payload.users.map((user, idx) => {
        const userNormScore = user.dailyScore > 10
          ? (user.dailyScore / 10).toFixed(1)
          : user.dailyScore.toFixed(1);
        const scoreBadge = getScoreBadgeColor(Number(userNormScore));
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        const pointers = (user.summaryPointers && user.summaryPointers.length > 0)
          ? user.summaryPointers
          : buildEvaluationSummaryPointers(user);

        // Render both task statuses
        let taskStatusesHtml = '';
        if (user.taskStatuses && user.taskStatuses.length > 0) {
          taskStatusesHtml = user.taskStatuses.map((st) => {
            const lower = st.toLowerCase();
            const isDone = ['closed', 'completed', 'done'].includes(lower);
            const isQa = lower.includes('qa');
            const color = isDone ? '#15803d' : isQa ? '#2563eb' : '#b45309';
            const bg = isDone ? '#f0fdf4' : isQa ? '#eff6ff' : '#fffbeb';
            const border = isDone ? '#bbf7d0' : isQa ? '#bfdbfe' : '#fde68a';
            return `<span style="display: inline-block; font-size: 10px; font-weight: 700; color: ${color}; background-color: ${bg}; border: 1px solid ${border}; padding: 2px 7px; border-radius: 4px; margin: 2px 0; white-space: nowrap;">${escapeHtml(st)}</span>`;
          }).join('<br>');
        } else {
          const parts: string[] = [];
          if (user.doneTasks > 0) {
            parts.push(`<span style="display: inline-block; font-size: 10px; font-weight: 700; color: #15803d; background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 2px 7px; border-radius: 4px; margin: 2px 0; white-space: nowrap;">${user.doneTasks} Done</span>`);
          }
          if (user.qaTasks > 0) {
            parts.push(`<span style="display: inline-block; font-size: 10px; font-weight: 700; color: #2563eb; background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 2px 7px; border-radius: 4px; margin: 2px 0; white-space: nowrap;">${user.qaTasks} QA</span>`);
          }
          const pending = user.totalTasks - user.doneTasks - user.qaTasks;
          if (pending > 0) {
            parts.push(`<span style="display: inline-block; font-size: 10px; font-weight: 700; color: #b45309; background-color: #fffbeb; border: 1px solid #fde68a; padding: 2px 7px; border-radius: 4px; margin: 2px 0; white-space: nowrap;">${pending} In Progress</span>`);
          }
          taskStatusesHtml = parts.join('<br>') || `<span style="display: inline-block; font-size: 10px; font-weight: 700; color: #64748b; background-color: #f1f5f9; border: 1px solid #e2e8f0; padding: 2px 7px; border-radius: 4px;">Assigned</span>`;
        }

        return `
          <tr style="background-color: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
            <!-- Column 1: Only User Email -->
            <td style="padding: 12px 14px; vertical-align: top; font-size: 12.5px; color: #0f172a; font-weight: 600;">
              ${escapeHtml(user.userEmail)}
            </td>

            <!-- Column 2: Total Added Tasks for Today -->
            <td align="center" style="padding: 12px 8px; vertical-align: top; font-size: 13.5px; font-weight: 800; color: #0f172a;">
              ${user.totalTasks}
            </td>

            <!-- Column 3: Both Task Statuses -->
            <td align="center" style="padding: 12px 8px; vertical-align: top;">
              ${taskStatusesHtml}
            </td>

            <!-- Column 4: Total Logged Hours -->
            <td align="center" style="padding: 12px 8px; vertical-align: top; font-size: 12.5px; white-space: nowrap;">
              <strong style="color: #0284c7; font-weight: 800; font-size: 13px;">${user.totalActualHours.toFixed(1)}h</strong>
            </td>

            <!-- Column 5: Only Total Score (No text badge) -->
            <td align="center" style="padding: 12px 8px; vertical-align: top; white-space: nowrap;">
              <span style="display: inline-block; font-size: 13px; font-weight: 900; color: ${scoreBadge.text}; background-color: ${scoreBadge.bg}; border: 1px solid ${scoreBadge.border}; padding: 3px 9px; border-radius: 6px;">
                ${userNormScore}/10
              </span>
            </td>

            <!-- Column 6: Evaluation Summary To The Point (3-4 bullet pointers) -->
            <td style="padding: 10px 14px; vertical-align: top; font-size: 11.5px; color: #334155; line-height: 1.45;">
              <ul style="margin: 0; padding-left: 14px; list-style-type: disc;">
                ${pointers.map((p) => `<li style="margin-bottom: 3px;">${renderPointerHtml(p)}</li>`).join('')}
              </ul>
            </td>
          </tr>
        `;
      }).join('');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 24px 8px;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 980px; background-color: #ffffff; border-radius: 16px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.08);">
          
          <!-- Branded Executive Banner -->
          <tr>
            <td style="background-color: #09090b; padding: 24px 32px; border-bottom: 3px solid #34c4f2;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #34c4f2; font-weight: 800;">Creole Knowledge Portal</span>
                    <h1 style="margin: 4px 0 0 0; font-size: 22px; font-weight: 900; color: #ffffff; letter-spacing: -0.01em;">Executive Daily Team Zoho Digest</h1>
                    <p style="margin: 5px 0 0 0; font-size: 13px; color: #a1a1aa;">Target Date: <strong>${escapeHtml(payload.date)}</strong></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Table Section -->
          <tr>
            <td style="padding: 24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 14px;">
                <tr>
                  <td>
                    <h3 style="margin: 0; font-size: 13.5px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.06em;">
                      Team Members Performance Summary (${payload.users.length})
                    </h3>
                  </td>
                  <td align="right" style="font-size: 11.5px; color: #64748b;">
                    Full Activity Breakdown
                  </td>
                </tr>
              </table>
              
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; width: 100%;">
                <thead>
                  <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                    <th style="padding: 12px 14px; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em;">User Email</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em; white-space: nowrap;">Total Tasks</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em; white-space: nowrap;">Task Status</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em; white-space: nowrap;">Logged Hours</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em; white-space: nowrap;">Total Score</th>
                    <th style="padding: 12px 14px; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em; min-width: 220px;">Evaluation Summary</th>
                  </tr>
                </thead>
                <tbody>
                  ${tableRowsHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Portal CTA Action Button -->
          <tr>
            <td align="center" style="padding: 0 32px 28px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color: #34c4f2; border-radius: 10px; box-shadow: 0 4px 12px rgba(52, 196, 242, 0.35);">
                    <a href="${evaluationLink}" style="display: inline-block; color: #09090b; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; text-decoration: none; padding: 13px 30px;">
                      Open Zoho Evaluation Manager in Admin Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer Information -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                This consolidated team digest is delivered daily at 10:00 PM IST to authorized Administrators and Managers configured in the Creole Knowledge Portal.
              </p>
              <p style="margin: 6px 0 0 0; font-size: 10px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} Creole Studios &middot; Creole Knowledge Portal
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  const text = `
Creole Knowledge Portal - Daily Team Zoho Task Performance Digest
==================================================================
Target Date: ${payload.date}

Summary Table:
-----------------------------------------------------------------------------------------------------
${payload.users.map((u) => {
  const norm = u.dailyScore > 10 ? (u.dailyScore / 10).toFixed(1) : u.dailyScore.toFixed(1);
  const statusStr = (u.taskStatuses && u.taskStatuses.length > 0)
    ? u.taskStatuses.join(', ')
    : `${u.doneTasks} Done, ${u.totalTasks - u.doneTasks} In Progress`;
  const pointers = (u.summaryPointers && u.summaryPointers.length > 0)
    ? u.summaryPointers
    : buildEvaluationSummaryPointers(u);
  const pointersText = pointers.map((p) => `    • ${p}`).join('\n');
  return `• ${u.userEmail} | Tasks: ${u.totalTasks} | Status: ${statusStr} | Hours: ${u.totalActualHours.toFixed(1)}h | Score: ${norm}/10
  Summary:
${pointersText}`;
}).join('\n\n')}
-----------------------------------------------------------------------------------------------------

View full details in Admin Portal: ${evaluationLink}
  `.trim();

  return { subject, html, text };
}
