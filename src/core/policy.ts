import { SitePolicyStatus } from '../types';
import { DEFAULT_FILE_SIZE_LIMIT, DEFAULT_SITE_FILE_SIZE_LIMITS } from './constants';

export const BUILTIN_AI_DOMAINS: readonly string[] = [
  // International
  'gemini.google.com',
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'chat.deepseek.com',
  'poe.com',
  'perplexity.ai',
  'copilot.microsoft.com',
  'grok.com',

  // Chinese platforms
  'kimi.moonshot.cn',
  'chatglm.cn',
  'chat.z.ai',
  'z.ai',
  'bigmodel.cn',
  'tongyi.aliyun.com',
  'chat.qwen.ai',
  'qwen.ai',
  'qianwen.com',
  'doubao.com',
  'yuanbao.tencent.com',
  'yuanbao.com',
];

export const normalizeHostname = (host: string): string => {
  return host
    .toLowerCase()
    .trim()
    .replace(/^www\./, '');
};

export const matchDomain = (hostname: string, targetDomain: string): boolean => {
  const normHost = normalizeHostname(hostname);
  const normTarget = normalizeHostname(targetDomain);
  return normHost === normTarget || normHost.endsWith(`.${normTarget}`);
};

/**
 * Policy decision priority:
 *   1. Blacklist (highest)
 *   2. Whitelist
 *   3. Built-in list
 *   4. Disabled by default
 */
export const evaluateSitePolicy = (
  currentHostname: string,
  userWhitelist: readonly string[] = [],
  userBlacklist: readonly string[] = [],
): SitePolicyStatus => {
  const isBlacklisted = userBlacklist.some((domain) => matchDomain(currentHostname, domain));
  if (isBlacklisted) return 'DISABLED_BLACKLIST';

  const isWhitelisted = userWhitelist.some((domain) => matchDomain(currentHostname, domain));
  if (isWhitelisted) return 'ENABLED_WHITELIST';

  const isBuiltin = BUILTIN_AI_DOMAINS.some((domain) => matchDomain(currentHostname, domain));
  if (isBuiltin) return 'ENABLED_BUILTIN';

  return 'DISABLED';
};

export const evaluateSitePolicyForHostnames = (
  hostnames: readonly string[],
  userWhitelist: readonly string[] = [],
  userBlacklist: readonly string[] = [],
): SitePolicyStatus => {
  const normalizedHosts = Array.from(new Set(hostnames.map(normalizeHostname).filter(Boolean)));

  if (normalizedHosts.some((host) => userBlacklist.some((domain) => matchDomain(host, domain)))) {
    return 'DISABLED_BLACKLIST';
  }

  if (normalizedHosts.some((host) => userWhitelist.some((domain) => matchDomain(host, domain)))) {
    return 'ENABLED_WHITELIST';
  }

  if (
    normalizedHosts.some((host) => BUILTIN_AI_DOMAINS.some((domain) => matchDomain(host, domain)))
  ) {
    return 'ENABLED_BUILTIN';
  }

  return 'DISABLED';
};

/**
 * Resolve the effective single-file size limit (bytes) for a hostname.
 *
 * Priority:
 *   1. User-configured per-host overrides
 *   2. Built-in defaults from {@link DEFAULT_SITE_FILE_SIZE_LIMITS}
 *   3. User-configured default
 *   4. Hard-coded fallback
 */
export function resolveSiteLimit(
  hostname: string,
  customLimits?: Readonly<Record<string, number>>,
  defaultLimit?: number,
): number {
  const clean = normalizeHostname(hostname);

  if (customLimits) {
    for (const [domain, limit] of Object.entries(customLimits)) {
      if (typeof limit === 'number' && limit > 0 && matchDomain(clean, domain)) {
        return limit;
      }
    }
  }

  for (const [domain, limit] of Object.entries(DEFAULT_SITE_FILE_SIZE_LIMITS)) {
    if (matchDomain(clean, domain)) return limit;
  }

  if (typeof defaultLimit === 'number' && defaultLimit > 0) return defaultLimit;
  return DEFAULT_FILE_SIZE_LIMIT;
}
