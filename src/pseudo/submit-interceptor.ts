import type { PseudoFile, SupportedLang } from '../types';
import { logger } from '../core/logger';
import { EditorWriter } from '../dom/editor-writer';
import { sleep } from '../dom/dom-utils';
import { replacePlaceholders, synthesizePayload } from './payload';
import type { PseudoFileManager } from './pseudo-file-manager';
import type { PseudoFileRenderer } from './pseudo-file-renderer';

export type FlushSource = 'keyboard' | 'pointer' | 'manual';

const IME_COMPOSITION_KEYCODE = 229;
const SEND_NAME_PATTERN = /(send|submit|发送|送出|提交|运行|run\b)/i;

const SEND_CONTROL_SELECTOR = [
  'button',
  '[role="button"]',
  'input[type="submit"]',
  '[data-testid*="send" i]',
  '[aria-label*="send" i]',
].join(', ');

export interface SubmitInterceptorOptions {
  readonly lang: SupportedLang;
  readonly onFlushed?: (info: { readonly count: number; readonly chars: number }) => void;
}

function readEditorText(editor: HTMLElement): string {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    return editor.value;
  }
  return editor.textContent ?? '';
}

function isSendControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('.aigi-pseudo-dock')) return false;
  const control = target.closest(SEND_CONTROL_SELECTOR);
  if (!control) return false;
  if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) {
    if (control.disabled) return false;
  }
  if (control.getAttribute('aria-disabled') === 'true') return false;
  if (control.getAttribute('type') === 'submit') return true;
  const name = (
    control.getAttribute('aria-label') ??
    control.getAttribute('title') ??
    control.textContent ??
    ''
  ).trim();
  return SEND_NAME_PATTERN.test(name);
}

function findHostSendButton(anchor: HTMLElement | null): HTMLElement | null {
  const root =
    anchor?.closest('form') ||
    anchor?.closest('[class*="chat" i], [class*="composer" i], [class*="input" i]') ||
    document;

  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));
  for (const btn of buttons) {
    if (btn.closest('.aigi-pseudo-dock')) continue;
    if (isSendControl(btn)) return btn;
  }
  return null;
}

export class SubmitInterceptor {
  private readonly manager: PseudoFileManager;
  private readonly renderer: PseudoFileRenderer;
  private readonly options: SubmitInterceptorOptions;
  private editor: HTMLElement | null = null;
  private attached = false;
  private isFlushing = false;

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
    this.isFlushing = false;
  }

  rebind(editor: HTMLElement | null): boolean {
    if (!this.attached || !editor) return false;
    this.editor = editor;
    return true;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.manager.count === 0 || this.isFlushing) return;
    if (!this.isSubmissionKey(event)) return;
    if (!this.isWithinEditor(event)) return;

    // 关键：阻止 Enter 的原生默认换行行为，消除大文本下的二次强制排版死锁
    event.preventDefault();
    this.flush('keyboard');
  };

  private readonly handlePointerDown = (event: Event): void => {
    if (this.manager.count === 0 || this.isFlushing) return;
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

  public flush(source: FlushSource = 'manual'): boolean {
    if (this.isFlushing) return false;
    this.isFlushing = true;

    try {
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

      const written = EditorWriter.setEntireContent(next, editor);
      if (!written) {
        logger.warn('SubmitInterceptor.flush: editor write failed, payload retained');
        return false;
      }

      this.renderer.clear();
      this.manager.clear();

      logger.debug('SubmitInterceptor flushed', files.length, 'file(s) via', source);
      this.options.onFlushed?.({ count: files.length, chars: next.length - current.length });
      return true;
    } finally {
      this.isFlushing = false;
    }
  }

  public async flushAndSubmit(source: FlushSource = 'manual'): Promise<boolean> {
    const editor = this.editor;
    if (!this.flush(source)) return false;
    if (!editor || !editor.isConnected) return false;

    await sleep(80);

    const sendBtn = findHostSendButton(editor);
    if (
      sendBtn &&
      !sendBtn.hasAttribute('disabled') &&
      sendBtn.getAttribute('aria-disabled') !== 'true'
    ) {
      sendBtn.click();
    } else {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    return true;
  }

  public insertOnly(): boolean {
    const editor = this.editor;
    const files = this.manager.list();
    if (files.length === 0 || !editor || !editor.isConnected) return false;

    const current = readEditorText(editor);
    const next = this.appendPayload(current, files);
    const ok = EditorWriter.setEntireContent(next, editor);
    if (ok) {
      this.renderer.clear();
      this.manager.clear();
    }
    return ok;
  }

  private appendPayload(current: string, files: readonly PseudoFile[]): string {
    const preamble =
      this.options.lang === 'zh-CN'
        ? '以下是我粘贴的 GitHub 仓库代码摘要，请基于这些内容回答：'
        : 'Below is the GitHub repository digest I attached. Please answer based on it:';
    const payload = synthesizePayload(files, { preamble });
    return current.trim().length > 0 ? `${current}\n\n${payload}` : payload;
  }
}
