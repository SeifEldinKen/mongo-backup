import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { BackupError } from './errors.js';

loadDotenv();

const requiredString = (name: string) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z.string({ error: () => `${name} is required and was not set` }),
  );

const requiredEmail = (name: string) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v),
    z
      .string({ error: () => `${name} is required and was not set` })
      .email(`${name} must be a valid email address`),
  );

const boolFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw.trim() === '') return defaultValue;
      const normalized = raw.trim().toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) return true;
      if (['false', '0', 'no'].includes(normalized)) return false;
      return defaultValue;
    });

const envSchema = z.object({
  MONGO_URI: requiredString('MONGO_URI').pipe(
    z
      .string()
      .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
        message: 'MONGO_URI must start with mongodb:// or mongodb+srv://',
      }),
  ),
  RCLONE_CONFIG: requiredString('RCLONE_CONFIG'),
  REMOTE: requiredString('REMOTE'),
  BACKUP_DIR: requiredString('BACKUP_DIR'),

  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  LOCAL_RETENTION_DAYS: z.coerce.number().int().positive().default(3),
  LINK_EXPIRE: z.string().min(1).default('24h'),

  DUMP_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  UPLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  MIN_BACKUP_SIZE_MB: z.coerce.number().positive().default(1),
  MIN_FREE_DISK_MB: z.coerce.number().positive().default(500),

  BREVO_API_KEY: requiredString('BREVO_API_KEY'),
  MAIL_FROM: requiredEmail('MAIL_FROM'),
  MAIL_FROM_NAME: z.string().min(1).default('Backup Bot'),

  HEALTHCHECK_URL: z.string().optional().default(''),
  NOTIFY_ON_SUCCESS: boolFromEnv(true),
  TZ_DISPLAY: z.string().min(1).default('Africa/Cairo'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const varName = first?.path[0] ?? 'unknown';
    throw new BackupError('preflight', `[${String(varName)}] ${first?.message ?? 'Invalid configuration value'}`, 2);
  }
  return parsed.data;
}
