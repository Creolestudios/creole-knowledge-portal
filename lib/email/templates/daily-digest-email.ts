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
  importantNotes?: string[];
  timeAssessmentLabel?: string;
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
 * Generates an executive, mobile-friendly HTML & plain-text email for
 * the consolidated Daily Team Zoho Task Performance Digest for Admins & Managers.
 * Built 100% with email-safe tables and high readability.
 */
export function generateDailyDigestEmail(payload: DailyDigestEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const normalizedAvg = payload.teamAvgScore > 10
    ? (payload.teamAvgScore / 10).toFixed(1)
    : payload.teamAvgScore.toFixed(1);
  const portalUrl = payload.portalUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://portal.creolestudios.com';
  const evaluationLink = `${portalUrl}/admin/dashboard?tab=zoho`;

  const subject = `[Daily Zoho Digest] Team Performance Report - ${payload.date} (Avg Score: ${normalizedAvg}/10)`;

  // Generate table rows for users
  const tableRowsHtml = payload.users.length === 0
    ? `<tr><td colspan="7" style="padding: 24px; text-align: center; color: #71717a; font-style: italic; font-size: 13px;">No employee activity recorded or evaluated for ${escapeHtml(payload.date)}.</td></tr>`
    : payload.users.map((user, idx) => {
        const userNormScore = user.dailyScore > 10
          ? (user.dailyScore / 10).toFixed(1)
          : user.dailyScore.toFixed(1);
        const scoreBadge = getScoreBadgeColor(Number(userNormScore));
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        const delayedBadgeColor = user.delayedTasks > 0 ? '#dc2626' : '#16a34a';
        const delayedBgColor = user.delayedTasks > 0 ? '#fee2e2' : '#dcfce7';
        const delayedBorder = user.delayedTasks > 0 ? '#fca5a5' : '#86efac';

        return `
          <tr style="background-color: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
            <!-- Employee Info -->
            <td style="padding: 14px 12px; vertical-align: top;">
              <strong style="display: block; font-size: 13.5px; color: #0f172a; line-height: 1.3;">
                ${escapeHtml(user.userName)}
              </strong>
              <span style="display: block; font-size: 11px; color: #64748b; margin-top: 2px;">
                ${escapeHtml(user.userEmail)}
              </span>
              ${user.seniorityLevel ? `
                <span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: #4338ca; background-color: #e0e7ff; padding: 2px 7px; border-radius: 4px; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.03em;">
                  ${escapeHtml(user.seniorityLevel)}
                </span>
              ` : ''}
            </td>

            <!-- Total Tasks -->
            <td align="center" style="padding: 14px 8px; vertical-align: top; font-size: 13.5px; font-weight: 800; color: #0f172a;">
              ${user.totalTasks}
            </td>

            <!-- Due / Delayed Tasks -->
            <td align="center" style="padding: 14px 8px; vertical-align: top;">
              <span style="display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 6px; background-color: ${delayedBgColor}; color: ${delayedBadgeColor}; border: 1px solid ${delayedBorder};">
                ${user.delayedTasks}
              </span>
            </td>

            <!-- Done / QA Tasks -->
            <td align="center" style="padding: 14px 8px; vertical-align: top; font-size: 12px; color: #334155;">
              <span style="color: #16a34a; font-weight: 800; font-size: 12.5px;">${user.doneTasks} done</span>
              ${user.qaTasks > 0 ? `<br><span style="display: inline-block; color: #2563eb; font-size: 10px; font-weight: 700; background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 1px 6px; border-radius: 4px; margin-top: 3px;">${user.qaTasks} QA</span>` : ''}
            </td>

            <!-- Logged vs Planned Hours -->
            <td align="center" style="padding: 14px 8px; vertical-align: top; font-size: 12.5px; white-space: nowrap;">
              <strong style="color: #0284c7; font-weight: 800;">${user.totalActualHours.toFixed(1)}h</strong>
              <span style="color: #94a3b8; font-size: 11px;"> / ${user.totalPlannedHours.toFixed(1)}h</span>
            </td>

            <!-- Daily Score -->
            <td align="center" style="padding: 14px 8px; vertical-align: top; white-space: nowrap;">
              <div style="background-color: ${scoreBadge.bg}; border: 1px solid ${scoreBadge.border}; color: ${scoreBadge.text}; padding: 4px 9px; border-radius: 8px; display: inline-block; text-align: center;">
                <strong style="font-size: 14px; font-weight: 900; line-height: 1;">${userNormScore}</strong>
                <span style="font-size: 10px; font-weight: 700;">/10</span>
                <span style="display: block; font-size: 8.5px; font-weight: 800; text-transform: uppercase; margin-top: 2px;">${scoreBadge.label}</span>
              </div>
            </td>

            <!-- Reason & Performance Summary -->
            <td style="padding: 14px 12px; vertical-align: top; font-size: 12px; color: #334155; line-height: 1.5;">
              <p style="margin: 0; font-size: 12px; color: #1e293b; font-weight: 500;">
                ${escapeHtml(user.reason)}
              </p>
              ${user.importantNotes && user.importantNotes.length > 0 ? `
                <ul style="margin: 5px 0 0 0; padding-left: 14px; font-size: 11px; color: #b45309; line-height: 1.4;">
                  ${user.importantNotes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}
                </ul>
              ` : ''}
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
                    <p style="margin: 5px 0 0 0; font-size: 13px; color: #a1a1aa;">Consolidated 10:00 PM IST Analysis for Administrators &amp; Managers &middot; Target Date: <strong>${escapeHtml(payload.date)}</strong></p>
                  </td>
                  <td align="right" style="vertical-align: middle; white-space: nowrap; padding-left: 16px;">
                    <div style="background-color: #18181b; border: 1px solid #3f3f46; padding: 10px 18px; border-radius: 12px; text-align: center; display: inline-block;">
                      <span style="display: block; font-size: 10px; font-weight: 800; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.05em;">Team Avg Score</span>
                      <strong style="font-size: 24px; font-weight: 900; color: #34c4f2; line-height: 1.1;">${normalizedAvg}</strong>
                      <span style="font-size: 11px; font-weight: 600; color: #71717a;">/10</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- KPI Metric Cards Strip -->
          <tr>
            <td style="padding: 18px 32px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="19%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 800; color: #64748b; letter-spacing: 0.04em;">Members</span>
                    <strong style="font-size: 20px; font-weight: 900; color: #0f172a; display: block; margin-top: 2px;">${payload.totalUsersEvaluated}</strong>
                  </td>
                  <td width="1.25%"></td>
                  <td width="19%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 800; color: #64748b; letter-spacing: 0.04em;">Total Tasks</span>
                    <strong style="font-size: 20px; font-weight: 900; color: #0f172a; display: block; margin-top: 2px;">${payload.totalTasks}</strong>
                  </td>
                  <td width="1.25%"></td>
                  <td width="19%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 800; color: #16a34a; letter-spacing: 0.04em;">Completed</span>
                    <strong style="font-size: 20px; font-weight: 900; color: #16a34a; display: block; margin-top: 2px;">${payload.totalDoneTasks}</strong>
                  </td>
                  <td width="1.25%"></td>
                  <td width="19%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 800; color: #dc2626; letter-spacing: 0.04em;">Due / Delayed</span>
                    <strong style="font-size: 20px; font-weight: 900; color: #dc2626; display: block; margin-top: 2px;">${payload.totalDelayedTasks}</strong>
                  </td>
                  <td width="1.25%"></td>
                  <td width="19%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 800; color: #0284c7; letter-spacing: 0.04em;">Hours Logged</span>
                    <strong style="font-size: 20px; font-weight: 900; color: #0284c7; display: block; margin-top: 2px;">${payload.totalActualHours.toFixed(1)}h</strong>
                    <span style="font-size: 10px; color: #94a3b8;">/${payload.totalPlannedHours.toFixed(1)}h</span>
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
              
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                    <th style="padding: 12px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em;">Employee</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em;">Tasks</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em;">Due / Delay</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em;">Status</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em;">Hours</th>
                    <th style="padding: 12px 8px; text-align: center; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em;">Score</th>
                    <th style="padding: 12px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em; min-width: 220px;">Reason &amp; Evaluation Summary</th>
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
Team Members Evaluated: ${payload.totalUsersEvaluated}
Team Average Score: ${normalizedAvg}/10
Total Tasks: ${payload.totalTasks} (Completed: ${payload.totalDoneTasks}, Due/Delayed: ${payload.totalDelayedTasks})
Total Hours: ${payload.totalActualHours.toFixed(1)}h logged / ${payload.totalPlannedHours.toFixed(1)}h planned

Summary Table:
-----------------------------------------------------------------------------------------------------
${payload.users.map((u) => {
  const norm = u.dailyScore > 10 ? (u.dailyScore / 10).toFixed(1) : u.dailyScore.toFixed(1);
  return `• ${u.userName} (${u.userEmail}) | Tasks: ${u.totalTasks} (Done: ${u.doneTasks}, Delayed: ${u.delayedTasks}) | Hours: ${u.totalActualHours.toFixed(1)}h/${u.totalPlannedHours.toFixed(1)}h | Score: ${norm}/10
  Reason: ${u.reason}${u.importantNotes && u.importantNotes.length > 0 ? `\n  Notes: ${u.importantNotes.join('; ')}` : ''}`;
}).join('\n\n')}
-----------------------------------------------------------------------------------------------------

View full details in Admin Portal: ${evaluationLink}
  `.trim();

  return { subject, html, text };
}
