// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeMode } from '../types';
import {
  activeStatusPill,
  disposeStatusPill,
  StatusPill,
  type StatusPillLabels,
} from './status-pill';
import { STATUS_PILL_CSS } from './status-pill-styles';

const LABELS: StatusPillLabels = {
  close: 'Close',
  forceFull: 'Force full',
  subpath: 'Specific subpath',
  subpathPlaceholder: 'e.g. src/core',
  apply: 'Apply',
};

function makeComposer(): HTMLTextAreaElement {
  const shell = document.createElement('div');
  const form = document.createElement('form');
  const row = document.createElement('div');
  const textarea = document.createElement('textarea');
  row.appendChild(textarea);
  form.appendChild(row);
  shell.appendChild(form);
  document.body.appendChild(shell);
  return textarea;
}

function createPill(anchor: HTMLElement | null, theme: ThemeMode = 'light') {
  const onForceFull = vi.fn();
  const onSubpath = vi.fn();
  const onDismiss = vi.fn();
  const pill = new StatusPill({ anchor, theme, labels: LABELS, onForceFull, onSubpath, onDismiss });
  return { pill, onForceFull, onSubpath, onDismiss };
}

function shadow(pill: StatusPill): ShadowRoot {
  const root = pill.root?.shadowRoot;
  if (!root) throw new Error('pill is not mounted');
  return root;
}

function query<T extends HTMLElement>(pill: StatusPill, selector: string): T {
  const node = shadow(pill).querySelector<T>(selector);
  if (!node) throw new Error('missing ' + selector);
  return node;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  disposeStatusPill();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('StatusPill isolation', () => {
  it('renders inside an open shadow root', () => {
    const { pill } = createPill(null);
    pill.showAnalyzing('Analyzing');

    const host = pill.root;
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();
    expect(document.querySelector('.aigi-status-pill__bar')).toBeNull();
    expect(query(pill, '.aigi-status-pill__text').textContent).toBe('Analyzing');
    expect(host?.getAttribute('contenteditable')).toBe('false');
    expect(host?.dataset.aigiSurface).toBe('status-pill');
  });

  it('injects the bundled stylesheet and carries the theme', () => {
    const { pill } = createPill(null, 'dark');
    pill.showReady('Done');

    const host = pill.root;
    expect(host?.dataset.aigiTheme).toBe('dark');
    const style = shadow(pill).querySelector('style');
    expect(style?.textContent).toBe(STATUS_PILL_CSS);
    expect(style?.textContent).toContain(":host([data-aigi-theme='dark'])");
  });

  it('anchors above the composer inside the form row', () => {
    const anchor = makeComposer();
    const { pill } = createPill(anchor);
    pill.showAnalyzing('Analyzing');

    expect(pill.root?.dataset.placement).toBe('anchored');
    expect(pill.root?.parentElement).toBe(anchor.closest('form'));
    expect(anchor.closest('form')?.firstElementChild).toBe(pill.root);
  });

  it('floats on the body when there is no composer', () => {
    const { pill } = createPill(null);
    pill.showAnalyzing('Analyzing');

    expect(pill.root?.dataset.placement).toBe('floating');
    expect(pill.root?.parentElement).toBe(document.body);
  });
});

describe('StatusPill states', () => {
  it('keeps ready non-interactive', () => {
    const { pill, onForceFull, onSubpath } = createPill(null);
    pill.showReady('Extracted');

    const body = query<HTMLButtonElement>(pill, '.aigi-status-pill__body');
    expect(body.disabled).toBe(true);
    expect(body.dataset.actionable).toBe('false');
    expect(query(pill, '.aigi-status-pill__chevron').hidden).toBe(true);
    expect(query(pill, '.aigi-status-pill__close').hidden).toBe(true);
    expect(query(pill, '.aigi-status-pill__tray').hidden).toBe(true);

    body.click();
    expect(onForceFull).not.toHaveBeenCalled();
    expect(onSubpath).not.toHaveBeenCalled();
  });

  it('expands the tray only for a degraded digest', () => {
    const { pill } = createPill(null);
    pill.showDegraded('Skeleton', true);

    const body = query<HTMLButtonElement>(pill, '.aigi-status-pill__body');
    const tray = query(pill, '.aigi-status-pill__tray');
    expect(body.disabled).toBe(false);
    expect(body.dataset.actionable).toBe('true');
    expect(tray.hidden).toBe(true);

    body.click();
    expect(body.getAttribute('aria-expanded')).toBe('true');
    expect(tray.hidden).toBe(false);

    body.click();
    expect(body.getAttribute('aria-expanded')).toBe('false');
    expect(tray.hidden).toBe(true);
  });

  it('routes Force full to the session', () => {
    const { pill, onForceFull } = createPill(null);
    pill.showDegraded('Skeleton', true);
    query<HTMLButtonElement>(pill, '.aigi-status-pill__body').click();

    const forceFull = query<HTMLButtonElement>(pill, '.aigi-status-pill__action');
    expect(forceFull.hidden).toBe(false);
    forceFull.click();

    expect(onForceFull).toHaveBeenCalledTimes(1);
    expect(query(pill, '.aigi-status-pill__tray').hidden).toBe(true);
  });

  it('hides Force full when the tree itself was truncated', () => {
    const { pill } = createPill(null);
    pill.showDegraded('Skeleton', false);
    query<HTMLButtonElement>(pill, '.aigi-status-pill__body').click();

    expect(query<HTMLButtonElement>(pill, '.aigi-status-pill__action').hidden).toBe(true);
  });

  it('dismisses through the close control', () => {
    const { pill, onDismiss } = createPill(null);
    pill.showDegraded('Skeleton', true);
    query<HTMLButtonElement>(pill, '.aigi-status-pill__close').click();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('StatusPill subpath form', () => {
  it('submits a trimmed subpath and closes the row', () => {
    const { pill, onSubpath } = createPill(null);
    pill.showDegraded('Skeleton', true);
    query<HTMLButtonElement>(pill, '.aigi-status-pill__body').click();

    const actions = shadow(pill).querySelectorAll<HTMLButtonElement>('.aigi-status-pill__action');
    actions[1].click();
    const row = query<HTMLFormElement>(pill, '.aigi-status-pill__subpath');
    const input = query<HTMLInputElement>(pill, '.aigi-status-pill__input');
    expect(row.hidden).toBe(false);

    input.value = '  src/core  ';
    row.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onSubpath).toHaveBeenCalledWith('src/core');
    expect(row.hidden).toBe(true);
  });

  it('ignores an empty submission', () => {
    const { pill, onSubpath } = createPill(null);
    pill.showDegraded('Skeleton', true);
    query<HTMLButtonElement>(pill, '.aigi-status-pill__body').click();
    shadow(pill).querySelectorAll<HTMLButtonElement>('.aigi-status-pill__action')[1].click();

    const row = query<HTMLFormElement>(pill, '.aigi-status-pill__subpath');
    query<HTMLInputElement>(pill, '.aigi-status-pill__input').value = '   ';
    row.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onSubpath).not.toHaveBeenCalled();
    expect(row.hidden).toBe(false);
  });

  it('closes the row on Escape and refocuses the composer', () => {
    const anchor = makeComposer();
    anchor.focus();
    const { pill } = createPill(anchor);
    pill.showDegraded('Skeleton', true);
    query<HTMLButtonElement>(pill, '.aigi-status-pill__body').click();
    shadow(pill).querySelectorAll<HTMLButtonElement>('.aigi-status-pill__action')[1].click();

    const row = query<HTMLFormElement>(pill, '.aigi-status-pill__subpath');
    const input = query<HTMLInputElement>(pill, '.aigi-status-pill__input');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );

    expect(row.hidden).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });
});

describe('StatusPill focus and lifecycle', () => {
  it('prevents mousedown from stealing focus', () => {
    const anchor = makeComposer();
    anchor.focus();
    const { pill } = createPill(anchor);
    pill.showDegraded('Skeleton', true);
    query<HTMLButtonElement>(pill, '.aigi-status-pill__body').click();

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    query<HTMLButtonElement>(pill, '.aigi-status-pill__action').dispatchEvent(down);

    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });

  it('never remounts after disposal', () => {
    const { pill } = createPill(null);
    pill.showAnalyzing('Analyzing');
    const host = pill.root;
    expect(host).not.toBeNull();

    pill.dispose();
    expect(document.body.contains(host)).toBe(false);
    expect(pill.root).toBeNull();
    expect(pill.mount()).toBe(false);

    pill.showDegraded('Late response', true);

    expect(document.body.children).toHaveLength(0);
    expect(activeStatusPill()).toBeNull();
  });

  it('retires only the newest pill on SPA disposal', () => {
    const first = createPill(null).pill;
    first.showAnalyzing('First');
    const second = createPill(null).pill;
    second.showAnalyzing('Second');

    expect(activeStatusPill()).toBe(second);
    disposeStatusPill();

    expect(activeStatusPill()).toBeNull();
    expect(first.root).not.toBeNull();
    expect(second.root).toBeNull();
  });
});
