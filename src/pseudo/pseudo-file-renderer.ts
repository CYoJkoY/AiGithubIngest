import type { PseudoFile, SupportedLang, ThemeMode } from '../types';
import { logger } from '../core/logger';
import { formatBytes, formatTokens } from './payload';
import type { PseudoFileManager } from './pseudo-file-manager';

/**
 * View layer for the pseudo-file engine.
 *
 * Contract: the host DOM only ever receives metadata. Card text is written
 * with `textContent` — never `innerHTML` — so a repository named
 * `<img onerror=…>` is rendered as literal characters.
 *
 * Every card declares `contain: layout paint`, which stops a card mutation
 * from propagating a reflow to the host input or its layout ancestors.
 */

export const DOCK_CLASS = 'aigi-pseudo-dock';
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PseudoFileRendererOptions {
  readonly lang: SupportedLang;
  readonly theme: ThemeMode;
  /** Fired after a card is removed from the DOM and its memory freed. */
  readonly onRemove?: (file: PseudoFile) => void;
  /** Fired when the set of cards changes (including to empty). */
  readonly onChange?: (count: number) => void;
}

/** Minimal 16×16 linear document glyph. */
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

/** Minimal 16×16 close glyph. */
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

  /**
   * Insert the dock directly above the host input.
   *
   * Anchoring before the editor keeps the card visually attached to the
   * composer and, crucially, keeps the injected node outside the React/Vue
   * subtree that manages the input's own value. When no anchor can be found we
   * fall back to a fixed-position dock pinned above the page bottom.
   */
  mount(anchor: HTMLElement | null): boolean {
    if (this.dock) return this.isMounted || this.remount(anchor);

    const dock = this.buildDock();
    const parent = anchor?.parentElement ?? null;

    if (parent) {
      parent.insertBefore(dock, anchor);
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
    const parent = anchor?.parentElement ?? document.body;
    if (!parent) return false;
    parent.insertBefore(dock, anchor);
    dock.dataset.placement = anchor?.parentElement ? 'anchored' : 'floating';
    return dock.isConnected;
  }

  private buildDock(): HTMLElement {
    const dock = document.createElement('div');
    dock.className = DOCK_CLASS;
    dock.dataset.aigiTheme = this.options.theme;
    dock.setAttribute('contenteditable', 'false');
    // Keeps the injected surface out of the host's editing/selection model.
    dock.setAttribute('data-aigi-surface', 'pseudo-file');

    const header = document.createElement('div');
    header.className = 'aigi-pseudo-header';

    const title = document.createElement('span');
    title.className = 'aigi-pseudo-title';
    title.textContent = this.options.lang === 'zh-CN' ? '待发送摘要' : 'Pending digest';

    this.summaryEl = document.createElement('span');
    this.summaryEl.className = 'aigi-pseudo-summary';

    header.append(title, this.summaryEl);

    this.listEl = document.createElement('ul');
    this.listEl.className = 'aigi-pseudo-list';

    dock.append(header, this.listEl);
    // A dock is born empty; `updateSummary` clears the flag as cards arrive.
    dock.dataset.empty = 'true';
    this.updateSummary();
    return dock;
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

    // Both handlers stop propagation so removing a card never steals focus
    // from the host input or triggers the composer's own click behaviour.
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

  /**
   * Remove a card and free its payload in the same tick.
   *
   * DOM and memory are mutated together — there is no window in which a card
   * survives while its backing text is already gone (no ghost references).
   */
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

  /** Tear the whole surface down: DOM first, then memory. */
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
