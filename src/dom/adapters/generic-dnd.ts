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
  // Gemini 内层优先
  '.ql-editor[contenteditable="true"]',
  'rich-textarea',
  '[xapfileselectordropzone]',
  '.xap-uploader-dropzone',
  '[data-filedrop-id="chat-window-input-container"]',
  // 通用 dropzone 标记
  '[file-drop-zone]',
  '[data-dropzone="true"]',
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  '[class*="uploader" i]',
];

function collectDropTargets(activeElement: HTMLElement | null): HTMLElement[] {
  const targets: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  const add = (el: HTMLElement | null | undefined): void => {
    if (!el || seen.has(el)) return;
    // 可见性检查（防止命中到隐藏的备用 dropzone）
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

  // 最终兜底：只在没有命中任何更具体候选时才会被真正尝试
  add(document.querySelector<HTMLElement>('main'));
  return targets;
}

/**
 * 关键：每次派发事件都必须使用**全新**的 DataTransfer。
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
 * 关键修复点：
 * 这里**不再**在末尾派发 dragend / dragleave。
 * 原因是 dragend / dragleave 会立刻清除宿主的拖放高亮态（例如 Gemini 的
 * `.xap-drag-in-progress`），而这正是我们在消费判定里曾经想当作"弱信号"
 * 使用的东西。一旦我们自己先把高亮清掉，判定逻辑就会在 80ms 内返回 true，
 * 让未被消费的 drop 被误判为成功，并终止整条适配器链。
 *
 * 现在 dragend / dragleave 的派发被推迟到消费判定结束之后（见 finalizeDrag）。
 */
async function dispatchDropSequence(target: HTMLElement, file: File): Promise<void> {
  fireDragEvent('dragenter', target, file);
  await sleep(50);

  // 真实浏览器会连续派发多次 dragover，部分实现需要至少两次才进入 drop-ready
  fireDragEvent('dragover', target, file);
  await sleep(50);
  fireDragEvent('dragover', target, file);
  await sleep(50);

  fireDragEvent('drop', target, file);
}

/**
 * drop 之后通知宿主退出拖放态。
 *
 * 必须、且只允许在消费判定结束之后调用。
 * 无论判定结果如何都会调用，以保证页面上不会残留拖放高亮 / 拖放态。
 */
function finalizeDrag(target: HTMLElement, file: File): void {
  try {
    fireDragEvent('dragend', target, file);
    fireDragEvent('dragleave', target, file);
  } catch {
    /* 清理阶段的异常不应向上抛出，避免中断适配器链 */
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
 * 只信任「强信号」：页面上出现新的附件预览节点（数量严格大于 beforeCount）。
 *
 * 历史教训（这也是本次修复的核心）：
 *   之前曾额外启用过一个「弱信号」——「宿主清除 `.xap-drag-in-progress`
 *   高亮态即视为消费成功」。但这个信号不可靠，原因有二：
 *     1. 我们自己的 drop 序列末尾派发的 dragend / dragleave 就会清掉高亮，
 *        与宿主是否消费毫无关系。
 *     2. 在非 Gemini 站点上该高亮节点根本不存在，`!hasActiveDragState()`
 *        恒为 true，waitForConsumption 会在 80ms 内立即返回 true。
 *   结果就是：drop 未被消费时也被判成成功，适配器链提前终止，
 *   导致真正该做兜底的 generic-paste 适配器永远得不到执行机会。
 *
 * 现在彻底移除了弱信号。判定失败就干净地返回 false，
 * 把机会让给链上后续的适配器。
 */
async function waitForConsumption(
  beforeAttachmentCount: number,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(80);
    if (countAttachments() > beforeAttachmentCount) return true;
  }
  return false;
}

/** 单个 target 尝试窗口（80ms 轮询粒度 ≈ 5 次检查） */
const PER_TARGET_WAIT_MS = 400;

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
      // 派发阶段：异常只影响当前 target，不影响后续 target
      try {
        await dispatchDropSequence(target, file);
      } catch (err) {
        logger.warn('generic-dnd: dispatch failed on', target.tagName, err);
        finalizeDrag(target, file);
        continue;
      }

      // 消费判定阶段：此时宿主仍处于拖放高亮态，判定信号未被污染
      const consumed = await waitForConsumption(beforeCount, PER_TARGET_WAIT_MS);

      // 无论消费与否，都通知宿主退出拖放态，避免 UI 残留
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
