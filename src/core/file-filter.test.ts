import { describe, it, expect } from 'vitest';
import { shouldIncludeFile, matchGlob } from './file-filter';

describe('matchGlob', () => {
  it('matches single-segment wildcard without crossing /', () => {
    // `*` does NOT cross directory separators
    expect(matchGlob('foo.ts', '*.ts')).toBe(true);
    expect(matchGlob('src/foo.ts', '*.ts')).toBe(false);
    expect(matchGlob('src/foo.ts', 'src/*.ts')).toBe(true);
    expect(matchGlob('src/lib/foo.ts', 'src/*.ts')).toBe(false);
    expect(matchGlob('src/foo.ts', '*.js')).toBe(false);
  });

  it('matches double-star across directory separators', () => {
    // Standard glob semantics: `**/*.ts` requires at least one directory separator,
    // so it matches nested files but not top-level ones.
    expect(matchGlob('src/foo.ts', '**/*.ts')).toBe(true);
    expect(matchGlob('src/lib/foo.ts', '**/*.ts')).toBe(true);
    expect(matchGlob('foo.ts', '**/*.ts')).toBe(false);
  });

  it('matches exact path', () => {
    expect(matchGlob('src/foo.ts', 'src/foo.ts')).toBe(true);
    expect(matchGlob('src/foo.ts', 'src/bar.ts')).toBe(false);
  });
});

describe('shouldIncludeFile', () => {
  it('excludes node_modules', () => {
    expect(shouldIncludeFile('node_modules/foo.js')).toBe(false);
  });

  it('excludes lockfiles', () => {
    expect(shouldIncludeFile('pnpm-lock.yaml')).toBe(false);
  });

  it('includes regular source', () => {
    expect(shouldIncludeFile('src/index.ts')).toBe(true);
  });

  it('rejects oversized files', () => {
    expect(shouldIncludeFile('src/big.ts', 200 * 1024, 100 * 1024)).toBe(false);
  });

  it('respects custom include', () => {
    expect(shouldIncludeFile('src/a.ts', 100, 1024 * 100, ['src/**'])).toBe(true);
    expect(shouldIncludeFile('lib/a.ts', 100, 1024 * 100, ['src/**'])).toBe(false);
  });

  it('respects custom exclude', () => {
    expect(shouldIncludeFile('src/a.ts', 100, 1024 * 100, undefined, ['src/**'])).toBe(false);
    expect(shouldIncludeFile('lib/a.ts', 100, 1024 * 100, undefined, ['src/**'])).toBe(true);
  });
});
