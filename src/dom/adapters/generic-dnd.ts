import { SiteAdapter } from './types';
import { countAttachmentElements, makeFileDataTransfer, sleep } from '../dom-utils';

const DROP_TARGET_SELECTORS: readonly string[] = [
  '.ql-editor[contenteditable="true"]',
  'rich-textarea',
  '[xapfileselectordropzone]',
  '.xap-uploader-dropzone',
  '[data-filedrop-id="chat-window-input-container"]',
  '[file-drop-zone]',
  '[data-dropzone="true"]',
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  '[class*="uploader" i]',
];

const PER_TARGET_WAIT_MS = 300;
const POLL_INTERVAL_MS = 80;

function collectDropTargets(activeElement: HTMLElement | null): HTMLElement[] {
  const targets: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const add = (el: HTMLElement | null | undefined): void => {
    if (!el || seen.has(el)) return;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
    seen.add(el);
    targets.push(el);
  };

  for (const sel of DROP_TARGET_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach(add);
  }

  if (activeElement) {
    add(activeElement.closest<HTMLElement>('[contenteditable="true"]'));
    add(activeElement);
  }

  add(document.querySelector<HTMLElement>('main'));
  return targets;
}

function fireDragEvent(type: string, target: HTMLElement, file: File): DragEvent {
  const evt = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer: makeFileDataTransfer(file),
  });
  target.dispatchEvent(evt);
  return evt;
}

async function dispatchDropSequence(target: HTMLElement, file: File): Promise<void> {
  fireDragEvent('dragenter', target, file);
  await sleep(50);

  fireDragEvent('dragover', target, file);
  await sleep(50);
  fireDragEvent('dragover', target, file);
  await sleep(50);

  fireDragEvent('drop', target, file);
}

function finalizeDrag(target: HTMLElement, file: File): void {
  try {
    fireDragEvent('dragend', target, file);
    fireDragEvent('dragleave', target, file);
  } catch {
    // 忽略清理阶段事件异常
  }
}

async function waitForConsumption(
  beforeAttachmentCount: number,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(POLL_INTERVAL_MS);
    if (countAttachmentElements() > beforeAttachmentCount) return true;
  }
  return false;
}

export const genericDndAdapter: SiteAdapter = {
  id: 'generic-dnd',
  matches: () => true,
  attach: async (file, ctx) => {
    const { activeElement, logger } = ctx;
    const targets = collectDropTargets(activeElement);
    if (targets.length === 0) return { success: false, method: 'dnd' };

    const beforeCount = countAttachmentElements();

    logger.debug(
      'generic-dnd: candidate targets',
      targets.map((t) => t.tagName),
    );

    for (const target of targets) {
      let dispatched = false;
      try {
        await dispatchDropSequence(target, file);
        dispatched = true;
      } catch (err) {
        logger.warn('generic-dnd: dispatch failed on', target.tagName, err);
      }

      let consumed = false;
      if (dispatched) {
        consumed = await waitForConsumption(beforeCount, PER_TARGET_WAIT_MS);
      }

      finalizeDrag(target, file);

      if (consumed) {
        logger.debug('generic-dnd: consumed by', target.tagName);
        return { success: true, method: 'dnd' };
      }
      logger.debug('generic-dnd: not consumed by', target.tagName);
    }

    return { success: false, method: 'dnd' };
  },
};
