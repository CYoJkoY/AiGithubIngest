export interface IngestRequestPayload {
  readonly url: string;
  readonly maxFileSizeKb?: number;
  readonly pattern?: string;
}

export interface IngestResponsePayload {
  readonly digest: string;
  readonly tree?: string;
  readonly summary?: string;
  readonly error?: string;
}

export type IngestFailureReason =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "REPO_TOO_LARGE"
  | "INCOMPLETE_DIGEST"
  | "NETWORK_ERROR";

export interface IngestError {
  readonly reason: IngestFailureReason;
  readonly message: string;
  readonly statusCode?: number;
}
