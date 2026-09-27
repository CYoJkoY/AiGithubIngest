import { SiteAdapter } from './types';
import { mountFilesToInput } from './show-picker-guard';

/**
 * 豆包（Doubao）专属上传适配器。
 *
 * 历史教训与本次修复：
 *   1. 早期版本使用 `input[data-testid="upload-file-input"], input[type="file"]`
 *      的宽泛选择器，容易命中页面无关的隐藏 input。
 *   2. 上一版本引入了「附件预览节点数量增加」作为消费判定，但豆包的
 *      附件预览 DOM 结构与通用选择器不匹配，导致 `countAttachments()`
 *      恒为 0，消费判定恒为「未消费」。于是豆包适配器内部先走路径 A
 *      （直接挂载）判定失败、再走路径 B（点击按钮挂载）仍判定失败，
 *      返回 false 后又触发了 generic-file-input 的第三次挂载 ——
 *      用户看到的就是「一次粘贴，上传了三个文件」。
 *
 * 修复策略：
 *   1. 只信任精确的 `input[data-testid="upload-file-input"]` 选择器，
 *      不再 fallback 到宽泛的 `input[type="file"]`。
 *   2. 优先点击「上传」按钮 → 等待豆包创建**新** input → 挂载，这是
 *      最可靠、最贴近用户真实操作路径的方式。
 *   3. 只挂载**一次**：要么走「新 input」路径，要么走「已有 input」
 *      路径，绝不两条都跑。挂载成功即返回 true，让豆包自己处理后续
 *      上传流程；不再做消费判定，避免自己探测不到信号时重复触发。
 *   4. 只有当所有豆包专属路径都无法挂载时，才返回 false 交给通用
 *      兜底链（generic-file-input / generic-upload-trigger 等）。
 *
 * 为什么不再做消费判定：
 *   豆包上传成功后的附件预览节点使用 Angular 组件内部类名，无法通过
 *   通用 class 选择器稳定命中。任何基于「附件预览节点增加」的判定在
 *   豆包上都会假阴性，反而成为重复上传的诱因。既然选择器已经精确、
 *   挂载路径已经收敛，直接信任一次挂载即可。
 */

const NEW_INPUT_POLL_MS = 80;
const NEW_INPUT_TIMEOUT_MS = 800;

/** 只信任豆包明确的上传 input */
const DOUBAO_INPUT_SELECTOR = 'input[data-testid="upload-file-input"]';

/** 豆包「上传」触发按钮 */
const DOUBAO_TRIGGER_SELECTOR = 'button[data-testid="upload_file_button"]';

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

/** 快照当前所有 file input，用于区分「新出现」的 input */
function snapshotFileInputs(): Set<HTMLInputElement> {
  return new Set(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
}

/** 等待一个「新出现」的豆包上传 input */
async function waitForNewDoubaoInput(
  before: Set<HTMLInputElement>,
  timeoutMs: number,
): Promise<HTMLInputElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(NEW_INPUT_POLL_MS);
    const input = findDoubaoInput();
    if (input && !before.has(input)) return input;
  }
  return null;
}

export const doubaoAdapter: SiteAdapter = {
  id: 'doubao',
  matches: (host) => host.includes('doubao.com'),

  attach: async (_file, ctx) => {
    const { dataTransfer, logger } = ctx;

    // -------------------------------------------------------------------
    // 优先路径：点击「上传」按钮 → 等待豆包创建新 input → 挂载一次
    //
    // 相比复用已有 input，这条路径有两个优势：
    //   - 触发的一定是当前会话的 input，不会命中历史遗留的隐藏节点
    //   - 豆包的按钮点击会顺带初始化内部上传上下文，消费更可靠
    // -------------------------------------------------------------------
    const attachBtn = findDoubaoTrigger();
    if (attachBtn) {
      const before = snapshotFileInputs();
      try {
        attachBtn.click();
      } catch (err) {
        logger.warn('doubao attach click failed', err);
      }

      const newInput = await waitForNewDoubaoInput(before, NEW_INPUT_TIMEOUT_MS);
      if (newInput && mountFilesToInput(newInput, dataTransfer, logger)) {
        return { success: true, method: 'doubao-menu' };
      }
    }

    // -------------------------------------------------------------------
    // 备用路径：页面已存在明确的豆包上传 input，直接挂载一次。
    // 注意：这里只挂载一次，绝不会与上面的「优先路径」叠加触发。
    // -------------------------------------------------------------------
    const existingInput = findDoubaoInput();
    if (existingInput && mountFilesToInput(existingInput, dataTransfer, logger)) {
      return { success: true, method: 'doubao-direct' };
    }

    // -------------------------------------------------------------------
    // 所有豆包专属路径均无法挂载，让位给通用兜底适配器。
    // -------------------------------------------------------------------
    logger.debug('doubao: gave up, falling through to generic adapters');
    return { success: false, method: 'doubao' };
  },
};
