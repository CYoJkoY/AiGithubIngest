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
    expect(out.match(new RegExp(SEPARATOR, 'g'))?.length).toBe(4); // 2 files × 2 separators
    expect(out).toContain('FILE: a.ts');
    expect(out).toContain('FILE: b.ts');
  });
});
