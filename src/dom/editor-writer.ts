import { logger } from '../core/logger';

export interface SavedRange {
  start: number;
  end: number;
}

export class EditorWriter {
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

    try {
      if (typeof document.execCommand === 'function') {
        const ok = document.execCommand('insertText', false, text);
        if (ok && (container.textContent?.length ?? 0) > beforeLen) {
          return true;
        }
      }
    } catch (err) {
      logger.debug('insertIntoContentEditable: execCommand threw', err);
    }

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

    return (container.textContent?.length ?? 0) > beforeLen;
  }
}
