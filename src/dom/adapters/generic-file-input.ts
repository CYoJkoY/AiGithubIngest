import { SiteAdapter, AdapterContext, AdapterResult } from './types';
import { CLEANUP_DELAY_MS } from '../../core/constants';

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

function mountFileToInput(input: HTMLInputElement, dataTransfer: DataTransfer): void {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (descriptor?.set) {
      descriptor.set.call(input, dataTransfer.files);
    } else {
      input.files = dataTransfer.files;
    }
    const tracker = (input as unknown as { _valueTracker?: { setValue: (val: string) => void } })
      ._valueTracker;
    if (tracker) tracker.setValue('');
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    setTimeout(() => cleanUpFileInput(input), CLEANUP_DELAY_MS);
  } catch {
    // 容错
  }
}

function cleanUpFileInput(fileInput: HTMLInputElement): void {
  try {
    const emptyDT = new DataTransfer();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (descriptor?.set) {
      descriptor.set.call(fileInput, emptyDT.files);
    } else {
      fileInput.files = emptyDT.files;
    }
    fileInput.value = '';
    const tracker = (
      fileInput as unknown as { _valueTracker?: { setValue: (val: string) => void } }
    )._valueTracker;
    if (tracker) tracker.setValue('');
  } catch {
    // 容错
  }
}

export const genericFileInputAdapter: SiteAdapter = {
  id: 'generic-file-input',
  matches: () => true,
  attach: async (file, ctx) => {
    const { dataTransfer, activeElement } = ctx;
    const searchScopes = [
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

    for (const scope of searchScopes) {
      const fileInputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="file"]'));
      for (const fileInput of fileInputs) {
        if (!isValidFileInput(fileInput, file)) continue;
        mountFileToInput(fileInput, dataTransfer);
        return { success: true, method: 'file-input' };
      }
    }

    const globalInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    );
    for (const fileInput of globalInputs) {
      if (!isValidFileInput(fileInput, file)) continue;
      mountFileToInput(fileInput, dataTransfer);
      return { success: true, method: 'file-input-global' };
    }

    return { success: false, method: 'file-input' };
  },
};
