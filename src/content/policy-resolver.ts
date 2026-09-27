import { evaluateSitePolicyForHostnames, normalizeHostname } from '../core/policy';

export function resolvePolicyHostnames(): string[] {
  const hostnames = new Set<string>();
  const add = (value?: string | null): void => {
    if (!value) return;
    try {
      const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
      const host = normalizeHostname(url.hostname);
      if (host) hostnames.add(host);
    } catch {
      // ignore
    }
  };
  add(window.location.hostname);
  add(document.referrer);
  try {
    const ancestorOrigins = window.location.ancestorOrigins;
    if (ancestorOrigins) {
      for (let i = 0; i < ancestorOrigins.length; i++) {
        add(ancestorOrigins.item(i));
      }
    }
  } catch {
    // ignore
  }
  try {
    if (window.top && window.top.location) {
      add(window.top.location.hostname);
    }
  } catch {
    // 跨域 top
  }
  return Array.from(hostnames);
}

export function resolveActiveEditor(targetElement: HTMLElement | null): HTMLElement | null {
  if (
    targetElement instanceof HTMLTextAreaElement ||
    targetElement instanceof HTMLInputElement ||
    (targetElement && targetElement.isContentEditable)
  ) {
    return targetElement;
  }
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"], [role="textbox"]'),
  );
  return candidates.find((el) => el.offsetWidth > 0 && el.offsetHeight > 0) || targetElement;
}

export function resolveEventTarget(event: ClipboardEvent): HTMLElement | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const node of path) {
    if (!(node instanceof HTMLElement)) continue;
    if (
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLInputElement ||
      node.isContentEditable ||
      node.closest('[contenteditable="true"]')
    ) {
      return node;
    }
  }
  return event.target instanceof HTMLElement ? event.target : null;
}
