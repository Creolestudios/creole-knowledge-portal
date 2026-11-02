export interface TaskEmailItem {
  taskName: string;
  projectName: string;
  plannedHours: number;
  actualHours: number;
  status: string;
  timeAssessmentLabel: string;
  score: number;
  timeScore?: number;
  workMatchScore?: number;
  feedback?: string;
  whereLacked?: string;
  whereToImprove?: string;
  improvementItems?: string[];
  zohoLink?: string;
}

export interface DailyEvaluationEmailPayload {
  userName: string;
  userEmail: string;
  userRole?: string;
  date: string;
  dailyScore: number; // 0 to 100 or 0 to 10
  totalPlannedHours: number;
  totalActualHours: number;
  taskCount: number;
  doneTasks: number;
  delayedTasks: number;
  qaTasks: number;
  dailySummary: string;
  strengths: string[];
  improvements: string[];
  tasks: TaskEmailItem[];
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

function getScoreRating(score: number): { label: string; bg: string; text: string; border: string } {
  const normalized = score > 10 ? score / 10 : score;
  if (normalized >= 9.0) {
    return { label: 'Excellent', bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' };
  }
  if (normalized >= 7.5) {
    return { label: 'Good', bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' };
  }
  return { label: 'Needs Attention', bg: '#fffbeb', text: '#d97706', border: '#fde68a' };
}

function getTimeBadgeColor(assessment: string): { bg: string; text: string; border: string; label: string } {
  switch (assessment) {
    case 'ON_TIME':
    case 'SLIGHT_OVERRUN_TOLERATED':
      return { bg: '#dcfce7', text: '#15803d', border: '#86efac', label: 'Within Buffer' };
    case 'NOT_LOGGED':
      return { bg: '#f4f4f5', text: '#52525b', border: '#d4d4d8', label: 'Not Logged' };
    case 'UNEXPECTED_EARLY':
      return { bg: '#ffedd5', text: '#c2410c', border: '#fed7aa', label: 'Early Gap' };
    case 'OVERDUE':
    default:
      return { bg: '#fee2e2', text: '#b91c1c', border: '#fca5a5', label: 'Buffer Exceeded' };
  }
}

/**
 * Format decimal hours to clock-style (e.g. 4.5 -> "4:30")
 */
function formatHoursToClock(hours: number): string {
  if (Number.isNaN(hours) || !Number.isFinite(hours) || hours <= 0) return '0:00';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Generates an executive, mobile-friendly HTML & plain-text email
 * matching the exact UI, badges, and layout of the Daily Evaluation Modal Popup.
 * Built 100% with email-safe nested tables (zero CSS flexbox or grid).
 */
export function generateDailyEvaluationEmail(payload: DailyEvaluationEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const normalizedScore = payload.dailyScore > 10
    ? (payload.dailyScore / 10).toFixed(1)
    : payload.dailyScore.toFixed(1);
  const rating = getScoreRating(Number(normalizedScore));
  const userRole = payload.userRole || 'Developer';
  const portalUrl = payload.portalUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://portal.creolestudios.com';
  const evaluationLink = `${portalUrl}/dashboard/zoho-evaluation`;

  const subject = `[Zoho Daily Evaluation] ${payload.userName} - ${payload.date} (Score: ${normalizedScore}/10)`;

  const plannedClock = formatHoursToClock(payload.totalPlannedHours);
  const actualClock = formatHoursToClock(payload.totalActualHours);

  // Per-task cards matching ZohoDailyEvaluationModal & ZohoTaskModal (Email-Safe Table based)
  const taskCardsHtml = payload.tasks.length === 0
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 14px;">
        <tr>
          <td style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; padding: 24px; text-align: center; color: #64748b; font-style: italic; font-size: 13px;">
            No tasks logged or evaluated for this date.
          </td>
        </tr>
      </table>
    `
    : payload.tasks.map((task) => {
        const timeBadge = getTimeBadgeColor(task.timeAssessmentLabel);
        const taskScore = task.score > 10 ? (task.score / 10).toFixed(1) : task.score.toFixed(1);
        const timeScore = task.timeScore !== undefined
          ? (task.timeScore > 10 ? (task.timeScore / 10).toFixed(1) : task.timeScore.toFixed(1))
          : null;
        const workMatchScore = task.workMatchScore !== undefined
          ? (task.workMatchScore > 10 ? (task.workMatchScore / 10).toFixed(1) : task.workMatchScore.toFixed(1))
          : null;

        const isQA = task.status.toLowerCase().includes('qa');
        const isDone = task.status.toLowerCase().includes('completed') || task.status.toLowerCase().includes('closed') || task.status.toLowerCase().includes('done');
        const statusBadgeBg = isDone ? '#dcfce7' : isQA ? '#eff6ff' : '#f1f5f9';
        const statusBadgeText = isDone ? '#15803d' : isQA ? '#2563eb' : '#475569';
        const statusBadgeBorder = isDone ? '#86efac' : isQA ? '#bfdbfe' : '#e2e8f0';

        const taskPlannedClock = formatHoursToClock(task.plannedHours);
        const taskActualClock = formatHoursToClock(task.actualHours);

        return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
            <tr>
              <td style="padding: 16px 18px;">
                <!-- Card Header Table: Project, Duration, Status, Score -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 10px;">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="display: inline-block; font-size: 10px; font-weight: 800; color: #1e293b; background-color: #e2e8f0; padding: 3px 8px; border-radius: 6px; margin-right: 6px; text-transform: uppercase; letter-spacing: 0.04em;">
                        ${escapeHtml(task.projectName)}
                      </span>
                      <span style="display: inline-block; font-size: 10.5px; font-weight: 600; color: #334155; background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 2px 8px; border-radius: 6px; margin-right: 6px;">
                        ⏱ ${taskActualClock} hrs / ${taskPlannedClock} hrs
                      </span>
                      ${task.status ? `
                        <span style="display: inline-block; font-size: 10px; font-weight: 700; color: ${statusBadgeText}; background-color: ${statusBadgeBg}; border: 1px solid ${statusBadgeBorder}; padding: 2px 8px; border-radius: 6px; text-transform: uppercase;">
                          ${escapeHtml(task.status)}
                        </span>
                      ` : ''}
                    </td>
                    <td align="right" style="vertical-align: middle; white-space: nowrap;">
                      <span style="display: inline-block; font-size: 13px; font-weight: 900; color: #6d28d9; background-color: #f5f3ff; border: 1px solid #ddd6fe; padding: 4px 10px; border-radius: 8px;">
                        ${taskScore}/10
                      </span>
                    </td>
                  </tr>
                </table>

                <!-- Task Title -->
                <div style="font-size: 14.5px; font-weight: 800; color: #0f172a; line-height: 1.4; margin-bottom: 12px;">
                  ${escapeHtml(task.taskName)}
                </div>

                <!-- Metrics Strip: Time Adherence & Work Justification -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 10px;">
                  <tr>
                    <td style="padding: 8px 12px; font-size: 11px; color: #64748b;">
                      Time Tolerance: <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 10px; background-color: ${timeBadge.bg}; color: ${timeBadge.text}; border: 1px solid ${timeBadge.border}; margin-left: 4px;">
                        ${timeBadge.label}
                      </span>
                      ${timeScore ? `<strong style="color: #0f172a; margin-left: 6px;">(${timeScore}/10)</strong>` : ''}
                    </td>
                    ${workMatchScore ? `
                      <td align="right" style="padding: 8px 12px; font-size: 11px; color: #64748b;">
                        Work Justification: <strong style="color: #7c3aed; font-size: 11.5px;">${workMatchScore}/10</strong>
                      </td>
                    ` : ''}
                  </tr>
                </table>

                <!-- Performance Evaluation / Feedback -->
                ${task.feedback ? `
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
                    <tr>
                      <td style="background-color: #faf5ff; border-left: 3px solid #8b5cf6; border-radius: 6px; padding: 10px 14px;">
                        <span style="display: block; font-size: 10px; font-weight: 800; color: #6b21a8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px;">
                          ✨ Performance Evaluation
                        </span>
                        <p style="margin: 0; font-size: 12px; color: #334155; line-height: 1.5;">
                          ${escapeHtml(task.feedback)}
                        </p>
                      </td>
                    </tr>
                  </table>
                ` : ''}

                <!-- Actionable Improvements -->
                ${task.improvementItems && task.improvementItems.length > 0 ? `
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 10px 14px;">
                        <span style="display: block; font-size: 10px; font-weight: 800; color: #b45309; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
                          💡 Actionable Improvements
                        </span>
                        <ul style="margin: 0; padding-left: 18px; font-size: 11.5px; color: #92400e; line-height: 1.45;">
                          ${task.improvementItems.map(item => `<li style="margin-bottom: 2px;">${escapeHtml(item)}</li>`).join('')}
                        </ul>
                      </td>
                    </tr>
                  </table>
                ` : ''}
              </td>
            </tr>
          </table>
        `;
      }).join('');

  const strengthsListHtml = payload.strengths.length > 0
    ? payload.strengths.map(s => `<li style="margin-bottom: 4px;">${escapeHtml(s)}</li>`).join('')
    : '<li>Consistent execution and delivery against assigned tasks.</li>';

  const improvementsListHtml = payload.improvements.length > 0
    ? payload.improvements.map(i => `<li style="margin-bottom: 4px;">${escapeHtml(i)}</li>`).join('')
    : '<li>Continue logging timely work progress and updates regularly.</li>';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 24px 10px;">
    <tr>
      <td align="center">
        <!-- Main Modal-Style Container -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 680px; background-color: #ffffff; border-radius: 16px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08);">
          
          <!-- Branded Top Accent Bar -->
          <tr>
            <td style="background-color: #09090b; padding: 6px 28px; border-bottom: 3px solid #34c4f2;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 10px; font-weight: 800; color: #34c4f2; text-transform: uppercase; letter-spacing: 0.12em;">
                    CREOLE KNOWLEDGE PORTAL &bull; ZOHO PERFORMANCE AUDIT
                  </td>
                  <td align="right" style="font-size: 10px; font-weight: 600; color: #94a3b8;">
                    DAILY 10:00 PM IST
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Modal Header (Header Badges + Title + Overall Score) -->
          <tr>
            <td style="padding: 24px 28px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0;">
              <!-- Badges Line (Date, Tasks Count, Employee Info) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
                <tr>
                  <td>
                    <span style="display: inline-block; font-size: 11px; font-weight: 700; background-color: #f5f3ff; color: #6d28d9; border: 1px solid #ddd6fe; padding: 3px 10px; border-radius: 6px; margin-right: 6px;">
                      📅 ${escapeHtml(payload.date)}
                    </span>
                    <span style="display: inline-block; font-size: 11px; font-weight: 700; background-color: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; padding: 3px 10px; border-radius: 6px; margin-right: 6px;">
                      ${payload.taskCount} Task${payload.taskCount === 1 ? '' : 's'} Evaluated
                    </span>
                    <span style="font-size: 12px; color: #64748b; font-weight: 600;">
                      ${escapeHtml(payload.userName)} &bull; ${escapeHtml(userRole)}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Main Title and Overall Day Score Badge -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <h1 style="margin: 0; font-size: 21px; font-weight: 900; color: #0f172a; letter-spacing: -0.02em; line-height: 1.3;">
                      <span style="color: #8b5cf6;">✨</span> Daily Performance &amp; Activity Evaluation
                    </h1>
                    <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
                      Evaluation summary &amp; timelog audit for <strong>${escapeHtml(payload.userEmail)}</strong>
                    </div>
                  </td>
                  <td align="right" style="vertical-align: middle; white-space: nowrap; padding-left: 14px;">
                    <div style="background-color: ${rating.bg}; border: 1px solid ${rating.border}; color: ${rating.text}; padding: 8px 16px; border-radius: 12px; text-align: center; display: inline-block;">
                      <span style="display: block; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">${rating.label}</span>
                      <strong style="font-size: 22px; font-weight: 900; line-height: 1.1;">${normalizedScore}</strong>
                      <span style="font-size: 11px; font-weight: 600; opacity: 0.8;">/10</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Summary Metric Cards (Planned Time, Actual Spent, Done Tasks, Score) -->
          <tr>
            <td style="padding: 16px 28px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Planned Time -->
                  <td width="23%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 10px; text-align: center;">
                    <span style="display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em;">Planned Time</span>
                    <strong style="display: block; font-size: 17px; font-weight: 900; color: #0f172a; margin-top: 2px;">${plannedClock} hrs</strong>
                    <span style="display: block; font-size: 10px; color: #94a3b8; margin-top: 1px;">(${payload.totalPlannedHours.toFixed(1)}h total)</span>
                  </td>
                  <td width="2%"></td>
                  <!-- Actual Spent -->
                  <td width="23%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 10px; text-align: center;">
                    <span style="display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; color: #0284c7; letter-spacing: 0.04em;">Actual Spent</span>
                    <strong style="display: block; font-size: 17px; font-weight: 900; color: #0284c7; margin-top: 2px;">${actualClock} hrs</strong>
                    <span style="display: block; font-size: 10px; color: #94a3b8; margin-top: 1px;">(${payload.totalActualHours.toFixed(1)}h total)</span>
                  </td>
                  <td width="2%"></td>
                  <!-- Task Status -->
                  <td width="23%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 10px; text-align: center;">
                    <span style="display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; color: #16a34a; letter-spacing: 0.04em;">Completed</span>
                    <strong style="display: block; font-size: 17px; font-weight: 900; color: #16a34a; margin-top: 2px;">${payload.doneTasks} / ${payload.taskCount}</strong>
                    <span style="display: block; font-size: 10px; color: #94a3b8; margin-top: 1px;">${payload.delayedTasks > 0 ? `${payload.delayedTasks} delayed` : '0 delayed'}</span>
                  </td>
                  <td width="2%"></td>
                  <!-- Quality Rating -->
                  <td width="23%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 10px; text-align: center;">
                    <span style="display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; color: #7c3aed; letter-spacing: 0.04em;">Day Score</span>
                    <strong style="display: block; font-size: 17px; font-weight: 900; color: #7c3aed; margin-top: 2px;">${normalizedScore} / 10</strong>
                    <span style="display: block; font-size: 10px; color: #94a3b8; margin-top: 1px;">${rating.label}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Daily Performance Summary (Modal Left/Right Split Alignment) -->
          <tr>
            <td style="padding: 20px 28px 12px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #fbfaff; border: 1px solid #ede9fe; border-left: 4px solid #8b5cf6; border-radius: 8px; padding: 16px;">
                    <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 800; color: #6b21a8; letter-spacing: 0.05em; margin-bottom: 6px;">
                      ✨ Performance Evaluation Summary
                    </span>
                    <p style="margin: 0; font-size: 13px; color: #1e293b; line-height: 1.55;">
                      ${escapeHtml(payload.dailySummary)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Key Accomplishments and Areas for Improvement Cards -->
          <tr>
            <td style="padding: 8px 28px 16px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Accomplishments -->
                  <td width="48%" style="vertical-align: top; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 16px;">
                    <strong style="display: block; font-size: 11px; text-transform: uppercase; color: #166534; letter-spacing: 0.04em; margin-bottom: 8px;">
                      ✅ Key Accomplishments
                    </strong>
                    <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #14532d; line-height: 1.5;">
                      ${strengthsListHtml}
                    </ul>
                  </td>
                  <td width="4%"></td>
                  <!-- Improvements -->
                  <td width="48%" style="vertical-align: top; background-color: #fffbeb; border: 1px solid #fed7aa; border-radius: 10px; padding: 14px 16px;">
                    <strong style="display: block; font-size: 11px; text-transform: uppercase; color: #9a3412; letter-spacing: 0.04em; margin-bottom: 8px;">
                      💡 Areas for Improvement
                    </strong>
                    <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #7c2d12; line-height: 1.5;">
                      ${improvementsListHtml}
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tasks Evaluated for this Day Section -->
          <tr>
            <td style="padding: 12px 28px 20px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
                <tr>
                  <td>
                    <h3 style="margin: 0; font-size: 13px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.06em;">
                      Tasks Evaluated for this Day (${payload.tasks.length})
                    </h3>
                  </td>
                  <td align="right" style="font-size: 11px; color: #64748b;">
                    Exact activity &amp; time breakdown
                  </td>
                </tr>
              </table>

              ${taskCardsHtml}
            </td>
          </tr>

          <!-- Portal CTA Action Button -->
          <tr>
            <td align="center" style="padding: 0 28px 28px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color: #34c4f2; border-radius: 10px; box-shadow: 0 4px 12px rgba(52, 196, 242, 0.35);">
                    <a href="${evaluationLink}" style="display: inline-block; color: #09090b; font-size: 12.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; text-decoration: none; padding: 13px 28px;">
                      View Full Analysis in Knowledge Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer Information -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 28px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                This automated evaluation was delivered to <strong>${escapeHtml(payload.userEmail)}</strong> and designated reporting seniors following the daily 10:00 PM IST Zoho evaluation crawl.
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
Creole Knowledge Portal - Daily Zoho Task Evaluation
=====================================================
Employee: ${payload.userName} (${payload.userEmail}) • Role: ${userRole}
Date: ${payload.date}
Overall Day Score: ${normalizedScore}/10 (${rating.label})

Cumulative Time Activity:
- Planned Time: ${plannedClock} hrs (${payload.totalPlannedHours.toFixed(1)}h total)
- Actual Spent: ${actualClock} hrs (${payload.totalActualHours.toFixed(1)}h total)
- Tasks Evaluated: ${payload.taskCount} (Done: ${payload.doneTasks}, Delayed/Gap: ${payload.delayedTasks}, QA: ${payload.qaTasks})

Performance Evaluation Summary:
${payload.dailySummary}

Key Accomplishments:
${payload.strengths.map(s => `- ${s}`).join('\n')}

Areas for Improvement:
${payload.improvements.map(i => `- ${i}`).join('\n')}

Tasks Evaluated:
${payload.tasks.map(t => {
  const tScore = t.score > 10 ? (t.score / 10).toFixed(1) : t.score.toFixed(1);
  return `• [${t.projectName}] ${t.taskName} (${t.actualHours}h/${t.plannedHours}h) - Score: ${tScore}/10 | Tolerance: ${t.timeAssessmentLabel}
  Summary: ${t.feedback || 'None'}
  ${t.improvementItems && t.improvementItems.length > 0 ? `Improvements: ${t.improvementItems.join('; ')}` : ''}`;
}).join('\n\n')}

View complete interactive report: ${evaluationLink}
  `.trim();

  return { subject, html, text };
}
