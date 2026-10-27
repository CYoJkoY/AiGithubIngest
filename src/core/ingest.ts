import type {
  FileMetadata,
  GitHubTarget,
  IngestFileResult,
  IngestOptions,
  IngestStrategyType,
  IngestSummary,
  PreflightReport,
  SupportedLang,
} from '../types';
import { RAW_FILE_SIZE_CAP_BYTES } from './constants';
import { fetchRawFiles } from './content-fetcher';
import { DomainError } from './errors';
import { t } from './i18n';
import { OutputFormatter } from './output-formatter';
import {
  preflightRepository,
  resolveContentLimitBytes,
  toPreflightSnapshot,
} from './repo-preflight';
import {
  isSkeletonTruncated,
  selectSkeletonPaths,
  skeletonFetchPaths,
  synthesizeSkeleton,
} from './skeleton-synthesizer';
import { estimateTokensFromBytes, resolveIngestStrategy } from './strategy-engine';
import { formatTokenCount } from './token-estimator';
import { TreeBuilder } from './tree-builder';
import { classifyGitHubUrl, toRepoTarget } from './url-parser';

/** Normalize a repository-relative override to `/a/b` form. */
export function normalizeSubpath(value: string, lang: SupportedLang = 'zh-CN'): string {
  const segments = value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new DomainError('NOT_GITHUB_URL', t('parseUnsafePath', lang));
  }
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

/**
 * Apply the user's subpath override.
 *
 * A blob URL names one file, so its scope is never widened or moved. Every
 * other target adopts the override before preflight narrows the metadata; the
 * value is repository-relative, so it replaces any path the URL carried.
 */
export function withSubpathOverride(
  target: GitHubTarget,
  override: string | undefined,
  lang: SupportedLang = 'zh-CN',
): GitHubTarget {
  if (override === undefined) return target;
  if (target.type === 'blob') return target;
  const subpath = normalizeSubpath(override, lang);
  if (subpath === '/') return target;
  return { ...target, subpath, type: 'subpath' };
}

function renderTree(report: PreflightReport): string {
  const rootSlug = `${report.target.owner}-${report.target.repo}`;
  const inputs = report.validFiles.map((file) => ({ path: file.path, size: file.size }));
  return TreeBuilder.renderAscii(TreeBuilder.build(inputs, rootSlug));
}

function joinBodies(files: readonly IngestFileResult[]): string {
  return files.map((file) => file.content).join('\n');
}

/** Metadata rows the skeleton needs bodies for: README, configs, entrypoints. */
function subsetForSkeleton(report: PreflightReport): readonly FileMetadata[] {
  const wanted = new Set(skeletonFetchPaths(selectSkeletonPaths(report)));
  return report.validFiles.filter((file) => wanted.has(file.path));
}

interface BodyFetch {
  readonly files: readonly IngestFileResult[];
  readonly truncated: boolean;
  /** Metadata rows dropped because a forced full digest exceeded its budget. */
  readonly omitted: number;
}

/**
 * Fetch bodies for the selected strategy.
 *
 * A forced full digest is budgeted on metadata before downloading, so files
 * outside the token ceiling are never fetched. Every other path fetches the
 * full scope, or the skeleton subset, as before.
 */
async function fetchBodies(
  report: PreflightReport,
  strategy: IngestStrategyType,
  options: IngestOptions,
  lang: SupportedLang,
): Promise<BodyFetch> {
  const contentLimit = resolveContentLimitBytes(options.maxFileSizeKb);
  const budgeted =
    options.forceStrategy === 'full' && strategy === 'full'
      ? applyTokenBudget(report.validFiles, options.maxTokenBudget, contentLimit)
      : { files: report.validFiles, omitted: 0 };
  const requested = strategy === 'skeleton' ? subsetForSkeleton(report) : budgeted.files;
  if (requested.length === 0) {
    return { files: [], truncated: false, omitted: budgeted.omitted };
  }

  const result = await fetchRawFiles(report.target, requested, {
    token: options.token,
    maxBytes: contentLimit,
    lang,
    onProgress: (completed, total) => {
      options.onProgress?.(t('stepFetchingFiles', lang), completed, total);
    },
  });
  return { files: result.files, truncated: result.truncated > 0, omitted: budgeted.omitted };
}

interface BudgetSlice {
  readonly files: readonly FileMetadata[];
  readonly omitted: number;
}

/**
 * Keep files in path order until the next one would cross the token budget.
 * Each file is costed at its resolved content limit, which is the most it can
 * contribute after fetching.
 */
function applyTokenBudget(
  files: readonly FileMetadata[],
  maxTokenBudget: number | undefined,
  contentLimit: number,
): BudgetSlice {
  if (maxTokenBudget === undefined || !Number.isFinite(maxTokenBudget) || maxTokenBudget <= 0) {
    return { files, omitted: 0 };
  }
  const kept: FileMetadata[] = [];
  let bytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const cost = Math.min(Math.max(0, files[index].size), contentLimit);
    const nextBytes = bytes + cost;
    if (estimateTokensFromBytes(nextBytes) > maxTokenBudget) {
      return { files: kept, omitted: files.length - index };
    }
    kept.push(files[index]);
    bytes = nextBytes;
  }
  return { files: kept, omitted: 0 };
}

interface DigestResult {
  readonly files: readonly IngestFileResult[];
  readonly formattedOutput: string;
  readonly estimatedTokens: string;
  readonly truncated: boolean;
  readonly omitted: number;
  /** ASCII tree reused by both the digest and the UI so it renders once. */
  readonly treeVisual: string;
}

function buildSkeletonDigest(
  report: PreflightReport,
  files: readonly IngestFileResult[],
  treeVisual: string,
  lang: SupportedLang,
): DigestResult {
  const formattedOutput = synthesizeSkeleton({ report, files, treeVisual, lang });
  return {
    files,
    formattedOutput,
    estimatedTokens: formatTokenCount(formattedOutput),
    truncated: isSkeletonTruncated(report, files),
    omitted: 0,
    treeVisual,
  };
}

interface TreeDigestInput {
  readonly report: PreflightReport;
  readonly files: readonly IngestFileResult[];
  readonly treeVisual: string;
  readonly omitted: number;
  readonly lang: SupportedLang;
}

function buildTreeDigest(input: TreeDigestInput): DigestResult {
  const { report, files, treeVisual, omitted, lang } = input;
  const estimatedTokens = formatTokenCount(treeVisual + joinBodies(files));
  const prefix = OutputFormatter.createSummaryPrefix(
    toRepoTarget(report.target),
    report.target.ref,
    files.length,
    estimatedTokens,
  );
  let formattedOutput = OutputFormatter.buildFullDigest(prefix, treeVisual, files);
  if (omitted > 0) {
    formattedOutput += `\n${t('forcedFullOmittedNote', lang, { count: omitted })}\n`;
  }
  return {
    files,
    formattedOutput,
    estimatedTokens,
    truncated: omitted > 0,
    omitted,
    treeVisual,
  };
}

function buildDigest(
  report: PreflightReport,
  files: readonly IngestFileResult[],
  strategy: IngestStrategyType,
  omitted: number,
  lang: SupportedLang,
): DigestResult {
  const treeVisual = renderTree(report);
  if (strategy === 'skeleton') {
    return buildSkeletonDigest(report, files, treeVisual, lang);
  }
  return buildTreeDigest({ report, files, treeVisual, omitted, lang });
}

function assertStrategyScope(
  report: PreflightReport,
  strategy: IngestStrategyType,
  lang: SupportedLang,
): void {
  if (strategy === 'single' && report.target.type !== 'blob') {
    throw new DomainError('SINGLE_REQUIRES_BLOB', t('singleRequiresBlob', lang));
  }
}

export async function ingestRepository(
  rawUrl: string,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const lang: SupportedLang = options.lang ?? 'zh-CN';
  const classified = classifyGitHubUrl(rawUrl, lang);
  if (!classified.ok) {
    throw new DomainError('NOT_GITHUB_URL', classified.error.message);
  }

  const target = withSubpathOverride(classified.value, options.subpath, lang);
  if (options.forceStrategy === 'single' && target.type !== 'blob') {
    throw new DomainError('SINGLE_REQUIRES_BLOB', t('singleRequiresBlob', lang));
  }

  options.onProgress?.(t('stepPreflight', lang), 0, 100);
  const report = await preflightRepository(target, {
    token: options.token,
    lang,
    includePatterns: options.includePatterns,
    excludePatterns: options.excludePatterns,
    maxFileSizeKb: options.maxFileSizeKb,
    tokenBudgetWarningThreshold: options.tokenBudgetWarningThreshold,
  });
  if (report.validFiles.length === 0) {
    throw new DomainError('NO_MATCHING_FILES', t('noMatchFiles', lang));
  }

  const strategy = resolveIngestStrategy(report, {
    forceStrategy: options.forceStrategy,
    tokenBudgetWarningThreshold: options.tokenBudgetWarningThreshold,
  });
  assertStrategyScope(report, strategy, lang);

  const bodies = await fetchBodies(report, strategy, options, lang);
  options.onProgress?.(t('stepBuildingTree', lang), 95, 100);
  if (strategy === 'skeleton') options.onProgress?.(t('stepSynthesizing', lang), 98, 100);

  const digest = buildDigest(report, bodies.files, strategy, bodies.omitted, lang);
  return {
    repoInfo: toRepoTarget(report.target),
    resolvedBranch: report.target.ref,
    treeVisual: digest.treeVisual,
    files: digest.files,
    formattedOutput: digest.formattedOutput,
    estimatedTokens: digest.estimatedTokens,
    strategy,
    truncated: report.truncated || bodies.truncated || digest.truncated,
    preflight: toPreflightSnapshot(report),
    omittedFiles: digest.omitted > 0 ? digest.omitted : undefined,
  };
}

/** Exposed for tests: the fixed byte cap used when no override is supplied. */
export const DEFAULT_CONTENT_LIMIT_BYTES = RAW_FILE_SIZE_CAP_BYTES;
