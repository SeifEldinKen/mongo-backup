export const redact = (input: string): string =>
  input.replace(/:\/\/([^:/?#]+):([^@]+)@/g, '://$1:****@');

export const redactEmail = (email: string): string => {
  const [user, domain] = email.split('@');
  if (!user || !domain) return email;
  return `${user.slice(0, 1)}***@${domain}`;
};

/** رسالة خطأ آمنة للعرض في اللوج أو الإيميل، بعد إخفاء أي بيانات حساسة. */
export const errorMessage = (error: unknown): string =>
  redact(error instanceof Error ? error.message : String(error));

type Level = 'INFO' | 'WARN' | 'ERROR';

function write(level: Level, stage: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] [${stage}] ${redact(message)}`;
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (stage: string, message: string): void => write('INFO', stage, message),
  warn: (stage: string, message: string): void => write('WARN', stage, message),
  error: (stage: string, message: string): void => write('ERROR', stage, message),
};
