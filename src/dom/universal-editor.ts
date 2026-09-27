import { SiteAdapter } from './adapters/types';
import { doubaoAdapter } from './adapters/doubao';
import { qwenAdapter } from './adapters/qwen';
import { yuanbaoAdapter } from './adapters/yuanbao';
import { genericFileInputAdapter } from './adapters/generic-file-input';
import { genericPasteAdapter } from './adapters/generic-paste';
import { genericDndAdapter } from './adapters/generic-dnd';
import { logger } from '../core/logger';
import { ADAPTER_TIMEOUT_MS } from '../core/constants';

/**
 * 适配器链（命中即返回，后面的不再执行）：
 *   1. 平台专属适配器（豆包 / 通义 / 元宝）
 *   2. 原生 <input type="file"> 挂载
 *   3. 合成 drag & drop
 *   4. 合成 paste（兜底：多数现代 AI 站点并不真正消费 ClipboardEvent 中的 File，
 *      放在最后可避免它抢先触发一层多余的「粘贴中」UI 状态）
 */
const adapters: readonly SiteAdapter[] = [
  doubaoAdapter,
  qwenAdapter,
  yuanbaoAdapter,
  genericFileInputAdapter,
  genericDndAdapter,
  genericPasteAdapter,
];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Adapter timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = '';

  public static async attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): Promise<boolean> {
    const now = Date.now();
    const uploadKey = `${file.name}-${file.size}`;
    if (now - this.lastUploadTime < 1500 && this.lastUploadKey === uploadKey) return true;
    this.lastUploadTime = now;
    this.lastUploadKey = uploadKey;

    const activeEl = (
      targetElement instanceof HTMLElement ? targetElement : document.activeElement
    ) as HTMLElement | null;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const url = new URL(window.location.href);
    const host = url.hostname.toLowerCase();

    for (const adapter of adapters) {
      if (!adapter.matches(host, url)) continue;
      try {
        const result = await withTimeout(
          adapter.attach(file, { file, dataTransfer, activeElement: activeEl, logger }),
          ADAPTER_TIMEOUT_MS,
        );
        if (result.success) return true;
      } catch (err) {
        logger.warn(`Adapter ${adapter.id} failed`, err);
      }
    }
    return false;
  }

  public static insertAtCursor(
    text: string,
    targetElement?: EventTarget | null,
    savedRange?: { start: number; end: number },
  ): boolean {
    const activeEl = (
      targetElement instanceof HTMLElement ? targetElement : document.activeElement
    ) as HTMLElement | null;
    if (!activeEl) return false;

    if (activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement) {
      return insertIntoFormField(activeEl, text, savedRange);
    }

    if (activeEl.isContentEditable || activeEl.closest("[contenteditable='true']")) {
      return insertIntoContentEditable(activeEl, text);
    }
    return false;
  }
}

function insertIntoFormField(
  el: HTMLTextAreaElement | HTMLInputElement,
  text: string,
  savedRange?: { start: number; end: number },
): boolean {
  const originalValue = el.value;
  const start = savedRange
    ? Math.min(savedRange.start, originalValue.length)
    : (el.selectionStart ?? originalValue.length);
  const end = savedRange
    ? Math.min(savedRange.end, originalValue.length)
    : (el.selectionEnd ?? originalValue.length);

  const updated = originalValue.slice(0, start) + text + originalValue.slice(end);
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (nativeSetter) nativeSetter.call(el, updated);
  else el.value = updated;

  const newPos = start + text.length;
  try {
    el.setSelectionRange(newPos, newPos);
  } catch (err) {
    logger.debug('setSelectionRange failed', err);
  }
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  return true;
}

function insertIntoContentEditable(el: HTMLElement, text: string): boolean {
  const container = el.isContentEditable
    ? el
    : (el.closest("[contenteditable='true']") as HTMLElement);
  container.focus();

  if (typeof InputEvent === 'function') {
    const inputEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: text,
    });
    const notCancelled = container.dispatchEvent(inputEvent);
    if (!notCancelled) return true;
  }
  return document.execCommand('insertText', false, text);
}
