import { logger } from '../core/logger';

export interface SavedRange {
  start: number;
  end: number;
}

/** 超过此字符阈值即视为大文本，优先采用 Paste 管道以防止 execCommand 阻塞主线程 */
const LARGE_TEXT_THRESHOLD = 15_000;

export class EditorWriter {
  public static setEntireContent(text: string, targetElement?: EventTarget | null): boolean {
    const activeEl = (
      targetElement instanceof HTMLElement ? targetElement : document.activeElement
    ) as HTMLElement | null;
    if (!activeEl) return false;

    if (activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement) {
      return this.setFormFieldValue(activeEl, text);
    }

    if (activeEl.isContentEditable || activeEl.closest("[contenteditable='true']")) {
      return this.setContentEditableValue(activeEl, text);
    }
    return false;
  }

  public static insertAtCursor(
    text: string,
    targetElement?: EventTarget | null,
    savedRange?: SavedRange,
  ): boolean {
    const activeEl = (
      targetElement instanceof HTMLElement ? targetElement : document.activeElement
    ) as HTMLElement | null;
    if (!activeEl) return false;

    if (activeEl instanceof HTMLTextAreaElement || activeEl instanceof HTMLInputElement) {
      return this.insertIntoFormField(activeEl, text, savedRange);
    }

    if (activeEl.isContentEditable || activeEl.closest("[contenteditable='true']")) {
      return this.insertIntoContentEditable(activeEl, text);
    }
    return false;
  }

  private static setFormFieldValue(
    el: HTMLTextAreaElement | HTMLInputElement,
    text: string,
  ): boolean {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (nativeSetter) nativeSetter.call(el, text);
    else el.value = text;

    try {
      el.setSelectionRange(text.length, text.length);
    } catch (err) {
      logger.debug('setSelectionRange failed', err);
    }
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  private static setContentEditableValue(el: HTMLElement, text: string): boolean {
    const container = el.isContentEditable
      ? el
      : (el.closest("[contenteditable='true']") as HTMLElement | null);
    if (!container) return false;

    container.focus();
    this.selectAll(container);

    const isLargeText = text.length >= LARGE_TEXT_THRESHOLD;

    // 大文本优先使用 Paste 模拟（绕过 execCommand 导致的主线程撤销栈死锁）
    if (isLargeText) {
      if (this.tryPaste(container, text)) return true;
      if (this.tryExecCommand(container, text)) return true;
    } else {
      if (this.tryExecCommand(container, text)) return true;
      if (this.tryPaste(container, text)) return true;
    }

    if (this.tryDomFallback(container, text)) return true;
    return (container.textContent?.length ?? 0) > 0;
  }

  private static selectAll(container: HTMLElement): void {
    try {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(container);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (err) {
      logger.debug('setContentEditableValue: selectAll failed', err);
    }
  }

  private static tryExecCommand(container: HTMLElement, text: string): boolean {
    try {
      if (typeof document.execCommand === 'function') {
        const ok = document.execCommand('insertText', false, text);
        if (ok && container.textContent?.includes(text.slice(0, 30))) {
          return true;
        }
      }
    } catch (err) {
      logger.debug('tryExecCommand threw', err);
    }
    return false;
  }

  private static tryPaste(container: HTMLElement, text: string): boolean {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dt,
      });
      container.dispatchEvent(pasteEvt);
      if (container.textContent?.includes(text.slice(0, 30))) {
        return true;
      }
    } catch (err) {
      logger.debug('tryPaste threw', err);
    }
    return false;
  }

  private static tryDomFallback(container: HTMLElement, text: string): boolean {
    try {
      container.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      container.appendChild(p);
      container.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType: 'insertText',
          data: text,
        }),
      );
      container.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      container.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    } catch (err) {
      logger.debug('tryDomFallback threw', err);
    }
    return false;
  }

  private static insertIntoFormField(
    el: HTMLTextAreaElement | HTMLInputElement,
    text: string,
    savedRange?: SavedRange,
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
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
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

  private static insertIntoContentEditable(el: HTMLElement, text: string): boolean {
    const container = el.isContentEditable
      ? el
      : (el.closest("[contenteditable='true']") as HTMLElement | null);
    if (!container) return false;

    container.focus();
    const beforeLen = container.textContent?.length ?? 0;

    if (text.length >= LARGE_TEXT_THRESHOLD && this.tryPaste(container, text)) {
      return true;
    }

    if (this.tryExecCommand(container, text)) {
      return (container.textContent?.length ?? 0) > beforeLen;
    }

    return (container.textContent?.length ?? 0) > beforeLen;
  }
}
