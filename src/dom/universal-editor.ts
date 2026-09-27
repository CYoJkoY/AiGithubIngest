import { SiteAdapter } from './adapters/types';
import { doubaoAdapter } from './adapters/doubao';
import { qwenAdapter } from './adapters/qwen';
import { yuanbaoAdapter } from './adapters/yuanbao';
import { genericFileInputAdapter } from './adapters/generic-file-input';
import { genericUploadTriggerAdapter } from './adapters/generic-upload-trigger';
import { genericDndAdapter } from './adapters/generic-dnd';
import { genericPasteAdapter } from './adapters/generic-paste';
import { logger } from '../core/logger';
import { ADAPTER_TIMEOUT_MS } from '../core/constants';
import { EditorWriter, SavedRange } from './editor-writer';
import { makeFileDataTransfer } from './dom-utils';

const adapters: readonly SiteAdapter[] = [
  doubaoAdapter,
  qwenAdapter,
  yuanbaoAdapter,
  genericFileInputAdapter,
  genericUploadTriggerAdapter,
  genericDndAdapter,
  genericPasteAdapter,
];

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Adapter timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export class UniversalEditor {
  public static async attachVirtualFile(
    file: File,
    targetElement?: EventTarget | null,
  ): Promise<boolean> {
    const activeEl = (
      targetElement instanceof HTMLElement ? targetElement : document.activeElement
    ) as HTMLElement | null;
    const dataTransfer = makeFileDataTransfer(file);

    const url = new URL(window.location.href);
    const host = url.hostname.toLowerCase();

    for (const adapter of adapters) {
      if (!adapter.matches(host, url)) continue;
      try {
        const result = await withTimeout(
          adapter.attach(file, { file, dataTransfer, activeElement: activeEl, logger }),
          ADAPTER_TIMEOUT_MS,
        );
        if (result.success) return true;
      } catch (err) {
        logger.warn(`Adapter ${adapter.id} failed`, err);
      }
    }
    return false;
  }

  public static insertAtCursor(
    text: string,
    targetElement?: EventTarget | null,
    savedRange?: SavedRange,
  ): boolean {
    return EditorWriter.insertAtCursor(text, targetElement, savedRange);
  }
}
