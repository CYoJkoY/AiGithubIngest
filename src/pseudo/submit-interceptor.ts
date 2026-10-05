import type { PseudoFile, SupportedLang } from '../types';
import { logger } from '../core/logger';
import { EditorWriter } from '../dom/editor-writer';
import { sleep } from '../dom/dom-utils';
import { replacePlaceholders, synthesizePayload } from './payload';
import { resolveActiveEditor } from '../content/policy-resolver';
import type { PseudoFileManager } from './pseudo-file-manager';
import type { PseudoFileRenderer } from './pseudo-file-renderer';

export type FlushSource = 'keyboard' | 'pointer' | 'manual';

const IME_COMPOSITION_KEYCODE = 229;
const SEND_NAME_PATTERN = /(send|submit|发送|送出|提交|运行|run|chat|prompt)/i;

/** 涵盖全球主流与国内大模型专属发送控件的高敏选择器矩阵 */
const SEND_CONTROL_SELECTORS: readonly string[] = [
  'button[data-testid*="send" i]',
  'button[aria-label*="send" i]',
  'button[aria-label*="发送"]',
  'button[title*="发送"]',
  'button[id*="send" i]',
  'button[class*="send" i]',
  'div[role="button"][aria-label*="发送"]',
  'div[role="button"][data-testid*="send" i]',
  'button[type="submit"]',
  'input[type="submit"]',
];

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

function isSendButtonElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest('.aigi-pseudo-dock')) return null;

  for (const sel of SEND_CONTROL_SELECTORS) {
    const hit = target.closest<HTMLElement>(sel);
    if (hit) {
      if (hit instanceof HTMLButtonElement && hit.disabled) return null;
      if (hit.getAttribute('aria-disabled') === 'true') return null;
      return hit;
    }
  }

  // 启发式：匹配文本或内嵌图标带 Arrow / Send 特征的按钮
  const btn = target.closest<HTMLElement>('button, [role="button"]');
  if (btn) {
    if (btn instanceof HTMLButtonElement && btn.disabled) return null;
    if (btn.getAttribute('aria-disabled') === 'true') return null;
    const desc = (
      btn.getAttribute('aria-label') ||
      btn.getAttribute('title') ||
      btn.textContent ||
      ''
    ).trim();
    if (SEND_NAME_PATTERN.test(desc)) return btn;

    // 检查是否有向上发射箭头 svg
    const hasSendSvg = btn.querySelector('svg path[d*="M"], svg[class*="send" i]');
    if (hasSendSvg && !desc.includes('取消') && !desc.includes('stop')) return btn;
  }

  return null;
}

export class SubmitInterceptor {
  private readonly manager: PseudoFileManager;
  private readonly renderer: PseudoFileRenderer;
  private readonly options: SubmitInterceptorOptions;
  private editor: HTMLElement | null = null;
  private attached = false;
  private isProcessing = false;

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
    this.editor = editor;
    if (this.attached) return true;

    // 在全局 capture 阶段最高优先级监听，防止宿主先发
    document.addEventListener('keydown', this.handleKeyDown, true);
    document.addEventListener('click', this.handleClick, true);
    this.attached = true;
    logger.debug('SubmitInterceptor securely attached');
    return true;
  }

  detach(): void {
    if (!this.attached) return;
    document.removeEventListener('keydown', this.handleKeyDown, true);
    document.removeEventListener('click', this.handleClick, true);
    this.attached = false;
    this.editor = null;
    this.isProcessing = false;
  }

  rebind(editor: HTMLElement | null): boolean {
    this.editor = editor;
    return true;
  }

  /**
   * 动态定位当下真正活跃的 Editor（消灭 DOM 替换漂移带来的脱节）
   */
  private resolveLiveEditor(eventTarget?: EventTarget | null): HTMLElement | null {
    if (eventTarget instanceof HTMLElement) {
      if (
        eventTarget instanceof HTMLTextAreaElement ||
        eventTarget instanceof HTMLInputElement ||
        eventTarget.isContentEditable
      ) {
        return eventTarget;
      }
      const closest = eventTarget.closest<HTMLElement>(
        'textarea, [contenteditable="true"], [role="textbox"]',
      );
      if (closest) return closest;
    }

    if (this.editor && this.editor.isConnected) {
      return this.editor;
    }

    return resolveActiveEditor(null);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.manager.count === 0 || this.isProcessing) return;
    if (!this.isSubmissionKey(event)) return;

    const liveEditor = this.resolveLiveEditor(event.target);
    if (!liveEditor) return;

    // 关键修正：确认为发送按键，必须无条件阻断原生半截逻辑
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    void this.executeAtomicSpliceAndSend(liveEditor, 'keyboard');
  };

  private readonly handleClick = (event: MouseEvent): void => {
    if (this.manager.count === 0 || this.isProcessing) return;
    const sendBtn = isSendButtonElement(event.target);
    if (!sendBtn) return;

    const liveEditor = this.resolveLiveEditor(null);
    if (!liveEditor) return;

    // 拦截原生提前读取，先拼后发
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    void this.executeAtomicSpliceAndSend(liveEditor, 'pointer', sendBtn);
  };

  private isSubmissionKey(event: KeyboardEvent): boolean {
    if (event.key !== 'Enter') return false;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.isComposing) return false;
    return event.keyCode !== IME_COMPOSITION_KEYCODE;
  }

  /**
   * 原子性拼接并直接触发发送（彻底打通卡顿与丢失的闭环）
   */
  private async executeAtomicSpliceAndSend(
    editor: HTMLElement,
    source: FlushSource,
    triggerButton?: HTMLElement,
  ): Promise<void> {
    this.isProcessing = true;
    try {
      const files = this.manager.list();
      if (files.length === 0) return;

      const current = readEditorText(editor);
      const expanded = replacePlaceholders(current, (id) => this.manager.get(id));
      const next = expanded !== current ? expanded : this.appendPayload(current, files);

      // 1. 无死锁更新输入框内容
      const written = EditorWriter.setEntireContent(next, editor);
      if (!written) {
        logger.error('EditorWriter failed to write composite payload');
        return;
      }

      // 2. 释放伪文件状态与卡片 DOM
      const count = files.length;
      const chars = next.length - current.length;
      this.renderer.clear();
      this.manager.clear();
      this.options.onFlushed?.({ count, chars });

      // 3. 让渡排版执行帧（给 React / Vue 状态机吸收 input 事件的时机）
      await sleep(60);

      // 4. 驱动真实发送动作
      const finalBtn = triggerButton || this.findSendButton(editor);
      if (finalBtn && !finalBtn.hasAttribute('disabled')) {
        finalBtn.click();
      } else {
        // 合成回车触发提交（此时输入框已完备，不会再被拦截器捕捉）
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

      logger.info(`Successfully dispatched pseudo payload (${count} parts) via ${source}`);
    } catch (err) {
      logger.error('executeAtomicSpliceAndSend encountered an error', err);
    } finally {
      this.isProcessing = false;
    }
  }

  private findSendButton(anchor: HTMLElement): HTMLElement | null {
    const scope =
      anchor.closest('form') ||
      anchor.closest('[class*="chat" i], [class*="composer" i], [class*="input" i]') ||
      document.body;

    const buttons = Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"]'));
    for (const btn of buttons) {
      if (isSendButtonElement(btn)) return btn;
    }
    return null;
  }

  private appendPayload(current: string, files: readonly PseudoFile[]): string {
    const preamble =
      this.options.lang === 'zh-CN'
        ? '以下是我粘贴的 GitHub 仓库代码摘要，请基于这些内容回答：'
        : 'Below is the GitHub repository digest I attached. Please answer based on it:';
    const payload = synthesizePayload(files, { preamble });
    return current.trim().length > 0 ? `${current}\n\n${payload}` : payload;
  }

  public flush(source: FlushSource = 'manual'): boolean {
    const liveEditor = this.resolveLiveEditor(null);
    if (!liveEditor) return false;
    void this.executeAtomicSpliceAndSend(liveEditor, source);
    return true;
  }

  public insertOnly(): boolean {
    const liveEditor = this.resolveLiveEditor(null);
    if (!liveEditor) return false;
    const files = this.manager.list();
    if (files.length === 0) return false;

    const current = readEditorText(liveEditor);
    const next = this.appendPayload(current, files);
    const ok = EditorWriter.setEntireContent(next, liveEditor);
    if (ok) {
      this.renderer.clear();
      this.manager.clear();
    }
    return ok;
  }
}
