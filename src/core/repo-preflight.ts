import type {
  FileMetadata,
  GitTreeItem,
  GitHubTarget,
  PreflightSnapshot,
  PreflightReport,
  SupportedLang,
} from '../types';
import { RAW_FILE_SIZE_CAP_BYTES } from './constants';
import { shouldIncludeFile } from './file-filter';
import { DomainError } from './errors';
import { encodeGitRef, readJson, requestGitHub } from './github-http';
import { t } from './i18n';
import { estimateTokensFromBytes, resolveIngestStrategy } from './strategy-engine';

const CONFIG_BASENAMES = new Set<string>([
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'cargo.toml',
  'go.mod',
  'build.zig',
  'pyproject.toml',
  'requirements.txt',
  'gemfile',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'cmakelists.txt',
  'makefile',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
]);

const ENTRYPOINT_BASENAMES = new Set<string>([
  'index.ts',
  'main.ts',
  'app.ts',
  'server.ts',
  'index.js',
  'main.js',
  'main.py',
  'app.py',
  'manage.py',
  'main.go',
  'main.rs',
  'lib.rs',
  'main.zig',
  'root.zig',
]);

export interface PreflightOptions {
  readonly token?: string;
  readonly lang?: SupportedLang;
  readonly includePatterns?: readonly string[];
  readonly excludePatterns?: readonly string[];
  readonly maxFileSizeKb?: number;
  readonly tokenBudgetWarningThreshold?: number;
}

interface TreePayload {
  readonly tree: readonly GitTreeItem[];
  readonly truncated: boolean;
}

function baseName(path: string): string {
  const parts = path.split('/');
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

function isConfigFile(path: string): boolean {
  const name = baseName(path);
  if (CONFIG_BASENAMES.has(name)) return true;
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path);
}

function isReadmeFile(path: string): boolean {
  return baseName(path).startsWith('readme');
}

function isEntrypoint(path: string): boolean {
  return ENTRYPOINT_BASENAMES.has(baseName(path));
}

/** Effective per-file content limit, never above the global 60 KB cap. */
export function resolveContentLimitBytes(maxFileSizeKb?: number): number {
  if (maxFileSizeKb === undefined || !Number.isFinite(maxFileSizeKb) || maxFileSizeKb <= 0) {
    return RAW_FILE_SIZE_CAP_BYTES;
  }
  return Math.min(RAW_FILE_SIZE_CAP_BYTES, Math.floor(maxFileSizeKb * 1024));
}

function isRepoPayload(value: unknown): value is { readonly default_branch?: unknown } {
  return typeof value === 'object' && value !== null;
}

function isTreeItem(value: unknown): value is GitTreeItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.path === 'string' &&
    (item.type === 'blob' || item.type === 'tree') &&
    typeof item.mode === 'string' &&
    typeof item.sha === 'string'
  );
}

function isTreeItemArray(value: unknown): value is readonly GitTreeItem[] {
  return Array.isArray(value) && value.every(isTreeItem);
}

function parseTreePayload(value: unknown, lang: SupportedLang): TreePayload {
  if (typeof value !== 'object' || value === null) {
    throw new DomainError('DOWNLOAD_FAILED', t('invalidApiResponse', lang));
  }
  const record = value as Record<string, unknown>;
  if (!isTreeItemArray(record.tree)) {
    throw new DomainError('DOWNLOAD_FAILED', t('invalidApiResponse', lang));
  }
  return { tree: record.tree, truncated: record.truncated === true };
}

/** Repository-relative scope without leading or trailing slashes. */
function toScopePath(subpath: string): string {
  return subpath.replace(/^\/+|\/+$/g, '');
}

/** Restrict metadata to the URL target: a whole repo, one directory, or one blob. */
function isWithinScope(path: string, target: GitHubTarget): boolean {
  const scope = toScopePath(target.subpath);
  if (scope === '') return true;
  if (target.type === 'blob') return path === scope;
  return path.startsWith(`${scope}/`);
}

/**
 * An explicitly targeted blob is the user's intent, so exclusion patterns must
 * not drop it. Size truncation still applies later through the content limit.
 */
function isExplicitBlob(path: string, target: GitHubTarget): boolean {
  return target.type === 'blob' && path === toScopePath(target.subpath);
}

export async function resolveDefaultBranch(
  owner: string,
  repo: string,
  options: PreflightOptions = {},
): Promise<string> {
  const lang = options.lang ?? 'zh-CN';
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const response = await requestGitHub(url, { token: options.token, lang });
  const payload = await readJson(response, lang);
  if (!isRepoPayload(payload)) {
    throw new DomainError('DOWNLOAD_FAILED', t('invalidApiResponse', lang));
  }
  const branch = payload.default_branch;
  if (typeof branch !== 'string' || branch.trim() === '') {
    throw new DomainError('DOWNLOAD_FAILED', t('invalidApiResponse', lang));
  }
  return branch;
}

async function fetchTree(
  target: GitHubTarget,
  options: PreflightOptions = {},
): Promise<TreePayload> {
  const lang = options.lang ?? 'zh-CN';
  const ref = encodeGitRef(target.ref);
  const url = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/git/trees/${ref}?recursive=1`;
  const response = await requestGitHub(url, { token: options.token, lang });
  return parseTreePayload(await readJson(response, lang), lang);
}

interface MetadataAccumulator {
  readonly files: FileMetadata[];
  readonly configs: string[];
  readonly entries: string[];
  readonly contentLimit: number;
}

function collectMetadata(
  tree: readonly GitTreeItem[],
  target: GitHubTarget,
  options: PreflightOptions,
): MetadataAccumulator {
  const contentLimit = resolveContentLimitBytes(options.maxFileSizeKb);
  const files: FileMetadata[] = [];
  const configs: string[] = [];
  const entries: string[] = [];

  for (const item of tree) {
    if (item.type !== 'blob') continue;
    if (!isWithinScope(item.path, target)) continue;
    const size = item.size ?? 0;
    const included =
      isExplicitBlob(item.path, target) ||
      shouldIncludeFile(
        item.path,
        size,
        Number.POSITIVE_INFINITY,
        options.includePatterns,
        options.excludePatterns,
      );
    if (!included) continue;

    const config = isConfigFile(item.path);
    files.push({
      path: item.path,
      size,
      isConfigFile: config,
      isReadme: isReadmeFile(item.path),
      truncated: size > contentLimit,
    });
    if (config) configs.push(item.path);
    if (isEntrypoint(item.path)) entries.push(item.path);
  }

  return { files, configs: configs.sort(), entries: entries.sort(), contentLimit };
}

function buildReport(
  target: GitHubTarget,
  tree: readonly GitTreeItem[],
  truncated: boolean,
  options: PreflightOptions,
): PreflightReport {
  const metadata = collectMetadata(tree, target, options);
  const totalBytes = metadata.files.reduce((sum, file) => sum + file.size, 0);
  const draft: PreflightReport = {
    target,
    totalBlobs: tree.filter((item) => item.type === 'blob').length,
    validFiles: metadata.files,
    estimatedTokens: estimateTokensFromBytes(totalBytes),
    recommendedStrategy: 'skeleton',
    stackConfigs: metadata.configs,
    entrypoints: metadata.entries,
    truncated,
  };
  return {
    ...draft,
    recommendedStrategy: resolveIngestStrategy(draft, {
      tokenBudgetWarningThreshold: options.tokenBudgetWarningThreshold,
    }),
  };
}

/** Run one metadata request (plus optional branch resolution) before content. */
export async function preflightRepository(
  target: GitHubTarget,
  options: PreflightOptions = {},
): Promise<PreflightReport> {
  const ref = target.ref || (await resolveDefaultBranch(target.owner, target.repo, options));
  const resolvedTarget: GitHubTarget = { ...target, ref };
  const tree = await fetchTree(resolvedTarget, options);
  return buildReport(resolvedTarget, tree.tree, tree.truncated, options);
}

/** Reduce a full report to the payload the content script needs. */
export function toPreflightSnapshot(report: PreflightReport): PreflightSnapshot {
  return {
    target: report.target,
    totalBlobs: report.totalBlobs,
    fileCount: report.validFiles.length,
    estimatedTokens: report.estimatedTokens,
    recommendedStrategy: report.recommendedStrategy,
    stackConfigs: report.stackConfigs,
    truncated: report.truncated,
  };
}
