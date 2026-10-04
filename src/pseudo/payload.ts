import type { PseudoFile } from '../types';

/**
 * Payload synthesis for the pseudo-file engine.
 *
 * This module is pure: no DOM, no storage, no network. Everything here is
 * unit-testable in a node environment and is the only place that knows how a
 * `PseudoFile` becomes text inside a prompt.
 */

/** Placeholder envelope used by the transport layer: `__PSEUDO_FILE_<id>__`. */
export const PSEUDO_PLACEHOLDER_PREFIX = '__PSEUDO_FILE_';
export const PSEUDO_PLACEHOLDER_SUFFIX = '__';

/** Global regex; remember to reset `lastIndex` or use `String.replace`. */
export const PSEUDO_PLACEHOLDER_PATTERN = /__PSEUDO_FILE_([A-Za-z0-9_-]+)__/g;

/**
 * Fallback token estimate.
 *
 * The pseudo-file spec proposes `Math.ceil(length / 3.8)`. The repository
 * already ships a closer heuristic in `core/token-estimator`, so that one wins
 * (local system beats raw external inspiration); this constant is retained
 * only as the documented fallback for environments where the heuristic
 * regex is unavailable.
 */
export const TOKEN_BYTES_PER_TOKEN_FALLBACK = 3.8;

/** Upper bound for a synthesized payload, guarding against runaway prompts. */
export const MAX_PAYLOAD_CHARS = 300_000;

const UTF8_ENCODER = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return UTF8_ENCODER.encode(text).length;
}

export function buildPlaceholder(id: string): string {
  return `${PSEUDO_PLACEHOLDER_PREFIX}${id}${PSEUDO_PLACEHOLDER_SUFFIX}`;
}

/** Wrap one payload in an XML-ish file block the model can parse unambiguously. */
export function wrapFileBlock(name: string, content: string): string {
  return `<file name="${escapeAttribute(name)}">\n${content}\n</file>`;
}

/** Minimal XML attribute escaping — prevents a crafted name from breaking the block. */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SynthesisOptions {
  /** Leading text inserted above the first file block. */
  readonly preamble?: string;
  /** Hard cap on returned characters. `0` disables truncation. */
  readonly maxChars?: number;
}

/**
 * Concatenate every registered file into one submission payload.
 *
 * Every part is wrapped in a named `<file>` block so a multi-part digest stays
 * self-describing after it is flattened into a single text message.
 */
export function synthesizePayload(
  files: readonly PseudoFile[],
  options: SynthesisOptions = {},
): string {
  if (files.length === 0) return '';

  const maxChars = options.maxChars ?? MAX_PAYLOAD_CHARS;
  const segments: string[] = [];
  if (options.preamble) segments.push(options.preamble);

  let total = options.preamble ? options.preamble.length : 0;

  for (const file of files) {
    const block = wrapFileBlock(file.name, file.content);
    if (maxChars > 0 && total + block.length > maxChars) {
      const tail = truncateBlock(file, maxChars - total);
      // A zero budget must not leave a dangling separator behind.
      if (tail.length > 0) segments.push(tail);
      break;
    }
    segments.push(block);
    total += block.length;
  }

  return segments.join('\n\n');
}

/** Last-resort truncation when the assembled payload would exceed the cap. */
function truncateBlock(file: PseudoFile, budget: number): string {
  if (budget <= 0) return '';
  const header = `<file name="${escapeAttribute(file.name)}" truncated="true">\n`;
  const footer = '\n</file>';
  const available = budget - header.length - footer.length;
  if (available <= 0) return header.slice(0, Math.max(0, budget)) + footer;
  return `${header}${file.content.slice(0, available)}${footer}`;
}

export type PlaceholderResolver = (id: string) => PseudoFile | undefined;

/**
 * Expand any `__PSEUDO_FILE_<id>__` placeholders already sitting in `input`.
 *
 * This makes flushing idempotent: if a previous submit attempt left a
 * placeholder behind (host re-render, interrupted send, user undo), a second
 * flush rewrites it in place instead of appending a duplicate copy.
 */
export function replacePlaceholders(input: string, resolve: PlaceholderResolver): string {
  if (!input || !input.includes(PSEUDO_PLACEHOLDER_PREFIX)) return input;
  return input.replace(PSEUDO_PLACEHOLDER_PATTERN, (match, id: string) => {
    const file = resolve(id);
    return file ? wrapFileBlock(file.name, file.content) : match;
  });
}

/** Human-readable size, e.g. `18.4 KB` / `2.31 MB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

/** Compact token readout, e.g. `12.4k`. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(Math.round(tokens));
}

/**
 * Sanitize a file name coming from the network or the clipboard.
 *
 * Strips path separators, control characters, and XML-hostile markup so the
 * value can be shown in the DOM and embedded in a `<file name="...">` block
 * without becoming an injection vector.
 */
export function sanitizeFileName(rawName: string): string {
  const stripped = rawName
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(/[<>"'`]/g, '')
    .trim();
  const collapsed = stripped.replace(/\s+/g, ' ');
  if (collapsed.length === 0) return 'digest.md';
  if (collapsed.length > 96) return collapsed.slice(0, 96);
  return collapsed;
}
