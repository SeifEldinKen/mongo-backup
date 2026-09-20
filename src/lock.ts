import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

interface LockFileContents {
  pid: number;
  startedAt: string;
}

export interface LockHandle {
  release: () => Promise<void>;
}

export class LockHeldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockHeldError';
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLockFile(lockPath: string): Promise<LockFileContents | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LockFileContents>;
    if (typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string') {
      return { pid: parsed.pid, startedAt: parsed.startedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export async function acquireLock(backupDir: string): Promise<LockHandle> {
  await fs.mkdir(backupDir, { recursive: true });
  const lockPath = join(backupDir, '.lock');

  const existing = await readLockFile(lockPath);
  if (existing && isProcessAlive(existing.pid)) {
    throw new LockHeldError(
      `A run is already in progress (PID ${existing.pid}, started at ${existing.startedAt}) — skipping`,
    );
  }
  if (existing) {
    logger.warn('lock', `Ignoring stale lock (PID ${existing.pid} is not alive)`);
  }

  const contents: LockFileContents = { pid: process.pid, startedAt: new Date().toISOString() };
  await fs.writeFile(lockPath, JSON.stringify(contents), 'utf8');

  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await fs.rm(lockPath, { force: true });
  };

  return { release };
}

export function registerShutdownHandlers(release: () => Promise<void>): void {
  const handleSignal = (signal: NodeJS.Signals) => {
    logger.warn('lock', `Received ${signal} — releasing lock and exiting`);
    void release().finally(() => process.exit(1));
  };
  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
}
