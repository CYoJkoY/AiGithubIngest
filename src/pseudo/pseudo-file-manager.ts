import type { PseudoFile } from '../types';
import { estimateTokenCount } from '../core/token-estimator';
import { logger } from '../core/logger';
import { sanitizeFileName, utf8ByteLength } from './payload';

/**
 * Storage layer for the pseudo-file engine.
 *
 * The full text of every digest part lives here — in a plain `Map` on the heap
 * — and nowhere else. The DOM receives only the id/name/size/token metadata
 * that {@link PseudoFileRenderer} needs to draw a card.
 *
 * Every mutating entry point is guarded: empty payloads, absurd names, and
 * runaway totals are rejected before they can allocate.
 */

export type RegisterFailure = 'EMPTY_CONTENT' | 'INVALID_NAME' | 'FILE_LIMIT' | 'BYTE_LIMIT';

export type RegisterResult =
  | { readonly ok: true; readonly file: PseudoFile }
  | { readonly ok: false; readonly reason: RegisterFailure };

export interface PseudoFileManagerOptions {
  /** Maximum simultaneously registered files. */
  readonly maxFiles?: number;
  /** Maximum resident payload across all files (bytes). */
  readonly maxTotalBytes?: number;
  /** Injectable clock — keeps id generation deterministic under test. */
  readonly now?: () => number;
}

export const DEFAULT_MAX_PSEUDO_FILES = 12;
export const DEFAULT_MAX_TOTAL_BYTES = 24 * 1024 * 1024;

export class PseudoFileManager {
  private readonly files = new Map<string, PseudoFile>();
  private readonly maxFiles: number;
  private readonly maxTotalBytes: number;
  private readonly now: () => number;
  private sequence = 0;
  private bytes = 0;

  constructor(options: PseudoFileManagerOptions = {}) {
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_PSEUDO_FILES;
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
    this.now = options.now ?? (() => Date.now());
  }

  get count(): number {
    return this.files.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  get totalTokens(): number {
    let sum = 0;
    for (const file of this.files.values()) sum += file.tokenEstimate;
    return sum;
  }

  list(): readonly PseudoFile[] {
    return Array.from(this.files.values());
  }

  get(id: string): PseudoFile | undefined {
    if (!id) return undefined;
    return this.files.get(id);
  }

  has(id: string): boolean {
    return this.files.has(id);
  }

  /**
   * Register a payload and return its handle.
   *
   * Registration order is preserved, which matters because a split digest must
   * reach the model as part 1, part 2, … in sequence.
   */
  register(rawName: string, content: string): RegisterResult {
    if (typeof content !== 'string' || content.trim().length === 0) {
      return { ok: false, reason: 'EMPTY_CONTENT' };
    }

    const name = sanitizeFileName(rawName);
    if (name.length === 0) return { ok: false, reason: 'INVALID_NAME' };

    if (this.files.size >= this.maxFiles) {
      logger.warn('PseudoFileManager: file limit reached', this.maxFiles);
      return { ok: false, reason: 'FILE_LIMIT' };
    }

    const size = utf8ByteLength(content);
    if (this.bytes + size > this.maxTotalBytes) {
      logger.warn('PseudoFileManager: byte budget exceeded', this.bytes + size);
      return { ok: false, reason: 'BYTE_LIMIT' };
    }

    const file: PseudoFile = {
      id: this.nextId(),
      name,
      size,
      content,
      tokenEstimate: estimateTokenCount(content),
    };

    this.files.set(file.id, file);
    this.bytes += size;
    return { ok: true, file };
  }

  /** Drop one file and release its bytes immediately. */
  remove(id: string): boolean {
    const file = this.files.get(id);
    if (!file) return false;
    this.files.delete(id);
    this.bytes = Math.max(0, this.bytes - file.size);
    return true;
  }

  /** Garbage collect everything. Called the instant a submission is flushed. */
  clear(): void {
    this.files.clear();
    this.bytes = 0;
  }

  private nextId(): string {
    this.sequence += 1;
    const stamp = Math.floor(this.now()).toString(36);
    return `pf_${stamp}${this.sequence.toString(36)}`;
  }
}
