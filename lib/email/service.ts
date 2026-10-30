import nodemailer from 'nodemailer';
import {
  DailyEvaluationEmailPayload,
  generateDailyEvaluationEmail,
} from './templates/daily-evaluation-email';

export interface SendDailyEvaluationEmailParams {
  to: string;
  cc?: string[];
  payload: DailyEvaluationEmailPayload;
  dryRun?: boolean;
}

export interface SendDailyEvaluationEmailResult {
  success: boolean;
  recipientCount: number;
  messageId?: string;
  mocked?: boolean;
  transportUsed?: 'smtp' | 'resend' | 'mock';
  error?: string;
}

/**
 * Validates basic email formatting safely without greedy regex backtracking
 */
function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim();
  const atIdx = clean.indexOf('@');
  const dotIdx = clean.lastIndexOf('.');
  return atIdx > 0 && dotIdx > atIdx + 1 && dotIdx < clean.length - 1 && !clean.includes(' ');
}

/**
 * Dispatches a daily Zoho task evaluation email to the employee and CC seniors.
 * Supports:
 * 1. Direct Gmail/Google Workspace SMTP (Requires zero DNS / GoDaddy setup!)
 * 2. Resend REST API (If RESEND_API_KEY is configured)
 * 3. Safe Mock fallback (For testing/dry-runs without credentials)
 */
export async function sendDailyEvaluationEmail(
  params: SendDailyEvaluationEmailParams
): Promise<SendDailyEvaluationEmailResult> {
  const toEmail = (params.to || '').trim().toLowerCase();
  if (!isValidEmail(toEmail)) {
    console.warn('[EmailService] Invalid recipient email address:', params.to);
    return {
      success: false,
      recipientCount: 0,
      error: `Invalid recipient email address: "${params.to}"`,
    };
  }

  // Deduplicate and filter CC senior emails (excluding the recipient itself)
  const ccEmails = (params.cc || [])
    .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter((e) => isValidEmail(e) && e !== toEmail);
  const uniqueCc = Array.from(new Set(ccEmails));
  const totalRecipients = 1 + uniqueCc.length;

  const emailContent = generateDailyEvaluationEmail(params.payload);

  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  const resendApiKey = process.env.RESEND_API_KEY;

  // 1. Dry run mode: gracefully mock delivery
  if (params.dryRun) {
    console.log(
      `[EmailService:Mock] (dryRun mode enabled) Evaluation email generated for ${toEmail} (CC: ${uniqueCc.join(', ') || 'none'}). Subject: "${emailContent.subject}"`
    );
    return {
      success: true,
      recipientCount: totalRecipients,
      mocked: true,
      transportUsed: 'mock',
      messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
  }

  // 2. Direct SMTP (Gmail / Google Workspace - Zero GoDaddy / DNS setup needed!)
  if (smtpUser && smtpPass) {
    try {
      const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
      const smtpPort = Number(process.env.SMTP_PORT) || 465;
      const isSecure = smtpPort === 465;
      const fromAddress =
        process.env.SMTP_FROM ||
        process.env.EMAIL_FROM ||
        `Creole Knowledge Portal <${smtpUser}>`;

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: isSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from: fromAddress,
        to: toEmail,
        cc: uniqueCc.length > 0 ? uniqueCc : undefined,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });

      console.log(
        `[EmailService:SMTP] Successfully dispatched daily evaluation email to ${toEmail} (CC: ${uniqueCc.join(', ') || 'none'}). MessageID: ${info.messageId}`
      );

      return {
        success: true,
        recipientCount: totalRecipients,
        messageId: info.messageId,
        mocked: false,
        transportUsed: 'smtp',
      };
    } catch (smtpErr: unknown) {
      const message = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
      console.error(`[EmailService:SMTP] Exception dispatching email via SMTP to ${toEmail}:`, smtpErr);
      return {
        success: false,
        recipientCount: 0,
        transportUsed: 'smtp',
        error: `SMTP error: ${message}`,
      };
    }
  }

  // 3. Resend REST API
  if (resendApiKey) {
    const fromAddress =
      process.env.RESEND_FROM_EMAIL ||
      process.env.EMAIL_FROM ||
      'Creole Knowledge Portal <onboarding@resend.dev>';

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [toEmail],
          cc: uniqueCc.length > 0 ? uniqueCc : undefined,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error(
          `[EmailService:Resend] Resend API error (${res.status}) sending to ${toEmail}:`,
          errorText
        );
        return {
          success: false,
          recipientCount: 0,
          transportUsed: 'resend',
          error: `Resend API error (${res.status}): ${errorText}`,
        };
      }

      const data = (await res.json()) as { id?: string };
      console.log(
        `[EmailService:Resend] Successfully sent daily evaluation email to ${toEmail} + ${uniqueCc.length} seniors. Resend ID: ${data.id}`
      );
      return {
        success: true,
        recipientCount: totalRecipients,
        messageId: data.id,
        mocked: false,
        transportUsed: 'resend',
      };
    } catch (resendErr: unknown) {
      const message = resendErr instanceof Error ? resendErr.message : String(resendErr);
      console.error(`[EmailService:Resend] Exception dispatching email to ${toEmail}:`, resendErr);
      return {
        success: false,
        recipientCount: 0,
        transportUsed: 'resend',
        error: message,
      };
    }
  }

  // 4. Fallback: Neither SMTP nor Resend configured
  console.log(
    `[EmailService:Mock] (Neither SMTP nor RESEND_API_KEY configured) Evaluation email generated for ${toEmail} (CC: ${uniqueCc.join(', ') || 'none'}). Subject: "${emailContent.subject}"`
  );
  return {
    success: true,
    recipientCount: totalRecipients,
    mocked: true,
    transportUsed: 'mock',
    messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
}
