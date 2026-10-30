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
}

export interface DailyEvaluationEmailPayload {
  userName: string;
  userEmail: string;
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
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getScoreBadgeColor(score: number): { bg: string; text: string; border: string } {
  const normalized = score > 10 ? score / 10 : score;
  if (normalized >= 8.0) {
    return { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' };
  }
  if (normalized >= 6.0) {
    return { bg: '#fffbeb', text: '#d97706', border: '#fde68a' };
  }
  return { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' };
}

function getTimeBadgeColor(assessment: string): { bg: string; text: string } {
  switch (assessment) {
    case 'ON_TIME':
    case 'SLIGHT_OVERRUN_TOLERATED':
      return { bg: '#dcfce7', text: '#15803d' };
    case 'NOT_LOGGED':
      return { bg: '#f4f4f5', text: '#71717a' };
    case 'UNEXPECTED_EARLY':
      return { bg: '#ffedd5', text: '#c2410c' };
    case 'OVERDUE':
    default:
      return { bg: '#fee2e2', text: '#b91c1c' };
  }
}

/**
 * Generates an executive, mobile-friendly HTML & plain-text email
 * for daily 10 PM Zoho Task Evaluation reporting.
 */
export function generateDailyEvaluationEmail(payload: DailyEvaluationEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const normalizedScore = payload.dailyScore > 10 ? (payload.dailyScore / 10).toFixed(1) : payload.dailyScore.toFixed(1);
  const scoreColors = getScoreBadgeColor(Number(normalizedScore));
  const portalUrl = payload.portalUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://portal.creolestudios.com';
  const evaluationLink = `${portalUrl}/dashboard/zoho-evaluation`;

  const subject = `[Zoho Daily Evaluation] ${payload.userName} - ${payload.date} (Score: ${normalizedScore}/10)`;

  const taskRowsHtml = payload.tasks.length === 0
    ? `<tr><td colspan="5" style="padding: 16px; text-align: center; color: #71717a; font-style: italic;">No tasks logged or evaluated for this date.</td></tr>`
    : payload.tasks.map((task) => {
        const timeBadge = getTimeBadgeColor(task.timeAssessmentLabel);
        const taskScore = task.score > 10 ? (task.score / 10).toFixed(1) : task.score.toFixed(1);
        const timeScore = task.timeScore !== undefined ? (task.timeScore > 10 ? (task.timeScore / 10).toFixed(1) : task.timeScore.toFixed(1)) : null;
        const workMatchScore = task.workMatchScore !== undefined ? (task.workMatchScore > 10 ? (task.workMatchScore / 10).toFixed(1) : task.workMatchScore.toFixed(1)) : null;

        const toleranceLabel = (() => {
          switch (task.timeAssessmentLabel) {
            case 'ON_TIME':
            case 'SLIGHT_OVERRUN_TOLERATED':
              return 'Within Buffer';
            case 'NOT_LOGGED':
              return 'Not Logged';
            case 'UNEXPECTED_EARLY':
              return 'Early Gap';
            case 'OVERDUE':
            default:
              return 'Buffer Exceeded';
          }
        })();

        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td colspan="5" style="padding: 16px; vertical-align: top;">
              <!-- Task Header & Meta -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 8px;">
                <tr>
                  <td style="vertical-align: top;">
                    <div style="margin-bottom: 4px;">
                      <span style="display: inline-block; font-size: 10px; font-weight: 700; color: #0284c7; background-color: #e0f2fe; padding: 2px 8px; border-radius: 6px; margin-right: 6px;">
                        ${escapeHtml(task.projectName)}
                      </span>
                      <span style="display: inline-block; font-size: 10px; font-weight: 700; color: #475569; background-color: #f1f5f9; padding: 2px 8px; border-radius: 6px;">
                        ${escapeHtml(task.status)}
                      </span>
                    </div>
                    <strong style="font-size: 14px; font-weight: 700; color: #0f172a; line-height: 1.3; display: block;">
                      ${escapeHtml(task.taskName)}
                    </strong>
                  </td>
                  <td align="right" style="vertical-align: top; white-space: nowrap;">
                    <div style="background-color: #faf5ff; border: 1px solid #e9d5ff; padding: 6px 12px; border-radius: 8px; text-align: center; display: inline-block;">
                      <span style="display: block; font-size: 9px; font-weight: 700; color: #7e22ce; text-transform: uppercase;">Task Score</span>
                      <strong style="font-size: 16px; font-weight: 900; color: #7e22ce; line-height: 1;">${taskScore}</strong>
                      <span style="font-size: 10px; color: #a855f7;">/10</span>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Metrics Strip (Time, Justification, Tolerance) -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size: 11px;">
                  <tr>
                    <td style="color: #64748b;">
                      Hours: <strong style="color: #0f172a;">${task.actualHours.toFixed(2)}h</strong> <span style="color: #94a3b8;">/ ${task.plannedHours.toFixed(2)}h planned</span>
                    </td>
                    <td style="text-align: center;">
                      Tolerance: <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 10px; background-color: ${timeBadge.bg}; color: ${timeBadge.text};">
                        ${escapeHtml(toleranceLabel)}
                      </span>
                      ${timeScore ? `<span style="color: #64748b; font-size: 10px; margin-left: 4px;">(${timeScore}/10)</span>` : ''}
                    </td>
                    ${workMatchScore ? `
                      <td style="text-align: right; color: #64748b;">
                        Work Justification: <strong style="color: #7e22ce;">${workMatchScore}/10</strong>
                      </td>
                    ` : ''}
                  </tr>
                </table>
              </div>

              <!-- Admin Panel Evaluative Performance Summary -->
              ${task.feedback ? `
                <div style="background-color: #ffffff; border-left: 3px solid #8b5cf6; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                  <span style="display: block; font-size: 10px; font-weight: 800; color: #6b21a8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">
                    Performance Evaluation
                  </span>
                  <p style="margin: 0; font-size: 12px; color: #334155; line-height: 1.5; white-space: pre-line;">
                    ${escapeHtml(task.feedback)}
                  </p>
                </div>
              ` : ''}

              <!-- Actionable Improvements (Admin Panel Parity) -->
              ${task.improvementItems && task.improvementItems.length > 0 ? `
                <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 8px 12px;">
                  <span style="display: block; font-size: 10px; font-weight: 800; color: #b45309; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">
                    Actionable Improvements
                  </span>
                  <ul style="margin: 0; padding-left: 16px; font-size: 11px; color: #92400e; line-height: 1.4;">
                    ${task.improvementItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}
            </td>
          </tr>
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
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 680px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #09090b; padding: 24px 32px; border-bottom: 3px solid #34c4f2;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #34c4f2; font-weight: 700;">Creole Knowledge Portal</span>
                    <h1 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 800; color: #ffffff;">Daily Zoho Task Evaluation</h1>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #a1a1aa;">Automated 10:00 PM IST Analysis Report</p>
                  </td>
                  <td align="right" style="vertical-align: middle;">
                    <div style="background-color: ${scoreColors.bg}; border: 1px solid ${scoreColors.border}; color: ${scoreColors.text}; padding: 8px 16px; border-radius: 12px; text-align: center; display: inline-block;">
                      <span style="display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Daily Score</span>
                      <strong style="font-size: 22px; font-weight: 900; line-height: 1;">${normalizedScore}</strong>
                      <span style="font-size: 11px; font-weight: 600; opacity: 0.8;">/10</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Employee Overview & Date -->
          <tr>
            <td style="padding: 24px 32px 12px 32px; background-color: #ffffff;">
              <p style="margin: 0; font-size: 14px; color: #64748b;">
                Evaluation report for <strong style="color: #0f172a;">${escapeHtml(payload.userName)}</strong> (${escapeHtml(payload.userEmail)})
              </p>
              <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">
                Evaluation Target Date: <strong>${escapeHtml(payload.date)}</strong>
              </p>
            </td>
          </tr>

          <!-- Summary Metric Cards -->
          <tr>
            <td style="padding: 12px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="23%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 700; color: #64748b;">Total Tasks</span>
                    <strong style="font-size: 18px; color: #0f172a;">${payload.taskCount}</strong>
                  </td>
                  <td width="2%"></td>
                  <td width="23%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 700; color: #16a34a;">Completed</span>
                    <strong style="font-size: 18px; color: #16a34a;">${payload.doneTasks}</strong>
                  </td>
                  <td width="2%"></td>
                  <td width="23%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 700; color: #dc2626;">Delayed / Gap</span>
                    <strong style="font-size: 18px; color: #dc2626;">${payload.delayedTasks}</strong>
                  </td>
                  <td width="2%"></td>
                  <td width="25%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
                    <span style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 700; color: #0284c7;">Hours Logged</span>
                    <strong style="font-size: 18px; color: #0284c7;">${payload.totalActualHours.toFixed(1)}h</strong>
                    <span style="font-size: 10px; color: #94a3b8;">/${payload.totalPlannedHours.toFixed(1)}h</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Daily Executive Performance Summary -->
          <tr>
            <td style="padding: 12px 32px;">
              <div style="background-color: #f1f5f9; border-left: 4px solid #34c4f2; border-radius: 8px; padding: 14px 16px;">
                <span style="display: block; font-size: 11px; text-transform: uppercase; font-weight: 800; color: #0369a1; letter-spacing: 0.05em; margin-bottom: 4px;">Daily Performance Summary</span>
                <p style="margin: 0; font-size: 13px; color: #1e293b; line-height: 1.5;">${escapeHtml(payload.dailySummary)}</p>
              </div>
            </td>
          </tr>

          <!-- Strengths and Growth Areas -->
          <tr>
            <td style="padding: 8px 32px 16px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="48%" style="vertical-align: top; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px;">
                    <strong style="display: block; font-size: 11px; text-transform: uppercase; color: #166534; margin-bottom: 6px;">Key Strengths</strong>
                    <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #14532d; line-height: 1.5;">
                      ${strengthsListHtml}
                    </ul>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="vertical-align: top; background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 10px; padding: 14px;">
                    <strong style="display: block; font-size: 11px; text-transform: uppercase; color: #9a3412; margin-bottom: 6px;">Recommendations & Coaching</strong>
                    <ul style="margin: 0; padding-left: 18px; font-size: 12px; color: #7c2d12; line-height: 1.5;">
                      ${improvementsListHtml}
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Detailed Task Breakdown Table -->
          <tr>
            <td style="padding: 12px 32px 24px 32px;">
              <h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">
                Detailed Task Breakdown (${payload.tasks.length})
              </h3>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Task</th>
                    <th style="padding: 10px 14px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Hours</th>
                    <th style="padding: 10px 14px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Tolerance</th>
                    <th style="padding: 10px 14px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Status</th>
                    <th style="padding: 10px 14px; text-align: right; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700;">Score</th>
                  </tr>
                </thead>
                <tbody>
                  ${taskRowsHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- Portal CTA Action Button -->
          <tr>
            <td align="center" style="padding: 0 32px 28px 32px;">
              <a href="${evaluationLink}" style="display: inline-block; background-color: #34c4f2; color: #09090b; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; text-decoration: none; padding: 12px 28px; border-radius: 12px; box-shadow: 0 4px 10px rgba(52, 196, 242, 0.3);">
                View Full Analysis in Knowledge Portal
              </a>
            </td>
          </tr>

          <!-- Footer Information -->
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                This automated email was delivered to <strong>${escapeHtml(payload.userEmail)}</strong> and designated reporting seniors following the daily 10:00 PM IST Zoho evaluation crawl.
              </p>
              <p style="margin: 6px 0 0 0; font-size: 10px; color: #cbd5e1;">
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
Employee: ${payload.userName} (${payload.userEmail})
Date: ${payload.date}
Overall Score: ${normalizedScore}/10

Summary:
- Total Tasks: ${payload.taskCount}
- Completed: ${payload.doneTasks}
- Delayed/Gap: ${payload.delayedTasks}
- Hours Logged: ${payload.totalActualHours.toFixed(1)}h / ${payload.totalPlannedHours.toFixed(1)}h

Performance Overview:
${payload.dailySummary}

Key Strengths:
${payload.strengths.map(s => `- ${s}`).join('\n')}

Recommendations:
${payload.improvements.map(i => `- ${i}`).join('\n')}

Task Details:
${payload.tasks.map(t => `- ${t.taskName} [${t.projectName}]: ${t.actualHours}h/${t.plannedHours}h | Status: ${t.status} | Score: ${(t.score > 10 ? t.score / 10 : t.score).toFixed(1)}/10`).join('\n')}

View complete report: ${evaluationLink}
  `.trim();

  return { subject, html, text };
}
