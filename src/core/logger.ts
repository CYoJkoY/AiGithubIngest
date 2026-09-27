type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDebug = true;

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDebug) console.debug('[AiGithubIngest]', ...args);
  },
  info: (...args: unknown[]) => console.info('[AiGithubIngest]', ...args),
  warn: (...args: unknown[]) => console.warn('[AiGithubIngest]', ...args),
  error: (...args: unknown[]) => console.error('[AiGithubIngest]', ...args),
};
