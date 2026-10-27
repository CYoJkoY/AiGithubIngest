import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHubTarget } from '../types';
import { ingestRepository, normalizeSubpath, withSubpathOverride } from './ingest';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ingestRepository forced full budget', () => {
  it('budgets metadata before fetching and reports omitted files', async () => {
    const calls: string[] = [];
    const tree = {
      tree: ['a.ts', 'b.ts', 'c.ts'].map((path) => ({
        path,
        mode: '100644',
        type: 'blob',
        sha: 'x',
        size: 4000,
      })),
      truncated: false,
    };
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/git/trees/')) {
        return Promise.resolve(new Response(JSON.stringify(tree), { status: 200 }));
      }
      return Promise.resolve(new Response('x'.repeat(4000), { status: 200 }));
    });

    const summary = await ingestRepository('https://github.com/o/r/tree/main', {
      forceStrategy: 'full',
      maxTokenBudget: 1100,
      lang: 'en',
    });

    const rawCalls = calls.filter((url) => url.startsWith('https://raw.githubusercontent.com/'));
    expect(rawCalls).toEqual(['https://raw.githubusercontent.com/o/r/main/a.ts']);
    expect(summary.strategy).toBe('full');
    expect(summary.files.map((file) => file.path)).toEqual(['a.ts']);
    expect(summary.omittedFiles).toBe(2);
    expect(summary.truncated).toBe(true);
  });
});
