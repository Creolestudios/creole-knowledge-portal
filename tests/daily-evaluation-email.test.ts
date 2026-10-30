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
    expect(result.html).toContain('High comment quality');
    expect(result.html).toContain('Log time earlier in the afternoon');
    expect(result.html).toContain('/dashboard/zoho-evaluation');

    expect(result.text).toContain('Jane Developer');
    expect(result.text).toContain('Score: 8.8/10');
    expect(result.text).toContain('Implement Resend Email Service');
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
    expect(result.html).toContain('Consistent execution and delivery against assigned tasks.');
    expect(result.html).toContain('Continue logging timely work progress and updates regularly.');
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
