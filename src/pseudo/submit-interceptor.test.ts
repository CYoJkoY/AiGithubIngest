// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PseudoFileManager } from './pseudo-file-manager';
import { PseudoFileRenderer } from './pseudo-file-renderer';
import { SubmitInterceptor } from './submit-interceptor';
import { buildPlaceholder } from './payload';

/**
 * Every interceptor created by a test, so `afterEach` can detach them.
 *
 * Listeners live on `document` by design, so without this teardown a stale
 * interceptor from a previous test would still observe new events.
 */
const liveInterceptors: SubmitInterceptor[] = [];

interface Harness {
  readonly manager: PseudoFileManager;
  readonly renderer: PseudoFileRenderer;
  readonly interceptor: SubmitInterceptor;
  readonly editor: HTMLTextAreaElement;
}

function mountHarness(overrides: { lang?: 'zh-CN' | 'en' } = {}): Harness {
  const manager = new PseudoFileManager({ now: () => 1_700_000_000_000 });
  const renderer = new PseudoFileRenderer(manager, {
    lang: overrides.lang ?? 'zh-CN',
    theme: 'light',
  });

  const shell = document.createElement('div');
  const editor = document.createElement('textarea');
  shell.appendChild(editor);
  document.body.appendChild(shell);

  renderer.mount(editor);

  const interceptor = new SubmitInterceptor(manager, renderer, {
    lang: overrides.lang ?? 'zh-CN',
  });
  interceptor.attach(editor);
  liveInterceptors.push(interceptor);

  for (const [name, content] of [
    ['owner_repo.part1of2.md', 'PART ONE'],
    ['owner_repo.part2of2.md', 'PART TWO'],
  ] as const) {
    const result = manager.register(name, content);
    if (result.ok) renderer.add(result.file);
  }

  return { manager, renderer, interceptor, editor };
}

/** Dispatch a keydown the way a host composer would see it. */
function press(
  editor: HTMLElement,
  init: Partial<KeyboardEventInit> & { key: string },
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  editor.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  while (liveInterceptors.length > 0) liveInterceptors.pop()?.detach();
  vi.restoreAllMocks();
});

describe('SubmitInterceptor attachment', () => {
  it('refuses to attach without a composer', () => {
    const manager = new PseudoFileManager();
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    const interceptor = new SubmitInterceptor(manager, renderer, { lang: 'zh-CN' });
    liveInterceptors.push(interceptor);
    expect(interceptor.attach(null)).toBe(false);
    expect(interceptor.isAttached).toBe(false);
  });

  it('reports the pending file count', () => {
    const { interceptor } = mountHarness();
    expect(interceptor.pending).toBe(2);
  });

  it('detaches cleanly and stops reacting to keys', () => {
    const { interceptor, editor } = mountHarness();
    interceptor.detach();

    press(editor, { key: 'Enter' });

    expect(interceptor.isAttached).toBe(false);
    expect(interceptor.pending).toBe(2);
    expect(editor.value).toBe('');
  });
});

describe('SubmitInterceptor IME safety', () => {
  it('never flushes while an IME composition is active', () => {
    const { editor, manager } = mountHarness();

    press(editor, { key: 'Enter', isComposing: true });

    expect(manager.count).toBe(2);
    expect(editor.value).toBe('');
  });

  it('never flushes on the legacy composition keycode 229', () => {
    const { editor, manager } = mountHarness();

    // jsdom cannot set the deprecated keyCode via the constructor, so the
    // property is defined the way a Chromium IME path would surface it.
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => 229 });
    editor.dispatchEvent(event);

    expect(manager.count).toBe(2);
    expect(editor.value).toBe('');
  });

  it('never flushes on Shift+Enter (newline)', () => {
    const { editor, manager } = mountHarness();

    press(editor, { key: 'Enter', shiftKey: true });

    expect(manager.count).toBe(2);
    expect(editor.value).toBe('');
  });

  it('never flushes on Ctrl/Cmd+Enter', () => {
    const { editor, manager } = mountHarness();

    press(editor, { key: 'Enter', ctrlKey: true });
    press(editor, { key: 'Enter', metaKey: true });

    expect(manager.count).toBe(2);
    expect(editor.value).toBe('');
  });

  it('never flushes on a non-Enter key', () => {
    const { editor, manager } = mountHarness();

    press(editor, { key: 'a' });
    press(editor, { key: 'Escape' });

    expect(manager.count).toBe(2);
    expect(editor.value).toBe('');
  });

  it('ignores Enter when the registry is empty', () => {
    const { editor, manager, interceptor } = mountHarness();
    manager.clear();
    interceptor.flush();

    expect(interceptor.flush()).toBe(false);
    expect(editor.value).toBe('');
  });

  it('ignores Enter that originates outside the composer', () => {
    const { manager, editor } = mountHarness();
    const stranger = document.createElement('textarea');
    document.body.appendChild(stranger);

    press(stranger, { key: 'Enter' });

    expect(manager.count).toBe(2);
    expect(editor.value).toBe('');
  });
});

describe('SubmitInterceptor flush', () => {
  it('appends every part as a named file block', () => {
    const { editor } = mountHarness();

    press(editor, { key: 'Enter' });

    expect(editor.value).toContain('<file name="owner_repo.part1of2.md">');
    expect(editor.value).toContain('PART ONE');
    expect(editor.value).toContain('<file name="owner_repo.part2of2.md">');
    expect(editor.value).toContain('PART TWO');
  });

  it('preserves the text the user already typed', () => {
    const { editor } = mountHarness();
    editor.value = '请解释这个项目';

    press(editor, { key: 'Enter' });

    expect(editor.value.startsWith('请解释这个项目')).toBe(true);
    expect(editor.value).toContain('<file name="owner_repo.part1of2.md">');
  });

  it('dispatches input and change so controlled composers resync', () => {
    const { editor } = mountHarness();
    const onInput = vi.fn();
    const onChange = vi.fn();
    editor.addEventListener('input', onInput);
    editor.addEventListener('change', onChange);

    press(editor, { key: 'Enter' });

    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('uses the localized preamble', () => {
    const { editor } = mountHarness({ lang: 'en' });

    press(editor, { key: 'Enter' });

    expect(editor.value).toContain('Below is the GitHub repository digest I attached.');
  });

  it('garbage collects memory and card DOM in the same tick', () => {
    const { editor, manager, renderer, interceptor } = mountHarness();
    expect(renderer.root?.querySelectorAll('.aigi-pseudo-card')).toHaveLength(2);

    press(editor, { key: 'Enter' });

    expect(manager.count).toBe(0);
    expect(manager.totalBytes).toBe(0);
    expect(renderer.root?.querySelectorAll('.aigi-pseudo-card')).toHaveLength(0);
    expect(interceptor.pending).toBe(0);
  });
});

describe('SubmitInterceptor idempotency', () => {
  it('never duplicates the payload on a second Enter', () => {
    const { editor, manager } = mountHarness();

    press(editor, { key: 'Enter' });
    const first = editor.value;

    press(editor, { key: 'Enter' });

    expect(editor.value).toBe(first);
    expect(manager.count).toBe(0);
  });

  it('expands a leftover placeholder in place instead of appending', () => {
    const { editor, manager, interceptor } = mountHarness();
    const files = manager.list();
    editor.value = `please review ${buildPlaceholder(files[0].id)}`;

    expect(interceptor.flush()).toBe(true);

    expect(editor.value).toBe(
      `please review <file name="owner_repo.part1of2.md">\nPART ONE\n</file>`,
    );
    expect(editor.value).not.toContain('__PSEUDO_FILE_');
  });

  it('reports the flush through the callback', () => {
    const manager = new PseudoFileManager({ now: () => 1_700_000_000_000 });
    const renderer = new PseudoFileRenderer(manager, { lang: 'zh-CN', theme: 'light' });
    const editor = document.createElement('textarea');
    document.body.appendChild(editor);
    renderer.mount(editor);

    const onFlushed = vi.fn();
    const interceptor = new SubmitInterceptor(manager, renderer, { lang: 'zh-CN', onFlushed });
    interceptor.attach(editor);
    liveInterceptors.push(interceptor);

    const result = manager.register('a.md', 'CONTENT');
    if (result.ok) renderer.add(result.file);

    press(editor, { key: 'Enter' });

    expect(onFlushed).toHaveBeenCalledTimes(1);
    expect(onFlushed.mock.calls[0][0]).toMatchObject({ count: 1 });
    expect(onFlushed.mock.calls[0][0].chars).toBeGreaterThan(0);
  });

  it('retains the payload when the composer has been detached', () => {
    const { editor, manager, interceptor } = mountHarness();
    editor.remove();

    expect(interceptor.flush()).toBe(false);
    expect(manager.count).toBe(2);
  });
});

describe('SubmitInterceptor send-button path', () => {
  it('flushes on pointerdown over a send control', () => {
    const { editor, manager } = mountHarness();
    const send = document.createElement('button');
    send.setAttribute('aria-label', 'Send message');
    document.body.appendChild(send);

    send.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));

    expect(manager.count).toBe(0);
    expect(editor.value).toContain('PART ONE');
  });

  it('ignores a disabled send control', () => {
    const { editor, manager } = mountHarness();
    const send = document.createElement('button');
    send.setAttribute('aria-label', 'Send message');
    send.disabled = true;
    document.body.appendChild(send);

    send.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));

    expect(manager.count).toBe(2);
    expect(editor.value).toBe('');
  });

  it('ignores an unrelated control such as "stop generating"', () => {
    const { editor, manager } = mountHarness();
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Stop generating');
    document.body.appendChild(stop);

    stop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));

    expect(manager.count).toBe(2);
    expect(editor.value).toBe('');
  });
});
