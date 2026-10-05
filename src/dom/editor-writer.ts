import { logger } from '../core/logger';

export interface SavedRange {
  start: number;
  end: number;
}

/** 超过此字符阈值严禁走 execCommand，直接使用原子性快照注入以防撤销栈死锁 */
const LARGE_TEXT_THRESHOLD = 8_000;

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
      return this.setContentEditableValue(activeEl, text);
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

    // 触发 React/Vue/原生框架监听
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

    // 针对大型代码摘要（超出阈值），彻底规避 execCommand 与合成 paste
    // 直接采用最底层的 DOM 文本节点快速置换，阻止主线程 Undo 栈挂起
    if (text.length >= LARGE_TEXT_THRESHOLD) {
      return this.tryFastDomReplacement(container, text);
    }

    if (this.tryExecCommand(container, text)) return true;
    if (this.tryPaste(container, text)) return true;
    return this.tryFastDomReplacement(container, text);
  }

  private static tryFastDomReplacement(container: HTMLElement, text: string): boolean {
    try {
      container.innerHTML = '';
      const fragment = document.createDocumentFragment();
      const p = document.createElement('p');
      p.textContent = text;
      fragment.appendChild(p);
      container.appendChild(fragment);

      // 调度合成 Input 事件通知富文本框架（如 ProseMirror / Lexical）
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
      logger.error('tryFastDomReplacement failed', err);
      return false;
    }
  }

  private static tryExecCommand(container: HTMLElement, text: string): boolean {
    try {
      this.selectAll(container);
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
      this.selectAll(container);
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
      logger.debug('selectAll failed', err);
    }
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
    return this.setFormFieldValue(el, updated);
  }
}
