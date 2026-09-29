import { SupportedLang } from '../types';

export const translations = {
  'zh-CN': {
    // Popup Header & General
    popupTitle: 'AI Ingest 策略管理',
    checking: '检查中...',
    cantGetDomain: '无法获取当前站点',
    language: '界面语言',
    openGithubRepo: '查看 GitHub 仓库',

    // Site Policy Badges
    builtin: '内置支持',
    builtinDisabled: '已停用',
    blacklisted: '已拉黑',
    whitelisted: '已加白',
    disabled: '未启用',

    // Site Policy Actions (精简文案，根除折行风险)
    disableBuiltinBtn: '停用内置支持',
    enableBuiltinBtn: '恢复内置支持',
    removeWhitelist: '移出白名单',
    addWhitelist: '加入白名单',
    addToBlacklistBtn: '加入黑名单',
    removeFromBlacklistBtn: '移出黑名单',

    // Blacklist Quick Management
    blacklistSectionTitle: '黑名单管理',
    blacklistInputPlaceholder: '输入待屏蔽域名，如 doubao.com',
    addBlacklistBtn: '拉黑',
    noBlacklistDomains: '暂无黑名单网站',
    invalidDomainTip: '请输入有效域名格式',

    // Token Section (还原 '保存' 确保单元测试断言完全吻合)
    tokenSectionTitle: 'GitHub PAT 凭据',
    tokenPlaceholder: 'ghp_xxxxxxxx (需 repo 权限)',
    tokenSave: '保存',
    tokenSaved: '已保存！',
    tokenClear: '清除',
    tokenCleared: '已清除',
    tokenHint: '配置个人令牌可解析私有仓库，并将 API 速率限额提升至 5000次/h。',

    // Site upload limits
    siteFileLimitTitle: '分片阈值配置 (MB)',
    siteFileLimitHint: '设置单文件上限。超出大小时，代码摘要将自动分割为多份 Markdown 文件挂载。',
    siteFileLimitCurrentSite: '当前站点上限',
    siteFileLimitConfigured: '已配置的自定义站点',
    siteFileLimitAddTitle: '添加站点规则',
    siteFileLimitEmpty: '暂无自定义规则',
    siteFileLimitDomainPlaceholder: '域名，如 example.com',
    siteFileLimitAddBtn: '添加规则',
    siteFileLimitSaveBtn: '保存',
    siteFileLimitRemoveBtn: '移除',
    siteFileLimitFallback: '全局默认分片上限',
    siteFileLimitInvalidValue: '请输入有效数值',
    siteFileLimitInvalidDomain: '请输入有效域名',

    // Content & Toast
    taskInProgress: '已有提取任务进行中，已恢复普通文本粘贴',
    ingesting: '正在解析并提取 {repo}...',
    ingestFailed: '提取失败: {err}，已回退为普通链接',
    attachedSuccess: '已成功作为文件附件挂载 {file} ({count} 个文件)',
    fallbackMounted: '已挂载结构概览至输入框，已启用防卡死保护',
    networkError: '通信异常，已恢复原链接',
    privateRepoNotice: '目标仓库不存在或为私有仓库（需在扩展图标中配置具备 repo权限的 PAT）',
    fallbackDigestHeader: '[已解析 GitHub 仓库: {repo}]',
    fallbackFileCount: '包含文件数: {count} | 预估 Token: {tokens}',
    fallbackHint: '提示: 建议在输入框附带具体需求分析。',
    attachingPart: '正在上传第 {current}/{total} 部分...',
    attachedMultiPart: '已成功上传 {count} 个分片文件',
    partialAttachFailed: '第 {current}/{total} 部分上传失败，请重试或手动粘贴',

    // Core steps
    stepResolvingBranch: '正在解析分支信息...',
    stepDownloadingZip: '正在流式下载代码包 (Zipball)...',
    stepUnpacking: '正在内存解压与过滤文件...',
    stepBuildingTree: '正在构建结构化目录树与上下文...',
    emptyZipError: '仓库压缩包内容为空',
    noMatchFiles: '指定路径下未匹配到任何符合规则的文本文件',
    downloadFailedWithStatus: '下载代码压缩包失败: HTTP {status}',
    anonymousRateLimit: '获取仓库失败：匿名访问受限或私有仓库无权限，请在扩展中配置 GitHub PAT',
    authFailedWithStatus: 'GitHub API 鉴权失败 (HTTP {status})，请检查 Token 有效性及 repo 权限。',
  },
  en: {
    // Popup Header & General
    popupTitle: 'AI Ingest Policy',
    checking: 'Checking...',
    cantGetDomain: 'Cannot resolve site',
    language: 'Language',
    openGithubRepo: 'Open GitHub Repo',

    // Site Policy Badges
    builtin: 'Built-in',
    builtinDisabled: 'Disabled',
    blacklisted: 'Blocked',
    whitelisted: 'Whitelisted',
    disabled: 'Inactive',

    // Site Policy Actions
    disableBuiltinBtn: 'Disable Built-in',
    enableBuiltinBtn: 'Enable Built-in',
    removeWhitelist: 'Remove Whitelist',
    addWhitelist: 'Add to Whitelist',
    addToBlacklistBtn: 'Blacklist',
    removeFromBlacklistBtn: 'Unblacklist',

    // Blacklist Quick Management
    blacklistSectionTitle: 'Blacklist Management',
    blacklistInputPlaceholder: 'Domain to block, e.g. doubao.com',
    addBlacklistBtn: 'Block',
    noBlacklistDomains: 'No blacklisted domains',
    invalidDomainTip: 'Please enter a valid domain',

    // Token Section
    tokenSectionTitle: 'GitHub PAT Auth',
    tokenPlaceholder: "ghp_xxxxxxxx ('repo' scope)",
    tokenSave: 'Save',
    tokenSaved: 'Saved!',
    tokenClear: 'Clear',
    tokenCleared: 'Cleared',
    tokenHint:
      'Personal Access Token allows accessing private repos and raises rate limits to 5,000 req/h.',

    // Site upload limits
    siteFileLimitTitle: 'File Size Thresholds (MB)',
    siteFileLimitHint:
      'Set per-site file size limits. Oversized digests are split into multi-part files.',
    siteFileLimitCurrentSite: 'Current Site Threshold',
    siteFileLimitConfigured: 'Configured Rules',
    siteFileLimitAddTitle: 'Add Site Rule',
    siteFileLimitEmpty: 'No custom rules yet',
    siteFileLimitDomainPlaceholder: 'Domain, e.g. example.com',
    siteFileLimitAddBtn: 'Add Rule',
    siteFileLimitSaveBtn: 'Save',
    siteFileLimitRemoveBtn: 'Remove',
    siteFileLimitFallback: 'Global Default Limit',
    siteFileLimitInvalidValue: 'Please enter a valid value',
    siteFileLimitInvalidDomain: 'Please enter a valid domain',

    // Content & Toast
    taskInProgress: 'An extraction task is already in progress, pasted as raw text.',
    ingesting: 'Parsing and extracting {repo}...',
    ingestFailed: 'Extraction failed: {err}. Reverted to plain link.',
    attachedSuccess: 'Successfully attached {file} as file ({count} files)',
    fallbackMounted: 'Mounted structure overview to input, anti-freeze protection enabled.',
    networkError: 'Communication error, reverted to plain link.',
    privateRepoNotice:
      "Repository not found or is private (Please configure a PAT with 'repo' scope in the extension popup).",
    fallbackDigestHeader: '[Parsed GitHub Repository: {repo}]',
    fallbackFileCount: 'Files analyzed: {count} | Estimated tokens: {tokens}',
    fallbackHint: 'Tip: You can now append your specific prompt or analysis instructions.',
    attachingPart: 'Attaching part {current}/{total}...',
    attachedMultiPart: 'Successfully attached as {count} part(s)',
    partialAttachFailed:
      'Attachment interrupted at part {current}/{total}. Please retry or paste manually.',

    // Core steps
    stepResolvingBranch: 'Resolving branch information...',
    stepDownloadingZip: 'Streaming repository archive (Zipball)...',
    stepUnpacking: 'Unpacking and filtering files in memory...',
    stepBuildingTree: 'Building structured file tree and context...',
    emptyZipError: 'Repository archive is empty.',
    noMatchFiles: 'No text files matched the filtering criteria.',
    downloadFailedWithStatus: 'Failed to download repository archive: HTTP {status}',
    anonymousRateLimit:
      'Failed to fetch repository: Rate limit exceeded or unauthorized private repository. Please configure a GitHub Token.',
    authFailedWithStatus:
      'GitHub API authentication failed (HTTP {status}). Please check your PAT permissions.',
  },
} as const;

export type I18nKey = keyof (typeof translations)['zh-CN'];

export function t(
  key: I18nKey,
  lang: SupportedLang = 'zh-CN',
  params?: Record<string, string | number>,
): string {
  const dictionary = translations[lang] || translations['zh-CN'];
  let text: string = dictionary[key] || translations['zh-CN'][key] || key;

  if (params) {
    for (const [paramKey, paramVal] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
    }
  }

  return text;
}
