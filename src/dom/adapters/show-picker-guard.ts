import type { Logger } from '../../core/logger';

export interface ShowPickerGuard {
  dispose(): void;
}

interface PatchedProto {
  showPicker?: () => void;
}

export function installShowPickerGuard(
  onFileInput: (input: HTMLInputElement, source: string) => void,
  logger: Logger,
): ShowPickerGuard {
  const proto = HTMLInputElement.prototype as unknown as PatchedProto;
  const originalShowPicker = proto.showPicker;
  let patched = false;

  const clickBlocker = (e: Event): void => {
    const target = e.target;
    if (target instanceof HTMLInputElement && target.type === 'file') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      logger.debug('showPicker-guard: intercepted click');
      onFileInput(target, 'click-interception');
    }
  };

  document.addEventListener('click', clickBlocker, true);

  if (typeof originalShowPicker === 'function') {
    try {
      proto.showPicker = function (this: HTMLInputElement): void {
        if (this.type === 'file') {
          logger.debug('showPicker-guard: intercepted showPicker');
          onFileInput(this, 'showPicker-interception');
          return;
        }
        return originalShowPicker.call(this);
      };
      patched = true;
    } catch (err) {
      logger.warn('Failed to patch showPicker', err);
    }
  }

  return {
    dispose(): void {
      document.removeEventListener('click', clickBlocker, true);
      if (patched) {
        proto.showPicker = originalShowPicker;
      }
    },
  };
}

export function mountFilesToInput(
  input: HTMLInputElement,
  dataTransfer: DataTransfer,
  logger: Logger,
): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
    if (descriptor?.set) descriptor.set.call(input, dataTransfer.files);
    else input.files = dataTransfer.files;

    logger.debug('mounted files to input, count=', input.files?.length ?? 0);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  } catch (err) {
    logger.warn('mountFilesToInput failed', err);
    return false;
  }
}
