import { SitePolicyStatus } from "../types";

export const BUILTIN_AI_DOMAINS: readonly string[] = [
  // 国际主流大模型
  "gemini.google.com",
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "chat.deepseek.com",
  "poe.com",
  "perplexity.ai",
  "copilot.microsoft.com",
  "grok.com",

  // 国内主流大模型（深度覆盖通义千问新老版、豆包、腾讯元宝、智谱清言所有主子域名）
  "kimi.moonshot.cn",
  "chatglm.cn",
  "chat.z.ai",
  "z.ai",
  "bigmodel.cn",
  "tongyi.aliyun.com",
  "chat.qwen.ai",
  "qwen.ai",
  "qianwen.com",
  "doubao.com",
  "yuanbao.tencent.com",
  "yuanbao.com",
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

/**
 * 策略裁决优先级：
 * 1. 用户黑名单 (Highest) -> 只要在黑名单，无论是否内置，一律停用
 * 2. 用户白名单 -> 手动添加的自定义站点，启用
 * 3. 官方内置列表 -> 默认启用
 * 4. 其它站点 -> 默认停用
 */
export const evaluateSitePolicy = (
  currentHostname: string,
  userWhitelist: readonly string[] = [],
  userBlacklist: readonly string[] = [],
): SitePolicyStatus => {
  const isBlacklisted = userBlacklist.some((domain) =>
    matchDomain(currentHostname, domain),
  );
  if (isBlacklisted) return "DISABLED_BLACKLIST";

  const isWhitelisted = userWhitelist.some((domain) =>
    matchDomain(currentHostname, domain),
  );
  if (isWhitelisted) return "ENABLED_WHITELIST";

  const isBuiltin = BUILTIN_AI_DOMAINS.some((domain) =>
    matchDomain(currentHostname, domain),
  );
  if (isBuiltin) return "ENABLED_BUILTIN";

  return "DISABLED";
};
