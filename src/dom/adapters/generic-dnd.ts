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
 * 完整 drop 序列：dragenter → dragover(x2) → drop → dragend/dragleave。
 * 每次都用新鲜 DataTransfer。
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
  await sleep(100);

  // 清理：通知框架退出拖放态
  fireDragEvent('dragend', target, file);
  fireDragEvent('dragleave', target, file);
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
 * Gemini 消费 drop 后会移除 xap-drag-in-progress 类。
 * 这只是一个「弱信号」——只有在 Gemini 上下文里才有意义。
 */
function hasActiveDragState(): boolean {
  return document.querySelector('.xap-drag-in-progress') !== null;
}

/**
 * 判断当前页面是否处于「弱信号可用」的上下文。
 *
 * 之前的问题：`!hasActiveDragState()` 在非 Gemini 站点上恒为 true，
 * waitForConsumption 会在 80ms 内立即返回 true，被误判为成功；
 * attachVirtualFile 随即中止适配器链，最终 UI 只闪了一下却什么都没挂上。
 *
 * 现在只有在页面上确实存在 Gemini 相关节点时才启用弱信号判定。
 */
function supportsWeakSignal(): boolean {
  return document.querySelector('rich-textarea, .ql-editor, [xapfileselectordropzone]') !== null;
}

async function waitForConsumption(
  beforeAttachmentCount: number,
  timeoutMs: number,
  allowWeakSignal: boolean,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(80);
    // 出现附件预览 —— 强成功信号
    if (countAttachments() > beforeAttachmentCount) return true;
    // 拖放高亮态被清除 —— 弱成功信号（仅 Gemini 等特定上下文）
    if (allowWeakSignal && !hasActiveDragState()) return true;
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
    const allowWeakSignal = supportsWeakSignal();

    logger.debug(
      'generic-dnd: candidate targets',
      targets.map((t) => t.tagName),
    );

    for (const target of targets) {
      try {
        await dispatchDropSequence(target, file);
      } catch (err) {
        logger.warn('generic-dnd: dispatch failed on', target.tagName, err);
        continue;
      }
      const consumed = await waitForConsumption(beforeCount, 800, allowWeakSignal);
      if (consumed) {
        logger.debug('generic-dnd: consumed by', target.tagName);
        return { success: true, method: 'dnd' };
      }
      logger.debug('generic-dnd: not consumed by', target.tagName);
    }

    return { success: false, method: 'dnd' };
  },
};
