export interface BackupResult {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  durationMs: number;
}

export type Stage =
  | 'preflight'
  | 'lock'
  | 'dump'
  | 'upload'
  | 'link'
  | 'retention'
  | 'notify'
  | 'done';
