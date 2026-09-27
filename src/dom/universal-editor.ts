import { SiteAdapter } from './adapters/types';
import { doubaoAdapter } from './adapters/doubao';
import { qwenAdapter } from './adapters/qwen';
import { yuanbaoAdapter } from './adapters/yuanbao';
import { genericFileInputAdapter } from './adapters/generic-file-input';
import { genericPasteAdapter } from './adapters/generic-paste';
import { genericDndAdapter } from './adapters/generic-dnd';
import { logger } from '../core/logger';
import { ADAPTER_TIMEOUT_MS } from '../core/constants';

const adapters: SiteAdapter[] = [
  doubaoAdapter,
  qwenAdapter,
  yuanbaoAdapter,
  genericFileInputAdapter,
  genericPasteAdapter,
  genericDndAdapter,
];

export class UniversalEditor {
  private static lastUploadTime = 0;
  private static lastUploadKey = '';

  public static async attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): Promise<boolean> {
    const now = Date.now();
    const uploadKey = `${file.name}-${file.size}`;
    if (now - this.lastUploadTime < 1500 && this.lastUploadKey === uploadKey) {
      return true;
    }
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
        const result = await Promise.race([
          adapter.attach(file, { file, dataTransfer, activeElement: activeEl, logger }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Adapter timeout')), ADAPTER_TIMEOUT_MS),
          ),
        ]);
        if (result.success) return true;
      } catch (err) {
        logger.warn(`Adapter ${adapter.id} failed:`, err);
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
      const originalValue = activeEl.value;
      const start = savedRange
        ? Math.min(savedRange.start, originalValue.length)
        : (activeEl.selectionStart ?? originalValue.length);
      const end = savedRange
        ? Math.min(savedRange.end, originalValue.length)
        : (activeEl.selectionEnd ?? originalValue.length);

      const updatedValue = originalValue.slice(0, start) + text + originalValue.slice(end);
      const prototype =
        activeEl instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(activeEl, updatedValue);
      else activeEl.value = updatedValue;

      const newPos = start + text.length;
      try {
        activeEl.setSelectionRange(newPos, newPos);
      } catch {
        // 静默
      }
      activeEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      activeEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    }

    if (activeEl.isContentEditable || activeEl.closest("[contenteditable='true']")) {
      const container = activeEl.isContentEditable
        ? activeEl
        : (activeEl.closest("[contenteditable='true']") as HTMLElement);
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
    return false;
  }
}
