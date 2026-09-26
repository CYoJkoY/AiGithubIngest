import { SitePolicyStatus } from "../types";

export const BUILTIN_AI_DOMAINS: readonly string[] = [
  "gemini.google.com",
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "chat.deepseek.com",
  "poe.com",
  "perplexity.ai",
  "kimi.moonshot.cn",
  "chatglm.cn",
  "tongyi.aliyun.com",
  "copilot.microsoft.com",
];

export const normalizeHostname = (host: string): string => {
  return host
    .toLowerCase()
    .trim()
    .replace(/^www\./, "");
};

export const matchDomain = (
  hostname: string,
  targetDomain: string,
): boolean => {
  const normHost = normalizeHostname(hostname);
  const normTarget = normalizeHostname(targetDomain);
  return normHost === normTarget || normHost.endsWith(`.${normTarget}`);
};

export const evaluateSitePolicy = (
  currentHostname: string,
  userWhitelist: readonly string[],
): SitePolicyStatus => {
  const isBuiltin = BUILTIN_AI_DOMAINS.some((domain) =>
    matchDomain(currentHostname, domain),
  );
  if (isBuiltin) return "ENABLED_BUILTIN";

  const isWhitelisted = userWhitelist.some((domain) =>
    matchDomain(currentHostname, domain),
  );
  if (isWhitelisted) return "ENABLED_WHITELIST";

  return "DISABLED";
};
