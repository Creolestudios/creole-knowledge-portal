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
 * Constructs concise, clear bullet pointers explaining why points were deducted:
 * Focuses strictly on factual deduction reasons and obvious rationale (no Done/Pending/Action noise).
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

  // Collect distinct deduction reasons
  const deductionReasons: string[] = [];

  if (user.importantNotes && user.importantNotes.length > 0) {
    for (const rawNote of user.importantNotes) {
      if (!rawNote || !rawNote.trim()) continue;
      const note = rawNote.trim();
      let text = '';
      if (/log progress comments|no progress comments|missing comments/i.test(note)) {
        text = 'No progress comments added explaining what was done and tested.';
      } else if (/copy-pastes|verbatim/i.test(note)) {
        text = 'Comment just copied the task description without explaining the work.';
      } else if (/beyond status updates|status marks|brief description/i.test(note)) {
        text = 'Comments were too short (just words like "done" without explaining work and tests).';
      } else if (/pending deliverables|remaining items|unfinished/i.test(note)) {
        text = 'Tasks were left pending without explaining any blocker.';
      } else if (/not in qa review|left in "in progress"|left in in progress/i.test(note)) {
        text = 'Tasks were left in In Progress without moving to In QA Review.';
      } else if (/exceeded planned hours|overtime|delayed/i.test(note)) {
        text = 'Task took more time than planned.';
      } else if (/no hours were logged|zero hours/i.test(note)) {
        text = 'No hours logged in Zoho Projects for assigned tasks.';
      } else {
        const clean = note
          .replace(/\s*\(-?\d+(?:\.\d+)?\s*pts?\)/gi, '')
          .replace(/^[A-Za-z\s]+:\s*/, '')
          .trim();
        text = clean;
      }
      if (text) {
        if (!text.endsWith('.')) text += '.';
        if (!deductionReasons.includes(text)) {
          deductionReasons.push(text);
        }
      }
    }
  }

  // Check additional deductions from actual hours, delay, and status so all deduction reasons are listed
  if (user.totalActualHours === 0 && user.totalTasks > 0) {
    const zeroHours = 'No hours logged in Zoho Projects for assigned tasks.';
    if (!deductionReasons.includes(zeroHours)) {
      deductionReasons.push(zeroHours);
    }
  }

  if (user.delayedTasks > 0) {
    const delayDeduction = `${user.delayedTasks} task(s) took more time than planned.`;
    if (!deductionReasons.some(d => d.includes('more time than planned'))) {
      deductionReasons.push(delayDeduction);
    }
  }

  const hasTasksLeftInProgress = (user.taskStatuses && user.taskStatuses.some(s => /in progress|backlog/i.test(s))) ||
    (user.doneTasks === 0 && (user.qaTasks ?? 0) === 0 && user.totalTasks > 0);
  if (hasTasksLeftInProgress) {
    const statusDeduction = 'Tasks were left in In Progress without moving to In QA Review.';
    if (!deductionReasons.includes(statusDeduction)) {
      deductionReasons.push(statusDeduction);
    }
  }

  // Fallbacks if no deductions were found
  if (deductionReasons.length === 0) {
    if (user.reason && user.reason.trim().length > 10 && !/^completed \d+\/\d+ task/i.test(user.reason.trim()) && !/^daily evaluation completed/i.test(user.reason.trim())) {
      const r = user.reason.trim();
      deductionReasons.push(r.endsWith('.') ? r : `${r}.`);
    } else if (scoreNum >= 8.5) {
      deductionReasons.push('Tasks completed on time with clear progress updates.');
    } else if (scoreNum >= 7.0) {
      deductionReasons.push('Tasks completed on time, but progress comments were brief.');
    } else if (scoreNum >= 5.0) {
      deductionReasons.push('Progress comments did not explain what was done and tested.');
    } else {
      deductionReasons.push('No progress comments added explaining what was done and tested.');
    }
  }

  // All scoring deduction points are listed directly under Why this score
  pointers.push(`Why this score (${normScore}/10):`);
  for (const r of deductionReasons) {
    pointers.push(r);
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

function renderEvaluationSummaryHtml(pointers: string[]): string {
  if (pointers.length === 0) return '';
  const first = pointers[0];
  const whyMatch = first.match(/^Why this score \(\d+(?:\.\d+)?\/10\):?$/i);
  if (whyMatch) {
    const items = pointers.slice(1);
    return `
      <div style="font-size: 11px; font-weight: 800; color: #0f172a; margin-bottom: 3px;">
        <strong>${escapeHtml(first)}</strong>
      </div>
      <ul style="margin: 0; padding-left: 14px; list-style-type: disc; word-break: break-word; overflow-wrap: break-word;">
        ${items.map(it => `<li style="margin-bottom: 2px; word-break: break-word; overflow-wrap: break-word;">${escapeHtml(it)}</li>`).join('')}
      </ul>
    `.trim();
  }

  return `
    <ul style="margin: 0; padding-left: 14px; list-style-type: disc; word-break: break-word; overflow-wrap: break-word;">
      ${pointers.map((p) => `<li style="margin-bottom: 3px; word-break: break-word; overflow-wrap: break-word;">${renderPointerHtml(p)}</li>`).join('')}
    </ul>
  `.trim();
}

function renderEvaluationSummaryText(pointers: string[]): string {
  if (pointers.length === 0) return '';
  const first = pointers[0];
  const whyMatch = first.match(/^Why this score \(\d+(?:\.\d+)?\/10\):?$/i);
  if (whyMatch) {
    const items = pointers.slice(1);
    return `    ${first}\n${items.map(it => `      • ${it}`).join('\n')}`;
  }
  return pointers.map(p => `    • ${p}`).join('\n');
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
    ? `<tr><td colspan="3" style="padding: 24px; text-align: center; color: #71717a; font-style: italic; font-size: 13px;">No employee activity recorded or evaluated for ${escapeHtml(payload.date)}.</td></tr>`
    : payload.users.map((user, idx) => {
        const userNormScore = user.dailyScore > 10
          ? (user.dailyScore / 10).toFixed(1)
          : user.dailyScore.toFixed(1);
        const scoreBadge = getScoreBadgeColor(Number(userNormScore));
        const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        const pointers = (user.summaryPointers && user.summaryPointers.length > 0)
          ? user.summaryPointers
          : buildEvaluationSummaryPointers(user);

        // Render task statuses inline
        let taskStatusesHtml = '';
        if (user.taskStatuses && user.taskStatuses.length > 0) {
          taskStatusesHtml = user.taskStatuses.map((st) => {
            const lower = st.toLowerCase();
            const isDone = ['closed', 'completed', 'done'].includes(lower);
            const isQa = lower.includes('qa');
            const color = isDone ? '#15803d' : isQa ? '#2563eb' : '#b45309';
            const bg = isDone ? '#f0fdf4' : isQa ? '#eff6ff' : '#fffbeb';
            const border = isDone ? '#bbf7d0' : isQa ? '#bfdbfe' : '#fde68a';
            return `<span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: ${color}; background-color: ${bg}; border: 1px solid ${border}; padding: 1px 5px; border-radius: 4px; margin: 1px 2px; white-space: nowrap;">${escapeHtml(st)}</span>`;
          }).join(' ');
        } else {
          const parts: string[] = [];
          if (user.doneTasks > 0) {
            parts.push(`<span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: #15803d; background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 1px 5px; border-radius: 4px; margin: 1px 2px; white-space: nowrap;">${user.doneTasks} Done</span>`);
          }
          if (user.qaTasks > 0) {
            parts.push(`<span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: #2563eb; background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 1px 5px; border-radius: 4px; margin: 1px 2px; white-space: nowrap;">${user.qaTasks} QA</span>`);
          }
          const pending = user.totalTasks - user.doneTasks - user.qaTasks;
          if (pending > 0) {
            parts.push(`<span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: #b45309; background-color: #fffbeb; border: 1px solid #fde68a; padding: 1px 5px; border-radius: 4px; margin: 1px 2px; white-space: nowrap;">${pending} In Progress</span>`);
          }
          taskStatusesHtml = parts.join(' ') || `<span style="display: inline-block; font-size: 9.5px; font-weight: 700; color: #64748b; background-color: #f1f5f9; border: 1px solid #e2e8f0; padding: 1px 5px; border-radius: 4px;">Assigned</span>`;
        }

        const displayName = user.userName && user.userName.trim().length > 0
          ? user.userName
          : user.userEmail.split('@')[0];

        return `
          <tr style="background-color: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
            <!-- Column 1: User Info (Name, Email, Task count with status, Logged hours) -->
            <td width="36%" style="width: 36%; padding: 10px 12px; vertical-align: top; line-height: 1.4;">
              <div style="font-size: 12.5px; font-weight: 800; color: #0f172a; margin-bottom: 2px;">
                ${escapeHtml(displayName)}
              </div>
              <div style="font-size: 11px; color: #64748b; margin-bottom: 6px; word-break: break-all;">
                ${escapeHtml(user.userEmail)}
              </div>
              <div style="margin-bottom: 4px; font-size: 11px; color: #334155;">
                <span style="font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #475569; letter-spacing: 0.03em;">Tasks (${user.totalTasks}):</span>
                <span style="display: inline-block; vertical-align: middle; margin-left: 2px;">${taskStatusesHtml}</span>
              </div>
              <div style="font-size: 11px; color: #334155;">
                <span style="font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #475569; letter-spacing: 0.03em;">Logged:</span>
                <strong style="color: #0284c7; font-weight: 800; font-size: 12px; margin-left: 3px;">${user.totalActualHours.toFixed(1)}h</strong>
              </div>
            </td>

            <!-- Column 2: Overall Score -->
            <td width="14%" align="center" style="width: 14%; padding: 10px 4px; vertical-align: middle; text-align: center; white-space: nowrap;">
              <span style="display: inline-block; font-size: 12.5px; font-weight: 900; color: ${scoreBadge.text}; background-color: ${scoreBadge.bg}; border: 1px solid ${scoreBadge.border}; padding: 3px 8px; border-radius: 6px;">
                ${userNormScore}/10
              </span>
            </td>

            <!-- Column 3: Evaluation Summary -->
            <td width="50%" style="width: 50%; padding: 10px 14px; vertical-align: top; font-size: 11px; color: #334155; line-height: 1.45; word-break: break-word; overflow-wrap: break-word;">
              ${renderEvaluationSummaryHtml(pointers)}
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
  <style>
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    table {
      border-spacing: 0;
    }
    @page {
      size: A4 portrait;
      margin: 8mm 6mm;
    }
    @media print {
      body {
        background-color: #ffffff !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      .digest-body-table {
        padding: 0 !important;
        background-color: #ffffff !important;
      }
      .digest-card {
        max-width: 100% !important;
        width: 100% !important;
        border: 1px solid #cbd5e1 !important;
        box-shadow: none !important;
      }
      .digest-data-table {
        width: 100% !important;
        table-layout: fixed !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="digest-body-table" style="background-color: #f1f5f9; padding: 18px 8px; width: 100%;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="digest-card" style="max-width: 820px; width: 100%; background-color: #ffffff; border-radius: 14px; border: 1px solid #cbd5e1; overflow: hidden; box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.08); table-layout: fixed;">
          
          <!-- Branded Executive Banner -->
          <tr>
            <td style="background-color: #09090b; padding: 20px 24px; border-bottom: 3px solid #34c4f2;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: #34c4f2; font-weight: 800;">Creole Knowledge Portal</span>
                    <h1 style="margin: 4px 0 0 0; font-size: 20px; font-weight: 900; color: #ffffff; letter-spacing: -0.01em;">Executive Daily Team Zoho Digest</h1>
                    <p style="margin: 4px 0 0 0; font-size: 12.5px; color: #a1a1aa;">Target Date: <strong>${escapeHtml(payload.date)}</strong></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Table Section -->
          <tr>
            <td style="padding: 18px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 12px;">
                <tr>
                  <td>
                    <h3 style="margin: 0; font-size: 13px; font-weight: 800; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">
                      Team Members Performance Summary (${payload.users.length})
                    </h3>
                  </td>
                  <td align="right" style="font-size: 11.5px; color: #64748b;">
                    Full Activity Breakdown
                  </td>
                </tr>
              </table>
              
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="digest-data-table" style="border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; width: 100%; table-layout: fixed;">
                <thead>
                  <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                    <th width="36%" style="width: 36%; padding: 10px 12px; text-align: left; font-size: 10px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em; vertical-align: middle;">User Info</th>
                    <th width="14%" style="width: 14%; padding: 10px 4px; text-align: center; font-size: 10px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.03em; vertical-align: middle; line-height: 1.3;">Overall Score</th>
                    <th width="50%" style="width: 50%; padding: 10px 14px; text-align: left; font-size: 10px; text-transform: uppercase; color: #475569; font-weight: 800; letter-spacing: 0.04em; vertical-align: middle;">Evaluation Summary</th>
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
            <td align="center" style="padding: 0 18px 22px 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="background-color: #34c4f2; border-radius: 8px; box-shadow: 0 4px 12px rgba(52, 196, 242, 0.35);">
                    <a href="${evaluationLink}" style="display: inline-block; color: #09090b; font-size: 12.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; text-decoration: none; padding: 12px 26px;">
                      Open Zoho Evaluation Manager in Admin Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer Information -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 20px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                This consolidated team digest is delivered daily at 8:30 AM IST to authorized Administrators and Managers configured in the Creole Knowledge Portal.
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

Summary Table (User Info | Overall Score | Evaluation Summary):
-----------------------------------------------------------------------------------------------------
${payload.users.map((u) => {
  const norm = u.dailyScore > 10 ? (u.dailyScore / 10).toFixed(1) : u.dailyScore.toFixed(1);
  const statusStr = (u.taskStatuses && u.taskStatuses.length > 0)
    ? u.taskStatuses.join(', ')
    : `${u.doneTasks} Done, ${u.totalTasks - u.doneTasks} In Progress`;
  const pointers = (u.summaryPointers && u.summaryPointers.length > 0)
    ? u.summaryPointers
    : buildEvaluationSummaryPointers(u);
  const pointersText = renderEvaluationSummaryText(pointers);
  const displayName = u.userName && u.userName.trim().length > 0 ? `${u.userName} (${u.userEmail})` : u.userEmail;
  return `• ${displayName} | Tasks (${u.totalTasks}): ${statusStr} | Logged: ${u.totalActualHours.toFixed(1)}h | Score: ${norm}/10
  Summary:
${pointersText}`;
}).join('\n\n')}
-----------------------------------------------------------------------------------------------------

View full details in Admin Portal: ${evaluationLink}
  `.trim();

  return { subject, html, text };
}
