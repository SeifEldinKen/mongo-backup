import type { Config } from './config.js';
import { BackupError } from './errors.js';
import { describeExecError, runCommand, withRetry } from './exec.js';
import { logger } from './logger.js';

function rcloneEnv(config: Config): NodeJS.ProcessEnv {
  return { ...process.env, RCLONE_CONFIG: config.RCLONE_CONFIG };
}

function remoteDir(config: Config): string {
  return config.REMOTE.endsWith('/') ? config.REMOTE : `${config.REMOTE}/`;
}

export async function uploadFile(config: Config, filePath: string): Promise<string> {
  const dir = remoteDir(config);
  logger.info('upload', `رفع إلى ${dir}`);

  try {
    await withRetry(
      () =>
        runCommand('rclone', ['copy', filePath, dir, '--retries', '3', '--low-level-retries', '5'], {
          timeoutMs: config.UPLOAD_TIMEOUT_MS,
          env: rcloneEnv(config),
        }),
      [5000, 15000, 45000],
    );
  } catch (error) {
    throw new BackupError('upload', `فشل رفع الملف عبر rclone: ${describeExecError(error)}`);
  }

  return dir;
}

export async function verifyRemoteFile(config: Config, fileName: string): Promise<void> {
  const dir = remoteDir(config);
  let stdout: string;
  try {
    ({ stdout } = await runCommand('rclone', ['lsf', dir, '--include', fileName], {
      timeoutMs: config.UPLOAD_TIMEOUT_MS,
      env: rcloneEnv(config),
    }));
  } catch (error) {
    throw new BackupError('upload', `فشل التحقق من وجود الملف على الـ remote: ${describeExecError(error)}`);
  }

  const found = stdout
    .split('\n')
    .map((line) => line.trim())
    .includes(fileName);

  if (!found) {
    throw new BackupError('upload', `الملف ${fileName} غير موجود على الـ remote بعد الرفع`);
  }

  logger.info('upload', 'تم التحقق من الملف على الـ remote ✓');
}

export async function generateDownloadLink(config: Config, fileName: string): Promise<string> {
  const dir = remoteDir(config);
  try {
    const { stdout } = await withRetry(
      () =>
        runCommand('rclone', ['link', `${dir}${fileName}`, '--expire', config.LINK_EXPIRE], {
          timeoutMs: 60_000,
          env: rcloneEnv(config),
        }),
      [3000, 3000],
    );
    const link = stdout.trim();
    if (!link) {
      throw new BackupError('link', 'rclone link أعاد رابطاً فارغاً');
    }
    return link;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError('link', `فشل توليد رابط التحميل: ${describeExecError(error)}`);
  }
}

export async function deleteOldRemoteBackups(config: Config): Promise<number> {
  const dir = remoteDir(config);
  const minAge = `${config.RETENTION_DAYS}d`;

  let deletedCount = 0;
  try {
    const { stdout } = await runCommand('rclone', ['lsf', dir, '--min-age', minAge], {
      timeoutMs: config.UPLOAD_TIMEOUT_MS,
      env: rcloneEnv(config),
    });
    deletedCount = stdout.split('\n').map((line) => line.trim()).filter(Boolean).length;

    await runCommand('rclone', ['delete', dir, '--min-age', minAge], {
      timeoutMs: config.UPLOAD_TIMEOUT_MS,
      env: rcloneEnv(config),
    });
  } catch (error) {
    throw new BackupError('retention', `فشل حذف النسخ القديمة من الـ remote: ${describeExecError(error)}`);
  }

  logger.info('retention', `حُذفت ${deletedCount} نسخة قديمة من الـ remote`);
  return deletedCount;
}
