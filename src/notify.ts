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
    throw new Error(`recipients.ts يحتوي عناوين غير صالحة: ${invalid.join(', ')}`);
  }
  if (recipients.length === 0) {
    throw new Error('recipients.ts فارغ — أضف بريداً واحداً على الأقل');
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

/** يبني جسم إيميل RTL موحّد الشكل من عنوان وقائمة صفوف (label, value) وفقرة ختامية اختيارية. */
function emailBody(title: string, rows: [string, string][], footerHtml = ''): string {
  const rowsHtml = rows.map(([label, value]) => `<li><strong>${label}:</strong> ${value}</li>`).join('\n');
  return `
    <div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; line-height: 1.8;">
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
    logger.info('notify', 'تخطي إشعار النجاح (NOTIFY_ON_SUCCESS=false)');
    return;
  }

  const dateLabel = formatDisplayTime(config, new Date());
  const html = emailBody(
    '✅ تمت النسخة الاحتياطية بنجاح',
    [
      ['اسم الملف', escapeHtml(data.fileName)],
      ['الحجم', formatBytes(data.fileSizeBytes)],
      ['مدة التنفيذ', `${(data.durationMs / 1000).toFixed(1)} ثانية`],
      ['السيرفر', escapeHtml(hostname())],
      [`الوقت (${escapeHtml(config.TZ_DISPLAY)})`, dateLabel],
    ],
    `
    <p>
      <a href="${data.downloadLink}" style="display:inline-block;padding:10px 20px;background:#2e7d32;color:#fff;text-decoration:none;border-radius:6px;">
        تحميل النسخة
      </a>
    </p>
    <p style="color:#b71c1c;">
      <strong>تنبيه:</strong> هذا الرابط يتيح تحميل قاعدة البيانات كاملة وصالح لمدة 24 ساعة. لا تُعد توجيهه.
    </p>
    `,
  );

  try {
    const to = validRecipients();
    await sendEmail(config, to, `✅ نسخة احتياطية — 49 — ${dateLabel}`, html);
    logger.info('notify', `أُرسل الإشعار إلى ${to.map(redactEmail).join(', ')}`);
  } catch (error) {
    logger.warn('notify', `فشل إرسال إيميل النجاح: ${errorMessage(error)}`);
  }
}

export interface FailureNotification {
  stage: string;
  message: string;
}

export async function notifyFailure(config: Config, data: FailureNotification): Promise<void> {
  const server = hostname();
  const dateLabel = formatDisplayTime(config, new Date());
  const html = emailBody('❌ فشل النسخ الاحتياطي', [
    ['المرحلة', escapeHtml(data.stage)],
    ['رسالة الخطأ', escapeHtml(redact(data.message))],
    ['السيرفر', escapeHtml(server)],
    [`الوقت (${escapeHtml(config.TZ_DISPLAY)})`, dateLabel],
  ], '<p>لمراجعة اللوج الكامل نفّذ: <code>pm2 logs mongo-backup</code></p>');

  try {
    const to = validRecipients();
    await sendEmail(config, to, `❌ فشل النسخ الاحتياطي — ${server}`, html);
    logger.info('notify', `أُرسل إشعار الفشل إلى ${to.map(redactEmail).join(', ')}`);
  } catch (error) {
    logger.warn('notify', `فشل إرسال إيميل الفشل: ${errorMessage(error)}`);
  }
}
