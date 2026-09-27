import { SiteAdapter } from './types';
import { mountFilesToInput } from './show-picker-guard';
import { safeClick, sleep, snapshotFileInputs, waitForNewFileInput } from '../dom-utils';

const TRIGGER_LABEL_PATTERN =
  /^[+＋]$|^add(\s|$)|add\s*files?|add\s*attachment|upload|attach|more\s*options|^更多$|^添加$|^上传$|^附件$/i;

const UPLOAD_MENU_ITEM_PATTERN =
  /upload\s*(from\s*)?(device|computer|files?|local)?|choose\s*files?|select\s*files?|local\s*files?|from\s*your?\s*(device|computer)|上传(本地|文件|附件)?|本地文件|选择文件/i;

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
        if (!isUsable(hit) || isInsideMenu(hit)) continue;
        return hit;
      }
    }

    const buttons = scope.querySelectorAll<HTMLElement>('button, [role="button"]');
    for (const btn of buttons) {
      if (!isUsable(btn) || isInsideMenu(btn)) continue;
      if (TRIGGER_LABEL_PATTERN.test(labelOf(btn))) return btn;
    }
  }
  return null;
}

function findUploadMenuItem(exclude?: HTMLElement | null): HTMLElement | null {
  const accept = (el: HTMLElement): boolean => {
    if (exclude && (el === exclude || exclude.contains(el))) return false;
    if (!isUsable(el)) return false;
    return UPLOAD_MENU_ITEM_PATTERN.test(labelOf(el));
  };

  const scoped = document.querySelectorAll<HTMLElement>(MENU_ITEM_IN_CONTAINER_SELECTOR);
  for (const el of scoped) {
    if (accept(el)) return el;
  }

  const items = document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"]');
  for (const el of items) {
    if (accept(el)) return el;
  }

  return null;
}

export const genericUploadTriggerAdapter: SiteAdapter = {
  id: 'generic-upload-trigger',
  matches: () => true,
  attach: async (_file, ctx) => {
    const { dataTransfer, activeElement, logger } = ctx;

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

    const trigger = findTriggerButton(activeElement);
    if (!trigger) {
      logger.debug('upload-trigger: no trigger button found');
      return { success: false, method: 'upload-trigger' };
    }

    const before = snapshotFileInputs();
    logger.debug('upload-trigger: clicking trigger', labelOf(trigger));
    safeClick(trigger, logger, 'trigger');

    let input = await waitForNewFileInput(before, 250);
    if (input && mountFilesToInput(input, dataTransfer, logger)) {
      return { success: true, method: 'upload-trigger-direct' };
    }

    for (let i = 0; i < 5; i++) {
      await sleep(POLL_INTERVAL_MS);
      const menuItem = findUploadMenuItem(trigger);
      if (menuItem) {
        logger.debug('upload-trigger: clicking menu item', labelOf(menuItem));
        safeClick(menuItem, logger, 'menu-item');
        break;
      }
    }

    input = await waitForNewFileInput(before, 1500);
    if (input && mountFilesToInput(input, dataTransfer, logger)) {
      return { success: true, method: 'upload-trigger-menu' };
    }

    logger.debug('upload-trigger: gave up');
    return { success: false, method: 'upload-trigger' };
  },
};
