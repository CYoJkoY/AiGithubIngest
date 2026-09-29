import { unzipSync } from 'fflate';
import {
  IngestFileResult,
  IngestOptions,
  IngestSummary,
  RepoTarget,
  SupportedLang,
} from '../types';
import { extractGitHubRepo } from './parser';
import { GitHubEngine } from './github-engine';
import { shouldIncludeFile } from './file-filter';
import { TreeBuilder } from './tree-builder';
import { OutputFormatter } from './output-formatter';
import { formatTokenCount } from './token-estimator';
import { t } from './i18n';
import { DomainError } from './errors';

const SEPARATOR_LINE = '='.repeat(48);
const BINARY_PLACEHOLDER = '[Binary file]';

function isBinary(buffer: Uint8Array): boolean {
  const checkLen = Math.min(buffer.length, 1024);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

interface ExtractedFile {
  readonly path: string;
  readonly content: string;
  readonly size: number;
}

interface ExtractResult {
  readonly treeFiles: Array<{ path: string; size: number }>;
  readonly processedFiles: ExtractedFile[];
}

/** 从 zip 键中去除 rootPrefix，并过滤掉目录项 */
function toRelativePath(rawKey: string, rootPrefix: string): string | null {
  if (rootPrefix && !rawKey.startsWith(rootPrefix)) return null;
  const relative = rootPrefix ? rawKey.slice(rootPrefix.length) : rawKey;
  if (!relative || relative.endsWith('/')) return null;
  return relative;
}

/** 检查相对路径是否命中目标子路径（支持 tree/blob 语义） */
function matchesSubpath(relativePath: string, cleanSubpath: string, isBlob: boolean): boolean {
  if (!cleanSubpath) return true;
  if (isBlob) return relativePath === cleanSubpath;
  return relativePath.startsWith(`${cleanSubpath}/`);
}

function toProcessedFile(
  relativePath: string,
  data: Uint8Array,
  decoder: TextDecoder,
): ExtractedFile {
  const size = data.length;
  if (isBinary(data)) {
    return { path: relativePath, content: BINARY_PLACEHOLDER, size };
  }
  return { path: relativePath, content: decoder.decode(data), size };
}

function extractFilesFromZip(
  unzipped: Record<string, Uint8Array>,
  fileKeys: string[],
  target: RepoTarget,
  options: IngestOptions,
  lang: SupportedLang,
): ExtractResult {
  const sampleKey = fileKeys.find((k) => k.includes('/')) ?? fileKeys[0];
  const slashIdx = sampleKey.indexOf('/');
  const rootPrefix = slashIdx !== -1 ? sampleKey.slice(0, slashIdx + 1) : '';

  const cleanSubpath = target.subpath ? target.subpath.replace(/^\/+|\/+$/g, '') : '';
  const isBlob = target.type === 'blob' && cleanSubpath.length > 0;
  const maxBytes = (options.maxFileSizeKb ?? 100) * 1024;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  const treeFiles: Array<{ path: string; size: number }> = [];
  const processedFiles: ExtractedFile[] = [];

  for (const rawKey of fileKeys) {
    const relativePath = toRelativePath(rawKey, rootPrefix);
    if (!relativePath) continue;
    if (!matchesSubpath(relativePath, cleanSubpath, isBlob)) continue;

    const fileData = unzipped[rawKey];
    const fileSize = fileData.length;
    if (
      !shouldIncludeFile(
        relativePath,
        fileSize,
        maxBytes,
        options.includePatterns,
        options.excludePatterns,
      )
    ) {
      continue;
    }

    treeFiles.push({ path: relativePath, size: fileSize });
    processedFiles.push(toProcessedFile(relativePath, fileData, decoder));
  }

  if (processedFiles.length === 0) {
    throw new DomainError('NO_MATCHING_FILES', t('noMatchFiles', lang));
  }

  return { treeFiles, processedFiles };
}

function buildRawContentPart(files: readonly ExtractedFile[]): string {
  let out = '';
  for (const f of files) {
    out += `\n${SEPARATOR_LINE}\nFILE: ${f.path}\n${SEPARATOR_LINE}\n${f.content}\n`;
  }
  return out;
}

export async function ingestRepository(
  rawUrl: string,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const lang: SupportedLang = options.lang ?? 'zh-CN';

  const parseResult = extractGitHubRepo(rawUrl, lang);
  if (!parseResult.ok) {
    throw new DomainError('NOT_GITHUB_URL', parseResult.error.message);
  }

  const target = parseResult.value;
  options.onProgress?.(t('stepResolvingBranch', lang), 0, 100);
  const resolvedBranch = await GitHubEngine.resolveBranch(target, options.token, lang);

  options.onProgress?.(t('stepDownloadingZip', lang), 20, 100);
  const zipBuffer = await GitHubEngine.fetchZipball(target, resolvedBranch, options.token, lang);

  options.onProgress?.(t('stepUnpacking', lang), 60, 100);
  const unzipped = unzipSync(new Uint8Array(zipBuffer));
  const fileKeys = Object.keys(unzipped);

  if (fileKeys.length === 0) {
    throw new DomainError('EMPTY_ARCHIVE', t('emptyZipError', lang));
  }

  const { treeFiles, processedFiles } = extractFilesFromZip(
    unzipped,
    fileKeys,
    target,
    options,
    lang,
  );

  options.onProgress?.(t('stepBuildingTree', lang), 90, 100);

  const rootSlug = `${target.owner}-${target.repo}`;
  const fileTree = TreeBuilder.build(treeFiles, rootSlug);
  const treeVisual = TreeBuilder.renderAscii(fileTree);

  const rawContentPart = buildRawContentPart(processedFiles);
  const estimatedTokens = formatTokenCount(treeVisual + rawContentPart);
  const summaryPrefix = OutputFormatter.createSummaryPrefix(
    target,
    resolvedBranch,
    processedFiles.length,
    estimatedTokens,
  );
  const formattedOutput = OutputFormatter.buildFullDigest(
    summaryPrefix,
    treeVisual,
    processedFiles as readonly IngestFileResult[],
  );

  return {
    repoInfo: target,
    resolvedBranch,
    treeVisual,
    files: processedFiles,
    formattedOutput,
    estimatedTokens,
  };
}
