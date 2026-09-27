export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

function isDebugEnabled(): boolean {
  try {
    const flag = (globalThis as { __AIGI_DEBUG__?: boolean }).__AIGI_DEBUG__;
    return flag !== false;
  } catch {
    return true;
  }
}

export const logger: Logger = {
  debug: (...args) => {
    if (isDebugEnabled()) console.debug('[AiGithubIngest]', ...args);
  },
  info: (...args) => console.info('[AiGithubIngest]', ...args),
  warn: (...args) => console.warn('[AiGithubIngest]', ...args),
  error: (...args) => console.error('[AiGithubIngest]', ...args),
};
