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

  it('scopes a subpath target to that directory and honors a blob target', async () => {
    stubFetch(() =>
      treeResponse([blob('src/a.ts', 10), blob('src/nested/b.ts', 10), blob('docs/c.md', 10)]),
    );

    const subpath = await preflightRepository(
      target({ type: 'subpath', subpath: '/src', ref: 'dev' }),
    );
    expect(subpath.validFiles.map((file) => file.path)).toEqual(['src/a.ts', 'src/nested/b.ts']);
    expect(subpath.recommendedStrategy).toBe('subpath');

    const single = await preflightRepository(
      target({ type: 'blob', subpath: '/docs/c.md', ref: 'dev' }),
    );
    expect(single.validFiles.map((file) => file.path)).toEqual(['docs/c.md']);
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
