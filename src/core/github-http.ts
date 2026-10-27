import type { SupportedLang } from '../types';
import { t } from './i18n';
import { DomainError } from './errors';

export interface GitHubRequestOptions {
  readonly token?: string;
  readonly lang?: SupportedLang;
}

export function buildGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'AiGithubIngest-Extension',
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

function describeReset(headers: Headers): string | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) return `${retryAfter}s`;

  const reset = headers.get('x-ratelimit-reset');
  if (!reset) return undefined;
  const epochSeconds = Number(reset);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return undefined;
  return new Date(epochSeconds * 1000).toISOString();
}

function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.headers.get('x-ratelimit-remaining') === '0') return true;
  return response.headers.get('retry-after') !== null;
}

/** Map a GitHub HTTP failure to the public domain error contract. */
export function mapHttpError(response: Response, lang: SupportedLang): DomainError {
  if (response.status === 401) {
    return new DomainError(
      'AUTH_FAILED',
      t('authFailedWithStatus', lang, { status: response.status }),
    );
  }
  if (response.status === 404) {
    return new DomainError('REPO_NOT_FOUND', t('privateRepoNotice', lang));
  }
  if (response.status === 403 || response.status === 429) {
    if (isRateLimited(response)) {
      const reset = describeReset(response.headers);
      const message = reset
        ? t('rateLimitResetAfter', lang, { time: reset })
        : t('rateLimitExceeded', lang, { status: response.status });
      return new DomainError('RATE_LIMITED', message);
    }
    return new DomainError(
      'AUTH_FAILED',
      t('authFailedWithStatus', lang, { status: response.status }),
    );
  }
  return new DomainError(
    'DOWNLOAD_FAILED',
    t('downloadFailedWithStatus', lang, { status: response.status }),
  );
}

/** Fetch a GitHub API resource and translate transport failures. */
export async function requestGitHub(
  url: string,
  options: GitHubRequestOptions = {},
): Promise<Response> {
  const lang = options.lang ?? 'zh-CN';
  let response: Response;
  try {
    response = await fetch(url, { headers: buildGitHubHeaders(options.token) });
  } catch {
    throw new DomainError('NETWORK_ERROR', t('networkRequestFailed', lang));
  }
  if (!response.ok) throw mapHttpError(response, lang);
  return response;
}

/** Read JSON without exposing an untyped API payload to callers. */
export async function readJson(response: Response, lang: SupportedLang): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DomainError('DOWNLOAD_FAILED', t('invalidApiResponse', lang));
  }
}

/** Encode a ref while preserving `/` as a path separator. */
export function encodeGitRef(ref: string): string {
  return ref
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
