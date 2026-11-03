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
  const rawPortalUrl =
    payload.portalUrl ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000';
  const portalUrl = rawPortalUrl.replace(/\/+$/, '');
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
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
            <tr>
              <td style="padding: 10px 14px;">
                <!-- Header: Project, Task Name, Hours, Status & Score -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="display: inline-block; font-size: 9.5px; font-weight: 800; color: #475569; background-color: #f1f5f9; border: 1px solid #e2e8f0; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 6px;">
                        ${escapeHtml(task.projectName)}
                      </span>
                      <strong style="font-size: 13.5px; color: #0f172a; vertical-align: middle;">
                        ${escapeHtml(task.taskName)}
                      </strong>
                    </td>
                    <td align="right" style="vertical-align: middle; white-space: nowrap; padding-left: 8px;">
                      <span style="font-size: 12.5px; font-weight: 900; color: #6d28d9; background-color: #f5f3ff; border: 1px solid #ddd6fe; padding: 2px 8px; border-radius: 6px;">
                        ${taskScore}/10
                      </span>
                    </td>
                  </tr>
                </table>

                <!-- Compact Sub-bar: Status, Hours & Tolerance -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 6px; margin-bottom: 6px;">
                  <tr>
                    <td style="font-size: 11px; color: #64748b; vertical-align: middle;">
                      <span style="display: inline-block; font-size: 10.5px; font-weight: 600; color: #334155; margin-right: 8px;">
                        ⏱ <strong>${taskActualClock}</strong> / ${taskPlannedClock} hrs
                      </span>
                      ${task.status ? `
                        <span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: ${statusBadgeText}; background-color: ${statusBadgeBg}; border: 1px solid ${statusBadgeBorder}; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; margin-right: 8px;">
                          ${escapeHtml(task.status)}
                        </span>
                      ` : ''}
                      <span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: ${timeBadge.text}; background-color: ${timeBadge.bg}; border: 1px solid ${timeBadge.border}; padding: 1px 6px; border-radius: 4px;">
                        ${timeBadge.label}
                      </span>
                      ${workMatchScore ? `
                        <span style="margin-left: 8px; font-size: 10.5px; color: #64748b;">
                          Work Justification: <strong style="color: #7c3aed;">${workMatchScore}/10</strong>
                        </span>
                      ` : ''}
                    </td>
                  </tr>
                </table>

                <!-- Performance Feedback (Compact) -->
                ${task.feedback ? `
                  <div style="background-color: #faf5ff; border-left: 3px solid #8b5cf6; border-radius: 4px; padding: 6px 10px; margin-top: 6px; font-size: 11.5px; color: #334155; line-height: 1.4;">
                    ${escapeHtml(task.feedback)}
                  </div>
                ` : ''}

                <!-- Actionable Improvement (Compact) -->
                ${task.improvementItems && task.improvementItems.length > 0 ? `
                  <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 4px; padding: 6px 10px; margin-top: 6px; font-size: 11px; color: #92400e; line-height: 1.35;">
                    <strong style="color: #b45309; text-transform: uppercase; font-size: 9.5px; letter-spacing: 0.04em;">Improvement:</strong>
                    ${task.improvementItems.map(item => escapeHtml(item)).join(' &bull; ')}
                  </div>
                ` : ''}
              </td>
            </tr>
          </table>
        `;
      }).join('');

  const strengthsListHtml = payload.strengths.length > 0
    ? payload.strengths.map(s => `<li style="margin-bottom: 2px;">${escapeHtml(s)}</li>`).join('')
    : '<li>Consistent execution and delivery against assigned tasks.</li>';

  const improvementsListHtml = payload.improvements.length > 0
    ? payload.improvements.map(i => `<li style="margin-bottom: 2px;">${escapeHtml(i)}</li>`).join('')
    : '<li>Continue logging timely work progress and updates regularly.</li>';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.45;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 12px 6px;">
    <tr>
      <td align="center">
        <!-- Main Modal-Style Container: 760px wide for maximum screen efficiency -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 760px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 15px -3px rgba(0, 0, 0, 0.05);">
          
          <!-- Compact Clean Header Bar: User, Role, Date + ONLY ONE Day Score Badge on right -->
          <tr>
            <td style="padding: 14px 20px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <div style="font-size: 10px; font-weight: 800; color: #0284c7; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px;">
                      Creole Knowledge Portal &bull; Daily Evaluation
                    </div>
                    <div style="font-size: 16px; font-weight: 900; color: #0f172a; line-height: 1.2;">
                      ${escapeHtml(payload.userName)}
                      <span style="font-size: 11.5px; font-weight: 500; color: #64748b;">(${escapeHtml(payload.userEmail)})</span>
                    </div>
                    <div style="font-size: 11.5px; color: #64748b; margin-top: 3px;">
                      <span style="font-weight: 600; color: #334155;">${escapeHtml(userRole)}</span>
                      <span style="color: #cbd5e1; margin: 0 5px;">&bull;</span>
                      <span>📅 ${escapeHtml(payload.date)}</span>
                      <span style="color: #cbd5e1; margin: 0 5px;">&bull;</span>
                      <span><strong>${payload.taskCount}</strong> Tasks Evaluated</span>
                    </div>
                  </td>
                  <td align="right" style="vertical-align: middle; white-space: nowrap; padding-left: 12px;">
                    <!-- Day Score shown ONLY ONCE here on the top right -->
                    <div style="background-color: ${rating.bg}; border: 1.5px solid ${rating.border}; color: ${rating.text}; padding: 6px 14px; border-radius: 10px; text-align: center; display: inline-block;">
                      <span style="display: block; font-size: 8.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em;">Day Score</span>
                      <strong style="font-size: 20px; font-weight: 900; line-height: 1.1;">${normalizedScore}</strong>
                      <span style="font-size: 11px; font-weight: 700; opacity: 0.85;">/ 10</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Compact 3-Metric Cards: Planned Time, Actual Spent, Status (No duplicated score card) -->
          <tr>
            <td style="padding: 10px 20px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Planned Time -->
                  <td width="32%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; text-align: center;">
                    <span style="display: block; font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #64748b; letter-spacing: 0.04em;">Planned Time</span>
                    <strong style="display: block; font-size: 15px; font-weight: 900; color: #0f172a; margin-top: 1px;">${plannedClock} hrs</strong>
                  </td>
                  <td width="2%"></td>
                  <!-- Actual Spent -->
                  <td width="32%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; text-align: center;">
                    <span style="display: block; font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #0284c7; letter-spacing: 0.04em;">Actual Spent</span>
                    <strong style="display: block; font-size: 15px; font-weight: 900; color: #0284c7; margin-top: 1px;">${actualClock} hrs</strong>
                  </td>
                  <td width="2%"></td>
                  <!-- Task Status -->
                  <td width="32%" style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; text-align: center;">
                    <span style="display: block; font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #16a34a; letter-spacing: 0.04em;">Status Breakdown</span>
                    <strong style="display: block; font-size: 15px; font-weight: 900; color: #16a34a; margin-top: 1px;">
                      ${payload.qaTasks > 0 ? `${payload.qaTasks} QA Review` : `${payload.doneTasks} Completed`}
                    </strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Compact Accomplishments & Improvements (Side by side) -->
          <tr>
            <td style="padding: 10px 20px 8px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <!-- Accomplishments -->
                  <td width="48%" style="vertical-align: top; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px;">
                    <strong style="display: block; font-size: 10px; text-transform: uppercase; color: #166534; letter-spacing: 0.04em; margin-bottom: 5px;">
                      ✅ Key Accomplishments
                    </strong>
                    <ul style="margin: 0; padding-left: 16px; font-size: 11.5px; color: #14532d; line-height: 1.4;">
                      ${strengthsListHtml}
                    </ul>
                  </td>
                  <td width="4%"></td>
                  <!-- Improvements -->
                  <td width="48%" style="vertical-align: top; background-color: #fffbeb; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 14px;">
                    <strong style="display: block; font-size: 10px; text-transform: uppercase; color: #9a3412; letter-spacing: 0.04em; margin-bottom: 5px;">
                      💡 Areas for Improvement
                    </strong>
                    <ul style="margin: 0; padding-left: 16px; font-size: 11.5px; color: #7c2d12; line-height: 1.4;">
                      ${improvementsListHtml}
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tasks List Section (Compact layout) -->
          <tr>
            <td style="padding: 8px 20px 14px 20px;">
              <div style="font-size: 11.5px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">
                Daily Tasks Breakdown (${payload.tasks.length})
              </div>

              ${taskCardsHtml}
            </td>
          </tr>

          <!-- Compact CTA Button & Footer -->
          <tr>
            <td align="center" style="padding: 0 20px 16px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color: #34c4f2; border-radius: 8px; box-shadow: 0 2px 8px rgba(52, 196, 242, 0.25);">
                    <a href="${evaluationLink}" style="display: inline-block; color: #09090b; font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; text-decoration: none; padding: 9px 22px;">
                      View in Knowledge Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <div style="font-size: 10px; color: #94a3b8; margin-top: 10px;">
                &copy; ${new Date().getFullYear()} Creole Studios &middot; Creole Knowledge Portal
              </div>
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
