import { SiteAdapter } from './types';

/**
 * Drop target 优先级选择器：
 *  1) Gemini 的声明式 dropzone（xapfileselectordropzone / xap-uploader-dropzone）
 *  2) 常见通用 dropzone 标记
 *  3) file-drop-zone 属性
 * 顺序即优先级——外层容器放前面，事件会冒泡到内层监听器，所以先尝试最内层
 * 的 xapfileselectordropzone 更可靠。
 */
const DROP_TARGET_SELECTORS: readonly string[] = [
  '[xapfileselectordropzone]',
  '.xap-uploader-dropzone',
  '[file-drop-zone]',
  '[data-filedrop-id="chat-window-input-container"]',
  '[data-dropzone="true"]',
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  '[class*="uploader" i]',
];

/** 收集候选 drop target（去重、保持优先级、只保留可见元素） */
function collectDropTargets(activeElement: HTMLElement | null): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const push = (el: HTMLElement | null | undefined): void => {
    if (!el || seen.has(el)) return;
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
    seen.add(el);
  };
  const targets: HTMLElement[] = [];
  const add = (el: HTMLElement | null | undefined): void => {
    const before = seen.size;
    push(el);
    if (el && seen.size > before) targets.push(el);
  };

  for (const selector of DROP_TARGET_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach(add);
  }

  if (activeElement) {
    add(
      activeElement.closest<HTMLElement>(
        '[class*="chat" i], [class*="input" i], [class*="editor" i], main',
      ),
    );
  }

  add(document.querySelector<HTMLElement>('main'));
  return targets;
}

/**
 * 派发完整 drop 序列。要点：
 *  - dataTransfer.effectAllowed = 'all' 才能被部分框架识别为合法拖拽
 *  - dragover 必须 preventDefault，否则浏览器/框架认为该区域拒绝 drop
 *  - 事件间加 40ms 间隔，让 React/Angular 完成状态推进（dragenter → dragover → drop）
 */
async function dispatchDropSequence(
  target: HTMLElement,
  dataTransfer: DataTransfer,
): Promise<void> {
  try {
    dataTransfer.effectAllowed = 'all';
    dataTransfer.dropEffect = 'copy';
  } catch {
    /* Safari 对某些 DataTransfer 属性只读，静默忽略 */
  }

  const init: DragEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    dataTransfer,
  };

  const fire = (type: string): DragEvent => {
    const evt = new DragEvent(type, init);
    target.dispatchEvent(evt);
    return evt;
  };

  fire('dragenter');
  await new Promise<void>((r) => setTimeout(r, 40));

  const dragOverEvt = fire('dragover');
  if (!dragOverEvt.defaultPrevented) {
    dragOverEvt.preventDefault();
  }
  await new Promise<void>((r) => setTimeout(r, 40));

  fire('drop');
  fire('dragleave');
}

/**
 * drop 是否被前端框架消费？
 * 判断依据：drop 事件被 preventDefault（框架声明"我处理了"）
 *          或目标元素出现 drag-over 类（"我进入了激活态"）
 *          或 DOM 出现新的附件预览节点
 */
function snapshot(target: HTMLElement): string {
  const attachmentCount = document.querySelectorAll(
    'uploader-file-preview, [class*="file-preview" i], [class*="attachment" i], [class*="upload-chip" i]',
  ).length;
  return `${target.className}|${attachmentCount}`;
}

async function waitForDropConsumption(
  target: HTMLElement,
  before: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise<void>((r) => setTimeout(r, 80));
    if (snapshot(target) !== before) return true;
  }
  return false;
}

export const genericDndAdapter: SiteAdapter = {
  id: 'generic-dnd',
  matches: () => true,
  attach: async (_file, ctx) => {
    const { dataTransfer, activeElement, logger } = ctx;
    const targets = collectDropTargets(activeElement);

    for (const target of targets) {
      const before = snapshot(target);
      try {
        await dispatchDropSequence(target, dataTransfer);
      } catch (err) {
        logger.warn('generic-dnd: dispatch failed', err);
        continue;
      }
      const consumed = await waitForDropConsumption(target, before, 1200);
      if (consumed) {
        return { success: true, method: 'dnd' };
      }
    }

    return { success: false, method: 'dnd' };
  },
};
