import { BrevoClient } from '@getbrevo/brevo';
import { hostname } from 'node:os';
import type { Config } from './config.js';
import { withRetry } from './exec.js';
import { errorMessage, logger, redact, redactEmail } from './logger.js';
import { recipients } from './recipients.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** يتحقق من قائمة recipients.ts قبل الاستخدام — بريد فارغ أو غير صالح يمنع الإرسال بدل تجاهله بصمت. */
function validRecipients(): string[] {
  const invalid = recipients.filter((email) => !EMAIL_PATTERN.test(email));
  if (invalid.length > 0) {
    throw new Error(`recipients.ts contains invalid addresses: ${invalid.join(', ')}`);
  }
  if (recipients.length === 0) {
    throw new Error('recipients.ts is empty — add at least one email address');
  }
  return recipients;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDisplayTime(config: Config, date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: config.TZ_DISPLAY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** يبني جسم إيميل موحّد الشكل من عنوان وقائمة صفوف (label, value) وفقرة ختامية اختيارية. */
function emailBody(title: string, rows: [string, string][], footerHtml = ''): string {
  const rowsHtml = rows.map(([label, value]) => `<li><strong>${label}:</strong> ${value}</li>`).join('\n');
  return `
    <div dir="ltr" style="font-family: Tahoma, Arial, sans-serif; line-height: 1.8;">
      <h2>${title}</h2>
      <ul>${rowsHtml}</ul>
      ${footerHtml}
    </div>
  `;
}

async function sendEmail(
  config: Config,
  recipients: string[],
  subject: string,
  htmlContent: string,
): Promise<void> {
  const client = new BrevoClient({ apiKey: config.BREVO_API_KEY });

  await withRetry(
    () =>
      client.transactionalEmails.sendTransacEmail({
        sender: { name: config.MAIL_FROM_NAME, email: config.MAIL_FROM },
        to: recipients.map((email) => ({ email })),
        subject,
        htmlContent,
      }),
    [5000, 5000],
  );
}

export interface SuccessNotification {
  fileName: string;
  fileSizeBytes: number;
  durationMs: number;
  downloadLink: string;
}

export async function notifySuccess(config: Config, data: SuccessNotification): Promise<void> {
  if (!config.NOTIFY_ON_SUCCESS) {
    logger.info('notify', 'Skipping success notification (NOTIFY_ON_SUCCESS=false)');
    return;
  }

  const dateLabel = formatDisplayTime(config, new Date());
  const html = emailBody(
    '✅ Backup completed successfully',
    [
      ['File name', escapeHtml(data.fileName)],
      ['Size', formatBytes(data.fileSizeBytes)],
      ['Duration', `${(data.durationMs / 1000).toFixed(1)} seconds`],
      ['Server', escapeHtml(hostname())],
      [`Time (${escapeHtml(config.TZ_DISPLAY)})`, dateLabel],
    ],
    `
    <p>
      <a href="${data.downloadLink}" style="display:inline-block;padding:10px 20px;background:#2e7d32;color:#fff;text-decoration:none;border-radius:6px;">
        Download backup
      </a>
    </p>
    <p style="color:#b71c1c;">
      <strong>Warning:</strong> this link allows downloading the entire database and is valid for 24 hours. Do not forward it.
    </p>
    `,
  );

  try {
    const to = validRecipients();
    await sendEmail(config, to, `✅ Backup — 49 — ${dateLabel}`, html);
    logger.info('notify', `Sent notification to ${to.map(redactEmail).join(', ')}`);
  } catch (error) {
    logger.warn('notify', `Failed to send success email: ${errorMessage(error)}`);
  }
}

export interface FailureNotification {
  stage: string;
  message: string;
}

export async function notifyFailure(config: Config, data: FailureNotification): Promise<void> {
  const server = hostname();
  const dateLabel = formatDisplayTime(config, new Date());
  const html = emailBody('❌ Backup failed', [
    ['Stage', escapeHtml(data.stage)],
    ['Error message', escapeHtml(redact(data.message))],
    ['Server', escapeHtml(server)],
    [`Time (${escapeHtml(config.TZ_DISPLAY)})`, dateLabel],
  ], '<p>To review the full log, run: <code>pm2 logs mongo-backup</code></p>');

  try {
    const to = validRecipients();
    await sendEmail(config, to, `❌ Backup failed — ${server}`, html);
    logger.info('notify', `Sent failure notification to ${to.map(redactEmail).join(', ')}`);
  } catch (error) {
    logger.warn('notify', `Failed to send failure email: ${errorMessage(error)}`);
  }
}
