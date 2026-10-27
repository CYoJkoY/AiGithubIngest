import { describe, expect, it } from 'vitest';
import type { GitHubTarget } from '../types';
import { normalizeSubpath, withSubpathOverride } from './ingest';

function target(overrides: Partial<GitHubTarget> = {}): GitHubTarget {
  return {
    owner: 'owner',
    repo: 'repo',
    ref: 'main',
    subpath: '/',
    type: 'repo_root',
    canonicalUrl: 'https://github.com/owner/repo',
    ...overrides,
  };
}

describe('normalizeSubpath', () => {
  it('strips surrounding and duplicate slashes', () => {
    expect(normalizeSubpath('/src//core/')).toBe('/src/core');
    expect(normalizeSubpath('src\\core')).toBe('/src/core');
  });

  it('collapses an empty override to the repository root', () => {
    expect(normalizeSubpath('   ')).toBe('/');
    expect(normalizeSubpath('///')).toBe('/');
  });

  it('rejects traversal segments', () => {
    expect(() => normalizeSubpath('../secrets', 'en')).toThrowError(
      'GitHub path contains an unsafe path segment',
    );
    expect(() => normalizeSubpath('src/./core')).toThrowError();
  });
});

describe('withSubpathOverride', () => {
  it('is a no-op without an override', () => {
    const root = target();
    expect(withSubpathOverride(root, undefined, 'en')).toBe(root);
  });

  it('narrows a repository root to the requested directory', () => {
    const result = withSubpathOverride(target(), 'src/core', 'en');
    expect(result.type).toBe('subpath');
    expect(result.subpath).toBe('/src/core');
    expect(result.ref).toBe('main');
  });

  it('replaces the path of an existing subpath target', () => {
    const result = withSubpathOverride(target({ subpath: '/docs', type: 'subpath' }), 'src', 'en');
    expect(result.type).toBe('subpath');
    expect(result.subpath).toBe('/src');
  });

  it('replaces the path of a branch root target', () => {
    const result = withSubpathOverride(target({ type: 'branch_root' }), 'packages', 'en');
    expect(result.subpath).toBe('/packages');
    expect(result.type).toBe('subpath');
  });

  it('keeps a blob target unchanged', () => {
    const blob = target({ subpath: '/src/main.ts', type: 'blob' });
    expect(withSubpathOverride(blob, 'docs', 'en')).toBe(blob);
  });

  it('keeps the original target for a root override', () => {
    const root = target({ type: 'subpath', subpath: '/docs' });
    expect(withSubpathOverride(root, '/', 'en')).toBe(root);
  });

  it('rejects a traversal override before any request', () => {
    expect(() => withSubpathOverride(target(), '../etc', 'en')).toThrowError();
  });
});
