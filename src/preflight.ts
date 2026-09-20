import { promises as fs } from 'node:fs';
import type { Config } from './config.js';
import { BackupError } from './errors.js';
import { runCommand } from './exec.js';
import { logger } from './logger.js';

async function checkToolVersion(command: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await runCommand(command, args, { timeoutMs: 10_000 });
    const firstLine = (stdout || stderr).trim().split('\n')[0] ?? command;
    return firstLine;
  } catch (error) {
    throw new BackupError(
      'preflight',
      `الأداة "${command}" غير متاحة في PATH أو فشل استدعاؤها (${(error as Error).message})`,
      3,
    );
  }
}

async function checkDiskSpace(backupDir: string, minFreeMb: number): Promise<void> {
  await fs.mkdir(backupDir, { recursive: true });
  const stats = await fs.statfs(backupDir);
  const freeMb = (stats.bavail * stats.bsize) / (1024 * 1024);
  if (freeMb < minFreeMb) {
    throw new BackupError(
      'preflight',
      `المساحة المتاحة (${freeMb.toFixed(1)} MB) أقل من الحد الأدنى المطلوب (${minFreeMb} MB) في ${backupDir}`,
      4,
    );
  }
  logger.info('preflight', `المساحة المتاحة: ${(freeMb / 1024).toFixed(1)} GB ✓`);
}

export async function runPreflightChecks(config: Config): Promise<void> {
  const mongodumpVersion = await checkToolVersion('mongodump', ['--version']);
  logger.info('preflight', `${mongodumpVersion} ✓`);

  const rcloneVersion = await checkToolVersion('rclone', ['version']);
  logger.info('preflight', `${rcloneVersion} ✓`);

  await checkDiskSpace(config.BACKUP_DIR, config.MIN_FREE_DISK_MB);
}
