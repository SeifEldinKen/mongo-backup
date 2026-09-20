import { type Config, loadConfig } from './config.js';
import { cleanupLocalBackups } from './cleanup.js';
import { runDump } from './dump.js';
import { BackupError } from './errors.js';
import { acquireLock, LockHeldError, type LockHandle, registerShutdownHandlers } from './lock.js';
import { errorMessage, logger } from './logger.js';
import { notifyFailure, notifySuccess } from './notify.js';
import { runPreflightChecks } from './preflight.js';
import { deleteOldRemoteBackups, generateDownloadLink, uploadFile, verifyRemoteFile } from './storage.js';

function parseExpiry(expire: string): number | null {
  const match = /^(\d+)([smhdw])$/.exec(expire.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  const unit = match[2] as string;
  return amount * unitMs[unit]!;
}

async function runBackup(config: Config): Promise<{ lock: LockHandle | undefined; exitCode: number }> {
  let lock: LockHandle | undefined;
  const startedAt = Date.now();

  try {
    await runPreflightChecks(config);

    try {
      lock = await acquireLock(config.BACKUP_DIR);
    } catch (error) {
      if (error instanceof LockHeldError) {
        logger.warn('lock', error.message);
        return { lock: undefined, exitCode: 0 };
      }
      throw error;
    }

    registerShutdownHandlers(lock.release);

    const backup = await runDump(config);
    await uploadFile(config, backup.filePath);
    await verifyRemoteFile(config, backup.fileName);
    const downloadLink = await generateDownloadLink(config, backup.fileName);

    const expiryMs = parseExpiry(config.LINK_EXPIRE);
    const expiryLabel = expiryMs ? new Date(Date.now() + expiryMs).toISOString() : config.LINK_EXPIRE;
    logger.info('link', `Link valid until ${expiryLabel}`);

    await deleteOldRemoteBackups(config);
    await cleanupLocalBackups(config);

    await notifySuccess(config, {
      fileName: backup.fileName,
      fileSizeBytes: backup.fileSizeBytes,
      durationMs: backup.durationMs,
      downloadLink,
    });

    const totalDurationMs = Date.now() - startedAt;
    logger.info('done', `Completed in ${(totalDurationMs / 1000).toFixed(1)}s`);

    return { lock, exitCode: 0 };
  } catch (error) {
    const stage = error instanceof BackupError ? error.stage : 'preflight';
    const message = errorMessage(error);
    logger.error(stage, message);

    await notifyFailure(config, { stage, message });

    const exitCode = error instanceof BackupError ? error.exitCode : 1;
    return { lock, exitCode };
  }
}

async function main(): Promise<number> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    logger.error('preflight', errorMessage(error));
    return error instanceof BackupError ? error.exitCode : 2;
  }

  const { lock, exitCode } = await runBackup(config);
  if (lock) {
    await lock.release();
  }
  return exitCode;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    logger.error('done', `Unexpected error: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
