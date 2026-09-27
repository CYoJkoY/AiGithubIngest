import { SiteAdapter } from './types';

export const doubaoAdapter: SiteAdapter = {
  id: 'doubao',
  matches: (host) => host.includes('doubao.com'),
  attach: async (file, ctx) => {
    const { dataTransfer } = ctx;
    const directInput = document.querySelector<HTMLInputElement>(
      'input[data-testid="upload-file-input"], input[type="file"]',
    );
    if (directInput) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (descriptor?.set) descriptor.set.call(directInput, dataTransfer.files);
      else directInput.files = dataTransfer.files;
      directInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      directInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return { success: true, method: 'doubao-direct' };
    }

    const attachBtn = document.querySelector<HTMLElement>(
      'button[data-testid="upload_file_button"]',
    );
    if (!attachBtn) return { success: false, method: 'doubao' };

    const clickBlocker = (e: Event): void => {
      const target = e.target;
      if (target instanceof HTMLInputElement && target.type === 'file') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener('click', clickBlocker, true);

    const originalShowPicker = (
      HTMLInputElement.prototype as unknown as { showPicker?: () => void }
    ).showPicker;
    let showPickerPatched = false;
    if (typeof originalShowPicker === 'function') {
      try {
        (HTMLInputElement.prototype as unknown as { showPicker: () => void }).showPicker =
          function (this: HTMLInputElement): void {
            if (this.type === 'file') return;
            return originalShowPicker.call(this);
          };
        showPickerPatched = true;
      } catch {
        // 容错
      }
    }

    try {
      attachBtn.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
      );
    } catch {
      // 容错
    }

    await new Promise((r) => setTimeout(r, 200));
    const newInput = document.querySelector<HTMLInputElement>(
      'input[data-testid="upload-file-input"], input[type="file"]',
    );
    if (newInput) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (descriptor?.set) descriptor.set.call(newInput, dataTransfer.files);
      else newInput.files = dataTransfer.files;
      newInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      newInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    setTimeout(() => {
      document.removeEventListener('click', clickBlocker, true);
      if (showPickerPatched) {
        (HTMLInputElement.prototype as unknown as { showPicker?: () => void }).showPicker =
          originalShowPicker;
      }
    }, 1000);

    return { success: true, method: 'doubao-menu' };
  },
};
