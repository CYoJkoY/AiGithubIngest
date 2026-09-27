import { describe, it, expect } from 'vitest';
import {
  evaluateSitePolicy,
  evaluateSitePolicyForHostnames,
  matchDomain,
  normalizeHostname,
  resolveSiteLimit,
} from './policy';
import { DEFAULT_FILE_SIZE_LIMIT } from './constants';

describe('normalizeHostname', () => {
  it('lowercases and strips www', () => {
    expect(normalizeHostname('WWW.Example.com')).toBe('example.com');
  });
});

describe('matchDomain', () => {
  it('matches exact and subdomain', () => {
    expect(matchDomain('chatgpt.com', 'chatgpt.com')).toBe(true);
    expect(matchDomain('chat.chatgpt.com', 'chatgpt.com')).toBe(true);
    expect(matchDomain('evil-chatgpt.com', 'chatgpt.com')).toBe(false);
  });
});

describe('evaluateSitePolicy', () => {
  it('blacklist wins over builtin', () => {
    expect(evaluateSitePolicy('chatgpt.com', [], ['chatgpt.com'])).toBe('DISABLED_BLACKLIST');
  });
  it('whitelist wins over disabled', () => {
    expect(evaluateSitePolicy('example.com', ['example.com'], [])).toBe('ENABLED_WHITELIST');
  });
  it('builtin enabled by default', () => {
    expect(evaluateSitePolicy('claude.ai', [], [])).toBe('ENABLED_BUILTIN');
  });
  it('unknown host disabled', () => {
    expect(evaluateSitePolicy('unknown-host.com', [], [])).toBe('DISABLED');
  });
});

describe('evaluateSitePolicyForHostnames', () => {
  it('any candidate blacklisted disables', () => {
    expect(evaluateSitePolicyForHostnames(['foo.com', 'chatgpt.com'], [], ['chatgpt.com'])).toBe(
      'DISABLED_BLACKLIST',
    );
  });
  it('matches whitelist if not blacklisted', () => {
    expect(evaluateSitePolicyForHostnames(['custom.ai', 'sub.custom.ai'], ['custom.ai'], [])).toBe(
      'ENABLED_WHITELIST',
    );
  });
  it('matches builtin when host matches', () => {
    expect(evaluateSitePolicyForHostnames(['gemini.google.com'], [], [])).toBe('ENABLED_BUILTIN');
  });
  it('returns DISABLED when none match', () => {
    expect(evaluateSitePolicyForHostnames(['unknown.com', 'other.com'], [], [])).toBe('DISABLED');
  });
});

describe('resolveSiteLimit', () => {
  it('returns DEFAULT_FILE_SIZE_LIMIT when no overrides exist', () => {
    expect(resolveSiteLimit('example.com')).toBe(DEFAULT_FILE_SIZE_LIMIT);
  });

  it('matches exact host override', () => {
    const limits = { 'chatgpt.com': 50 * 1024 * 1024 };
    expect(resolveSiteLimit('chatgpt.com', limits)).toBe(50 * 1024 * 1024);
  });

  it('matches subdomain override with longest domain priority', () => {
    const limits = {
      'google.com': 10 * 1024 * 1024,
      'gemini.google.com': 25 * 1024 * 1024,
    };
    expect(resolveSiteLimit('gemini.google.com', limits)).toBe(25 * 1024 * 1024);
    expect(resolveSiteLimit('mail.google.com', limits)).toBe(10 * 1024 * 1024);
  });

  it('ignores invalid numeric values in custom limits', () => {
    const limits = { 'foo.com': -100, 'bar.com': 0 };
    expect(resolveSiteLimit('foo.com', limits, 15 * 1024 * 1024)).toBe(15 * 1024 * 1024);
  });

  it('falls back to custom defaultLimit when domain does not match', () => {
    expect(resolveSiteLimit('foo.com', undefined, 12 * 1024 * 1024)).toBe(12 * 1024 * 1024);
  });
});
