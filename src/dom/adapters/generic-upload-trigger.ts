import { SiteAdapter } from './types';
import { mountFilesToInput } from './show-picker-guard';

/**
 * 「触发上传按钮，等待宿主自行实例化 <input type="file">，再做挂载」的通用适配器。
 *
 * 适用场景：
 *   某些 SPA（典型如 Gemini / 部分 Angular 站点）并不会在 DOM 里长期保留
 *   可用的 file input，而是等用户点击「+」「附件」「上传」之类的按钮时，
 *   才在事件处理器里动态实例化一个 input，并把它注册进框架的事件体系。
 *   此时直接派发合成 drag/drop 或 paste 都拿不到宿主消费，因为框架根本没
 *   有处于「准备接收文件」的状态。
 *
 * 本适配器不依赖任何平台专有的 selector，只使用以下通用启发式：
 *   1. 通过 aria-label / title / textContent 匹配通用上传关键词
 *      （upload / attach / add file / 上传 / 附件 ...）
 *   2. 优先在输入区域附近的按钮里查找，减少误点其他区域按钮的概率
 *   3. 点击后轮询等待 input[type=file] 出现
 *
 * 设计约束：
 *   - 不硬编码任何站点域名或专有类名
 *   - 找不到候选按钮 / 点击后 input 未出现，都干净地返回 false，
 *     把机会让给链上后续适配器
 */

const UPLOAD_KEYWORD_PATTERN =
  /upload|attach|add\s*files?|add\s*attachment|file\s*upload|上传|附件|添加.*文件|插入.*文件/i;

const UPLOAD_BUTTON_SELECTORS: readonly string[] = [
  'button[aria-label*="upload" i]',
  'button[aria-label*="attach" i]',
  'button[aria-label*="add file" i]',
  'button[aria-label*="add attachment" i]',
  'button[title*="upload" i]',
  'button[title*="attach" i]',
  'button[title*="add file" i]',
  'button[aria-label*="上传"]',
  'button[aria-label*="附件"]',
  'button[title*="上传"]',
  'button[title*="附件"]',
  '[role="button"][aria-label*="upload" i]',
  '[role="button"][aria-label*="attach" i]',
  '[role="button"][aria-label*="上传"]',
  '[role="button"][aria-label*="附件"]',
];

const POLL_INTERVAL_MS = 120;
const MAX_POLL_ATTEMPTS = 12; // 总等待窗口 ≈ 1440ms

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isUsable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  // 可见性检查：过滤掉 display:none / 尺寸为 0 的隐藏按钮
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  return true;
}

/**
 * 在输入区域附近查找一个「像上传按钮」的元素。
 *
 * 搜索策略（按优先级从高到低）：
 *   1. 从锚点元素向上遍历 6 层祖先，在每个祖先子树里按 selector 优先级查找
 *   2. 兜底在 document.body 里查一次
 *
 * 这样能覆盖「按钮和输入框共用一个工具栏容器」这种绝大多数站点的布局。
 */
function findUploadButton(anchor: HTMLElement | null): HTMLElement | null {
  const scopes: Element[] = [];
  if (anchor) {
    let cur: Element | null = anchor;
    for (let depth = 0; depth < 6 && cur; depth++) {
      scopes.push(cur);
      cur = cur.parentElement;
    }
  }
  scopes.push(document.body);

  const seenScopes = new Set<Element>();
  for (const scope of scopes) {
    if (seenScopes.has(scope)) continue;
    seenScopes.add(scope);

    for (const sel of UPLOAD_BUTTON_SELECTORS) {
      const hit = scope.querySelector<HTMLElement>(sel);
      if (hit && isUsable(hit)) return hit;
    }

    // 关键词兜底：扫描该作用域内的所有 button / [role=button]
    const candidates = scope.querySelectorAll<HTMLElement>('button, [role="button"]');
    for (const btn of candidates) {
      if (!isUsable(btn)) continue;
      const label = (
        btn.getAttribute('aria-label') ||
        btn.getAttribute('title') ||
        btn.textContent ||
        ''
      ).trim();
      if (UPLOAD_KEYWORD_PATTERN.test(label)) return btn;
    }
  }

  return null;
}

/**
 * 只返回**当前时刻真实存在**的 file input。
 * 刻意不做 Shadow DOM 穿透：能出现在这里说明按钮刚刚创建了它，
 * 一定挂在 light DOM 上；穿透反而可能命中无关的隐藏 input。
 */
function findFileInput(): HTMLInputElement | null {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const input of inputs) {
    if (input.disabled) continue;
    return input;
  }
  return null;
}

export const genericUploadTriggerAdapter: SiteAdapter = {
  id: 'generic-upload-trigger',
  matches: () => true,
  attach: async (_file, ctx) => {
    const { dataTransfer, activeElement, logger } = ctx;

    const button = findUploadButton(activeElement);
    if (!button) {
      logger.debug('upload-trigger: no candidate button found');
      return { success: false, method: 'upload-trigger' };
    }

    const label = button.getAttribute('aria-label') || button.getAttribute('title') || '';
    logger.debug('upload-trigger: clicking candidate button', label || '<no label>');

    try {
      button.click();
    } catch (err) {
      logger.warn('upload-trigger: click failed', err);
      return { success: false, method: 'upload-trigger' };
    }

    // 点击后立刻检查一次：部分框架是同步创建 input 的
    const immediate = findFileInput();
    if (immediate && mountFilesToInput(immediate, dataTransfer, logger)) {
      return { success: true, method: 'upload-trigger-sync' };
    }

    // 同步没出现，进入轮询：Angular zone / React concurrent 下常见异步创建
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      const input = findFileInput();
      if (!input) continue;
      if (mountFilesToInput(input, dataTransfer, logger)) {
        return { success: true, method: 'upload-trigger-async' };
      }
    }

    logger.debug('upload-trigger: file input never appeared');
    return { success: false, method: 'upload-trigger' };
  },
};
