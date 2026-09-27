import { SiteAdapter } from './types';
import { mountFilesToInput } from './show-picker-guard';

export const doubaoAdapter: SiteAdapter = {
  id: 'doubao',
  matches: (host) => host.includes('doubao.com'),
  attach: async (_file, ctx) => {
    const { dataTransfer, logger } = ctx;

    const directInput = document.querySelector<HTMLInputElement>(
      'input[data-testid="upload-file-input"], input[type="file"]',
    );
    if (directInput) {
      if (mountFilesToInput(directInput, dataTransfer, logger)) {
        return { success: true, method: 'doubao-direct' };
      }
    }

    const attachBtn = document.querySelector<HTMLElement>(
      'button[data-testid="upload_file_button"]',
    );
    if (!attachBtn) return { success: false, method: 'doubao' };

    try {
      attachBtn.click();
    } catch (err) {
      logger.warn('doubao attach click failed', err);
      return { success: false, method: 'doubao' };
    }

    await new Promise((r) => setTimeout(r, 200));

    const newInput = document.querySelector<HTMLInputElement>(
      'input[data-testid="upload-file-input"], input[type="file"]',
    );
    if (newInput && mountFilesToInput(newInput, dataTransfer, logger)) {
      return { success: true, method: 'doubao-menu' };
    }
    return { success: false, method: 'doubao' };
  },
};
