import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import { BackupError } from './errors.js';
import { describeExecError, runCommand } from './exec.js';
import { logger } from './logger.js';
import type { BackupResult } from './types.js';

function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  return `${year}-${month}-${day}_${hours}-${minutes}`;
}

export async function runDump(config: Config): Promise<BackupResult> {
  const fileName = `mongo-${formatTimestamp(new Date())}.gz`;
  const filePath = join(config.BACKUP_DIR, fileName);

  logger.info('dump', 'Starting mongodump for database 49');
  const startedAt = Date.now();

  try {
    await runCommand(
      'mongodump',
      [`--uri=${config.MONGO_URI}`, `--archive=${filePath}`, '--gzip'],
      { timeoutMs: config.DUMP_TIMEOUT_MS },
    );
  } catch (error) {
    throw new BackupError('dump', `mongodump failed: ${describeExecError(error)}`);
  }

  const durationMs = Date.now() - startedAt;

  let fileSizeBytes: number;
  try {
    fileSizeBytes = (await stat(filePath)).size;
  } catch {
    throw new BackupError('dump', `Backup file was not created: ${filePath}`);
  }

  const fileSizeMb = fileSizeBytes / (1024 * 1024);
  if (fileSizeMb < config.MIN_BACKUP_SIZE_MB) {
    throw new BackupError(
      'dump',
      `Backup size (${fileSizeMb.toFixed(2)} MB) is below the allowed minimum (${config.MIN_BACKUP_SIZE_MB} MB)`,
    );
  }

  logger.info('dump', `Completed — ${fileSizeMb.toFixed(1)} MB in ${(durationMs / 1000).toFixed(1)}s`);

  return { filePath, fileName, fileSizeBytes, durationMs };
}
