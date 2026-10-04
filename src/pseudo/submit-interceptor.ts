import type { PseudoFile, SupportedLang } from '../types';
import { logger } from '../core/logger';
import { EditorWriter } from '../dom/editor-writer';
import { replacePlaceholders, synthesizePayload } from './payload';
import type { PseudoFileManager } from './pseudo-file-manager';
import type { PseudoFileRenderer } from './pseudo-file-renderer';

/**
 * Transport layer for the pseudo-file engine.
 *
 * ## Plan B — capture-phase transient injection
 *
 * The content script runs in an isolated world, so `window.fetch` cannot be
 * patched from here (Plan A is out of reach without a MAIN-world injector and
 * the extra permissions it implies). Instead the payload is spliced into the
 * composer at the exact moment of submission:
 *
 *   1. A capture-phase `keydown` listener fires *before* the host's own
 *      bubble-phase handler, so the host reads an input that already contains
 *      the digest.
 *   2. The full text is appended (or an existing placeholder is expanded),
 *      then native `input`/`change` events are dispatched so React/Vue
 *      controlled components resync their state.
 *   3. Memory and card DOM are released immediately after the write.
 *
 * ## IME safety
 *
 * Chinese/Japanese input confirms candidates with Enter while `isComposing`
 * is true (and several Chromium hosts additionally report `keyCode === 229`).
 * Both signals are treated as "not a submission" — an IME confirmation must
 * never flush a digest.
 */

export type FlushSource = 'keyboard' | 'pointer' | 'manual';

/** Legacy IME composition keycode still emitted by some Chromium hosts. */
const IME_COMPOSITION_KEYCODE = 229;

/** Accessible-name fragments that identify a send/submit control. */
const SEND_CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  'input[type="submit"]',
  '[data-testid*="send" i]',
  '[aria-label*="send" i]',
].join(', ');

const SEND_NAME_PATTERN = /(send|submit|发送|送出|提交|运行|run\b)/i;

export interface SubmitInterceptorOptions {
  readonly lang: SupportedLang;
  /** Called after a successful flush; useful for toasts. */
  readonly onFlushed?: (info: { readonly count: number; readonly chars: number }) => void;
}

function readEditorText(editor: HTMLElement): string {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    return editor.value;
  }
  return editor.textContent ?? '';
}

/**
 * Select the whole contenteditable so an `insertText` replaces it.
 *
 * Equivalent to a "select all then retype" for the host editor, which keeps
 * the operation on the native undo stack instead of fighting it.
 */
function selectAllContents(editor: HTMLElement): void {
  if (typeof window.getSelection !== 'function') return;
  try {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch (err) {
    logger.debug('SubmitInterceptor.selectAllContents failed', err);
  }
}

function isSendControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(SEND_CONTROL_SELECTOR);
  if (!control) return false;
  if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
    if (control.disabled) return false;
  }
  if (control.getAttribute('type') === 'submit') return true;
  const name = (
    control.getAttribute('aria-label') ??
    control.getAttribute('title') ??
    control.textContent ??
    ''
  ).trim();
  return SEND_NAME_PATTERN.test(name);
}

export class SubmitInterceptor {
  private readonly manager: PseudoFileManager;
  private readonly renderer: PseudoFileRenderer;
  private readonly options: SubmitInterceptorOptions;
  private editor: HTMLElement | null = null;
  private attached = false;

  constructor(
    manager: PseudoFileManager,
    renderer: PseudoFileRenderer,
    options: SubmitInterceptorOptions,
  ) {
    this.manager = manager;
    this.renderer = renderer;
    this.options = options;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  get pending(): number {
    return this.manager.count;
  }

  /**
   * Bind the interceptor to a composer.
   *
   * Listeners live on `document` in the capture phase rather than on the
   * editor itself: SPA hosts routinely re-create the textarea, and a
   * document-level listener survives that swap.
   */
  attach(editor: HTMLElement | null): boolean {
    if (!editor) return false;
    this.editor = editor;
    if (this.attached) return true;

    document.addEventListener('keydown', this.handleKeyDown, true);
    document.addEventListener('pointerdown', this.handlePointerDown, true);
    this.attached = true;
    logger.debug('SubmitInterceptor attached to', editor.tagName);
    return true;
  }

  detach(): void {
    if (!this.attached) return;
    document.removeEventListener('keydown', this.handleKeyDown, true);
    document.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.attached = false;
    this.editor = null;
  }

  /**
   * Point the interceptor at a fresh composer without re-binding listeners.
   *
   * SPA hosts rebuild the textarea on navigation while the surrounding DOM —
   * and therefore the dock — survives. Rebinding keeps the payload reachable
   * from the new composer instead of flushing into a detached node.
   */
  rebind(editor: HTMLElement | null): boolean {
    if (!this.attached || !editor) return false;
    this.editor = editor;
    return true;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.manager.count === 0) return;
    if (!this.isSubmissionKey(event)) return;
    if (!this.isWithinEditor(event)) return;
    this.flush('keyboard');
  };

  private readonly handlePointerDown = (event: Event): void => {
    if (this.manager.count === 0) return;
    if (!isSendControl(event.target)) return;
    this.flush('pointer');
  };

  private isSubmissionKey(event: KeyboardEvent): boolean {
    if (event.key !== 'Enter') return false;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.isComposing) return false;
    return event.keyCode !== IME_COMPOSITION_KEYCODE;
  }

  private isWithinEditor(event: KeyboardEvent): boolean {
    const editor = this.editor;
    if (!editor) return false;
    const target = event.target;
    if (target instanceof Node && (target === editor || editor.contains(target))) return true;
    return document.activeElement === editor;
  }

  /**
   * Splice every pending file into the composer and release them.
   *
   * Idempotent: if the input already holds `__PSEUDO_FILE_<id>__` markers from
   * an interrupted attempt, they are expanded in place rather than duplicated.
   */
  flush(source: FlushSource = 'manual'): boolean {
    const editor = this.editor;
    const files = this.manager.list();
    if (files.length === 0) return false;
    if (!editor || !editor.isConnected) {
      logger.warn('SubmitInterceptor.flush: editor detached, payload retained');
      return false;
    }

    const current = readEditorText(editor);
    const expanded = replacePlaceholders(current, (id) => this.manager.get(id));
    const next = expanded !== current ? expanded : this.appendPayload(current, files);

    const written = this.writeToEditor(editor, next, current.length);

    if (!written) {
      logger.warn('SubmitInterceptor.flush: editor write failed, payload retained');
      return false;
    }

    // Garbage collection runs the instant the text is in the host's hands.
    this.renderer.clear();
    this.manager.clear();

    logger.debug('SubmitInterceptor flushed', files.length, 'file(s) via', source);
    this.options.onFlushed?.({ count: files.length, chars: next.length - current.length });
    return true;
  }

  private appendPayload(current: string, files: readonly PseudoFile[]): string {
    const preamble =
      this.options.lang === 'zh-CN'
        ? '以下是我粘贴的 GitHub 仓库代码摘要，请基于这些内容回答：'
        : 'Below is the GitHub repository digest I attached. Please answer based on it:';
    const payload = synthesizePayload(files, { preamble });
    return current.trim().length > 0 ? `${current}\n\n${payload}` : payload;
  }

  /**
   * Replace the composer's whole text with `next`.
   *
   * A wholesale replace (rather than an append) is what makes the flush
   * idempotent: placeholder expansion rewrites text that is already mid-box,
   * and the append path simply replaces the old value with old + payload.
   */
  private writeToEditor(editor: HTMLElement, next: string, currentLength: number): boolean {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      // Range [0, currentLength] == "replace everything", reusing the
      // native-setter + input/change dispatch that controlled inputs need.
      return EditorWriter.insertAtCursor(next, editor, { start: 0, end: currentLength });
    }
    if (editor.isContentEditable) {
      selectAllContents(editor);
      return EditorWriter.insertAtCursor(next, editor);
    }
    return false;
  }
}
