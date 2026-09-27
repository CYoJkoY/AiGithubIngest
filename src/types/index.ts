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

export interface StorageSchema {
  readonly userWhitelist?: readonly string[];
  readonly userBlacklist?: readonly string[];
  readonly githubToken?: string;
  readonly lang?: SupportedLang;
}
