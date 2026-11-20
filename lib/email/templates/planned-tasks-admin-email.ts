export interface PlannedTasksAdminUserRow {
  userId?: string;
  userName: string;
  taskCount: number;
}

export interface PlannedTasksAdminEmailPayload {
  date: string;
  totalTasks: number;
  totalUsers: number;
  zeroCountUsers: number;
  users: PlannedTasksAdminUserRow[];
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

/**
 * Formats a YYYY-MM-DD date string into a friendly verbal label (e.g. "Monday, Nov 23, 2026")
 */
function formatVerbalDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Generates an executive, mobile-friendly HTML & plain-text email for the
 * Morning 8:45 AM Planned Tasks Ingestion Summary sent to Administrators & Managers.
 * Strictly 2 columns: User Name and Task Count (no hours, no email addresses).
 */
export function generatePlannedTasksAdminEmail(payload: PlannedTasksAdminEmailPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const verbalDate = formatVerbalDate(payload.date);
  const subject = `[Planned Tasks Ingestion] Morning Summary - ${payload.date} (${payload.totalTasks} Tasks)`;

  // Split users into two balanced groups for the side-by-side 2-table layout
  const half = Math.ceil(payload.users.length / 2);
  const leftUsers = payload.users.slice(0, half);
  const rightUsers = payload.users.slice(half);

  function renderTableRows(users: PlannedTasksAdminUserRow[]): string {
    return users.map((u, idx) => {
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      const isZero = u.taskCount === 0;

      const countBadge = isZero
        ? `<span style="display: inline-block; font-size: 12.5px; font-weight: 800; color: #b91c1c; background-color: #fef2f2; border: 1px solid #fecaca; padding: 2.5px 10px; border-radius: 6px; white-space: nowrap;">0</span>`
        : `<span style="display: inline-block; font-size: 12.5px; font-weight: 800; color: #0f766e; background-color: #f0fdfa; border: 1px solid #99f6e4; padding: 2.5px 10px; border-radius: 6px; white-space: nowrap;">${u.taskCount}</span>`;

      return `
        <tr style="background-color: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 12px; vertical-align: middle; text-align: left; font-size: 12.5px; font-weight: 700; color: #0f172a;">
            ${escapeHtml(u.userName)}
          </td>
          <td style="padding: 10px 12px; vertical-align: middle; text-align: center; width: 85px;">
            ${countBadge}
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderSubmissionsTable(users: PlannedTasksAdminUserRow[]): string {
    if (users.length === 0) return '';
    return `
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
            <th align="left" style="padding: 9px 12px; font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; letter-spacing: 0.05em;">
              User Name
            </th>
            <th align="center" style="padding: 9px 12px; font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569; letter-spacing: 0.05em; width: 85px;">
              Task Count
            </th>
          </tr>
        </thead>
        <tbody>
          ${renderTableRows(users)}
        </tbody>
      </table>
    `;
  }

  // Dual-table container or single empty message
  const dualTableHtml = payload.users.length === 0
    ? `<div style="padding: 24px; text-align: center; color: #71717a; font-style: italic; font-size: 13px;">No developer tasks recorded for ${escapeHtml(verbalDate)}.</div>`
    : rightUsers.length === 0
      ? renderSubmissionsTable(leftUsers)
      : `
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td width="48.5%" valign="top">
              ${renderSubmissionsTable(leftUsers)}
            </td>
            <td width="3%">&nbsp;</td>
            <td width="48.5%" valign="top">
              ${renderSubmissionsTable(rightUsers)}
            </td>
          </tr>
        </table>
      `;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    table { border-spacing: 0; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color: #f1f5f9; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width: 660px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Card Header (Sync info cleanly stated under title, no duplicate badge) -->
          <tr>
            <td style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 22px 24px; color: #ffffff; text-align: left;">
              <div style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #38bdf8; margin-bottom: 4px;">
                Creole Knowledge Portal
              </div>
              <div style="font-size: 18px; font-weight: 900; color: #ffffff; margin-bottom: 4px;">
                Morning Planned Tasks Summary
              </div>
              <div style="font-size: 12px; color: #94a3b8;">
                Automatic 8:45 AM Zoho Projects Ingestion Report
              </div>
            </td>
          </tr>

          <!-- Metadata Pill Bar (Clean Target Date without duplicate sync text) -->
          <tr>
            <td style="background-color: #f8fafc; padding: 11px 24px; border-bottom: 1px solid #e2e8f0; font-size: 12.5px; color: #475569; font-weight: 700;">
              📅 Target Date: <span style="color: #0284c7;">${escapeHtml(verbalDate)}</span>
            </td>
          </tr>

          <!-- 2-Table Submissions Grid (Divided into Left & Right Tables for better UI) -->
          <tr>
            <td style="padding: 18px 22px 24px 22px;">
              ${dualTableHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8;">
              This automated report was generated by the Creole Knowledge Portal at 08:45 AM IST following the morning task ingestion cron.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  // Plain-text alternative
  const plainRows = payload.users.length === 0
    ? 'No developer tasks recorded.'
    : payload.users.map(u => `${u.userName.padEnd(30)} : ${u.taskCount}`).join('\n');

  const text = `
CREOLE KNOWLEDGE PORTAL
Morning Planned Tasks Summary - 8:45 AM IST
Date: ${verbalDate}

DEVELOPER SUBMISSIONS:
${'User Name'.padEnd(30)} : Task Count
--------------------------------------------------
${plainRows}
  `.trim();

  return { subject, html, text };
}
