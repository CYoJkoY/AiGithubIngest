import { SiteAdapter } from './types';
import { mountFilesToInput } from './show-picker-guard';
import type { Logger } from '../../core/logger';

/**
 * 豆包（Doubao）专属上传适配器。
 *
 * 历史教训（本次修复的核心）：
 *   之前的实现使用 `input[data-testid="upload-file-input"], input[type="file"]`
 *   作为兜底选择器。`querySelector` 按 DOM 顺序返回第一个命中的节点，
 *   而豆包页面上普遍存在多个 `input[type="file"]`（头像上传、插件入口、
 *   隐藏的备用 input 等），因此极易挂载到与当前会话无关的隐藏 input 上。
 *
 *   `mountFilesToInput` 只要赋值不抛异常就返回 true，于是适配器无条件
 *   返回 `{ success: true }`，适配器链被提前终止，后续的 generic 兜底
 *   适配器（generic-file-input / generic-upload-trigger / generic-dnd）
 *   永远得不到执行机会。这就是「豆包上传反而不正常」的直接原因。
 *
 * 修复策略（与 generic-dnd 的消费判定保持一致）：
 *   1. 只信任明确的 `input[data-testid="upload-file-input"]`，不再 fallback
 *      到宽泛的 `input[type="file"]`。
 *   2. 挂载后用「附件预览节点数量增加」这一**强信号**校验宿主是否真的
 *      消费了文件；未消费则返回 false，让兜底链继续执行。
 *   3. 路径 A（直接挂载）未消费时，继续尝试路径 B（点击上传按钮 →
 *      等待宿主渲染 input → 挂载），而不是提前返回。
 */

const PICKER_DELAY_MS = 250;
const CONSUME_POLL_MS = 80;
const CONSUME_TIMEOUT_MS = 500;

/** 只信任豆包明确的上传 input，避免命中无关的隐藏 file input */
const DOUBAO_INPUT_SELECTOR = 'input[data-testid="upload-file-input"]';

/** 豆包「上传」触发按钮 */
const DOUBAO_TRIGGER_SELECTOR = 'button[data-testid="upload_file_button"]';

const ATTACHMENT_PREVIEW_SELECTOR = [
  'uploader-file-preview',
  '[class*="file-preview" i]',
  '[class*="attachment-preview" i]',
  '[class*="upload-chip" i]',
  '[class*="file-chip" i]',
  '[class*="uploaded-file" i]',
].join(',');

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

/** 统计页面上的附件预览节点数量（成功挂载后会 > 0） */
function countAttachments(): number {
  return document.querySelectorAll(ATTACHMENT_PREVIEW_SELECTOR).length;
}

/**
 * 等待宿主消费本次挂载。
 *
 * 只信任「强信号」：页面上出现新的附件预览节点。
 * 与 generic-dnd 保持完全一致的判定逻辑，避免再次出现
 * 「赋值成功即视为消费成功」的假阳性。
 */
async function waitForConsumption(beforeAttachmentCount: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < CONSUME_TIMEOUT_MS) {
    await sleep(CONSUME_POLL_MS);
    if (countAttachments() > beforeAttachmentCount) return true;
  }
  return false;
}

/**
 * 尝试将文件挂载到指定 input，并校验宿主是否真的消费。
 * 未消费时返回 false，交由上层决定是否继续尝试其它路径。
 */
async function tryMountAndVerify(
  input: HTMLInputElement,
  dataTransfer: DataTransfer,
  logger: Logger,
  method: string,
): Promise<boolean> {
  const before = countAttachments();
  if (!mountFilesToInput(input, dataTransfer, logger)) {
    logger.debug(`doubao: mountFilesToInput failed (${method})`);
    return false;
  }
  const consumed = await waitForConsumption(before);
  if (!consumed) {
    logger.debug(`doubao: input mount not consumed (${method})`);
  }
  return consumed;
}

export const doubaoAdapter: SiteAdapter = {
  id: 'doubao',
  matches: (host) => host.includes('doubao.com'),

  attach: async (_file, ctx) => {
    const { dataTransfer, logger } = ctx;

    // -------------------------------------------------------------------
    // 路径 A：页面已存在明确的上传 input（例如豆包已经预挂载）
    // -------------------------------------------------------------------
    const directInput = findDoubaoInput();
    if (directInput) {
      const consumed = await tryMountAndVerify(directInput, dataTransfer, logger, 'doubao-direct');
      if (consumed) return { success: true, method: 'doubao-direct' };
    }

    // -------------------------------------------------------------------
    // 路径 B：点击「上传」按钮 → 等待豆包渲染出 input → 挂载
    // -------------------------------------------------------------------
    const attachBtn = findDoubaoTrigger();
    if (!attachBtn) {
      logger.debug('doubao: no trigger button found');
      return { success: false, method: 'doubao' };
    }

    try {
      attachBtn.click();
    } catch (err) {
      logger.warn('doubao attach click failed', err);
      return { success: false, method: 'doubao' };
    }

    await sleep(PICKER_DELAY_MS);

    const newInput = findDoubaoInput();
    if (newInput) {
      const consumed = await tryMountAndVerify(newInput, dataTransfer, logger, 'doubao-menu');
      if (consumed) return { success: true, method: 'doubao-menu' };
    }

    logger.debug('doubao: gave up, falling through to generic adapters');
    return { success: false, method: 'doubao' };
  },
};
