export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface RepoTarget {
  readonly owner: string;
  readonly repo: string;
  readonly canonicalUrl: string;
}

export type ParseError =
  | { readonly code: "EMPTY_INPUT"; readonly message: string }
  | { readonly code: "NOT_GITHUB_URL"; readonly message: string };

export type IngestError =
  | { readonly code: "NETWORK_TIMEOUT"; readonly message: string }
  | { readonly code: "NETWORK_ERROR"; readonly message: string }
  | {
      readonly code: "HTTP_ERROR";
      readonly status: number;
      readonly message: string;
    }
  | { readonly code: "EMPTY_PAYLOAD"; readonly message: string };

export interface IngestSuccessPayload {
  readonly repoUrl: string;
  readonly content: string;
}

export type ExtensionMessage = {
  readonly type: "FETCH_GITINGEST";
  readonly payload: { readonly url: string };
};

export type ExtensionResponse =
  | { readonly success: true; readonly payload: IngestSuccessPayload }
  | { readonly success: false; readonly error: IngestError };

export type SitePolicyStatus =
  | "ENABLED_BUILTIN"
  | "ENABLED_WHITELIST"
  | "DISABLED";

export interface StorageSchema {
  readonly userWhitelist?: readonly string[];
}

export type SupportedEditor =
  | { readonly kind: "textarea"; readonly element: HTMLTextAreaElement }
  | { readonly kind: "contenteditable"; readonly element: HTMLElement };

export type ToastVariant = "info" | "success" | "error";
