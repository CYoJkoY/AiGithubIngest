import { SiteAdapter } from './types';

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
      return { success: false, method: 'paste' };
    } catch {
      return { success: false, method: 'paste' };
    }
  },
};
