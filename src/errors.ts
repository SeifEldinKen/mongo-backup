import type { Stage } from './types.js';

export class BackupError extends Error {
  readonly stage: Stage;
  readonly exitCode: number;

  constructor(stage: Stage, message: string, exitCode = 1) {
    super(message);
    this.name = 'BackupError';
    this.stage = stage;
    this.exitCode = exitCode;
  }
}
