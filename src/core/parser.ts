import { RepoTarget, ParseError } from '../types';
import { Result, ok, err } from './result';

/**
 * GitHub 顶层全局保留路由（非具体用户/组织名）
 */
const GITHUB_RESERVED_ROOTS = new Set<string>([
  'settings',
  'marketplace',
  'explore',
  'topics',
  'trending',
  'collections',
  'events',
  'sponsors',
  'login',
  'join',
  'security',
  'features',
  'pricing',
  'enterprise',
  'customer-stories',
  'readme',
  'about',
  'contact',
  'organizations',
  'search',
  'notifications',
]);

/**
 * 仓库内非代码树/非文件资源路由（不应触发全量仓库 Ingest 解析）
 */
const NON_CODE_ACTIONS = new Set<string>([
  'issues',
  'pull',
  'pulls',
  'actions',
  'projects',
  'wiki',
  'security',
  'pulse',
  'graphs',
  'community',
  'discussions',
  'network',
  'settings',
  'commits',
  'commit',
  'releases',
  'tags',
  'branches',
  'stargazers',
  'watchers',
  'forks',
  'labels',
  'milestones',
  'find',
  'new',
]);

/**
 * 常见多段分支名前缀
 */
const MULTI_SEGMENT_BRANCH_PREFIXES = new Set<string>([
  'feature',
  'feat',
  'fix',
  'bugfix',
  'hotfix',
  'release',
  'chore',
  'docs',
  'test',
  'refactor',
]);

const safeDecodeUriComponent = (val: string): string => {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
};

/**
 * 规范化解析用户粘贴的文本，精准提取 GitHub 代码仓库与文件路径目标
 */
export const extractGitHubRepo = (
  rawText: string | null | undefined,
): Result<RepoTarget, ParseError> => {
  if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
    return err({ code: 'EMPTY_INPUT', message: '输入内容为空' });
  }

  // 1. 清理外层可能存在的包裹字符（如 Markdown 链接尖括号、引号等）
  let candidate = rawText.trim();
  candidate = candidate.replace(/^[<(\["']+\vert{}[>)\]"']+$/g, '');

  // 2. 补齐协议头以支持标准 URL 解析
  if (
    /^[a-zA-Z0-9_\-\.]+\/[a-zA-Z0-9_\-\.]+/.test(candidate) &&
    !candidate.startsWith('http://') &&
    !candidate.startsWith('https://')
  ) {
    candidate = `https://github.com/${candidate.replace(/^github\.com\//, '')}`;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidate);
  } catch {
    return err({
      code: 'NOT_GITHUB_URL',
      message: '未匹配到有效的 GitHub 链接格式',
    });
  }

  // 3. 校验 Hostname 是否为 GitHub
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'github.com') {
    return err({
      code: 'NOT_GITHUB_URL',
      message: '非 GitHub 域名链接',
    });
  }

  // 4. 提取路径段（天然丢弃 query ? 与 hash #）
  const segments = parsedUrl.pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);

  if (segments.length < 2) {
    return err({
      code: 'NOT_GITHUB_URL',
      message: '缺少有效的 GitHub 仓库路径 (格式应为 owner/repo)',
    });
  }

  const rawOwner = segments[0];
  const rawRepo = segments[1];
  const owner = safeDecodeUriComponent(rawOwner);
  const repo = safeDecodeUriComponent(rawRepo).replace(/\.git$/, '');

  // 5. 校验 Owner 与 Repo 有效性，杜绝 GitHub 顶层保留字
  if (GITHUB_RESERVED_ROOTS.has(owner.toLowerCase()) || !/^[a-zA-Z0-9_\-\.]+$/.test(owner)) {
    return err({
      code: 'NOT_GITHUB_URL',
      message: '非合法的 GitHub 仓库所属组织或用户',
    });
  }

  if (!repo || !/^[a-zA-Z0-9_\-\.]+$/.test(repo)) {
    return err({
      code: 'NOT_GITHUB_URL',
      message: '非合法的 GitHub 仓库名称',
    });
  }

  // 6. 仓库根目录处理 (例如 https://github.com/owner/repo 或 owner/repo/)
  if (segments.length === 2) {
    const canonicalUrl = `https://github.com/${owner}/${repo}`;
    return ok({
      owner,
      repo,
      ref: undefined,
      type: undefined,
      subpath: '/',
      canonicalUrl,
    });
  }

  // 7. 处理多级路径：严格防范 Issue / PR / Commit 等非代码树路径被误判
  const action = segments[2].toLowerCase();

  // 若命中了 issues、pull、actions 等明确非代码树路由，直接拒绝解析，交由浏览器原生粘贴
  if (NON_CODE_ACTIONS.has(action)) {
    return err({
      code: 'NOT_GITHUB_URL',
      message: `已忽略非代码树链接 (/${action})`,
    });
  }

  // 仅允许 /tree/ 或 /blob/ 类型的代码路径
  if (action !== 'tree' && action !== 'blob') {
    return err({
      code: 'NOT_GITHUB_URL',
      message: '未匹配到受支持的 GitHub 代码目录 (tree) 或文件 (blob) 路径',
    });
  }

  if (segments.length === 3) {
    return err({
      code: 'NOT_GITHUB_URL',
      message: '缺少具体的分支或代码引用路径',
    });
  }

  const targetType: 'tree' | 'blob' = action;

  // 8. 智能解析 Ref 与 Subpath（兼顾 feature/* 等多段分支命名并做安全 URI 解码）
  let rawRefSegments: string[];
  let rawSubpathSegments: string[];

  if (segments.length >= 5 && MULTI_SEGMENT_BRANCH_PREFIXES.has(segments[3].toLowerCase())) {
    rawRefSegments = [segments[3], segments[4]];
    rawSubpathSegments = segments.slice(5);
  } else {
    rawRefSegments = [segments[3]];
    rawSubpathSegments = segments.slice(4);
  }

  const ref = rawRefSegments.map(safeDecodeUriComponent).join('/');
  const decodedSubpathParts = rawSubpathSegments.map(safeDecodeUriComponent);
  const subpath = decodedSubpathParts.length > 0 ? `/${decodedSubpathParts.join('/')}` : '/';

  // 构建规范化的 canonicalUrl，确保分支名中的保留字符（如 #）正确转义，避免被后续流程重新误切
  const encodedRef = rawRefSegments
    .map((seg) => encodeURIComponent(safeDecodeUriComponent(seg)))
    .join('/');
  const encodedSubpath =
    decodedSubpathParts.length > 0
      ? `/${decodedSubpathParts.map(encodeURIComponent).join('/')}`
      : '';

  const canonicalUrl = `https://github.com/${owner}/${repo}/${targetType}/${encodedRef}${encodedSubpath}`;

  return ok({
    owner,
    repo,
    ref,
    type: targetType,
    subpath,
    canonicalUrl,
  });
};
