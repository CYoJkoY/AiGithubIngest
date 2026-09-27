export type ToastType = 'info' | 'success' | 'error';

interface ToastEntry {
  readonly el: HTMLElement;
  readonly dismissTimer: ReturnType<typeof setTimeout>;
}

export class Toast {
  private static container: HTMLElement | null = null;
  private static readonly activeByKey = new Map<string, ToastEntry>();

  private static getOrCreateContainer(): HTMLElement {
    // document_start 阶段 <body> 可能尚未创建，回退到 <html>
    const parent = document.body || document.documentElement;

    if (!this.container || !parent.contains(this.container)) {
      this.container = document.createElement('div');
      this.container.className = 'ai-github-ingest-toast-container';
      parent.appendChild(this.container);
    }
    return this.container;
  }

  private static removeNode(el: HTMLElement): void {
    el.remove();
    const container = Toast.container;
    if (container && container.childNodes.length === 0) {
      container.remove();
      Toast.container = null;
    }
  }

  /**
   * 立即让指定 key 的 Toast 进入淡出流程，并从 key 映射里移除。
   * 用于 replaceKey 互斥显示，以及延迟弹出的「占位」Toast 被最终结果顶替。
   */
  private static dismissKey(key: string): void {
    const entry = Toast.activeByKey.get(key);
    if (!entry) return;
    Toast.activeByKey.delete(key);
    clearTimeout(entry.dismissTimer);
    entry.el.classList.remove('show');
    setTimeout(() => Toast.removeNode(entry.el), 250);
  }

  public static show(
    message: string,
    type: ToastType = 'info',
    duration: number = 3000,
    replaceKey?: string,
  ): void {
    // 相同 key 的旧 Toast 先被顶掉，避免视觉叠加
    if (replaceKey) Toast.dismissKey(replaceKey);

    const container = Toast.getOrCreateContainer();

    const toast = document.createElement('div');
    toast.className = `ai-github-ingest-toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    const dismissTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        Toast.removeNode(toast);
        // 只有当 map 里仍然指向自己时才清理 key，防止已被顶替的场景误删新条目
        if (replaceKey && Toast.activeByKey.get(replaceKey)?.el === toast) {
          Toast.activeByKey.delete(replaceKey);
        }
      }, 250);
    }, duration);

    if (replaceKey) {
      Toast.activeByKey.set(replaceKey, { el: toast, dismissTimer });
    }
  }
}

export const showToast = (
  message: string,
  type: ToastType = 'info',
  duration: number = 3000,
  replaceKey?: string,
): void => {
  Toast.show(message, type, duration, replaceKey);
};
