import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.js';
import { BackupError } from './errors.js';
import { logger } from './logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function cleanupLocalBackups(config: Config): Promise<number> {
  const cutoffMs = Date.now() - config.LOCAL_RETENTION_DAYS * DAY_MS;

  try {
    const entries = await fs.readdir(config.BACKUP_DIR, { withFileTypes: true });

    let deleted = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith('mongo-') || !entry.name.endsWith('.gz')) continue;

      const filePath = join(config.BACKUP_DIR, entry.name);
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs < cutoffMs) {
        await fs.rm(filePath, { force: true });
        deleted += 1;
      }
    }

    logger.info('retention', `حُذفت ${deleted} نسخة محلية`);
    return deleted;
  } catch (error) {
    throw new BackupError('retention', `فشل حذف النسخ المحلية القديمة: ${(error as Error).message}`);
  }
}
