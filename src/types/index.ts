export interface RepoTarget {
  readonly owner: string;
  readonly repo: string;
  readonly ref?: string;
  readonly subpath?: string;
  readonly canonicalUrl: string;
}

export interface IngestFileResult {
  readonly path: string;
  readonly content: string;
  readonly size: number;
}

export interface IngestSummary {
  readonly repoInfo: RepoTarget;
  readonly resolvedBranch: string;
  readonly treeVisual: string;
  readonly files: readonly IngestFileResult[];
  readonly formattedOutput: string;
}

export type ExtensionMessage = {
  readonly type: "INGEST_REPO";
  readonly payload: { readonly url: string };
};

export type ExtensionResponse =
  | { readonly success: true; readonly payload: IngestSummary }
  | {
      readonly success: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export interface StorageSchema {
  readonly userWhitelist?: readonly string[];
  readonly githubToken?: string;
}
