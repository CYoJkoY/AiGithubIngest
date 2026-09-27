import { SiteAdapter } from './types';
import { mountFilesToInput } from './show-picker-guard';
import { safeClick, snapshotFileInputs, waitForNewFileInput } from '../dom-utils';

const NEW_INPUT_TIMEOUT_MS = 800;
const DOUBAO_INPUT_SELECTOR = 'input[data-testid="upload-file-input"]';
const DOUBAO_TRIGGER_SELECTOR = 'button[data-testid="upload_file_button"]';

function findDoubaoInput(): HTMLInputElement | null {
  const input = document.querySelector<HTMLInputElement>(DOUBAO_INPUT_SELECTOR);
  if (!input || input.disabled) return null;
  return input;
}

function findDoubaoTrigger(): HTMLElement | null {
  const btn = document.querySelector<HTMLElement>(DOUBAO_TRIGGER_SELECTOR);
  if (!btn || btn.hasAttribute('disabled')) return null;
  return btn;
}

export const doubaoAdapter: SiteAdapter = {
  id: 'doubao',
  matches: (host) => host.includes('doubao.com'),

  attach: async (_file, ctx) => {
    const { dataTransfer, logger } = ctx;

    const attachBtn = findDoubaoTrigger();
    if (attachBtn) {
      const before = snapshotFileInputs();
      safeClick(attachBtn, logger, 'doubao-trigger');

      const newInput = await waitForNewFileInput(before, NEW_INPUT_TIMEOUT_MS, 80, (el) =>
        el.matches(DOUBAO_INPUT_SELECTOR),
      );
      if (newInput && mountFilesToInput(newInput, dataTransfer, logger)) {
        return { success: true, method: 'doubao-menu' };
      }
    }

    const existingInput = findDoubaoInput();
    if (existingInput && mountFilesToInput(existingInput, dataTransfer, logger)) {
      return { success: true, method: 'doubao-direct' };
    }

    logger.debug('doubao: gave up, falling through to generic adapters');
    return { success: false, method: 'doubao' };
  },
};
