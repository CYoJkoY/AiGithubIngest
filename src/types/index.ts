export interface RepoTarget {
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  readonly type?: 'tree' | 'blob';
  readonly subpath?: string;
  readonly canonicalUrl: string;
}

export interface GitTreeItem {
  readonly path: string;
  readonly mode: string;
  readonly type: 'blob' | 'tree';
  readonly sha: string;
  readonly size?: number;
  readonly url?: string;
}

export interface IngestOptions {
  readonly token?: string;
  readonly maxFileSizeKb?: number;
  readonly includePatterns?: readonly string[];
  readonly excludePatterns?: readonly string[];
  readonly lang?: SupportedLang;
  readonly onProgress?: (msg: string, current: number, total: number) => void;
}

export interface IngestFileResult {
  readonly path: string;
  readonly content: string;
  readonly size: number;
}

export interface FileSystemNode {
  name: string;
  type: 'DIRECTORY' | 'FILE';
  path: string;
  size: number;
  fileCount: number;
  dirCount: number;
  children: FileSystemNode[];
}

export interface IngestSummary {
  readonly repoInfo: RepoTarget;
  readonly resolvedBranch: string;
  readonly treeVisual: string;
  readonly files: readonly IngestFileResult[];
  readonly formattedOutput: string;
  readonly estimatedTokens: string;
}

export interface ParseError {
  readonly code: 'EMPTY_INPUT' | 'NOT_GITHUB_URL';
  readonly message: string;
}

export type SitePolicyStatus =
  'ENABLED_BUILTIN' | 'ENABLED_WHITELIST' | 'DISABLED_BLACKLIST' | 'DISABLED';

export interface IngestSuccessPayload {
  readonly repoUrl: string;
  readonly content: string;
}

export type ExtensionMessage = {
  readonly type: 'INGEST_REPO';
  readonly payload: { readonly url: string };
};

export type ExtensionResponse =
  | { readonly success: true; readonly payload: IngestSummary }
  | {
      readonly success: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export type SupportedLang = 'zh-CN' | 'en';
export type ThemeMode = 'light' | 'dark';

/**
 * How a repository digest is handed to the host AI chat surface.
 *
 * - `real-file`   — build `File` objects and push them through the site's real
 *                   upload pipeline (file input / drop zone / paste adapter).
 * - `pseudo-file` — keep the text in memory, render a lightweight metadata
 *                   card, and splice the content into the prompt at submit
 *                   time. Nothing large ever enters the host DOM.
 */
export type DigestSendMode = 'real-file' | 'pseudo-file';

/**
 * A large text payload held outside the DOM.
 *
 * `content` is the single source of truth and is never written into the host
 * document until the moment of submission. The DOM only ever sees `id`,
 * `name`, `size`, and `tokenEstimate`.
 */
export interface PseudoFile {
  /** Unique handle, format `pf_[base36 timestamp][base36 counter]`. */
  readonly id: string;
  /** File name including extension; drives icon + syntax inference. */
  readonly name: string;
  /** Payload size in bytes (UTF-8). */
  readonly size: number;
  /** Full raw text. Resident in memory only — never injected into the DOM. */
  readonly content: string;
  /** Estimated token count for the payload. */
  readonly tokenEstimate: number;
}

export interface StorageSchema {
  readonly userWhitelist?: readonly string[];
  readonly userBlacklist?: readonly string[];
  readonly githubToken?: string;
  readonly lang?: SupportedLang;
  readonly theme?: ThemeMode;
  /** Per-hostname single-file limit (bytes). Keys are lowercase hostnames. */
  readonly siteFileSizeLimits?: Readonly<Record<string, number>>;
  /** Fallback single-file limit (bytes) for hostnames not present in {@link siteFileSizeLimits}. */
  readonly defaultFileSizeLimit?: number;
  /** How digests are delivered to the host chat surface. Defaults to `real-file`. */
  readonly digestSendMode?: DigestSendMode;
}
