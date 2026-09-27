import { SiteAdapter } from './types';

export const genericDndAdapter: SiteAdapter = {
  id: 'generic-dnd',
  matches: () => true,
  attach: async (_file, ctx) => {
    const candidateTarget =
      ctx.activeElement?.closest('[class*="chat"]') ||
      ctx.activeElement?.closest('[class*="input"]') ||
      ctx.activeElement ||
      document.querySelector('[data-dropzone="true"]') ||
      document.querySelector('[class*="dropzone"]') ||
      document.querySelector('main');
    if (!candidateTarget) return { success: false, method: 'dnd' };

    try {
      const eventInit: DragEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: ctx.dataTransfer,
      };
      candidateTarget.dispatchEvent(new DragEvent('dragenter', eventInit));
      candidateTarget.dispatchEvent(new DragEvent('dragover', eventInit));
      candidateTarget.dispatchEvent(new DragEvent('drop', eventInit));
      return { success: false, method: 'dnd' };
    } catch {
      return { success: false, method: 'dnd' };
    }
  },
};
