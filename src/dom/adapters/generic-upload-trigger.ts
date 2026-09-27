import { SiteAdapter } from './types';
import { mountFilesToInput } from './show-picker-guard';
import type { Logger } from '../../core/logger';

/**
 * 「点击上传入口 → 等宿主创建 <input type="file"> → 挂载」的通用适配器。
 *
 * 显式支持两种常见流程：
 *   一步流程：点击按钮 → 宿主直接打开文件选择器（input 立即出现）
 *   两步流程：点击触发按钮 → 弹出菜单 → 点击「上传/本地文件」菜单项 → 文件选择器
 *
 * 不依赖任何站点专有 selector，只使用通用关键词与 DOM 启发式。
 *
 * 为什么需要显式支持两步流程：
 *   许多现代 SPA（Gemini 等）的「+」按钮点下去只会展开一个菜单，
 *   真正的 file input 要等用户点击「从设备上传」类菜单项后才出现。
 *   仅点击一次按钮永远等不到 input，适配器只能靠「上一次失败残留的
 *   菜单恰好开着」这种偶然状态成功，表现为「要点很多次」。
 */

// 触发按钮（打开菜单或直接打开文件选择器）匹配的标签模式
const TRIGGER_LABEL_PATTERN =
  /^[+＋]$|^add(\s|$)|add\s*files?|add\s*attachment|upload|attach|more\s*options|^更多$|^添加$|^上传$|^附件$/i;

// 菜单项（明确表示「从本地/设备上传」）匹配的标签模式
const UPLOAD_MENU_ITEM_PATTERN =
  /upload\s*(from\s*)?(device|computer|files?|local)?|choose\s*files?|select\s*files?|local\s*files?|from\s*your?\s*(device|computer)|上传(本地|文件|附件)?|本地文件|选择文件/i;

// 触发按钮的 aria-label / title 常用枚举
const TRIGGER_SELECTORS: readonly string[] = [
  'button[aria-label*="upload" i]',
  'button[aria-label*="attach" i]',
  'button[aria-label*="add file" i]',
  'button[aria-label*="add attachment" i]',
  'button[aria-label*="more options" i]',
  'button[title*="upload" i]',
  'button[title*="attach" i]',
  'button[aria-label*="上传"]',
  'button[aria-label*="附件"]',
  'button[aria-label*="更多"]',
  'button[aria-label*="添加"]',
  '[role="button"][aria-label*="upload" i]',
  '[role="button"][aria-label*="attach" i]',
  '[role="button"][aria-label*="上传"]',
  '[role="button"][aria-label*="附件"]',
];

const MENU_CONTAINER_SELECTOR =
  '[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"]';

const MENU_ITEM_IN_CONTAINER_SELECTOR = [
  '[role="menu"] [role="menuitem"]',
  '[role="menu"] [role="option"]',
  '[role="listbox"] [role="option"]',
  '[role="dialog"] [role="menuitem"]',
  '[role="dialog"] [role="option"]',
  '[role="tooltip"] [role="menuitem"]',
].join(', ');

const POLL_INTERVAL_MS = 100;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isUsable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  return true;
}

function labelOf(el: HTMLElement): string {
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const title = el.getAttribute('title');
  if (title) return title.trim();
  return (el.textContent || '').trim().slice(0, 80);
}

function isInsideMenu(el: HTMLElement): boolean {
  return el.closest(MENU_CONTAINER_SELECTOR) !== null;
}

/**
 * 查找顶层触发按钮。优先靠近编辑器，且排除已经处于菜单容器内部的元素
 * （那些是菜单项，由 findUploadMenuItem 处理）。
 */
function findTriggerButton(anchor: HTMLElement | null): HTMLElement | null {
  const scopes: Element[] = [];
  if (anchor) {
    let cur: Element | null = anchor;
    for (let depth = 0; depth < 8 && cur; depth++) {
      scopes.push(cur);
      cur = cur.parentElement;
    }
  }
  scopes.push(document.body);

  const seenScopes = new Set<Element>();
  for (const scope of scopes) {
    if (seenScopes.has(scope)) continue;
    seenScopes.add(scope);

    for (const sel of TRIGGER_SELECTORS) {
      const hits = scope.querySelectorAll(sel);
      for (const hit of hits) {
        if (!isUsable(hit)) continue;
        if (isInsideMenu(hit)) continue;
        return hit;
      }
    }

    const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"]');
    for (const btn of buttons) {
      if (!isUsable(btn)) continue;
      if (isInsideMenu(btn)) continue;
      if (TRIGGER_LABEL_PATTERN.test(labelOf(btn))) return btn;
    }
  }
  return null;
}

/**
 * 查找「从本地/设备上传」类菜单项。
 * 传 exclude 可跳过刚刚点过的触发按钮，防止重复命中同一个元素。
 */
function findUploadMenuItem(exclude?: HTMLElement | null): HTMLElement | null {
  const accept = (el: HTMLElement): boolean => {
    if (exclude && (el === exclude || exclude.contains(el))) return false;
    if (!isUsable(el)) return false;
    return UPLOAD_MENU_ITEM_PATTERN.test(labelOf(el));
  };

  // 第一轮：菜单容器内部的 menuitem / option（优先级最高，误判最少）
  const scoped = document.querySelectorAll<HTMLElement>(MENU_ITEM_IN_CONTAINER_SELECTOR);
  for (const el of scoped) {
    if (accept(el)) return el;
  }

  // 第二轮：任何位置的 menuitem / option（兜底）
  const items = document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"]');
  for (const el of items) {
    if (accept(el)) return el;
  }

  return null;
}

function snapshotFileInputs(): Set<HTMLInputElement> {
  return new Set(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
}

/**
 * 等待一个「新出现」的 file input。
 * 通过 before 快照排除掉已经存在的 input，避免误命中页面上的隐藏备用 input。
 */
async function waitForNewFileInput(
  before: Set<HTMLInputElement>,
  timeoutMs: number,
): Promise<HTMLInputElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    for (const input of inputs) {
      if (input.disabled) continue;
      if (before.has(input)) continue;
      return input;
    }
  }
  return null;
}

function safeClick(el: HTMLElement, logger: Logger, what: string): void {
  try {
    el.click();
  } catch (err) {
    logger.warn(`upload-trigger: ${what} click threw`, err);
  }
}

export const genericUploadTriggerAdapter: SiteAdapter = {
  id: 'generic-upload-trigger',
  matches: () => true,
  attach: async (_file, ctx) => {
    const { dataTransfer, activeElement, logger } = ctx;

    // -------------------------------------------------------------------
    // Step 1：菜单可能已经处于打开状态（例如上一次尝试的残留）。
    //         直接点击其中的上传菜单项即可，无需再点触发按钮。
    // -------------------------------------------------------------------
    const preexistingMenuItem = findUploadMenuItem();
    if (preexistingMenuItem) {
      const before = snapshotFileInputs();
      logger.debug('upload-trigger: clicking pre-existing menu item', labelOf(preexistingMenuItem));
      safeClick(preexistingMenuItem, logger, 'menu-item');
      const input = await waitForNewFileInput(before, 1200);
      if (input && mountFilesToInput(input, dataTransfer, logger)) {
        return { success: true, method: 'upload-trigger-menu-preexisting' };
      }
    }

    // -------------------------------------------------------------------
    // Step 2：定位并点击顶层触发按钮。
    // -------------------------------------------------------------------
    const trigger = findTriggerButton(activeElement);
    if (!trigger) {
      logger.debug('upload-trigger: no trigger button found');
      return { success: false, method: 'upload-trigger' };
    }

    const before = snapshotFileInputs();
    logger.debug('upload-trigger: clicking trigger', labelOf(trigger));
    safeClick(trigger, logger, 'trigger');

    // -------------------------------------------------------------------
    // Step 3：立即检查——部分站点点按钮会直接打开文件选择器。
    // -------------------------------------------------------------------
    let input = await waitForNewFileInput(before, 250);
    if (input && mountFilesToInput(input, dataTransfer, logger)) {
      return { success: true, method: 'upload-trigger-direct' };
    }

    // -------------------------------------------------------------------
    // Step 4：等待菜单渲染，找到上传菜单项并点击。
    //         最多等 500ms，菜单通常 100~200ms 内就绪。
    // -------------------------------------------------------------------
    for (let i = 0; i < 5; i++) {
      await sleep(POLL_INTERVAL_MS);
      const menuItem = findUploadMenuItem(trigger);
      if (menuItem) {
        logger.debug('upload-trigger: clicking menu item', labelOf(menuItem));
        safeClick(menuItem, logger, 'menu-item');
        break;
      }
    }

    // -------------------------------------------------------------------
    // Step 5：等待宿主创建 input 并挂载。
    // -------------------------------------------------------------------
    input = await waitForNewFileInput(before, 1500);
    if (input && mountFilesToInput(input, dataTransfer, logger)) {
      return { success: true, method: 'upload-trigger-menu' };
    }

    logger.debug('upload-trigger: gave up');
    return { success: false, method: 'upload-trigger' };
  },
};
