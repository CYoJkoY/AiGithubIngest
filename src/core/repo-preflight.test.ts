import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHubTarget } from '../types';
import {
  preflightRepository,
  resolveContentLimitBytes,
  resolveDefaultBranch,
} from './repo-preflight';

function target(overrides: Partial<GitHubTarget> = {}): GitHubTarget {
  return {
    owner: 'o',
    repo: 'r',
    ref: 'main',
    subpath: '/',
    type: 'branch_root',
    canonicalUrl: 'https://github.com/o/r/tree/main',
    ...overrides,
  };
}

function blob(path: string, size = 100): Record<string, unknown> {
  return { path, mode: '100644', type: 'blob', sha: 'x', size };
}

function treeResponse(tree: readonly Record<string, unknown>[], truncated = false): Response {
  return new Response(JSON.stringify({ tree, truncated }), { status: 200 });
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveContentLimitBytes', () => {
  it('uses the global cap unless a stricter per-file limit is set', () => {
    expect(resolveContentLimitBytes()).toBe(60 * 1024);
    expect(resolveContentLimitBytes(10)).toBe(10 * 1024);
    expect(resolveContentLimitBytes(1024)).toBe(60 * 1024);
    expect(resolveContentLimitBytes(0)).toBe(60 * 1024);
    expect(resolveContentLimitBytes(Number.NaN)).toBe(60 * 1024);
  });
});

describe('resolveDefaultBranch', () => {
  it('reads the repository default branch without a fallback guess', async () => {
    stubFetch(() => new Response(JSON.stringify({ default_branch: 'trunk' }), { status: 200 }));
    await expect(resolveDefaultBranch('o', 'r')).resolves.toBe('trunk');
  });

  it('rejects payloads without a usable default branch', async () => {
    stubFetch(() => new Response(JSON.stringify({ default_branch: '  ' }), { status: 200 }));
    await expect(resolveDefaultBranch('o', 'r')).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
    });
  });
});

describe('preflightRepository', () => {
  it('collects metadata, configs, entrypoints, and a token estimate', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      return treeResponse([
        { path: 'src', mode: '040000', type: 'tree', sha: 't' },
        blob('package.json', 20),
        blob('src/index.ts', 18),
        blob('README.md', 500),
      ]);
    });

    const report = await preflightRepository(target());

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/git/trees/main?recursive=1');
    expect(report.totalBlobs).toBe(3);
    expect(report.validFiles.map((file) => file.path)).toEqual([
      'package.json',
      'src/index.ts',
      'README.md',
    ]);
    expect(report.stackConfigs).toEqual(['package.json']);
    expect(report.entrypoints).toEqual(['src/index.ts']);
    expect(report.estimatedTokens).toBe(Math.ceil((20 + 18 + 500) / 3.8));
    expect(report.validFiles.every((file) => file.truncated === false)).toBe(true);
    expect(report.recommendedStrategy).toBe('full');
  });

  it('resolves the default branch when the URL omitted a ref', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url.endsWith('/repos/o/r')) {
        return new Response(JSON.stringify({ default_branch: 'develop' }), { status: 200 });
      }
      return treeResponse([blob('a.ts')]);
    });

    const report = await preflightRepository(target({ ref: '', type: 'repo_root' }));

    expect(report.target.ref).toBe('develop');
    expect(calls.some((url) => url.includes('/git/trees/develop'))).toBe(true);
  });
});

describe('preflightRepository scope requests', () => {
  it('scopes a subpath tree request to that directory', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url.includes('/git/trees/t-src?recursive=1')) {
        return treeResponse([blob('a.ts', 10), blob('nested/b.ts', 10)]);
      }
      return treeResponse([
        { path: 'src', mode: '040000', type: 'tree', sha: 't-src' },
        blob('docs/c.md', 10),
      ]);
    });

    const subpath = await preflightRepository(
      target({ type: 'subpath', subpath: '/src', ref: 'dev' }),
    );

    expect(calls).toEqual([
      'https://api.github.com/repos/o/r/git/trees/dev',
      'https://api.github.com/repos/o/r/git/trees/t-src?recursive=1',
    ]);
    expect(subpath.validFiles.map((file) => file.path)).toEqual(['src/a.ts', 'src/nested/b.ts']);
    expect(subpath.recommendedStrategy).toBe('subpath');
  });

  it('walks nested scopes one level at a time', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url.endsWith('/git/trees/t-core?recursive=1')) {
        return treeResponse([blob('ingest.ts', 10)]);
      }
      if (url.endsWith('/git/trees/t-src')) {
        return treeResponse([{ path: 'core', mode: '040000', type: 'tree', sha: 't-core' }]);
      }
      return treeResponse([{ path: 'src', mode: '040000', type: 'tree', sha: 't-src' }]);
    });

    const report = await preflightRepository(
      target({ type: 'subpath', subpath: '/src/core', ref: 'main' }),
    );

    expect(calls).toEqual([
      'https://api.github.com/repos/o/r/git/trees/main',
      'https://api.github.com/repos/o/r/git/trees/t-src',
      'https://api.github.com/repos/o/r/git/trees/t-core?recursive=1',
    ]);
    expect(report.validFiles.map((file) => file.path)).toEqual(['src/core/ingest.ts']);
  });

  it('reads a blob target through one contents request', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      return new Response(JSON.stringify({ type: 'file', sha: 'blob-sha', size: 42 }), {
        status: 200,
      });
    });

    const single = await preflightRepository(
      target({ type: 'blob', subpath: '/docs/c d.md', ref: 'dev' }),
    );

    expect(calls).toEqual(['https://api.github.com/repos/o/r/contents/docs/c%20d.md?ref=dev']);
    expect(single.validFiles.map((file) => file.path)).toEqual(['docs/c d.md']);
    expect(single.validFiles[0].size).toBe(42);
    expect(single.truncated).toBe(false);
  });

  it('rejects a blob target that is a directory', async () => {
    stubFetch(() => new Response(JSON.stringify([]), { status: 200 }));
    await expect(
      preflightRepository(target({ type: 'blob', subpath: '/docs', ref: 'dev' })),
    ).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
  });
});

describe('preflightRepository limits and fallbacks', () => {
  it('keeps oversized files in metadata and marks them truncated', async () => {
    stubFetch(() => treeResponse([blob('src/huge.ts', 61 * 1024)]));

    const report = await preflightRepository(target(), { maxFileSizeKb: 200 });

    expect(report.validFiles).toHaveLength(1);
    expect(report.validFiles[0].truncated).toBe(true);
    expect(report.estimatedTokens).toBe(Math.ceil((61 * 1024) / 3.8));
    expect(report.recommendedStrategy).toBe('full');
  });

  it('applies a stricter user file limit to the truncation marker', async () => {
    stubFetch(() => treeResponse([blob('src/a.ts', 20 * 1024), blob('src/b.ts', 5 * 1024)]));

    const report = await preflightRepository(target(), { maxFileSizeKb: 10 });

    expect(report.validFiles.map((file) => file.truncated)).toEqual([true, false]);
  });

  it('drops very large metadata-only files from a full recommendation', async () => {
    stubFetch(() => treeResponse([blob('data/dump.json', 400 * 1024)]));

    const report = await preflightRepository(target());

    expect(report.recommendedStrategy).toBe('skeleton');
  });

  it('drops default-excluded paths and custom excludes', async () => {
    stubFetch(() =>
      treeResponse([
        blob('src/a.ts', 10),
        blob('src/a.test.ts', 10),
        blob('node_modules/x.js', 10),
        blob('vendor/lib.ts', 10),
      ]),
    );

    const report = await preflightRepository(target(), { excludePatterns: ['vendor/**'] });

    expect(report.validFiles.map((file) => file.path)).toEqual(['src/a.ts']);
  });

  it('falls back to skeleton when GitHub truncates the tree', async () => {
    stubFetch(() => treeResponse([blob('a.ts', 10)], true));

    const report = await preflightRepository(target());

    expect(report.truncated).toBe(true);
    expect(report.recommendedStrategy).toBe('skeleton');
  });

  it('rejects malformed tree payloads', async () => {
    stubFetch(() => new Response(JSON.stringify({ tree: [{ path: 1 }] }), { status: 200 }));
    await expect(preflightRepository(target())).rejects.toMatchObject({
      code: 'DOWNLOAD_FAILED',
    });
  });
});
