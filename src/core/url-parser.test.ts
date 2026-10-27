import { describe, expect, it } from 'vitest';
import { classifyGitHubUrl, toRepoTarget } from './url-parser';

describe('classifyGitHubUrl', () => {
  it('classifies repository, branch, subpath, and blob URLs', () => {
    const cases = [
      ['https://github.com/owner/repo', 'repo_root'],
      ['https://github.com/owner/repo/tree/dev', 'branch_root'],
      ['https://github.com/owner/repo/tree/dev/src/core', 'subpath'],
      ['https://github.com/owner/repo/blob/dev/src/core/index.ts', 'blob'],
    ] as const;

    for (const [url, expected] of cases) {
      const result = classifyGitHubUrl(url);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe(expected);
    }
  });

  it('keeps repo-root subpath compatible with the legacy contract', () => {
    const result = classifyGitHubUrl('owner/repo');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ref).toBe('');
    expect(result.value.subpath).toBe('/');
    expect(toRepoTarget(result.value).type).toBeUndefined();
  });

  it('supports underscores, hyphens, nested paths, and decoded names', () => {
    const result = classifyGitHubUrl(
      'https://github.com/my_org/my-repo/tree/feature/my_branch/src/a-b/c_d',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ref).toBe('feature/my_branch');
    expect(result.value.subpath).toBe('/src/a-b/c_d');
  });

  it('decodes percent-encoded path segments', () => {
    const result = classifyGitHubUrl(
      'https://github.com/owner/repo/tree/main/src/%E4%B8%AD%E6%96%87',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.subpath).toBe('/src/中文');
  });

  it('rejects missing refs and path traversal', () => {
    expect(classifyGitHubUrl('https://github.com/owner/repo/tree').ok).toBe(false);
    expect(classifyGitHubUrl('https://github.com/owner/repo/tree/main/..').ok).toBe(false);
    expect(classifyGitHubUrl('https://github.com/owner/repo/tree/main/src/%2E%2E').ok).toBe(false);
  });

  it('preserves parser rejection messages', () => {
    const result = classifyGitHubUrl('https://gitlab.com/owner/repo', 'en');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('Link is not from a GitHub domain');
  });
});
