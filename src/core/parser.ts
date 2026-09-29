import { RepoTarget, ParseError, SupportedLang } from '../types';
import { Result, ok, err } from './result';
import { t } from './i18n';

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

/** `-` 放在末尾以避免转义 */
const OWNER_OR_REPO_PATTERN = /^[a-zA-Z0-9_.-]+$/;

const BARE_REPO_PREFIX_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/;

function safeDecodeUriComponent(val: string): string {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

/**
剥离用户粘贴时可能携带的 Markdown 包裹字符（如 `[text](url)`、`<url>`、引号等）。
若剥离后为空，则回退到原始 trim 结果。
*/
function stripWrappingChars(raw: string): string {
  const trimmed = raw.trim();

  // 1. 提取 Markdown 链接: [text](url) 或 ![alt](url)
  const mdLinkMatch = trimmed.match(/!?\[[^\]]*\]\(([^)]+)\)/);
  if (mdLinkMatch) {
    return mdLinkMatch[1].trim();
  }

  // 2. 提取尖括号自动链接: <url>
  const autolinkMatch = trimmed.match(/^<([^>]+)>$/);
  if (autolinkMatch) {
    return autolinkMatch[1].trim();
  }

  // 3. 剥离常规包裹符号（引号、括号等）
  const stripped = trimmed.replace(/^[<([{"'|]+/, '').replace(/[>)]}"'|]+$/, '');
  return stripped || trimmed;
}

/**
 * 归一化输入：为裸 `owner/repo` 补上 https://github.com/ 前缀。
 */
function normalizeCandidate(rawText: string): string {
  const candidate = stripWrappingChars(rawText);
  const isBareRepo = BARE_REPO_PREFIX_PATTERN.test(candidate);
  const hasProtocol = candidate.startsWith('http://') || candidate.startsWith('https://');
  if (isBareRepo && !hasProtocol) {
    return `https://github.com/${candidate.replace(/^github\.com\//, '')}`;
  }
  return candidate;
}

function extractSegments(pathname: string): string[] {
  return pathname
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
}

function validateOwnerAndRepo(
  rawOwner: string,
  rawRepo: string,
  lang: SupportedLang,
): Result<{ owner: string; repo: string }, ParseError> {
  const owner = safeDecodeUriComponent(rawOwner);
  const repo = safeDecodeUriComponent(rawRepo).replace(/\.git$/, '');
  if (GITHUB_RESERVED_ROOTS.has(owner.toLowerCase()) || !OWNER_OR_REPO_PATTERN.test(owner)) {
    return err({ code: 'NOT_GITHUB_URL', message: t('parseInvalidOwner', lang) });
  }
  if (!repo || !OWNER_OR_REPO_PATTERN.test(repo)) {
    return err({ code: 'NOT_GITHUB_URL', message: t('parseInvalidRepo', lang) });
  }
  return ok({ owner, repo });
}

interface RefAndSubpath {
  readonly ref: string;
  readonly subpath: string;
  readonly rawRefSegments: string[];
  readonly decodedSubpathParts: string[];
}

/**
 * 智能解析 Ref 与 Subpath（兼顾 feature/* 等多段分支命名并做安全 URI 解码）
 */
function parseRefAndSubpath(segments: string[]): RefAndSubpath {
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

  return { ref, subpath, rawRefSegments, decodedSubpathParts };
}

function buildCanonicalUrl(
  owner: string,
  repo: string,
  targetType: 'tree' | 'blob',
  rawRefSegments: string[],
  decodedSubpathParts: string[],
): string {
  const encodedRef = rawRefSegments
    .map((seg) => encodeURIComponent(safeDecodeUriComponent(seg)))
    .join('/');
  const encodedSubpath =
    decodedSubpathParts.length > 0
      ? `/${decodedSubpathParts.map(encodeURIComponent).join('/')}`
      : '';
  return `https://github.com/${owner}/${repo}/${targetType}/${encodedRef}${encodedSubpath}`;
}

/**
 * 规范化解析用户粘贴的文本，精准提取 GitHub 代码仓库与文件路径目标
 */
export const extractGitHubRepo = (
  rawText: string | null | undefined,
  lang: SupportedLang = 'zh-CN',
): Result<RepoTarget, ParseError> => {
  if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
    return err({ code: 'EMPTY_INPUT', message: t('parseEmptyInput', lang) });
  }
  const candidate = normalizeCandidate(rawText);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidate);
  } catch {
    return err({ code: 'NOT_GITHUB_URL', message: t('parseNotGithubUrl', lang) });
  }
  const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'github.com') {
    return err({ code: 'NOT_GITHUB_URL', message: t('parseNonGithubHost', lang) });
  }
  const segments = extractSegments(parsedUrl.pathname);
  if (segments.length < 2) {
    return err({
      code: 'NOT_GITHUB_URL',
      message: t('parseMissingRepoPath', lang),
    });
  }
  const validated = validateOwnerAndRepo(segments[0], segments[1], lang);
  if (!validated.ok) return err(validated.error);
  const { owner, repo } = validated.value;

  if (segments.length === 2) {
    return ok({
      owner,
      repo,
      ref: undefined,
      type: undefined,
      subpath: '/',
      canonicalUrl: `https://github.com/${owner}/${repo}`,
    });
  }
  const action = segments[2].toLowerCase();
  if (NON_CODE_ACTIONS.has(action)) {
    return err({
      code: 'NOT_GITHUB_URL',
      message: t('parseIgnoredAction', lang, { action }),
    });
  }
  if (action !== 'tree' && action !== 'blob') {
    return err({
      code: 'NOT_GITHUB_URL',
      message: t('parseUnsupportedAction', lang),
    });
  }
  if (segments.length === 3) {
    return err({
      code: 'NOT_GITHUB_URL',
      message: t('parseMissingRef', lang),
    });
  }

  const targetType: 'tree' | 'blob' = action;
  const { ref, subpath, rawRefSegments, decodedSubpathParts } = parseRefAndSubpath(segments);
  const canonicalUrl = buildCanonicalUrl(
    owner,
    repo,
    targetType,
    rawRefSegments,
    decodedSubpathParts,
  );

  return ok({ owner, repo, ref, type: targetType, subpath, canonicalUrl });
};
