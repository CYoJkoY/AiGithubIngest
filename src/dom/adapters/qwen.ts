import { SiteAdapter } from './types';
import { driveMenuUpload } from './menu-upload-driver';

function findQwenModeButton(): HTMLElement | null {
  const byClass = document.querySelector<HTMLElement>('.mode-select-open');
  if (byClass && !byClass.hasAttribute('disabled')) return byClass;

  const ariaCandidates = ['选择模式', 'Select mode', '选择'];
  for (const label of ariaCandidates) {
    const btn = document.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`);
    if (btn && !btn.hasAttribute('disabled')) return btn;
  }

  const uses = Array.from(document.querySelectorAll('use'));
  for (const use of uses) {
    const href =
      use.getAttribute('href') ||
      use.getAttribute('xlink:href') ||
      use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (href === '#qwpcicon-addBold') {
      const btn = use.closest<HTMLElement>('[role="button"]');
      if (btn && !btn.hasAttribute('disabled')) return btn;
    }
  }
  return null;
}

function findQwenUploadMenuItem(): HTMLElement | null {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  if (items.length === 0) return null;

  for (const item of items) {
    const uses = Array.from(item.querySelectorAll('use'));
    const hit = uses.some((use) => {
      const href =
        use.getAttribute('href') ||
        use.getAttribute('xlink:href') ||
        use.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      return href === '#qwpcicon-upload';
    });
    if (hit) return item;
  }

  const uploadTexts = ['上传附件', '上传文件', 'Upload attachment', 'Upload file'];
  for (const item of items) {
    const nameEl = item.querySelector('.mode-select-dropdown-item-name');
    const text = (nameEl?.textContent || item.textContent || '').trim();
    if (uploadTexts.some((kw) => text.includes(kw))) return item;
  }

  for (const item of items) {
    if (
      item.querySelector('.mode-select-dropdown-item') &&
      /upload|附件/i.test(item.textContent || '')
    )
      return item;
  }
  return null;
}

export const qwenAdapter: SiteAdapter = {
  id: 'qwen',
  matches: (host) =>
    host.includes('qwen.ai') || host.includes('qwen.com') || host.includes('tongyi.aliyun.com'),
  attach: (_file, ctx) =>
    driveMenuUpload({
      dataTransfer: ctx.dataTransfer,
      logger: ctx.logger,
      openMenu: () => {
        const btn = findQwenModeButton();
        if (!btn) return false;
        try {
          btn.click();
          return true;
        } catch (err) {
          ctx.logger.warn('qwen mode click failed', err);
          return false;
        }
      },
      findMenuItem: findQwenUploadMenuItem,
      timeoutMs: 5000,
      mountDelayMs: 500,
    }),
};
