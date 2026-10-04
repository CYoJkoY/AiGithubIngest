import { normalizeHostname } from '../core/policy';
import { logger } from '../core/logger';

export function resolvePolicyHostnames(): string[] {
  const hostnames = new Set<string>();
  const add = (value?: string | null): void => {
    if (!value) return;
    try {
      const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
      const host = normalizeHostname(url.hostname);
      if (host) hostnames.add(host);
    } catch (err) {
      logger.debug('resolvePolicyHostnames: invalid value', value, err);
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
  } catch (err) {
    logger.debug('ancestorOrigins access failed', err);
  }

  try {
    if (window.top && window.top.location) add(window.top.location.hostname);
  } catch (err) {
    logger.debug('cross-origin top access denied', err);
  }

  return Array.from(hostnames);
}

export function resolveActiveEditor(targetElement: HTMLElement | null): HTMLElement | null {
  if (targetElement instanceof HTMLTextAreaElement || targetElement instanceof HTMLInputElement) {
    return targetElement;
  }
  if (targetElement) {
    const editableRoot = targetElement.closest<HTMLElement>(
      'textarea, [contenteditable="true"], [role="textbox"]',
    );
    if (editableRoot) return editableRoot;
    if (targetElement.isContentEditable) return targetElement;
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
    if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
      return node;
    }
    const editable = node.closest<HTMLElement>('[contenteditable="true"], [role="textbox"]');
    if (editable) return editable;
    if (node.isContentEditable) return node;
  }
  return event.target instanceof HTMLElement ? event.target : null;
}
