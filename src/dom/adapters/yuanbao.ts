import { SiteAdapter } from './types';

export const yuanbaoAdapter: SiteAdapter = {
  id: 'yuanbao',
  matches: (host) => host.includes('yuanbao.tencent.com') || host.includes('yuanbao.com'),
  attach: async (_file, ctx) => {
    const { dataTransfer, logger } = ctx;
    return new Promise((resolve) => {
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      let resolved = false;
      let mounted = false;

      const originalShowPicker = (
        HTMLInputElement.prototype as unknown as { showPicker?: () => void }
      ).showPicker;
      let showPickerPatched = false;

      const cleanup = (): void => {
        try {
          document.removeEventListener('click', clickBlocker, true);
          if (showPickerPatched) {
            (HTMLInputElement.prototype as unknown as { showPicker?: () => void }).showPicker =
              originalShowPicker;
          }
        } catch {
          // 容错
        }
        for (const t of timers) clearTimeout(t);
      };

      const finish = (success: boolean): void => {
        if (resolved) return;
        resolved = true;
        logger.debug('yuanbao finish:', success);
        cleanup();
        resolve({ success, method: 'yuanbao' });
      };

      const doMount = (input: HTMLInputElement, source: string): void => {
        if (mounted) return;
        try {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
          if (descriptor?.set) descriptor.set.call(input, dataTransfer.files);
          else input.files = dataTransfer.files;
          logger.debug(`yuanbao mounted via ${source}, files=${input.files?.length}`);
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          mounted = true;
        } catch (err) {
          logger.warn('yuanbao mount failed:', err);
        }
      };

      const clickBlocker = (e: Event): void => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.type === 'file') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          doMount(target, 'click-interception');
          timers.push(setTimeout(() => finish(mounted), 600));
        }
      };

      document.addEventListener('click', clickBlocker, true);

      if (typeof originalShowPicker === 'function') {
        try {
          (HTMLInputElement.prototype as unknown as { showPicker: () => void }).showPicker =
            function (this: HTMLInputElement): void {
              if (this.type === 'file') {
                doMount(this, 'showPicker-interception');
                timers.push(setTimeout(() => finish(mounted), 600));
                return;
              }
              return originalShowPicker.call(this);
            };
          showPickerPatched = true;
        } catch {
          // 容错
        }
      }

      const addBtn = document.querySelector<HTMLElement>(
        '[data-new-input-control="add-tools-trigger"]',
      );
      if (!addBtn) {
        finish(false);
        return;
      }
      addBtn.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
      );

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

      const clickUploadItem = (): void => {
        if (mounted || resolved) return;
        const menuItems = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        for (const item of menuItems) {
          const text = (item.textContent || '').trim();
          if (!text) continue;
          if (UPLOAD_KEYWORDS.some((kw) => text.includes(kw))) {
            item.dispatchEvent(
              new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
            );
            return;
          }
        }
        const fallbackCandidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="option"], .t-menu__item, .t-dropdown__item, [class*="menu-item"], [class*="dropdown-item"], [class*="Menu"] li, li',
          ),
        );
        for (const item of fallbackCandidates) {
          const text = (item.textContent || '').trim();
          if (!text) continue;
          if (UPLOAD_KEYWORDS.some((kw) => text.includes(kw))) {
            item.dispatchEvent(
              new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
            );
            return;
          }
        }
      };

      timers.push(setTimeout(clickUploadItem, 200));
      timers.push(setTimeout(clickUploadItem, 400));
      timers.push(setTimeout(clickUploadItem, 700));
      timers.push(setTimeout(clickUploadItem, 1100));
      timers.push(setTimeout(clickUploadItem, 1600));
      timers.push(setTimeout(clickUploadItem, 2200));

      timers.push(
        setTimeout(() => {
          if (!mounted) {
            logger.debug('yuanbao timeout: never mounted');
            finish(false);
          }
        }, 5000),
      );
    });
  },
};
