import type { AdapterResult } from './types';
import type { Logger } from '../../core/logger';
import { installShowPickerGuard, mountFilesToInput } from './show-picker-guard';

export interface MenuUploadOptions {
  readonly dataTransfer: DataTransfer;
  readonly logger: Logger;
  readonly openMenu: () => boolean;
  readonly findMenuItem: () => HTMLElement | null;
  readonly timeoutMs?: number;
  readonly mountDelayMs?: number;
  readonly retryDelaysMs?: readonly number[];
}

const DEFAULT_RETRY_DELAYS_MS = [300, 600, 1000, 1500] as const;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MOUNT_DELAY_MS = 500;

function safeClick(el: HTMLElement, logger: Logger): void {
  try {
    el.click();
  } catch (err) {
    logger.warn('menu-upload click failed', err);
  }
}

export function driveMenuUpload(opts: MenuUploadOptions): Promise<AdapterResult> {
  const {
    dataTransfer,
    logger,
    openMenu,
    findMenuItem,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    mountDelayMs = DEFAULT_MOUNT_DELAY_MS,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  } = opts;

  return new Promise<AdapterResult>((resolve) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let resolved = false;
    let mounted = false;
    let guardDispose: (() => void) | null = null;

    const finish = (success: boolean): void => {
      if (resolved) return;
      resolved = true;
      logger.debug('menu-upload finish', { success });
      guardDispose?.();
      for (const t of timers) clearTimeout(t);
      resolve({ success, method: 'menu-upload' });
    };

    const doMount = (input: HTMLInputElement, source: string): void => {
      if (mounted) return;
      if (mountFilesToInput(input, dataTransfer, logger)) {
        logger.debug(`menu-upload mounted via ${source}`);
        mounted = true;
        timers.push(setTimeout(() => finish(mounted), mountDelayMs));
      }
    };

    const guard = installShowPickerGuard(doMount, logger);
    guardDispose = () => guard.dispose();

    const existingItem = findMenuItem();
    if (existingItem) {
      safeClick(existingItem, logger);
    } else if (!openMenu()) {
      finish(false);
      return;
    }

    const clickItem = (): void => {
      if (mounted || resolved) return;
      const item = findMenuItem();
      if (item) safeClick(item, logger);
    };

    for (const delay of retryDelaysMs) timers.push(setTimeout(clickItem, delay));

    timers.push(
      setTimeout(() => {
        if (!mounted) {
          logger.debug('menu-upload timeout');
          finish(false);
        }
      }, timeoutMs),
    );
  });
}
