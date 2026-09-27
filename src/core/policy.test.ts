import { describe, it, expect } from 'vitest';
import {
  evaluateSitePolicy,
  evaluateSitePolicyForHostnames,
  matchDomain,
  normalizeHostname,
} from './policy';

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
});
