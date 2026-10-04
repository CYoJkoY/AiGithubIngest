import type { PseudoFile, SupportedLang, ThemeMode } from '../types';
import { logger } from '../core/logger';
import { formatBytes, formatTokens } from './payload';
import type { PseudoFileManager } from './pseudo-file-manager';

export const DOCK_CLASS = 'aigi-pseudo-dock';
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PseudoFileRendererOptions {
  readonly lang: SupportedLang;
  readonly theme: ThemeMode;
  readonly onRemove?: (file: PseudoFile) => void;
  readonly onChange?: (count: number) => void;
  readonly onSendNow?: () => void;
  readonly onInsertNow?: () => void;
}

function createDocumentIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M9.2 1.5H4.2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.1z');
  const fold = document.createElementNS(SVG_NS, 'path');
  fold.setAttribute('d', 'M9.2 1.5v3.6h3.6');
  const rule1 = document.createElementNS(SVG_NS, 'path');
  rule1.setAttribute('d', 'M5.6 8.6h4.8');
  const rule2 = document.createElementNS(SVG_NS, 'path');
  rule2.setAttribute('d', 'M5.6 11h3.2');

  svg.append(path, fold, rule1, rule2);
  return svg;
}

function createCloseIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4.5 4.5l7 7M11.5 4.5l-7 7');
  svg.append(path);
  return svg;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'txt';
  return name.slice(dot + 1).toLowerCase();
}

export class PseudoFileRenderer {
  private readonly manager: PseudoFileManager;
  private readonly options: PseudoFileRendererOptions;
  private dock: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private readonly cards = new Map<string, HTMLElement>();

  constructor(manager: PseudoFileManager, options: PseudoFileRendererOptions) {
    this.manager = manager;
    this.options = options;
  }

  get root(): HTMLElement | null {
    return this.dock;
  }

  get isMounted(): boolean {
    return Boolean(this.dock && this.dock.isConnected);
  }

  mount(anchor: HTMLElement | null): boolean {
    if (this.dock) return this.isMounted || this.remount(anchor);

    const dock = this.buildDock();
    const target = this.resolveMountTarget(anchor);

    if (target && target.parent) {
      target.parent.insertBefore(dock, target.reference);
      dock.dataset.placement = 'anchored';
    } else if (document.body) {
      document.body.appendChild(dock);
      dock.dataset.placement = 'floating';
    } else {
      return false;
    }

    this.dock = dock;
    return true;
  }

  private remount(anchor: HTMLElement | null): boolean {
    const dock = this.dock;
    if (!dock) return false;
    const target = this.resolveMountTarget(anchor);
    if (target && target.parent) {
      target.parent.insertBefore(dock, target.reference);
      dock.dataset.placement = 'anchored';
      return dock.isConnected;
    }
    if (document.body) {
      document.body.appendChild(dock);
      dock.dataset.placement = 'floating';
      return dock.isConnected;
    }
    return false;
  }

  private resolveMountTarget(
    anchor: HTMLElement | null,
  ): { parent: HTMLElement; reference: HTMLElement | null } | null {
    if (!anchor) return null;

    // 严禁侵入 contenteditable 内部
    const editorRoot = anchor.closest<HTMLElement>('[contenteditable="true"]') || anchor;

    const form = editorRoot.closest('form');
    if (form && form.contains(editorRoot)) {
      let cur = editorRoot;
      while (cur.parentElement && cur.parentElement !== form) {
        cur = cur.parentElement;
      }
      return { parent: form, reference: cur };
    }

    let current = editorRoot;
    while (current.parentElement && current.parentElement !== document.body) {
      const parent = current.parentElement;
      const display = window.getComputedStyle(parent).display;
      if (display === 'flex' && !window.getComputedStyle(parent).flexDirection.includes('column')) {
        current = parent;
        continue;
      }
      return { parent, reference: current };
    }

    return editorRoot.parentElement
      ? { parent: editorRoot.parentElement, reference: editorRoot }
      : { parent: document.body, reference: null };
  }

  private buildDock(): HTMLElement {
    const dock = document.createElement('div');
    dock.className = DOCK_CLASS;
    dock.dataset.aigiTheme = this.options.theme;
    dock.setAttribute('contenteditable', 'false');
    dock.setAttribute('data-aigi-surface', 'pseudo-file');

    const header = document.createElement('div');
    header.className = 'aigi-pseudo-header';

    const infoGroup = document.createElement('div');
    infoGroup.className = 'aigi-pseudo-info-group';

    const title = document.createElement('span');
    title.className = 'aigi-pseudo-title';
    title.textContent = this.options.lang === 'zh-CN' ? '待发送摘要' : 'Pending digest';

    this.summaryEl = document.createElement('span');
    this.summaryEl.className = 'aigi-pseudo-summary';
    infoGroup.append(title, this.summaryEl);

    const actions = this.buildDockActions();
    header.append(infoGroup, actions);

    this.listEl = document.createElement('ul');
    this.listEl.className = 'aigi-pseudo-list';

    dock.append(header, this.listEl);
    dock.dataset.empty = 'true';
    this.updateSummary();
    return dock;
  }

  private buildDockActions(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'aigi-pseudo-actions';

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'aigi-pseudo-btn aigi-pseudo-btn--ghost';
    insertBtn.textContent = this.options.lang === 'zh-CN' ? '填入' : 'Insert';
    insertBtn.title = this.options.lang === 'zh-CN' ? '展开填入输入框' : 'Insert into prompt';
    insertBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.options.onInsertNow?.();
    });

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'aigi-pseudo-btn aigi-pseudo-btn--primary';
    sendBtn.textContent = this.options.lang === 'zh-CN' ? '立即发送' : 'Send Now';
    sendBtn.title = this.options.lang === 'zh-CN' ? '拼装并立即发送消息' : 'Send prompt now';
    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.options.onSendNow?.();
    });

    actions.append(insertBtn, sendBtn);
    return actions;
  }

  add(file: PseudoFile): void {
    if (!this.listEl) return;
    if (this.cards.has(file.id)) return;

    const card = this.buildCard(file);
    this.cards.set(file.id, card);
    this.listEl.appendChild(card);
    this.updateSummary();
    this.options.onChange?.(this.cards.size);
  }

  private buildCard(file: PseudoFile): HTMLElement {
    const card = document.createElement('li');
    card.className = 'aigi-pseudo-card';
    card.dataset.fileId = file.id;
    card.dataset.ext = extensionOf(file.name);
    card.setAttribute('contenteditable', 'false');

    const icon = document.createElement('span');
    icon.className = 'aigi-pseudo-icon';
    icon.appendChild(createDocumentIcon());

    const body = document.createElement('span');
    body.className = 'aigi-pseudo-body';

    const name = document.createElement('span');
    name.className = 'aigi-pseudo-name';
    name.textContent = file.name;
    name.title = file.name;

    const meta = document.createElement('span');
    meta.className = 'aigi-pseudo-meta';
    meta.textContent = `${formatBytes(file.size)} · ${formatTokens(file.tokenEstimate)} tok`;

    body.append(name, meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'aigi-pseudo-remove';
    remove.setAttribute('aria-label', 'Remove file');
    remove.title = this.options.lang === 'zh-CN' ? '移除此文件' : 'Remove this file';
    remove.appendChild(createCloseIcon());

    remove.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.remove(file.id);
    });

    card.append(icon, body, remove);
    return card;
  }

  remove(id: string): boolean {
    const card = this.cards.get(id);
    const file = this.manager.get(id);
    if (!card || !file) return false;

    card.remove();
    this.cards.delete(id);
    this.manager.remove(id);
    this.updateSummary();

    this.options.onRemove?.(file);
    this.options.onChange?.(this.cards.size);
    return true;
  }

  clear(): void {
    for (const card of this.cards.values()) card.remove();
    this.cards.clear();
    this.updateSummary();
  }

  destroy(): void {
    this.clear();
    try {
      this.dock?.remove();
    } catch (err) {
      logger.debug('PseudoFileRenderer.destroy: dock removal threw', err);
    }
    this.dock = null;
    this.listEl = null;
    this.summaryEl = null;
    this.manager.clear();
  }

  private updateSummary(): void {
    const summary = this.summaryEl;
    if (!summary) return;
    const count = this.cards.size;
    if (count === 0) {
      summary.textContent = '';
      this.dock?.setAttribute('data-empty', 'true');
      return;
    }
    this.dock?.removeAttribute('data-empty');
    const tokens = formatTokens(this.manager.totalTokens);
    summary.textContent =
      this.options.lang === 'zh-CN'
        ? `${count} 项 · ${formatBytes(this.manager.totalBytes)} · ${tokens} tok`
        : `${count} file(s) · ${formatBytes(this.manager.totalBytes)} · ${tokens} tok`;
  }
}
