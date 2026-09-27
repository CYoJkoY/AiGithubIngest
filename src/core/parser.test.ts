import { describe, it, expect } from 'vitest';
import { extractGitHubRepo } from './parser';

describe('extractGitHubRepo', () => {
  it('rejects empty input', () => {
    expect(extractGitHubRepo('').ok).toBe(false);
    expect(extractGitHubRepo(null).ok).toBe(false);
  });

  it('accepts bare owner/repo', () => {
    const r = extractGitHubRepo('facebook/react');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.owner).toBe('facebook');
      expect(r.value.repo).toBe('react');
    }
  });

  it('accepts full URL and normalizes canonicalUrl', () => {
    const r = extractGitHubRepo('https://github.com/facebook/react');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.canonicalUrl).toBe('https://github.com/facebook/react');
  });

  it('parses tree path with branch and subpath', () => {
    const r = extractGitHubRepo('https://github.com/facebook/react/tree/main/packages');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe('tree');
      expect(r.value.ref).toBe('main');
      expect(r.value.subpath).toBe('/packages');
    }
  });

  it('parses multi-segment branch prefix', () => {
    const r = extractGitHubRepo('https://github.com/o/r/tree/feature/foo/src');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.ref).toBe('feature/foo');
      expect(r.value.subpath).toBe('/src');
    }
  });

  it('rejects issues URL', () => {
    expect(extractGitHubRepo('https://github.com/facebook/react/issues/1').ok).toBe(false);
  });

  it('rejects non-github host', () => {
    expect(extractGitHubRepo('https://gitlab.com/foo/bar').ok).toBe(false);
  });

  it('strips .git suffix', () => {
    const r = extractGitHubRepo('https://github.com/facebook/react.git');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.repo).toBe('react');
  });
});
