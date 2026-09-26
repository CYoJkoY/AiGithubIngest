import { SupportedLang } from "../types";

export const translations = {
  "zh-CN": {
    // Popup
    popupTitle: "AI Ingest 策略管理",
    checking: "检查中...",
    builtin: "内置支持",
    builtinDisabled: "已停用 (内置)",
    disableBuiltinBtn: "在此内置站点停用插件",
    enableBuiltinBtn: "恢复在此站点启用",
    whitelisted: "已加白名单",
    removeWhitelist: "从白名单中移除",
    disabled: "未启用",
    addWhitelist: "将本站加入白名单并启用",
    cantGetDomain: "无法获取当前站点",
    tokenSectionTitle: "GitHub Token (支持私有仓库)",
    tokenPlaceholder: "ghp_xxxxxxxx (需勾选 repo 权限)",
    tokenSave: "保存",
    tokenSaved: "已保存！",
    tokenClear: "清除",
    tokenCleared: "已清除",
    tokenHint:
      "配置 Personal Access Token 可解析您的私有仓库并提升 API 限额至 5000次/h。",
    language: "语言 / Language",

    // Content & Toast
    taskInProgress: "已有提取任务进行中，已恢复普通文本粘贴",
    ingesting: "正在解析并提取 {repo}...",
    ingestFailed: "提取失败: {err}，已回退为普通链接",
    attachedSuccess: "已成功作为文件附件挂载 {file} ({count} 个文件)",
    fallbackMounted: "已挂载结构概览至输入框，已启用防卡死保护",
    networkError: "通信异常，已恢复原链接",
    privateRepoNotice:
      "目标仓库不存在或为私有仓库（需在扩展图标中配置具备 repo 权限的 PAT）",
    fallbackDigestHeader: "[已解析 GitHub 仓库: {repo}]",
    fallbackFileCount: "包含文件数: {count} | 预估 Token: {tokens}",
    fallbackHint: "提示: 建议在输入框附带具体需求分析。",

    // Core steps
    stepResolvingBranch: "正在解析分支信息...",
    stepDownloadingZip: "正在流式下载代码包 (Zipball)...",
    stepUnpacking: "正在内存解压与过滤文件...",
    stepBuildingTree: "正在构建结构化目录树与上下文...",
    emptyZipError: "仓库压缩包内容为空",
    noMatchFiles: "指定路径下未匹配到任何符合规则的文本文件",
    downloadFailedWithStatus: "下载代码压缩包失败: HTTP {status}",
    anonymousRateLimit:
      "获取仓库失败：匿名访问受限或私有仓库无权限，请在扩展中配置 GitHub PAT",
  },
  en: {
    // Popup
    popupTitle: "AI Ingest Policy & Settings",
    checking: "Checking...",
    builtin: "Built-in",
    builtinDisabled: "Disabled (Built-in)",
    disableBuiltinBtn: "Disable on this built-in site",
    enableBuiltinBtn: "Re-enable on this site",
    whitelisted: "Whitelisted",
    removeWhitelist: "Remove from whitelist",
    disabled: "Disabled",
    addWhitelist: "Enable & add to whitelist",
    cantGetDomain: "Cannot resolve current site",
    tokenSectionTitle: "GitHub Token (For Private Repos)",
    tokenPlaceholder: "ghp_xxxxxxxx (Requires 'repo' scope)",
    tokenSave: "Save",
    tokenSaved: "Saved!",
    tokenClear: "Clear",
    tokenCleared: "Cleared",
    tokenHint:
      "Personal Access Token allows accessing your private repositories and raises rate limits to 5,000 req/h.",
    language: "Language",

    // Content & Toast
    taskInProgress:
      "An extraction task is already in progress, pasted as raw text.",
    ingesting: "Parsing and extracting {repo}...",
    ingestFailed: "Extraction failed: {err}. Reverted to plain link.",
    attachedSuccess: "Successfully attached {file} as file ({count} files)",
    fallbackMounted:
      "Mounted structure overview to input, anti-freeze protection enabled.",
    networkError: "Communication error, reverted to plain link.",
    privateRepoNotice:
      "Repository not found or is private (Please configure a PAT with 'repo' scope in the extension popup).",
    fallbackDigestHeader: "[Parsed GitHub Repository: {repo}]",
    fallbackFileCount: "Files analyzed: {count} | Estimated tokens: {tokens}",
    fallbackHint:
      "Tip: You can now append your specific prompt or analysis instructions.",

    // Core steps
    stepResolvingBranch: "Resolving branch information...",
    stepDownloadingZip: "Streaming repository archive (Zipball)...",
    stepUnpacking: "Unpacking and filtering files in memory...",
    stepBuildingTree: "Building structured file tree and context...",
    emptyZipError: "Repository archive is empty.",
    noMatchFiles: "No text files matched the filtering criteria.",
    downloadFailedWithStatus:
      "Failed to download repository archive: HTTP {status}",
    anonymousRateLimit:
      "Failed to fetch repository: Rate limit exceeded or unauthorized private repository. Please configure a GitHub Token.",
  },
} as const;

export type I18nKey = keyof (typeof translations)["zh-CN"];

export function t(
  key: I18nKey,
  lang: SupportedLang = "zh-CN",
  params?: Record<string, string | number>,
): string {
  const dictionary = translations[lang] || translations["zh-CN"];
  let text: string = dictionary[key] || translations["zh-CN"][key] || key;

  if (params) {
    for (const [paramKey, paramVal] of Object.entries(params)) {
      text = text.replace(
        new RegExp(`\\{${paramKey}\\}`, "g"),
        String(paramVal),
      );
    }
  }

  return text;
}
