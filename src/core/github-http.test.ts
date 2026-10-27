import { describe, expect, it } from 'vitest';
import { buildGitHubHeaders, encodeGitRef, mapHttpError, readJson } from './github-http';

function responseWith(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('buildGitHubHeaders', () => {
  it('always sends the API contract headers', () => {
    const headers = buildGitHubHeaders();
    expect(headers.Accept).toBe('application/vnd.github.v3+json');
    expect(headers['User-Agent']).toBe('AiGithubIngest-Extension');
    expect(headers.Authorization).toBeUndefined();
  });

  it('adds a trimmed bearer token only when one is supplied', () => {
    expect(buildGitHubHeaders('  ghp_abc  ').Authorization).toBe('Bearer ghp_abc');
    expect(buildGitHubHeaders('   ').Authorization).toBeUndefined();
  });
});

describe('mapHttpError', () => {
  it('maps authentication and missing-repository statuses', () => {
    expect(mapHttpError(responseWith(401), 'en').code).toBe('AUTH_FAILED');
    expect(mapHttpError(responseWith(404), 'en').code).toBe('REPO_NOT_FOUND');
    expect(mapHttpError(responseWith(500), 'en').code).toBe('DOWNLOAD_FAILED');
  });

  it('detects rate limiting from status and headers', () => {
    expect(mapHttpError(responseWith(429), 'en').code).toBe('RATE_LIMITED');
    expect(mapHttpError(responseWith(403, { 'x-ratelimit-remaining': '0' }), 'en').code).toBe(
      'RATE_LIMITED',
    );
  });

  it('reports the retry window when GitHub provides one', () => {
    const withRetry = mapHttpError(responseWith(429, { 'retry-after': '30' }), 'en');
    expect(withRetry.message).toContain('30s');

    const withReset = mapHttpError(
      responseWith(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }),
      'en',
    );
    expect(withReset.message).toContain('2023-11-14T22:13:20.000Z');
  });

  it('treats a plain 403 as an authentication failure', () => {
    expect(mapHttpError(responseWith(403), 'en').code).toBe('AUTH_FAILED');
  });
});

describe('readJson', () => {
  it('parses valid bodies and converts invalid ones to a domain error', async () => {
    await expect(readJson(new Response('{"ok":true}'), 'en')).resolves.toEqual({ ok: true });
    await expect(readJson(new Response('not json'), 'en')).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
    });
  });
});

describe('encodeGitRef', () => {
  it('encodes segments while preserving slash separators', () => {
    expect(encodeGitRef('feature/my branch')).toBe('feature/my%20branch');
    expect(encodeGitRef('/main/')).toBe('main');
    expect(encodeGitRef('a/b/c#1')).toBe('a/b/c%231');
  });
});
