import { ToastVariant } from "../types";

const TOAST_ID = "__ai_github_ingest_toast__";
let timerId: number | null = null;

const createToastElement = (): HTMLElement => {
  const el = document.createElement("div");
  el.id = TOAST_ID;
  el.className = "ai-ingest-toast";
  document.body.appendChild(el);
  return el;
};

export const showToast = (
  message: string,
  variant: ToastVariant = "info",
): void => {
  const toast = document.getElementById(TOAST_ID) || createToastElement();

  if (timerId !== null) {
    window.clearTimeout(timerId);
    timerId = null;
  }

  toast.className = `ai-ingest-toast ai-ingest-toast--${variant}`;
  toast.textContent = message;
  toast.setAttribute("aria-hidden", "false");

  if (variant !== "info") {
    timerId = window.setTimeout(() => {
      toast.setAttribute("aria-hidden", "true");
    }, 4000);
  }
};
