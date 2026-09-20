import { execFile } from 'node:child_process';
import { errorMessage, redact } from './logger.js';

export interface ExecOptions {
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

export interface ExecOutput {
  stdout: string;
  stderr: string;
}

export class ExecError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;

  constructor(message: string, stdout: string, stderr: string, timedOut: boolean) {
    super(message);
    this.name = 'ExecError';
    this.stdout = stdout;
    this.stderr = stderr;
    this.timedOut = timedOut;
  }
}

const MAX_BUFFER_BYTES = 50 * 1024 * 1024;

export async function runCommand(
  command: string,
  args: string[],
  options: ExecOptions,
): Promise<ExecOutput> {
  return new Promise<ExecOutput>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        env: options.env ?? process.env,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed === true && error.signal !== null && error.signal !== undefined;
          reject(
            new ExecError(
              timedOut
                ? `${command} timed out (${options.timeoutMs}ms)`
                : `${command} failed: ${error.message}`,
              stdout,
              stderr,
              timedOut,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/** رسالة خطأ آمنة (بعد redact) تجمع stderr/stdout عند توفرهما، لعرضها في اللوج أو الإيميل. */
export function describeExecError(error: unknown): string {
  if (error instanceof ExecError) {
    return redact([error.message, error.stderr, error.stdout].filter(Boolean).join('\n'));
  }
  return errorMessage(error);
}

/** ينفّذ fn، وعند الفشل يعيد المحاولة بعد كل تأخير في retryDelaysMs بالترتيب. */
export async function withRetry<T>(fn: () => Promise<T>, retryDelaysMs: number[]): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const delay = retryDelaysMs[attempt];
      if (delay === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
