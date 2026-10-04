// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PseudoFile } from '../types';
import { PseudoFileManager } from './pseudo-file-manager';
import { PseudoFileRenderer } from './pseudo-file-renderer';
import { formatTokens, utf8ByteLength } from './payload';

/**
 * These tests cover the two invariants the architecture promises:
 *   1. no payload content ever reaches the host DOM;
 *   2. card removal frees memory and DOM in the same tick (no ghost refs).
 */

function makeFile(id: string, name: string, content: string): PseudoFile {
  return { id, name, size: utf8ByteLength(content), content, tokenEstimate: 12 };
}

/**
 * Register through the manager and dock the resulting handle.
 *
 * Ids are minted by the manager, so a test must never hand-roll one — that is
 * exactly the class of bug (DOM id ≠ registry id) this helper prevents.
 */
function addFile(name: string, content: string, renderer: PseudoFileRenderer): PseudoFile {
  const result = manager.register(name, content);
  if (!result.ok) throw new Error(`register failed: ${result.reason}`);
  renderer.add(result.file);
  return result.file;
}

function makeComposer(): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  const shell = document.createElement('div');
  shell.appendChild(textarea);
  document.body.appendChild(shell);
  return textarea;
}

let manager: PseudoFileManager;

beforeEach(() => {
  document.body.innerHTML = '';
  manager = new PseudoFileManager({ now: () => 1_700_000_000_000 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PseudoFileRenderer mounting', () => {
  it('anchors the dock directly above the host composer', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });

    expect(renderer.mount(editor)).toBe(true);
    expect(renderer.root?.dataset.placement).toBe('anchored');
    expect(editor.previousElementSibling).toBe(renderer.root);
  });

  it('falls back to a floating dock when no anchor is available', () => {
    const renderer = new PseudoFileRenderer(manager, { lang: 'en', theme: 'dark' });

    expect(renderer.mount(null)).toBe(true);
    expect(renderer.root?.dataset.placement).toBe('floating');
    expect(renderer.root?.parentElement).toBe(document.body);
  });

  it('carries the extension theme onto the dock for the scoped spectrum', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'dark' });
    renderer.mount(editor);
    expect(renderer.root?.dataset.aigiTheme).toBe('dark');
  });

  it('reports health from live DOM connectivity', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    expect(renderer.isMounted).toBe(false);
    renderer.mount(editor);
    expect(renderer.isMounted).toBe(true);
    renderer.root?.remove();
    expect(renderer.isMounted).toBe(false);
  });
});

describe('PseudoFileRenderer cards', () => {
  it('renders only metadata — the payload never enters the DOM', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    renderer.mount(editor);

    const secret = 'SUPER_SECRET_SOURCE_CODE_MARKER';
    addFile('owner_repo.md', secret, renderer);

    const dock = renderer.root as HTMLElement;
    expect(dock.textContent).not.toContain(secret);
    expect(dock.innerHTML).not.toContain(secret);
    expect(dock.textContent).toContain('owner_repo.md');
  });

  it('writes file names as text, never markup', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    renderer.mount(editor);

    // The manager sanitizes names upstream; this asserts the renderer's own
    // defence in depth — createElement + textContent, never innerHTML.
    const hostile = '<img src=x onerror="window.__pwned=1">';
    renderer.add(makeFile('pf_1', hostile, 'payload'));

    const dock = renderer.root as HTMLElement;
    expect(dock.querySelector('img')).toBeNull();
    expect((globalThis as { __pwned?: number }).__pwned).toBeUndefined();
    expect(dock.querySelector('.aigi-pseudo-name')?.textContent).toBe(hostile);
  });

  it('exposes card identity, extension, and a labelled remove control', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'en', theme: 'light' });
    renderer.mount(editor);

    const file = addFile('owner_repo.part1of3.md', 'body', renderer);

    const card = renderer.root?.querySelector<HTMLElement>(`[data-file-id="${file.id}"]`);
    expect(card).not.toBeNull();
    expect(card?.dataset.ext).toBe('md');
    expect(card?.getAttribute('contenteditable')).toBe('false');
    expect(card?.querySelector('[aria-label="Remove file"]')).not.toBeNull();
  });

  it('never duplicates a card for the same file', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'en', theme: 'light' });
    renderer.mount(editor);

    const file = makeFile('pf_1', 'a.md', 'A');
    renderer.add(file);
    renderer.add(file);

    expect(renderer.root?.querySelectorAll('.aigi-pseudo-card')).toHaveLength(1);
  });

  it('summarises count, bytes, and tokens in the dock header', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'en', theme: 'light' });
    renderer.mount(editor);

    addFile('a.md', 'x'.repeat(2048), renderer);
    addFile('b.md', 'y'.repeat(1024), renderer);

    // 3 KB total; the token figure comes from the manager's live registry.
    expect(renderer.root?.querySelector('.aigi-pseudo-summary')?.textContent).toBe(
      `2 file(s) · 3.0 KB · ${formatTokens(manager.totalTokens)} tok`,
    );
  });
});

describe('PseudoFileRenderer removal & GC', () => {
  it('frees memory and DOM together on remove', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    renderer.mount(editor);

    const file = addFile('a.md', 'x'.repeat(1024), renderer);

    expect(manager.totalBytes).toBe(1024);
    expect(renderer.remove(file.id)).toBe(true);

    expect(manager.get(file.id)).toBeUndefined();
    expect(manager.totalBytes).toBe(0);
    expect(renderer.root?.querySelector('.aigi-pseudo-card')).toBeNull();
  });

  it('stops the remove click from stealing focus from the composer', () => {
    const editor = makeComposer();
    editor.focus();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    renderer.mount(editor);

    addFile('a.md', 'A', renderer);

    const removeBtn = renderer.root?.querySelector<HTMLButtonElement>('.aigi-pseudo-remove');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    removeBtn?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(editor);
    expect(renderer.root?.querySelector('.aigi-pseudo-card')).toBeNull();
  });

  it('is a no-op when removing an id with no card', () => {
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    renderer.mount(makeComposer());
    expect(renderer.remove('pf_ghost')).toBe(false);
  });

  it('destroys the dock, the cards, and the memory in one pass', () => {
    const editor = makeComposer();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    renderer.mount(editor);

    manager.register('a.md', 'A');
    manager.register('b.md', 'B');
    for (const file of manager.list()) renderer.add(file);

    renderer.destroy();

    expect(document.querySelector('.aigi-pseudo-dock')).toBeNull();
    expect(manager.count).toBe(0);
    expect(renderer.isMounted).toBe(false);
  });

  it('notifies observers when the dock empties', () => {
    const editor = makeComposer();
    const onEmptied = vi.fn();
    const onChange = vi.fn();
    const renderer = new PseudoFileRenderer(manager, {
      lang: 'zh-CN',
      theme: 'light',
      onRemove: () => {
        if (manager.count === 0) onEmptied();
      },
      onChange,
    });
    renderer.mount(editor);

    const file = addFile('a.md', 'A', renderer);
    expect(onChange).toHaveBeenLastCalledWith(1);

    renderer.remove(file.id);
    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(onEmptied).toHaveBeenCalledTimes(1);
  });
});
