import { describe, it, expect } from 'vitest';
import { extractGitHubRepo } from './parser';

describe('extractGitHubRepo — URL parsing', () => {
  it('rejects empty, null, or whitespace input', () => {
    expect(extractGitHubRepo('').ok).toBe(false);
    expect(extractGitHubRepo(null).ok).toBe(false);
    expect(extractGitHubRepo('   ').ok).toBe(false);
  });

  it('accepts bare owner/repo', () => {
    const r = extractGitHubRepo('facebook/react');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.owner).toBe('facebook');
      expect(r.value.repo).toBe('react');
      expect(r.value.subpath).toBe('/');
    }
  });

  it('strips enclosing markdown symbols', () => {
    const r = extractGitHubRepo(
      '[https://github.com/facebook/react](https://github.com/facebook/react)',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.canonicalUrl).toBe('https://github.com/facebook/react');
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

  it('parses blob path', () => {
    const r = extractGitHubRepo('https://github.com/facebook/react/blob/main/package.json');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe('blob');
      expect(r.value.ref).toBe('main');
      expect(r.value.subpath).toBe('/package.json');
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

  it('strips .git suffix', () => {
    const r = extractGitHubRepo('https://github.com/facebook/react.git');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.repo).toBe('react');
  });
});

describe('extractGitHubRepo — rejection rules', () => {
  it('rejects issues or non-code URLs', () => {
    expect(extractGitHubRepo('https://github.com/facebook/react/issues/1').ok).toBe(false);
    expect(extractGitHubRepo('https://github.com/facebook/react/pulls').ok).toBe(false);
  });

  it('rejects reserved GitHub root routes', () => {
    expect(extractGitHubRepo('https://github.com/settings/profile').ok).toBe(false);
    expect(extractGitHubRepo('https://github.com/marketplace/actions').ok).toBe(false);
  });

  it('rejects paths without sufficient segments or invalid names', () => {
    expect(extractGitHubRepo('https://github.com/onlyowner').ok).toBe(false);
    expect(extractGitHubRepo('https://github.com/invalid user/repo').ok).toBe(false);
    expect(extractGitHubRepo('https://github.com/owner/invalid!repo').ok).toBe(false);
  });

  it('rejects unsupported actions neither tree nor blob', () => {
    expect(extractGitHubRepo('https://github.com/owner/repo/unknownaction/main').ok).toBe(false);
  });

  it('rejects tree URL without branch ref', () => {
    expect(extractGitHubRepo('https://github.com/owner/repo/tree').ok).toBe(false);
  });

  it('rejects non-github host', () => {
    expect(extractGitHubRepo('https://gitlab.com/foo/bar').ok).toBe(false);
  });
});

describe('extractGitHubRepo — i18n error messages', () => {
  it('returns Chinese error by default (zh-CN)', () => {
    const r = extractGitHubRepo('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('输入内容为空');
  });

  it('returns English error when lang=en', () => {
    const r = extractGitHubRepo('', 'en');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('Input is empty');
  });

  it('returns localized non-github-host message', () => {
    const zh = extractGitHubRepo('https://gitlab.com/a/b', 'zh-CN');
    const en = extractGitHubRepo('https://gitlab.com/a/b', 'en');
    expect(zh.ok).toBe(false);
    expect(en.ok).toBe(false);
    if (!zh.ok) expect(zh.error.message).toBe('非 GitHub 域名链接');
    if (!en.ok) expect(en.error.message).toBe('Link is not from a GitHub domain');
  });
});
