import { SiteAdapter } from './types';
import { driveMenuUpload } from './menu-upload-driver';
import { safeClick } from '../dom-utils';

const UPLOAD_KEYWORDS = [
  '本地文件',
  '上传文件',
  '上传附件',
  '上传',
  'Upload file',
  'Local file',
  'Upload',
  '附件',
];

function findYuanbaoUploadItem(): HTMLElement | null {
  const menuItems = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  for (const item of menuItems) {
    const text = (item.textContent || '').trim();
    if (text && UPLOAD_KEYWORDS.some((kw) => text.includes(kw))) return item;
  }

  const fallback = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="option"], .t-menu__item, .t-dropdown__item, [class*="menu-item"], [class*="dropdown-item"], [class*="Menu"] li, li',
    ),
  );
  for (const item of fallback) {
    const text = (item.textContent || '').trim();
    if (text && UPLOAD_KEYWORDS.some((kw) => text.includes(kw))) return item;
  }
  return null;
}

export const yuanbaoAdapter: SiteAdapter = {
  id: 'yuanbao',
  matches: (host) => host.includes('yuanbao.tencent.com') || host.includes('yuanbao.com'),
  attach: (_file, ctx) =>
    driveMenuUpload({
      dataTransfer: ctx.dataTransfer,
      logger: ctx.logger,
      openMenu: () => {
        const btn = document.querySelector<HTMLElement>(
          '[data-new-input-control="add-tools-trigger"]',
        );
        if (!btn) return false;
        safeClick(btn, ctx.logger, 'yuanbao-add-btn');
        return true;
      },
      findMenuItem: findYuanbaoUploadItem,
      timeoutMs: 5000,
      mountDelayMs: 600,
    }),
};
