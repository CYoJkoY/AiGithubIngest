import { SiteAdapter } from './types';

/**
 * 与 generic-dnd 保持一致的附件预览探测。
 * 派发合成 ClipboardEvent 后，如果宿主真的消费了其中的 File，
 * 页面上通常会很快出现附件预览节点。
 */
function countAttachmentNodes(): number {
  return document.querySelectorAll(
    [
      'uploader-file-preview',
      '[class*="file-preview" i]',
      '[class*="attachment-preview" i]',
      '[class*="upload-chip" i]',
      '[class*="file-chip" i]',
      '[class*="uploaded-file" i]',
    ].join(','),
  ).length;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

    const beforeCount = countAttachmentNodes();

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

    // 观察宿主是否真的消费了粘贴进来的文件。
    // 之前无条件返回 false，会在多数站点上白白触发一次「粘贴中」UI 状态，
    // 与后续 generic-dnd 的拖拽状态叠在一起就是肉眼可见的闪烁。
    const start = Date.now();
    while (Date.now() - start < 400) {
      await sleep(80);
      if (countAttachmentNodes() > beforeCount) {
        return { success: true, method: 'paste' };
      }
    }
    return { success: false, method: 'paste' };
  },
};
