import { describe, expect, it } from 'vitest';
import type { FileMetadata, GitHubTarget, PreflightReport } from '../types';
import { estimateTokensFromBytes, resolveIngestStrategy } from './strategy-engine';

const target: GitHubTarget = {
  owner: 'o',
  repo: 'r',
  ref: 'main',
  subpath: '/',
  type: 'repo_root',
  canonicalUrl: 'https://github.com/o/r',
};

function file(path: string): FileMetadata {
  return { path, size: 10, isConfigFile: false, isReadme: false, truncated: false };
}

function report(overrides: Partial<PreflightReport> = {}): PreflightReport {
  return {
    target,
    totalBlobs: 1,
    validFiles: [file('a.ts')],
    estimatedTokens: 10,
    recommendedStrategy: 'full',
    stackConfigs: [],
    entrypoints: [],
    truncated: false,
    ...overrides,
  };
}

describe('estimateTokensFromBytes', () => {
  it('uses ceil(bytes / 3.8) and handles invalid input', () => {
    expect(estimateTokensFromBytes(38)).toBe(10);
    expect(estimateTokensFromBytes(39)).toBe(11);
    expect(estimateTokensFromBytes(-1)).toBe(0);
    expect(estimateTokensFromBytes(Number.NaN)).toBe(0);
  });
});

describe('resolveIngestStrategy', () => {
  it('returns full for small repositories', () => {
    expect(resolveIngestStrategy(report())).toBe('full');
  });

  it('returns skeleton when files or tokens exceed thresholds', () => {
    expect(
      resolveIngestStrategy(
        report({ validFiles: Array.from({ length: 51 }, (_, i) => file(`${i}.ts`)) }),
      ),
    ).toBe('skeleton');
    expect(resolveIngestStrategy(report({ estimatedTokens: 60_001 }))).toBe('skeleton');
  });

  it('returns subpath for a small subpath target', () => {
    const subpathTarget: GitHubTarget = { ...target, type: 'subpath', subpath: '/src' };
    expect(resolveIngestStrategy(report({ target: subpathTarget }))).toBe('subpath');
  });

  it('uses skeleton for a subpath above 80 files and truncated trees', () => {
    const subpathTarget: GitHubTarget = { ...target, type: 'subpath', subpath: '/src' };
    const tooMany = Array.from({ length: 81 }, (_, i) => file(`${i}.ts`));
    expect(resolveIngestStrategy(report({ target: subpathTarget, validFiles: tooMany }))).toBe(
      'skeleton',
    );
    expect(resolveIngestStrategy(report({ truncated: true }))).toBe('skeleton');
  });

  it('honors forceStrategy except when the tree is truncated', () => {
    expect(resolveIngestStrategy(report(), { forceStrategy: 'skeleton' })).toBe('skeleton');
    expect(
      resolveIngestStrategy(report({ estimatedTokens: 999_999 }), { forceStrategy: 'full' }),
    ).toBe('full');
    expect(resolveIngestStrategy(report({ truncated: true }), { forceStrategy: 'full' })).toBe(
      'skeleton',
    );
  });
});
