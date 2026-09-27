import { SiteAdapter } from './types';
import { CLEANUP_DELAY_MS } from '../../core/constants';
import { mountFilesToInput } from './show-picker-guard';
import type { Logger } from '../../core/logger';

function isValidFileInput(input: HTMLInputElement, file: File): boolean {
  if (input.disabled) return false;
  const accept = input.accept?.trim();
  if (!accept) return true;

  const acceptLower = accept.toLowerCase();
  const isPureMedia =
    (acceptLower.includes('image/') ||
      acceptLower.includes('.jpg') ||
      acceptLower.includes('.png')) &&
    !acceptLower.includes('text') &&
    !acceptLower.includes('.txt') &&
    !acceptLower.includes('.doc') &&
    !acceptLower.includes('.pdf') &&
    !acceptLower.includes('*');
  if (isPureMedia) return false;

  const acceptPatterns = acceptLower
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (acceptPatterns.length === 0) return true;

  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  return acceptPatterns.some((pattern) => {
    if (pattern === '*/*' || pattern === '*') return true;
    if (
      pattern === '.txt' ||
      pattern === 'text/plain' ||
      pattern === '.md' ||
      pattern === '.markdown' ||
      pattern === 'text/markdown' ||
      pattern === '.doc' ||
      pattern === '.docx' ||
      pattern === '.pdf' ||
      pattern.includes('document')
    ) {
      return true;
    }
    if (pattern.startsWith('.')) return fileName.endsWith(pattern);
    if (pattern.endsWith('/*')) {
      const mimeCategory = pattern.slice(0, pattern.indexOf('/'));
      return fileType.startsWith(`${mimeCategory}/`) || mimeCategory === 'text';
    }
    return fileType === pattern;
  });
}

function cleanUpFileInput(fileInput: HTMLInputElement, logger: Logger): void {
  try {
    const emptyDT = new DataTransfer();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (descriptor?.set) descriptor.set.call(fileInput, emptyDT.files);
    else fileInput.files = emptyDT.files;
    fileInput.value = '';
    const tracker = (fileInput as unknown as { _valueTracker?: { setValue: (v: string) => void } })
      ._valueTracker;
    if (tracker) tracker.setValue('');
  } catch (err) {
    logger.debug('cleanUpFileInput failed', err);
  }
}

export const genericFileInputAdapter: SiteAdapter = {
  id: 'generic-file-input',
  matches: () => true,
  attach: async (file, ctx) => {
    const { dataTransfer, activeElement, logger } = ctx;
    const scopes = [
      activeElement?.closest('form'),
      activeElement?.closest('[class*="chat"]'),
      activeElement?.closest('[class*="input"]'),
      activeElement?.closest('[class*="editor"]'),
      activeElement?.closest('[class*="prompt"]'),
      activeElement?.closest('[role="presentation"]'),
      activeElement?.parentElement?.parentElement,
      document.querySelector('[role="main"]'),
      document.querySelector('main'),
      document.querySelector('#root'),
      document.querySelector('#app'),
      document.body,
    ].filter((scope): scope is Element => Boolean(scope));

    for (const scope of scopes) {
      const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      for (const input of inputs) {
        if (!isValidFileInput(input, file)) continue;
        if (mountFilesToInput(input, dataTransfer, logger)) {
          setTimeout(() => cleanUpFileInput(input, logger), CLEANUP_DELAY_MS);
          return { success: true, method: 'file-input' };
        }
      }
    }

    const globalInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    );
    for (const input of globalInputs) {
      if (!isValidFileInput(input, file)) continue;
      if (mountFilesToInput(input, dataTransfer, logger)) {
        setTimeout(() => cleanUpFileInput(input, logger), CLEANUP_DELAY_MS);
        return { success: true, method: 'file-input-global' };
      }
    }

    return { success: false, method: 'file-input' };
  },
};
