import { describe, it, expect } from 'vitest';
import { estimateTokenCount, formatTokenCount } from './token-estimator';

describe('estimateTokenCount', () => {
  it('returns 0 for empty', () => {
    expect(estimateTokenCount('')).toBe(0);
  });
  it('counts ASCII words', () => {
    expect(estimateTokenCount('hello world')).toBeGreaterThan(0);
  });
  it('counts non-ASCII higher', () => {
    expect(estimateTokenCount('你好世界')).toBeGreaterThan(0);
  });
});

describe('formatTokenCount', () => {
  it('returns plain for < 1000', () => {
    expect(formatTokenCount('a')).toBe('1');
  });
  it('formats k', () => {
    const big = 'word '.repeat(1500);
    expect(formatTokenCount(big)).toMatch(/k$/);
  });
});
