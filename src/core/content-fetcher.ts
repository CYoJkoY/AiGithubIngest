import type { FileMetadata, GitHubTarget, IngestFileResult, SupportedLang } from '../types';
import { RAW_FETCH_CONCURRENCY, RAW_FILE_SIZE_CAP_BYTES } from './constants';
import { encodeGitRef } from './github-http';
import { t } from './i18n';
import { logger } from './logger';

export interface RawFetchOptions {
  readonly token?: string;
  readonly maxBytes: number;
  readonly concurrency?: number;
  readonly lang?: SupportedLang;
  readonly signal?: AbortSignal;
  readonly onProgress?: (completed: number, total: number) => void;
}

export type RawFileStatus = 'ok' | 'truncated' | 'failed' | 'binary';

export interface FetchedRawFile {
  readonly result: IngestFileResult;
  readonly status: RawFileStatus;
}

export interface RawFetchResult {
  readonly files: readonly IngestFileResult[];
  readonly entries: readonly FetchedRawFile[];
  readonly failed: number;
  readonly truncated: number;
  readonly binary: number;
}

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });
const BINARY_SAMPLE_BYTES = 1024;

/** Build a raw.githubusercontent.com URL with every path segment encoded. */
export function buildRawUrl(target: GitHubTarget, path: string): string {
  const ref = encodeGitRef(target.ref);
  const encodedPath = path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://raw.githubusercontent.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/${ref}/${encodedPath}`;
}

function containsNullByte(bytes: Uint8Array): boolean {
  const length = Math.min(bytes.length, BINARY_SAMPLE_BYTES);
  for (let index = 0; index < length; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function resolveMaxBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return RAW_FILE_SIZE_CAP_BYTES;
  return Math.min(RAW_FILE_SIZE_CAP_BYTES, Math.floor(value));
}

function resolveConcurrency(value: number | undefined, total: number): number {
  const requested = value === undefined ? RAW_FETCH_CONCURRENCY : value;
  if (!Number.isFinite(requested) || requested <= 0) {
    return Math.min(RAW_FETCH_CONCURRENCY, total);
  }
  return Math.min(RAW_FETCH_CONCURRENCY, Math.max(1, Math.floor(requested)), total);
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Find the largest prefix that ends on a complete UTF-8 code point.
 * A trailing partial sequence is removed instead of decoded to U+FFFD.
 */
function completeUtf8End(bytes: Uint8Array, limit: number): number {
  let end = Math.min(bytes.length, Math.max(0, limit));
  if (end === 0) return 0;

  let leadIndex = end - 1;
  while (leadIndex > 0 && (bytes[leadIndex] & 0xc0) === 0x80) {
    leadIndex -= 1;
  }

  const lead = bytes[leadIndex];
  let expected = 1;
  if ((lead & 0xe0) === 0xc0) expected = 2;
  else if ((lead & 0xf0) === 0xe0) expected = 3;
  else if ((lead & 0xf8) === 0xf0) expected = 4;

  if (leadIndex + expected > end) {
    end = leadIndex;
  }
  return end;
}

function placeholder(path: string, reason: string, lang: SupportedLang): string {
  return `[${t('fetchFileFailedNote', lang)}: ${path}]\n${reason}`;
}

interface ReadCappedResult {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

async function collectStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  alreadyTruncated: boolean,
): Promise<ReadCappedResult> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = alreadyTruncated;

  try {
    while (total <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes + 1 - total;
      if (value.length > remaining) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    if (truncated) await reader.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(Math.min(total, maxBytes + 1));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.length) break;
    const slice = chunk.subarray(0, merged.length - offset);
    merged.set(slice, offset);
    offset += slice.length;
  }
  if (total > maxBytes) truncated = true;
  return { bytes: merged, truncated };
}

async function readCapped(
  response: Response,
  maxBytes: number,
  expectedSize: number,
): Promise<ReadCappedResult> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    const truncated = expectedSize > maxBytes || buffer.length > maxBytes;
    return { bytes: buffer.subarray(0, Math.min(buffer.length, maxBytes)), truncated };
  }
  return collectStream(response.body, maxBytes, expectedSize > maxBytes);
}

function failedEntry(
  path: string,
  size: number,
  reason: string,
  lang: SupportedLang,
): FetchedRawFile {
  return {
    result: { path, content: placeholder(path, reason, lang), size },
    status: 'failed',
  };
}

async function fetchOne(
  target: GitHubTarget,
  file: FileMetadata,
  options: RawFetchOptions,
): Promise<FetchedRawFile> {
  const lang = options.lang ?? 'zh-CN';
  const maxBytes = resolveMaxBytes(options.maxBytes);
  const url = buildRawUrl(target, file.path);

  try {
    const headers: Record<string, string> = {};
    if (options.token?.trim()) headers.Authorization = `Bearer ${options.token.trim()}`;
    const response = await fetch(url, { headers, signal: options.signal });
    if (!response.ok) {
      return failedEntry(file.path, file.size, `HTTP ${response.status}`, lang);
    }

    const declaredHeader = response.headers.get('content-length');
    const declared = declaredHeader === null ? Number.NaN : Number(declaredHeader);
    const expectedSize =
      declaredHeader !== null && Number.isFinite(declared) && declared >= 0
        ? declared
        : Math.max(file.size, 0);
    const { bytes, truncated } = await readCapped(response, maxBytes, expectedSize);
    if (containsNullByte(bytes)) {
      return {
        result: { path: file.path, content: t('fetchFileBinary', lang), size: expectedSize },
        status: 'binary',
      };
    }

    if (!truncated && bytes.length <= maxBytes) {
      return {
        result: { path: file.path, content: TEXT_DECODER.decode(bytes), size: bytes.length },
        status: 'ok',
      };
    }

    const end = completeUtf8End(bytes, maxBytes);
    const body = TEXT_DECODER.decode(bytes.subarray(0, end));
    return {
      result: {
        path: file.path,
        content: `${body}\n\n${t('fetchFileTruncated', lang, { path: file.path })}`,
        size: expectedSize,
      },
      status: 'truncated',
    };
  } catch (err) {
    if (isAbortError(err)) throw err;
    logger.warn('Raw fetch failed', file.path, err);
    const reason = err instanceof Error ? err.message : 'network error';
    return failedEntry(file.path, file.size, reason, lang);
  }
}

/** Fetch raw file bodies with bounded concurrency; failures become placeholders. */
export async function fetchRawFiles(
  target: GitHubTarget,
  files: readonly FileMetadata[],
  options: RawFetchOptions,
): Promise<RawFetchResult> {
  if (files.length === 0) {
    return { files: [], entries: [], failed: 0, truncated: 0, binary: 0 };
  }

  const entries: FetchedRawFile[] = new Array(files.length);
  let nextIndex = 0;
  let completed = 0;

  const workerCount = resolveConcurrency(options.concurrency, files.length);

  const runWorker = async (): Promise<void> => {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      entries[index] = await fetchOne(target, files[index], options);
      completed += 1;
      options.onProgress?.(completed, files.length);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  const counts: Record<RawFileStatus, number> = { ok: 0, truncated: 0, failed: 0, binary: 0 };
  const results: IngestFileResult[] = [];
  for (const entry of entries) {
    counts[entry.status] += 1;
    results.push(entry.result);
  }

  return {
    files: results,
    entries,
    failed: counts.failed,
    truncated: counts.truncated,
    binary: counts.binary,
  };
}
