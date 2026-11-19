import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSendMail = vi.fn();
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: (...args: any[]) => mockSendMail(...args),
    })),
  },
}));

import { generateDailyEvaluationEmail } from '@/lib/email/templates/daily-evaluation-email';
import { sendDailyEvaluationEmail } from '@/lib/email/service';

describe('Daily Evaluation Email Generator', () => {
  const samplePayload = {
    userName: 'Jane Developer',
    userEmail: 'jane@creolestudios.com',
    date: '2026-10-30',
    dailyScore: 88, // 8.8 / 10
    totalPlannedHours: 8.0,
    totalActualHours: 8.2,
    taskCount: 2,
    doneTasks: 2,
    delayedTasks: 0,
    qaTasks: 1,
    dailySummary: 'Completed all 2 tasks with solid code quality.',
    strengths: ['High comment quality', 'Strong code execution'],
    improvements: ['Log time earlier in the afternoon'],
    tasks: [
      {
        taskName: 'Implement Resend Email Service',
        projectName: 'Knowledge Portal',
        plannedHours: 4.0,
        actualHours: 4.1,
        status: 'Closed',
        timeAssessmentLabel: 'ON_TIME',
        score: 92,
        workMatchScore: 92,
        feedback: 'Accurate logging and comprehensive details',
      },
      {
        taskName: 'QA Review for Task Modal',
        projectName: 'Knowledge Portal',
        plannedHours: 4.0,
        actualHours: 4.1,
        status: 'Closed',
        timeAssessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
        score: 84,
        feedback: 'Good test scenarios verified',
      },
    ],
  };

  it('generates email subject, HTML, and plain text with correct metrics', () => {
    const result = generateDailyEvaluationEmail(samplePayload);

    expect(result.subject).toBe('[Zoho Daily Evaluation] Jane Developer - 2026-10-30 (Score: 8.8/10)');
    expect(result.html).toContain('Jane Developer');
    expect(result.html).toContain('jane@creolestudios.com');
    expect(result.html).toContain('8.8');
    expect(result.html).toContain('Implement Resend Email Service');
    expect(result.html).toContain('QA Review for Task Modal');
    expect(result.html).not.toContain('Key Accomplishments');
    expect(result.html).toContain('Log time earlier in the afternoon');
    expect(result.html).toContain('/dashboard/zoho-evaluation?view=evaluation');
    expect(result.html).not.toContain('Performance Evaluation Summary');

    expect(result.text).toContain('Jane Developer');
    expect(result.text).toContain('Score: 8.8/10');
    expect(result.text).toContain('Implement Resend Email Service');
    expect(result.text).not.toContain('Key Accomplishments:');
    expect(result.text).not.toContain('Performance Evaluation Summary:');
  });

  it('renders fallback messages when tasks, strengths or improvements are empty', () => {
    const emptyPayload = {
      ...samplePayload,
      tasks: [],
      strengths: [],
      improvements: [],
      dailyScore: 50,
    };
    const result = generateDailyEvaluationEmail(emptyPayload);

    expect(result.html).toContain('No tasks logged or evaluated for this date.');
    expect(result.html).not.toContain('Key Accomplishments');
  });

  it('renders task improvementItems as a structured bulleted list in HTML and plain text capped at 5 items', () => {
    const payloadWithImprovements = {
      ...samplePayload,
      tasks: [
        {
          taskName: 'Website Responsive Testing',
          projectName: 'SOLAR CRM',
          plannedHours: 4.0,
          actualHours: 2.6,
          status: 'In Progress',
          timeAssessmentLabel: 'UNEXPECTED_EARLY',
          score: 28,
          feedback: 'Early completion gap without sufficient test coverage.',
          improvementItems: [
            'Status Not Moved to In QA Review: Move completed task to "In QA Review" with testing notes to keep status up to date.',
            'Time Limit & Adherence: Finish within planned time limit or flag roadblocks early in comments.',
            'Task Complexity & Velocity Calibration: Complete routine tasks faster or add deeper implementation details.',
            'Log Technical Progress Comments: Post a concise comment in Zoho detailing files changed and verification steps.',
            'Calibrate Estimation & Expand Testing: Align planned hours with scope or add automated unit test coverage.',
            'Excess 6th item that should be sliced off',
          ],
        },
      ],
    };

    const result = generateDailyEvaluationEmail(payloadWithImprovements);

    // Verify HTML renders <ul> list with <li> elements
    expect(result.html).toContain('💡 Key Areas for Improvement:');
    expect(result.html).toContain('<ul style="margin: 0; padding-left: 16px; font-size: 11px; color: #7c2d12; line-height: 1.4;">');
    expect(result.html).toContain('<li style="margin-bottom: 3px;">Status Not Moved to In QA Review: Move completed task to &quot;In QA Review&quot; with testing notes to keep status up to date.</li>');
    expect(result.html).toContain('<li style="margin-bottom: 3px;">Time Limit &amp; Adherence: Finish within planned time limit or flag roadblocks early in comments.</li>');
    // Ensure 6th item was sliced off to keep max 5 points
    expect(result.html).not.toContain('Excess 6th item');

    // Verify plain text renders bulleted lines
    expect(result.text).toContain('Improvements:');
    expect(result.text).toContain('    - Status Not Moved to In QA Review: Move completed task to "In QA Review" with testing notes to keep status up to date.');
    expect(result.text).not.toContain('Excess 6th item');
  });

  it('renders metric terms with i icon tooltips in simple English matching evaluation card', () => {
    const result = generateDailyEvaluationEmail(samplePayload);

    expect(result.html).toContain('title="Time planned for task"');
    expect(result.html).toContain('Time planned for task');
    expect(result.html).toContain('Total logged in Zoho');
    expect(result.html).toContain('Score for finishing on time within the allowed buffer.');
    expect(result.html).toContain('Score for how clearly comments explain the work done.');
  });

  it('strips point deduction numbers (-X pts) from email improvements and notes', () => {
    const payloadWithPoints = {
      ...samplePayload,
      improvements: [
        'Add progress comments in Zoho Projects explaining what was done and tested (-5.0 pts work score).',
        'Move tasks to In QA Review before closing the day (-1.0 pt status deduction).',
      ],
      tasks: [
        {
          ...samplePayload.tasks[0],
          improvementItems: [
            'Log Progress Comments (-10.0 pts): Add progress comments in Zoho Projects explaining what was done and tested.',
          ],
        },
      ],
    };
    const result = generateDailyEvaluationEmail(payloadWithPoints);

    expect(result.html).toContain('Add progress comments in Zoho Projects explaining what was done and tested.');
    expect(result.html).toContain('Move tasks to In QA Review before closing the day.');
    expect(result.html).not.toContain('-5.0 pts');
    expect(result.html).not.toContain('-1.0 pt');
    expect(result.html).not.toContain('-10.0 pts');
  });
});

describe('sendDailyEvaluationEmail Service', () => {
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

  const payload = {
    userName: 'John Doe',
    userEmail: 'john@creolestudios.com',
    date: '2026-10-30',
    dailyScore: 85,
    totalPlannedHours: 7.5,
    totalActualHours: 7.5,
    taskCount: 1,
    doneTasks: 1,
    delayedTasks: 0,
    qaTasks: 0,
    dailySummary: 'Great job!',
    strengths: ['Timely delivery'],
    improvements: ['None'],
    tasks: [],
  };

  it('fails gracefully when to email is invalid', async () => {
    const res = await sendDailyEvaluationEmail({
      to: 'invalid-email-address',
      payload,
    });

    expect(res.success).toBe(false);
    expect(res.recipientCount).toBe(0);
    expect(res.error).toContain('Invalid recipient email address');
  });

  it('mocks delivery successfully when RESEND_API_KEY is not configured', async () => {
    const res = await sendDailyEvaluationEmail({
      to: 'john@creolestudios.com',
      cc: ['lead@creolestudios.com', 'pm@creolestudios.com'],
      payload,
    });

    expect(res.success).toBe(true);
    expect(res.mocked).toBe(true);
    expect(res.recipientCount).toBe(3); // 1 to + 2 cc
    expect(res.messageId).toContain('mock-');
  });

  it('mocks delivery when dryRun is set to true even if API key exists', async () => {
    process.env.RESEND_API_KEY = 're_test_key_123';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await sendDailyEvaluationEmail({
      to: 'john@creolestudios.com',
      cc: ['lead@creolestudios.com'],
      payload,
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.mocked).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dispatches to Resend API when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_live_key_999';
    process.env.RESEND_FROM_EMAIL = 'notifications@creolestudios.com';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'email_msg_12345' }),
    } as Response);

    const res = await sendDailyEvaluationEmail({
      to: 'john@creolestudios.com',
      cc: ['lead@creolestudios.com', 'john@creolestudios.com'], // Deduplicates self
      payload,
    });

    expect(res.success).toBe(true);
    expect(res.mocked).toBe(false);
    expect(res.messageId).toBe('email_msg_12345');
    expect(res.recipientCount).toBe(2); // john + 1 unique senior

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_live_key_999',
        }),
      })
    );

    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(callBody.to).toEqual(['john@creolestudios.com']);
    expect(callBody.cc).toEqual(['lead@creolestudios.com']);
    expect(callBody.from).toBe('notifications@creolestudios.com');
  });

  it('handles Resend API error responses without crashing', async () => {
    process.env.RESEND_API_KEY = 're_invalid_key';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden: Invalid API key',
    } as Response);

    const res = await sendDailyEvaluationEmail({
      to: 'john@creolestudios.com',
      payload,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain('Resend API error (403)');
  });

  it('dispatches via Gmail/Google Workspace SMTP when SMTP credentials are provided', async () => {
    process.env.SMTP_USER = 'priya.dhanani@creolestudios.com';
    process.env.SMTP_PASS = 'abcd efgh ijkl mnop';

    mockSendMail.mockResolvedValueOnce({ messageId: 'smtp_msg_777' });

    const res = await sendDailyEvaluationEmail({
      to: 'john@creolestudios.com',
      cc: ['lead@creolestudios.com'],
      payload,
    });

    expect(res.success).toBe(true);
    expect(res.transportUsed).toBe('smtp');
    expect(res.messageId).toBe('smtp_msg_777');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@creolestudios.com',
        cc: ['lead@creolestudios.com'],
        from: 'Creole Knowledge Portal <priya.dhanani@creolestudios.com>',
      })
    );
  });
});
