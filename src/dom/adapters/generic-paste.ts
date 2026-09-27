import { SiteAdapter } from './types';
import { countAttachmentElements, sleep } from '../dom-utils';

export const genericPasteAdapter: SiteAdapter = {
  id: 'generic-paste',
  matches: () => true,
  attach: async (_file, ctx) => {
    const target =
      ctx.activeElement ||
      (document.querySelector(
        'textarea, [contenteditable="true"], [role="textbox"]',
      ) as HTMLElement | null);
    if (!target) return { success: false, method: 'paste' };

    const beforeCount = countAttachmentElements();

    try {
      target.focus();
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        configurable: true,
        get() {
          return ctx.dataTransfer;
        },
      });
      target.dispatchEvent(pasteEvent);
    } catch (err) {
      ctx.logger.warn('generic-paste dispatch failed', err);
      return { success: false, method: 'paste' };
    }

    const start = Date.now();
    while (Date.now() - start < 400) {
      await sleep(80);
      if (countAttachmentElements() > beforeCount) {
        return { success: true, method: 'paste' };
      }
    }
    return { success: false, method: 'paste' };
  },
};
