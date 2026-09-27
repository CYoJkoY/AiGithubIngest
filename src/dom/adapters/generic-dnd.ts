import { SiteAdapter } from './types';

/**
 * drop target 优先级：最内层优先。
 * 真实拖放时浏览器会逐层选 drop target，所以先尝试 ql-editor / rich-textarea
 * 这种最内层，再逐层向外退，最后兜底到 main。
 *
 * 注意：这里刻意不再收 `[class*="chat" i]` 这类极其宽泛的选择器。
 * 多命中一个候选就会多跑一整轮 dragenter → dragover → drop → dragend/dragleave，
 * 每一轮都会触发宿主的拖拽高亮/取消高亮 UI 更新，是肉眼可见闪烁的来源。
 */
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

/**
 * 每次派发事件都必须使用**全新**的 DataTransfer。
 * Chrome 会在事件回调结束后回收 dataTransfer.files，复用同一个实例会导致
 * 后续事件里 files 为空。
 */
function makeFileDataTransfer(file: File): DataTransfer {
  const dt = new DataTransfer();
  dt.items.add(file);
  try {
    dt.effectAllowed = 'all';
    dt.dropEffect = 'copy';
  } catch {
    /* 部分环境下 effectAllowed 只读，忽略 */
  }
  return dt;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/**
 * 一次完整的 drop 派发序列：dragenter → dragover ×2 → drop。
 *
 * 关键：这里**不再**在末尾派发 dragend / dragleave。
 * dragend / dragleave 会立刻清除宿主的拖放高亮态（例如 Gemini 的
 * `.xap-drag-in-progress`）。一旦我们自己先把高亮清掉，
 * 任何基于「高亮消失 = 消费成功」的弱信号判定就会立即假阳性，
 * 让未被消费的 drop 被误判为成功，并终止整条适配器链。
 *
 * dragend / dragleave 的派发被推迟到消费判定结束之后（见 finalizeDrag）。
 */
async function dispatchDropSequence(target: HTMLElement, file: File): Promise<void> {
  fireDragEvent('dragenter', target, file);
  await sleep(50);

  fireDragEvent('dragover', target, file);
  await sleep(50);
  fireDragEvent('dragover', target, file);
  await sleep(50);

  fireDragEvent('drop', target, file);
}

/**
 * drop 之后通知宿主退出拖放态。
 * 必须、且只允许在消费判定结束之后调用。
 */
function finalizeDrag(target: HTMLElement, file: File): void {
  try {
    fireDragEvent('dragend', target, file);
    fireDragEvent('dragleave', target, file);
  } catch {
    /* 清理阶段异常不应中断适配器链 */
  }
}

/** 统计页面上的附件预览节点数量（成功挂载后会 > 0） */
function countAttachments(): number {
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

/**
 * 等待宿主消费本次 drop。
 *
 * 只信任「强信号」：页面上出现新的附件预览节点。
 *
 * 历史教训（本次修复的核心）：
 *   之前曾启用过「弱信号」——「宿主清除 `.xap-drag-in-progress`
 *   高亮态即视为消费成功」。该信号不可靠：
 *     1. 我们自己 drop 序列末尾派发的 dragend / dragleave 就会清掉高亮，
 *        与宿主是否消费毫无关系。
 *     2. 在非 Gemini 站点上该高亮节点根本不存在，`!hasActiveDragState()`
 *        恒为 true，判定会在 80ms 内立即返回 true。
 *   结果就是：drop 未被消费也被判成成功，适配器链提前终止，
 *   导致真正该做兜底的 generic-paste / generic-upload-trigger
 *   永远得不到执行机会。
 */
async function waitForConsumption(
  beforeAttachmentCount: number,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(POLL_INTERVAL_MS);
    if (countAttachments() > beforeAttachmentCount) return true;
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

    const beforeCount = countAttachments();

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
        // 消费判定期间宿主仍处于拖拽高亮态，弱信号未被污染
        consumed = await waitForConsumption(beforeCount, PER_TARGET_WAIT_MS);
      }

      // 无论消费与否都通知宿主退出拖放态，避免高亮残留
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
