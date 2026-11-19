import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: (...args: any[]) => mockSendMail(...args),
    })),
  },
}));

import {
  generateDailyDigestEmail,
  buildEvaluationSummaryPointers,
  DailyDigestEmailPayload,
} from '@/lib/email/templates/daily-digest-email';
import { sendDailyDigestEmail } from '@/lib/email/service';

describe('Daily Digest Email Generator', () => {
  const samplePayload: DailyDigestEmailPayload = {
    date: '2026-11-02',
    teamAvgScore: 8.4,
    totalUsersEvaluated: 2,
    totalTasks: 4,
    totalDoneTasks: 3,
    totalDelayedTasks: 1,
    totalPlannedHours: 16.0,
    totalActualHours: 15.5,
    users: [
      {
        userName: 'Alice Engineer',
        userEmail: 'alice@creolestudios.com',
        seniorityLevel: 'Senior',
        totalTasks: 2,
        doneTasks: 2,
        delayedTasks: 0,
        qaTasks: 1,
        totalPlannedHours: 8.0,
        totalActualHours: 7.8,
        dailyScore: 9.2,
        reason: 'Delivered all 2 tasks with strong code quality and timely updates.',
        importantNotes: ['Maintained perfect time adherence'],
      },
      {
        userName: 'Bob Developer',
        userEmail: 'bob@creolestudios.com',
        seniorityLevel: 'Mid',
        totalTasks: 2,
        doneTasks: 1,
        delayedTasks: 1,
        qaTasks: 0,
        totalPlannedHours: 8.0,
        totalActualHours: 7.7,
        dailyScore: 7.6,
        reason: 'Good progress but one task exceeded buffer without escalation comment.',
        importantNotes: ['Flag overtime dependencies early'],
      },
    ],
  };

  it('generates subject, HTML table, and plain text with consolidated team metrics', () => {
    const result = generateDailyDigestEmail(samplePayload);

    expect(result.subject).toBe('[Daily Zoho Digest] Team Performance Report - 2026-11-02');
    expect(result.html).toContain('Executive Daily Team Zoho Digest');
    expect(result.html).toContain('Target Date:');
    expect(result.html).not.toContain('Consolidated 10:00 PM IST Analysis for Administrators & Managers');
    expect(result.html).not.toContain('Team Avg Score');
    expect(result.html).not.toContain('Due / Delayed');
    expect(result.html).not.toContain('Hours Logged');
    expect(result.html).toContain('alice@creolestudios.com');
    expect(result.html).toContain('bob@creolestudios.com');
    expect(result.html).toContain('User Info');
    expect(result.html).toContain('Tasks (');
    expect(result.html).toContain('Logged:');
    expect(result.html).toContain('Overall Score');
    expect(result.html).toContain('Evaluation Summary');
    expect(result.html).not.toContain('Excellent');
    expect(result.html).toContain('9.2/10');
    expect(result.html).toContain('7.6/10');
    expect(result.html).toContain('Maintained perfect time adherence');
    expect(result.html).toContain('/admin/dashboard?tab=zoho');

    expect(result.text).toContain('alice@creolestudios.com');
    expect(result.text).toContain('bob@creolestudios.com');
    expect(result.text).not.toContain('Team Average Score:');
  });

  it('renders fallback table row when users list is empty', () => {
    const emptyPayload: DailyDigestEmailPayload = {
      ...samplePayload,
      users: [],
      totalUsersEvaluated: 0,
      totalTasks: 0,
      totalDoneTasks: 0,
      totalDelayedTasks: 0,
      totalActualHours: 0,
      totalPlannedHours: 0,
    };
    const result = generateDailyDigestEmail(emptyPayload);

    expect(result.html).toContain('No employee activity recorded or evaluated');
  });

  it('formats evaluation summary as deduction-focused pointers in HTML and plain text without Done, Pending, or Action', () => {
    const result = generateDailyDigestEmail(samplePayload);

    // Verify HTML renders deduction reasons and NOT Done/Pending/Action
    expect(result.html).toContain('Why this score (9.2/10):');
    expect(result.html).toContain('Why this score (7.6/10):');
    expect(result.html).not.toContain('<strong>Done:</strong>');
    expect(result.html).not.toContain('<strong>Pending:</strong>');
    expect(result.html).not.toContain('<strong>Action:</strong>');

    // Verify Plain text renders
    expect(result.text).toContain('Why this score (9.2/10):');
    expect(result.text).toContain('Why this score (7.6/10):');
    expect(result.text).not.toContain('• Done:');
    expect(result.text).not.toContain('• Pending:');
    expect(result.text).not.toContain('• Action:');
  });

  it('respects custom summaryPointers passed on DailyDigestUserRow', () => {
    const customPayload: DailyDigestEmailPayload = {
      ...samplePayload,
      users: [
        {
          userName: 'Charlie Tech',
          userEmail: 'charlie@creolestudios.com',
          totalTasks: 2,
          doneTasks: 0,
          delayedTasks: 0,
          qaTasks: 2,
          totalPlannedHours: 8.0,
          totalActualHours: 8.1,
          dailyScore: 9.9,
          reason: 'Custom reason',
          summaryPointers: [
            'Done: 2 tasks submitted to QA Review (8.1h logged).',
            'Pending: Awaiting QA verification before closing tickets.',
            'Why this score (9.9/10): Detailed comments and strict time adherence.',
            'Action: Follow up with QA to complete review.',
          ],
        },
      ],
    };

    const result = generateDailyDigestEmail(customPayload);
    expect(result.html).toContain('<strong>Done:</strong> 2 tasks submitted to QA Review (8.1h logged).');
    expect(result.html).toContain('<strong>Pending:</strong> Awaiting QA verification before closing tickets.');
    expect(result.html).toContain('<strong>Why this score (9.9/10):</strong> Detailed comments and strict time adherence.');
    expect(result.html).toContain('<strong>Action:</strong> Follow up with QA to complete review.');

    expect(result.text).toContain('• Done: 2 tasks submitted to QA Review (8.1h logged).');
    expect(result.text).toContain('• Pending: Awaiting QA verification before closing tickets.');
  });

  it('buildEvaluationSummaryPointers generates clear deduction-focused reasons without Done, Pending, or Action', () => {
    // Overdue/delayed case
    const delayedPointers = buildEvaluationSummaryPointers({
      userName: 'Delayed Dev',
      userEmail: 'dev@creolestudios.com',
      totalTasks: 2,
      doneTasks: 0,
      delayedTasks: 1,
      qaTasks: 0,
      totalPlannedHours: 8.0,
      totalActualHours: 9.5,
      dailyScore: 5.5,
      reason: 'Daily evaluation completed.', // generic
    });

    expect(delayedPointers.length).toBeGreaterThanOrEqual(2);
    expect(delayedPointers[0]).toBe('Why this score (5.5/10):');
    expect(delayedPointers[1]).toBe('1 task(s) took more time than planned.');
    expect(delayedPointers.some((p) => p.startsWith('Done:'))).toBe(false);
    expect(delayedPointers.some((p) => p.startsWith('Pending:'))).toBe(false);
    expect(delayedPointers.some((p) => p.startsWith('Action:'))).toBe(false);

    // Missing timelog case
    const zeroHoursPointers = buildEvaluationSummaryPointers({
      userName: 'Zero Hours',
      userEmail: 'zero@creolestudios.com',
      totalTasks: 2,
      doneTasks: 0,
      delayedTasks: 0,
      qaTasks: 0,
      totalPlannedHours: 8.0,
      totalActualHours: 0,
      dailyScore: 2.0,
      reason: 'No hours recorded.',
    });

    expect(zeroHoursPointers[0]).toBe('Why this score (2.0/10):');
    expect(zeroHoursPointers[1]).toBe('No hours logged in Zoho Projects for assigned tasks.');
    expect(zeroHoursPointers.some((p) => p.startsWith('Done:'))).toBe(false);
    expect(zeroHoursPointers.some((p) => p.startsWith('Pending:'))).toBe(false);
    expect(zeroHoursPointers.some((p) => p.startsWith('Action:'))).toBe(false);

    // Missing progress comments deduction case (all deduction points listed under Why this score)
    const missingCommentsPointers = buildEvaluationSummaryPointers({
      userName: 'Bharat Raj',
      userEmail: 'bharat.raj@creolestudios.com',
      totalTasks: 2,
      doneTasks: 0,
      delayedTasks: 0,
      qaTasks: 0,
      totalPlannedHours: 8.0,
      totalActualHours: 7.9,
      dailyScore: 4.3,
      reason: 'Completed 0/2 task(s) on 2026-11-19. Logged 7.9h vs 8h planned.',
      importantNotes: [
        'Log Progress Comments (-10.0 pts): Always log progress comments in Zoho Projects describing the implementation steps and test status.',
      ],
    });

    expect(missingCommentsPointers.length).toBe(3);
    expect(missingCommentsPointers[0]).toBe('Why this score (4.3/10):');
    expect(missingCommentsPointers[1]).toBe('No progress comments added explaining what was done and tested.');
    expect(missingCommentsPointers[2]).toBe('Tasks were left in In Progress without moving to In QA Review.');
    expect(missingCommentsPointers[1]).not.toContain(' or ');
    expect(missingCommentsPointers.some((p) => p.startsWith('Done:'))).toBe(false);
    expect(missingCommentsPointers.some((p) => p.startsWith('Pending:'))).toBe(false);
    expect(missingCommentsPointers.some((p) => p.startsWith('Action:'))).toBe(false);
  });
});

describe('sendDailyDigestEmail Service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const samplePayload: DailyDigestEmailPayload = {
    date: '2026-11-02',
    teamAvgScore: 8.5,
    totalUsersEvaluated: 1,
    totalTasks: 2,
    totalDoneTasks: 2,
    totalDelayedTasks: 0,
    totalPlannedHours: 8.0,
    totalActualHours: 8.0,
    users: [
      {
        userName: 'John Doe',
        userEmail: 'john@creolestudios.com',
        seniorityLevel: 'Senior',
        totalTasks: 2,
        doneTasks: 2,
        delayedTasks: 0,
        qaTasks: 1,
        totalPlannedHours: 8.0,
        totalActualHours: 8.0,
        dailyScore: 8.5,
        reason: 'Consistent delivery',
      },
    ],
  };

  it('fails gracefully when to list is empty or contains only invalid emails', async () => {
    const res = await sendDailyDigestEmail({
      to: ['invalid-email', ''],
      payload: samplePayload,
    });

    expect(res.success).toBe(false);
    expect(res.recipientCount).toBe(0);
    expect(res.error).toContain('No valid recipient email addresses');
  });

  it('mocks delivery successfully when neither SMTP nor Resend configured', async () => {
    const res = await sendDailyDigestEmail({
      to: ['admin@creolestudios.com', 'cto@creolestudios.com'],
      payload: samplePayload,
    });

    expect(res.success).toBe(true);
    expect(res.recipientCount).toBe(2);
    expect(res.mocked).toBe(true);
    expect(res.transportUsed).toBe('mock');
  });

  it('mocks delivery when dryRun is set to true', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    const res = await sendDailyDigestEmail({
      to: ['admin@creolestudios.com'],
      payload: samplePayload,
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.mocked).toBe(true);
    expect(res.transportUsed).toBe('mock');
  });

  it('dispatches to Resend API when RESEND_API_KEY is configured', async () => {
    process.env.RESEND_API_KEY = 're_live_key_999';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'resend_digest_msg_123' }),
    });
    global.fetch = mockFetch;

    const res = await sendDailyDigestEmail({
      to: ['cto@creolestudios.com'],
      payload: samplePayload,
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toBe('resend_digest_msg_123');
    expect(res.transportUsed).toBe('resend');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('dispatches via SMTP when SMTP credentials are provided', async () => {
    process.env.SMTP_USER = 'smtp-admin@creolestudios.com';
    process.env.SMTP_PASS = 'mock-smtp-password';

    mockSendMail.mockResolvedValue({ messageId: 'smtp_digest_777' });

    const res = await sendDailyDigestEmail({
      to: ['director@creolestudios.com', 'pm@creolestudios.com'],
      payload: samplePayload,
    });

    expect(res.success).toBe(true);
    expect(res.transportUsed).toBe('smtp');
    expect(res.messageId).toBe('smtp_digest_777');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['director@creolestudios.com', 'pm@creolestudios.com'],
        subject: expect.stringContaining('Team Performance Report'),
      })
    );
  });
});
