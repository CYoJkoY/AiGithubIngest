import { describe, it, expect } from 'vitest';
import { shouldIncludeFile, matchGlob } from './file-filter';

describe('matchGlob', () => {
  it('matches wildcard pattern', () => {
    expect(matchGlob('src/foo.ts', '*.ts')).toBe(true);
    expect(matchGlob('src/foo.ts', 'src/*.ts')).toBe(true);
    expect(matchGlob('src/foo.ts', '*.js')).toBe(false);
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
});
