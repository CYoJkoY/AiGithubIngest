export type ToastType = "info" | "success" | "error";

export class Toast {
  private static container: HTMLElement | null = null;

  private static getOrCreateContainer(): HTMLElement {
    if (!this.container || !document.body.contains(this.container)) {
      this.container = document.createElement("div");
      this.container.className = "ai-github-ingest-toast-container";
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  public static show(
    message: string,
    type: ToastType = "info",
    duration: number = 3000,
  ): void {
    const container = this.getOrCreateContainer();

    const toast = document.createElement("div");
    toast.className = `ai-github-ingest-toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("show");
    });

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.remove();
        if (container.childNodes.length === 0) {
          container.remove();
          Toast.container = null;
        }
      }, 250);
    }, duration);
  }
}

export const showToast = (
  message: string,
  type: ToastType = "info",
  duration: number = 3000,
): void => {
  Toast.show(message, type, duration);
};
