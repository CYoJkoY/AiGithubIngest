import type { GitHubTarget, IngestFileResult, PreflightReport, SupportedLang } from '../types';
import {
  SKELETON_CONFIG_LIMIT,
  SKELETON_ENTRY_EXCERPT_CHARS,
  SKELETON_ENTRY_LIMIT,
  SKELETON_INDEX_LIMIT,
} from './constants';
import { t } from './i18n';

export interface SkeletonSynthesisOptions {
  readonly report: PreflightReport;
  readonly files: readonly IngestFileResult[];
  readonly treeVisual: string;
  readonly lang: SupportedLang;
}

export interface SkeletonPaths {
  readonly readme?: string;
  readonly configs: readonly string[];
  readonly entrypoints: readonly string[];
  readonly index: readonly string[];
}

const CONFIG_LANGUAGES: Readonly<Record<string, string>> = {
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  gradle: 'groovy',
  kts: 'kotlin',
  zig: 'zig',
  mod: 'go',
  txt: 'text',
  makefile: 'makefile',
  dockerfile: 'dockerfile',
  md: 'markdown',
};

const ENTRYPOINT_LANGUAGES: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  py: 'python',
  go: 'go',
  rs: 'rust',
  zig: 'zig',
};

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Segment count, so a root config outranks an equally named nested one. */
function depthOf(path: string): number {
  return path.split('/').filter((segment) => segment !== '').length;
}

function uniqueSorted(paths: readonly string[]): readonly string[] {
  const unique = new Set(paths);
  return Array.from(unique).sort(comparePaths);
}

function baseName(path: string): string {
  const parts = path.split('/');
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

function resolveConfigLanguage(path: string): string {
  const name = baseName(path);
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  return CONFIG_LANGUAGES[extensionOf(name)] ?? 'text';
}

function resolveEntrypointLanguage(path: string): string {
  const name = baseName(path);
  return ENTRYPOINT_LANGUAGES[extensionOf(name)] ?? 'text';
}

/** Choose the README, configs, entrypoints, and capped index for a skeleton. */
export function selectSkeletonPaths(report: PreflightReport): SkeletonPaths {
  const sorted = [...report.validFiles].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const readme = sorted.find((file) => file.isReadme)?.path;
  const candidates = uniqueSorted(
    report.validFiles.filter((file) => file.isConfigFile).map((file) => file.path),
  );
  const shallowFirst = [...candidates].sort(
    (a, b) => depthOf(a) - depthOf(b) || comparePaths(a, b),
  );
  const configs = uniqueSorted(shallowFirst.slice(0, SKELETON_CONFIG_LIMIT));
  const entrypoints = uniqueSorted(report.entrypoints).slice(0, SKELETON_ENTRY_LIMIT);
  return {
    readme,
    configs,
    entrypoints,
    index: sorted.map((file) => file.path).slice(0, SKELETON_INDEX_LIMIT),
  };
}

/** Paths that must be fetched for a skeleton digest, deduplicated. */
export function skeletonFetchPaths(paths: SkeletonPaths): readonly string[] {
  const requested: string[] = [];
  if (paths.readme) requested.push(paths.readme);
  requested.push(...paths.configs, ...paths.entrypoints);
  return uniqueSorted(requested);
}

/** Distinct config paths, the same population {@link selectSkeletonPaths} caps. */
function countConfigCandidates(report: PreflightReport): number {
  const paths = new Set<string>();
  for (const file of report.validFiles) {
    if (file.isConfigFile) paths.add(file.path);
  }
  return paths.size;
}

/**
 * True when the skeleton omits content: the file index is capped or an
 * entrypoint body is trimmed to its excerpt limit.
 */
export function isSkeletonTruncated(
  report: PreflightReport,
  files: readonly IngestFileResult[],
): boolean {
  if (report.validFiles.length > SKELETON_INDEX_LIMIT) return true;
  if (countConfigCandidates(report) > SKELETON_CONFIG_LIMIT) return true;

  const bodies = new Map<string, number>();
  for (const file of files) bodies.set(file.path, file.content.length);
  const entrypoints = selectSkeletonPaths(report).entrypoints;
  return entrypoints.some((path) => (bodies.get(path) ?? 0) > SKELETON_ENTRY_EXCERPT_CHARS);
}

function buildExampleUrl(target: GitHubTarget): string {
  const base = `https://github.com/${target.owner}/${target.repo}`;
  const scope = target.subpath === '/' ? '' : target.subpath;
  if (target.type === 'blob') return `${base}/blob/${target.ref}${scope}`;
  return `${base}/tree/${target.ref}${scope}`;
}

function longestBacktickRun(content: string): number {
  let longest = 0;
  let run = 0;
  for (const char of content) {
    if (char === '`') {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

function fenceFor(content: string): string {
  return '`'.repeat(Math.max(3, longestBacktickRun(content) + 1));
}

function fencedBlock(content: string, language: string): string {
  const fence = fenceFor(content);
  if (content.length === 0) return `${fence}${language}\n${fence}`;
  return `${fence}${language}\n${content}\n${fence}`;
}

function safeExcerpt(content: string, maxChars: number): { text: string; length: number } {
  if (content.length <= maxChars) return { text: content, length: content.length };
  let end = maxChars;
  if (end > 0) {
    const code = content.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return { text: content.slice(0, end), length: end };
}

function missingBody(path: string, lang: SupportedLang): string {
  return `[${t('fetchFileFailedNote', lang)}: \`${path}\`]`;
}

function indexBody(paths: SkeletonPaths, totalFiles: number, lang: SupportedLang): string {
  const lines = paths.index.map((path) => path);
  if (totalFiles > paths.index.length) {
    lines.push(
      '',
      t('skeletonIndexLimited', lang, {
        shown: paths.index.length,
        total: totalFiles,
      }),
    );
  }
  return lines.join('\n');
}

function buildConfigSection(
  paths: SkeletonPaths,
  bodies: ReadonlyMap<string, string>,
  lang: SupportedLang,
): string[] {
  if (paths.configs.length === 0) return [t('skeletonNoConfig', lang)];

  const lines: string[] = [];
  for (const path of paths.configs) {
    lines.push(`### File: \`${path}\``);
    lines.push(
      fencedBlock(bodies.get(path) ?? missingBody(path, lang), resolveConfigLanguage(path)),
    );
    lines.push('');
  }
  return lines;
}

function buildEntrypointSection(
  paths: SkeletonPaths,
  bodies: ReadonlyMap<string, string>,
  lang: SupportedLang,
): string[] {
  if (paths.entrypoints.length === 0) return [t('skeletonNoEntrypoint', lang)];

  const lines: string[] = [];
  for (const path of paths.entrypoints) {
    lines.push(`### Entrypoint: \`${path}\``);
    const body = bodies.get(path) ?? missingBody(path, lang);
    const excerpt = safeExcerpt(body, SKELETON_ENTRY_EXCERPT_CHARS);
    lines.push(fencedBlock(excerpt.text, resolveEntrypointLanguage(path)));
    if (excerpt.length < body.length) {
      lines.push('');
      lines.push(t('skeletonEntrypointExcerpt', lang, { chars: excerpt.length }));
    }
    lines.push('');
  }
  return lines;
}

function buildReadmeSection(
  paths: SkeletonPaths,
  bodies: ReadonlyMap<string, string>,
  lang: SupportedLang,
): string[] {
  if (!paths.readme) return [t('skeletonNoReadme', lang)];
  const body = bodies.get(paths.readme);
  return [body && body.length > 0 ? body : missingBody(paths.readme, lang)];
}

/** Compose the four-section architecture skeleton without throwing. */
export function synthesizeSkeleton(options: SkeletonSynthesisOptions): string {
  const { report, files, treeVisual, lang } = options;
  const paths = selectSkeletonPaths(report);
  const bodies = new Map<string, string>();
  for (const file of files) bodies.set(file.path, file.content);

  const note = t('skeletonIngestNote', lang, {
    files: report.validFiles.length,
    tokens: report.estimatedTokens.toLocaleString('en-US'),
    example: buildExampleUrl(report.target),
  });

  const lines: string[] = [];
  lines.push(`# Repository Analysis: ${report.target.owner}/${report.target.repo}`);
  lines.push(`> **Ingest Note**: ${note}`);
  lines.push('');
  lines.push('## 1. Directory Tree');
  lines.push(fencedBlock(treeVisual.trimEnd(), 'text'));
  lines.push('');
  lines.push('## 2. Project Specification & Dependencies');
  lines.push(...buildConfigSection(paths, bodies, lang));
  lines.push(...buildEntrypointSection(paths, bodies, lang));
  lines.push('');
  lines.push('## 3. Readme');
  lines.push(...buildReadmeSection(paths, bodies, lang));
  lines.push('');
  lines.push('## 4. File Index');
  lines.push(fencedBlock(indexBody(paths, report.validFiles.length, lang), 'text'));
  lines.push('');

  return lines.join('\n');
}
