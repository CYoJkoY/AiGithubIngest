import { SiteAdapter } from './adapters/types';
import { doubaoAdapter } from './adapters/doubao';
import { qwenAdapter } from './adapters/qwen';
import { yuanbaoAdapter } from './adapters/yuanbao';
import { genericFileInputAdapter } from './adapters/generic-file-input';
import { genericDndAdapter } from './adapters/generic-dnd';
import { genericPasteAdapter } from './adapters/generic-paste';
import { genericUploadTriggerAdapter } from './adapters/generic-upload-trigger';
import { logger } from '../core/logger';
import { ADAPTER_TIMEOUT_MS } from '../core/constants';

/**
 * 适配器链（命中即返回，后面的不再执行）：
 *   1. 平台专属适配器（豆包 / 通义 / 元宝）
 *   2. 原生 <input type="file"> 挂载
 *   3. 合成 drag & drop
 *   4. 合成 paste（兜底：多数现代 AI 站点并不真正消费 ClipboardEvent 中的 File）
 *   5. 触发上传按钮 → 等待宿主自建 input → 挂载
 *
 * 第 5 项刻意放在最后：只有在所有「不点击任何 UI」的路径都失败后，
 * 才去主动点击页面上的上传按钮。这样可以最大程度减少对宿主 UI 的干扰，
 * 也避免在 dnd / paste 本就能成功的站点上多此一举。
 */
const adapters: readonly SiteAdapter[] = [
  doubaoAdapter,
  qwenAdapter,
  yuanbaoAdapter,
  genericFileInputAdapter,
  genericDndAdapter,
  genericPasteAdapter,
  genericUploadTriggerAdapter,
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

/**
 * 向 contenteditable 插入文本。
 *
 * 历史 bug（本次修复的核心）：
 *   之前实现为「先派发合成 beforeinput，若事件被 preventDefault 就 return true，
 *   否则再走 execCommand」。这在真实编辑器中是错误的：
 *
 *     const notCancelled = container.dispatchEvent(inputEvent);
 *     if (!notCancelled) return true;   // ← 被取消就认为「编辑器处理了」，直接返回成功
 *
 *   以 Quill（Gemini / 许多站点的编辑器内核）为例：它确实会监听 beforeinput
 *   并 preventDefault，但它对**合成事件**只做「取消掉，防止重复输入」的处理，
 *   并不会真的走自己的输入管线。于是 dispatchEvent 返回 false，
 *   函数提前 return true，而文本根本没被插入，execCommand 也永远不执行。
 *   最终现象就是：Toast 显示 fallback 已挂载，输入框里却什么都没有。
 *
 * 现在的策略：
 *   1. 优先走 document.execCommand('insertText')——在 Quill 1.x / 2.x、
 *      ProseMirror、Slate、Lexical 等主流编辑器里都有兼容层或原生支持，
 *      且是同步返回布尔值、可判定真实结果。
 *   2. execCommand 失败时，再派发合成 beforeinput 作为最后尝试。
 *   3. 用 textContent 长度变化做最终验证，避免再次出现「假装成功」。
 */
function insertIntoContentEditable(el: HTMLElement, text: string): boolean {
  const container = el.isContentEditable
    ? el
    : (el.closest("[contenteditable='true']") as HTMLElement | null);
  if (!container) return false;

  container.focus();

  const beforeLen = container.textContent?.length ?? 0;

  // 路径 1：execCommand（同步、可判定）
  try {
    if (typeof document.execCommand === 'function') {
      const ok = document.execCommand('insertText', false, text);
      if (ok) {
        const afterLen = container.textContent?.length ?? 0;
        if (afterLen > beforeLen) return true;
      }
    }
  } catch (err) {
    logger.debug('insertIntoContentEditable: execCommand threw', err);
  }

  // 路径 2：合成 beforeinput（仅当 execCommand 无效时使用）
  if (typeof InputEvent === 'function') {
    try {
      const inputEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      });
      container.dispatchEvent(inputEvent);
    } catch (err) {
      logger.debug('insertIntoContentEditable: beforeinput dispatch threw', err);
    }
  }

  const finalLen = container.textContent?.length ?? 0;
  return finalLen > beforeLen;
}
