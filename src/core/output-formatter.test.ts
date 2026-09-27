import { describe, it, expect } from 'vitest';
import { OutputFormatter, SEPARATOR } from './output-formatter';
import type { RepoTarget, IngestFileResult } from '../types';

const target: RepoTarget = {
  owner: 'foo',
  repo: 'bar',
  canonicalUrl: 'https://github.com/foo/bar',
  subpath: '/',
};

describe('OutputFormatter.createSummaryPrefix', () => {
  it('omits branch line for main/master', () => {
    const prefix = OutputFormatter.createSummaryPrefix(target, 'main', 5, '1.2k');
    expect(prefix).toContain('Repository: foo/bar');
    expect(prefix).not.toContain('Branch:');
  });

  it('includes branch when not main/master', () => {
    const prefix = OutputFormatter.createSummaryPrefix(target, 'dev', 5, '1.2k');
    expect(prefix).toContain('Branch: dev');
  });
});

describe('OutputFormatter.buildFullDigest', () => {
  it('emits a separator-delimited block per file', () => {
    const files: IngestFileResult[] = [
      { path: 'a.ts', content: 'AAA', size: 3 },
      { path: 'b.ts', content: 'BBB', size: 3 },
    ];
    const out = OutputFormatter.buildFullDigest('HEAD\n', 'tree\n', files);
    expect(out).toContain('HEAD');
    expect(out).toContain('Directory structure:');
    expect(out.match(new RegExp(SEPARATOR, 'g'))?.length).toBe(4);
    expect(out).toContain('FILE: a.ts');
    expect(out).toContain('FILE: b.ts');
  });
});

describe('OutputFormatter.splitIntoParts', () => {
  const prefix = 'Repository: foo/bar\nFiles analyzed: 0\n';

  it('returns a single part when everything fits', () => {
    const files: IngestFileResult[] = [{ path: 'a.ts', content: 'AAA', size: 3 }];
    const parts = OutputFormatter.splitIntoParts(prefix, 'tree\n', files, 100_000, 'foo_bar');
    expect(parts).toHaveLength(1);
    expect(parts[0].fileName).toBe('foo_bar.md');
    expect(parts[0].content).toContain('FILE: a.ts');
  });

  it('handles empty file list with a single header-only part', () => {
    const parts = OutputFormatter.splitIntoParts(prefix, 'tree\n', [], 4096, 'foo_bar');
    expect(parts).toHaveLength(1);
    expect(parts[0].content).toContain('Directory structure:');
  });

  it('splits into multiple parts when exceeding the limit', () => {
    const big = 'x'.repeat(2000);
    const files: IngestFileResult[] = Array.from({ length: 8 }, (_, i) => ({
      path: `f${i}.ts`,
      content: big,
      size: big.length,
    }));
    const parts = OutputFormatter.splitIntoParts(prefix, 'tree\n', files, 4096, 'foo_bar');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].fileName).toMatch(/^foo_bar\.part1of\d+\.md$/);
    for (const p of parts) {
      expect(p.sizeBytes).toBeGreaterThan(0);
      expect(p.content).toContain('Repository: foo/bar');
    }
  });

  it('splits a single oversized file at line boundaries with markers', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line-${i} ${'y'.repeat(50)}`).join('\n');
    const files: IngestFileResult[] = [{ path: 'huge.ts', content: lines, size: lines.length }];
    const parts = OutputFormatter.splitIntoParts(prefix, 'tree\n', files, 4096, 'foo_bar');
    expect(parts.length).toBeGreaterThan(1);
    const joined = parts.map((p) => p.content).join('\n');
    expect(joined).toContain('CONTINUED');
    expect(joined).toContain('[END OF FILE]');
  });

  it('does not split binary placeholders into lines', () => {
    const files: IngestFileResult[] = [{ path: 'bin.dat', content: '[Binary file]', size: 13 }];
    const parts = OutputFormatter.splitIntoParts(prefix, 'tree\n', files, 100_000, 'foo_bar');
    expect(parts).toHaveLength(1);
    expect(parts[0].content).toContain('[Binary file]');
  });
});
