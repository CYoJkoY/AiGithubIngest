export type DomainErrorCode =
  | 'EMPTY_INPUT'
  | 'NOT_GITHUB_URL'
  | 'REPO_NOT_FOUND'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'DOWNLOAD_FAILED'
  | 'EMPTY_ARCHIVE'
  | 'NO_MATCHING_FILES'
  | 'NETWORK_ERROR';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly params?: Record<string, string | number>;

  constructor(code: DomainErrorCode, message: string, params?: Record<string, string | number>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.params = params;
  }

  static from(err: unknown, fallbackCode: DomainErrorCode = 'NETWORK_ERROR'): DomainError {
    if (err instanceof DomainError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new DomainError(fallbackCode, message);
  }
}
