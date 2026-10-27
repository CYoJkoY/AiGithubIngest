import type { ThemeMode } from '../types';
import { STATUS_PILL_CSS } from './status-pill-styles';

export interface StatusPillLabels {
  readonly close: string;
  readonly forceFull: string;
  readonly subpath: string;
  readonly subpathPlaceholder: string;
  readonly apply: string;
}

export interface StatusPillOptions {
  readonly anchor: HTMLElement | null;
  readonly theme: ThemeMode;
  readonly labels: StatusPillLabels;
  readonly onForceFull: () => void;
  readonly onSubpath: (subpath: string) => void;
  readonly onDismiss: () => void;
}

type PillState = 'analyzing' | 'retrying' | 'ready' | 'error' | 'degraded';

interface PillRefs {
  readonly body: HTMLButtonElement;
  readonly text: HTMLElement;
  readonly chevron: HTMLElement;
  readonly close: HTMLButtonElement;
  readonly tray: HTMLElement;
  readonly forceFull: HTMLButtonElement;
  readonly subpath: HTMLButtonElement;
  readonly subpathRow: HTMLFormElement;
  readonly subpathInput: HTMLInputElement;
}

interface BarParts {
  readonly bar: HTMLElement;
  readonly dot: HTMLElement;
  readonly body: HTMLButtonElement;
  readonly text: HTMLElement;
  readonly chevron: HTMLElement;
  readonly close: HTMLButtonElement;
}

interface TrayParts {
  readonly tray: HTMLElement;
  readonly forceFull: HTMLButtonElement;
  readonly subpath: HTMLButtonElement;
  readonly subpathRow: HTMLFormElement;
  readonly subpathInput: HTMLInputElement;
}

interface MountTarget {
  readonly parent: HTMLElement;
  readonly before: HTMLElement | null;
}

const ROOT_CLASS = 'aigi-status-pill';

/**
 * Newest live pill, so a later ingest can retire a stale one without the
 * caller having to track every instance.
 */
let activePill: StatusPill | null = null;

function preventFocusSteal(button: HTMLButtonElement): void {
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
}

function createButton(className: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  preventFocusSteal(button);
  return button;
}

function createBarParts(labels: StatusPillLabels): BarParts {
  const bar = document.createElement('div');
  bar.className = 'aigi-status-pill__bar';

  const dot = document.createElement('span');
  dot.className = 'aigi-status-pill__dot';
  dot.setAttribute('aria-hidden', 'true');

  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'aigi-status-pill__body';
  body.dataset.actionable = 'false';
  body.setAttribute('aria-expanded', 'false');
  preventFocusSteal(body);

  const text = document.createElement('span');
  text.className = 'aigi-status-pill__text';
  text.setAttribute('aria-live', 'polite');
  text.setAttribute('aria-atomic', 'true');

  const chevron = document.createElement('span');
  chevron.className = 'aigi-status-pill__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.hidden = true;
  body.append(text, chevron);

  const close = createButton('aigi-status-pill__close', '\u00d7');
  close.setAttribute('aria-label', labels.close);
  close.title = labels.close;
  close.hidden = true;

  bar.append(dot, body, close);
  return { bar, dot, body, text, chevron, close };
}

function createTrayParts(labels: StatusPillLabels): TrayParts {
  const tray = document.createElement('div');
  tray.className = 'aigi-status-pill__tray';
  tray.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'aigi-status-pill__actions';

  const forceFull = createButton('aigi-status-pill__action', labels.forceFull);
  const subpath = createButton('aigi-status-pill__action', labels.subpath);
  actions.append(forceFull, subpath);

  const subpathRow = document.createElement('form');
  subpathRow.className = 'aigi-status-pill__subpath';
  subpathRow.hidden = true;

  const subpathInput = document.createElement('input');
  subpathInput.type = 'text';
  subpathInput.className = 'aigi-status-pill__input';
  subpathInput.placeholder = labels.subpathPlaceholder;
  subpathInput.setAttribute('aria-label', labels.subpath);
  subpathInput.autocomplete = 'off';
  subpathInput.spellcheck = false;

  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.className = 'aigi-status-pill__action aigi-status-pill__action--primary';
  apply.textContent = labels.apply;
  preventFocusSteal(apply);

  subpathRow.append(subpathInput, apply);
  tray.append(actions, subpathRow);
  return { tray, forceFull, subpath, subpathRow, subpathInput };
}

function setActivePill(pill: StatusPill | null): void {
  activePill = pill;
}

/**
 * Prefer the row that contains the composer, without entering a
 * contenteditable subtree. This mirrors the pseudo-file dock's placement so a
 * status reply appears where the user is already looking.
 */
function resolveMountTarget(anchor: HTMLElement | null): MountTarget | null {
  if (!anchor) return null;

  const editorRoot = anchor.closest<HTMLElement>('[contenteditable="true"]') ?? anchor;
  const form = editorRoot.closest('form');
  if (form && form.contains(editorRoot)) {
    let current = editorRoot;
    while (current.parentElement && current.parentElement !== form) {
      current = current.parentElement;
    }
    return { parent: form, before: current };
  }

  let current = editorRoot;
  while (current.parentElement && current.parentElement !== document.body) {
    const parent = current.parentElement;
    const style = window.getComputedStyle(parent);
    if (style.display === 'flex' && !style.flexDirection.includes('column')) {
      current = parent;
      continue;
    }
    return { parent, before: current };
  }

  if (!editorRoot.parentElement) return null;
  return { parent: editorRoot.parentElement, before: editorRoot };
}

/**
 * Lightweight status surface anchored to the active composer.
 *
 * The widget renders inside an open shadow root so host page styles cannot
 * repaint it, and the host resets inheritance so the page's typography stays
 * out of the widget.
 */
export class StatusPill {
  private readonly options: StatusPillOptions;
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private refs: PillRefs | null = null;
  private expanded = false;
  private disposed = false;

  constructor(options: StatusPillOptions) {
    this.options = options;
    this.host = document.createElement('div');
    this.host.className = ROOT_CLASS;
    this.host.dataset.aigiTheme = options.theme;
    this.host.dataset.aigiSurface = 'status-pill';
    this.host.dataset.state = 'analyzing';
    this.host.dataset.leaving = 'false';
    this.host.setAttribute('contenteditable', 'false');
    this.host.setAttribute('role', 'group');
    this.host.setAttribute('aria-label', 'AiGithubIngest');
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STATUS_PILL_CSS;
    shadow.append(style);
    this.shadow = shadow;
  }

  get root(): HTMLElement | null {
    return this.refs ? this.host : null;
  }

  mount(): boolean {
    if (this.disposed) return false;
    if (this.host.isConnected) return true;
    this.build();

    const target = resolveMountTarget(this.options.anchor);
    if (target) {
      target.parent.insertBefore(this.host, target.before);
      this.host.dataset.placement = 'anchored';
    } else if (document.body) {
      document.body.appendChild(this.host);
      this.host.dataset.placement = 'floating';
    } else {
      return false;
    }

    activePill?.retireIfDisconnected();
    setActivePill(this);
    return true;
  }

  showAnalyzing(message: string): void {
    this.render('analyzing', message, false);
  }

  showRetrying(message: string): void {
    this.render('retrying', message, false);
  }

  showReady(message: string): void {
    this.render('ready', message, false);
  }

  showError(message: string): void {
    this.render('error', message, false);
  }

  showDegraded(message: string, canForceFull: boolean): void {
    this.render('degraded', message, canForceFull);
  }

  fadeOut(): void {
    if (this.disposed) return;
    this.host.dataset.leaving = 'true';
  }

  /** Remove and make every later call a no-op, even for a late response. */
  dispose(): void {
    this.disposed = true;
    if (activePill === this) setActivePill(null);
    this.refs = null;
    this.expanded = false;
    this.host.remove();
  }

  private retireIfDisconnected(): void {
    if (this.host.isConnected || this.disposed) return;
    this.dispose();
  }

  private build(): PillRefs {
    if (this.refs) return this.refs;

    const head = createBarParts(this.options.labels);
    const tail = createTrayParts(this.options.labels);
    this.shadow.append(head.bar, tail.tray);

    const refs: PillRefs = {
      body: head.body,
      text: head.text,
      chevron: head.chevron,
      close: head.close,
      tray: tail.tray,
      forceFull: tail.forceFull,
      subpath: tail.subpath,
      subpathRow: tail.subpathRow,
      subpathInput: tail.subpathInput,
    };
    this.refs = refs;
    this.bindEvents(refs);
    return refs;
  }

  private bindEvents(refs: PillRefs): void {
    refs.body.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.host.dataset.state !== 'degraded') return;
      this.setExpanded(!this.expanded);
    });

    refs.close.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.options.onDismiss();
    });

    refs.forceFull.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setExpanded(false);
      this.options.onForceFull();
    });

    refs.subpath.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      refs.subpathRow.hidden = false;
      refs.subpathInput.focus();
    });

    refs.subpathRow.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const value = refs.subpathInput.value.trim();
      if (value === '') {
        refs.subpathInput.focus();
        return;
      }
      refs.subpathRow.hidden = true;
      this.options.onSubpath(value);
    });

    refs.subpathInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      refs.subpathRow.hidden = true;
      this.focusAnchor();
    });

    this.host.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || refs.subpathRow.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      refs.subpathRow.hidden = true;
      this.focusAnchor();
    });
  }

  private focusAnchor(): void {
    const anchor = this.options.anchor;
    if (!anchor) return;
    try {
      anchor.focus({ preventScroll: true });
    } catch {
      anchor.focus();
    }
  }

  private setExpanded(expanded: boolean): void {
    const refs = this.refs;
    if (!refs) return;
    this.expanded = expanded;
    refs.body.setAttribute('aria-expanded', String(expanded));
    refs.tray.hidden = !expanded;
    if (!expanded) {
      refs.subpathRow.hidden = true;
      refs.subpathInput.value = '';
    }
  }

  private render(state: PillState, message: string, canForceFull: boolean): void {
    if (this.disposed) return;
    this.mount();
    const refs = this.refs;
    if (refs === null) return;

    const interactive = state === 'degraded';
    this.host.dataset.state = state;
    this.host.dataset.leaving = 'false';
    refs.text.textContent = message;
    refs.body.dataset.actionable = String(interactive);
    refs.body.disabled = !interactive;
    refs.chevron.hidden = !interactive;
    refs.close.hidden = !interactive;
    refs.forceFull.hidden = !(interactive && canForceFull);
    refs.subpath.hidden = !interactive;
    if (!interactive) this.setExpanded(false);
  }
}

/** Remove the widget when its composer disappeared (SPA navigation). */
export function disposeStatusPill(): void {
  activePill?.dispose();
  setActivePill(null);
}

/** Test hook: the newest pill instance, if any. */
export function activeStatusPill(): StatusPill | null {
  return activePill;
}
