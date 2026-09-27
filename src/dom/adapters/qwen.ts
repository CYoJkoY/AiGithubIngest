import { SiteAdapter } from './types';

function findQwenModeButton(): HTMLElement | null {
  const byClass = document.querySelector<HTMLElement>('.mode-select-open');
  if (byClass && !byClass.hasAttribute('disabled')) return byClass;
  const ariaCandidates = ['选择模式', 'Select mode', '选择'];
  for (const label of ariaCandidates) {
    const btn = document.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`);
    if (btn && !btn.hasAttribute('disabled')) return btn;
  }
  const allUses = Array.from(document.querySelectorAll('use'));
  for (const use of allUses) {
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
  const menuItems = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  if (menuItems.length === 0) return null;
  for (const item of menuItems) {
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
  for (const item of menuItems) {
    const nameEl = item.querySelector('.mode-select-dropdown-item-name');
    const text = (nameEl?.textContent || item.textContent || '').trim();
    if (uploadTexts.some((kw) => text.includes(kw))) return item;
  }
  for (const item of menuItems) {
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
        logger.debug('qwen finish:', success);
        cleanup();
        resolve({ success, method: 'qwen' });
      };

      const doMount = (input: HTMLInputElement, source: string): void => {
        if (mounted) return;
        try {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
          if (descriptor?.set) descriptor.set.call(input, dataTransfer.files);
          else input.files = dataTransfer.files;
          logger.debug(`qwen mounted via ${source}, files=${input.files?.length}`);
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          mounted = true;
        } catch (err) {
          logger.warn('qwen mount failed:', err);
        }
      };

      const clickBlocker = (e: Event): void => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.type === 'file') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          doMount(target, 'click-interception');
          timers.push(setTimeout(() => finish(mounted), 500));
        }
      };

      document.addEventListener('click', clickBlocker, true);

      if (typeof originalShowPicker === 'function') {
        try {
          (HTMLInputElement.prototype as unknown as { showPicker: () => void }).showPicker =
            function (this: HTMLInputElement): void {
              if (this.type === 'file') {
                doMount(this, 'showPicker-interception');
                timers.push(setTimeout(() => finish(mounted), 500));
                return;
              }
              return originalShowPicker.call(this);
            };
          showPickerPatched = true;
        } catch {
          // 容错
        }
      }

      const existingItem = findQwenUploadMenuItem();
      if (existingItem) {
        existingItem.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
        );
      } else {
        const modeBtn = findQwenModeButton();
        if (!modeBtn) {
          finish(false);
          return;
        }
        modeBtn.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
        );
        const clickMenuItem = (): void => {
          if (mounted || resolved) return;
          const item = findQwenUploadMenuItem();
          if (!item) return;
          item.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
          );
        };
        timers.push(setTimeout(clickMenuItem, 300));
        timers.push(setTimeout(clickMenuItem, 600));
        timers.push(setTimeout(clickMenuItem, 1000));
        timers.push(setTimeout(clickMenuItem, 1500));
      }

      timers.push(
        setTimeout(() => {
          if (!mounted) {
            logger.debug('qwen timeout: never mounted');
            finish(false);
          }
        }, 5000),
      );
    });
  },
};
