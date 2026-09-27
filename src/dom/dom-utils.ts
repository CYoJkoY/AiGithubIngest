import type { Logger } from '../core/logger';

export const ATTACHMENT_SELECTORS = [
  'uploader-file-preview',
  '[class*="file-preview" i]',
  '[class*="attachment-preview" i]',
  '[class*="upload-chip" i]',
  '[class*="file-chip" i]',
  '[class*="uploaded-file" i]',
  '[class*="uploaded" i]',
] as const;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function countAttachmentElements(): number {
  return document.querySelectorAll(ATTACHMENT_SELECTORS.join(',')).length;
}

export function makeFileDataTransfer(file: File): DataTransfer {
  const dt = new DataTransfer();
  dt.items.add(file);
  try {
    dt.effectAllowed = 'all';
    dt.dropEffect = 'copy';
  } catch {
    // 部分浏览器环境对只读属性赋值会抛错，防御忽略
  }
  return dt;
}

export function safeClick(el: HTMLElement, logger: Logger, label = 'element'): void {
  try {
    el.click();
  } catch (err) {
    logger.warn(`safeClick failed on ${label}`, err);
  }
}

export function snapshotFileInputs(): Set<HTMLInputElement> {
  return new Set(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
}

export async function waitForNewFileInput(
  before: Set<HTMLInputElement>,
  timeoutMs: number,
  pollIntervalMs = 80,
  predicate?: (input: HTMLInputElement) => boolean,
): Promise<HTMLInputElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    for (const input of inputs) {
      if (input.disabled) continue;
      if (before.has(input)) continue;
      if (predicate && !predicate(input)) continue;
      return input;
    }
  }
  return null;
}

export function queryFileInputsDeep(root: ParentNode): HTMLInputElement[] {
  const results: HTMLInputElement[] = [];

  const walk = (node: ParentNode): void => {
    node.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((el) => {
      results.push(el);
    });

    node.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot);
    });
  };

  walk(root);
  return results;
}
