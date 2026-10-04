// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DigestPart } from '../core/output-formatter';
import { PseudoFileEngine } from './pseudo-file-engine';

function makeParts(count: number): DigestPart[] {
  return Array.from({ length: count }, (_, i) => ({
    fileName: `owner_repo.part${i + 1}of${count}.md`,
    content: `PART ${i + 1}\n`,
    sizeBytes: 8,
  }));
}

function makeComposer(): HTMLTextAreaElement {
  const editor = document.createElement('textarea');
  document.body.appendChild(editor);
  return editor;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PseudoFileEngine', () => {
  it('mounts every part as a card and reports the count', () => {
    const engine = new PseudoFileEngine({ lang: 'zh-CN', theme: 'light' });
    const result = engine.mount(makeParts(3), makeComposer());

    expect(result.ok).toBe(true);
    expect(result.registered).toBe(3);
    expect(result.rejected).toHaveLength(0);
    expect(document.querySelectorAll('.aigi-pseudo-card')).toHaveLength(3);
    expect(engine.pending).toBe(3);

    engine.dispose();
  });

  it('is not healthy before anything is mounted', () => {
    const engine = new PseudoFileEngine({ lang: 'zh-CN', theme: 'light' });
    expect(engine.isHealthy()).toBe(false);
    engine.dispose();
  });

  it('becomes healthy once the dock is anchored and the interceptor bound', () => {
    const engine = new PseudoFileEngine({ lang: 'zh-CN', theme: 'light' });
    engine.mount(makeParts(1), makeComposer());
    expect(engine.isHealthy()).toBe(true);
    engine.dispose();
  });

  it('stops being healthy after the host destroys the dock', () => {
    const engine = new PseudoFileEngine({ lang: 'zh-CN', theme: 'light' });
    engine.mount(makeParts(1), makeComposer());
    document.querySelector('.aigi-pseudo-dock')?.remove();
    expect(engine.isHealthy()).toBe(false);
    engine.dispose();
  });

  it('releases everything when mounting is impossible', () => {
    const detachedHost = document.createElement('div');
    const engine = new PseudoFileEngine({ lang: 'zh-CN', theme: 'light' });
    const result = engine.mount(makeParts(2), detachedHost);

    expect(result.ok).toBe(true);
    expect(result.registered).toBe(2);
    engine.dispose();
    expect(engine.pending).toBe(0);
  });

  it('reports rejected parts without losing the rest', () => {
    const engine = new PseudoFileEngine({ lang: 'zh-CN', theme: 'light' });
    const parts: DigestPart[] = [
      { fileName: 'good.md', content: 'OK', sizeBytes: 2 },
      { fileName: 'empty.md', content: '   ', sizeBytes: 3 },
    ];

    const result = engine.mount(parts, makeComposer());

    expect(result.ok).toBe(true);
    expect(result.registered).toBe(1);
    expect(result.rejected).toContain('EMPTY_CONTENT');

    engine.dispose();
  });

  it('flushes the digest into the composer and empties the dock', () => {
    const onFlushed = vi.fn();
    const engine = new PseudoFileEngine({ lang: 'zh-CN', theme: 'light', onFlushed });
    const editor = makeComposer();
    editor.value = 'review this';
    engine.mount(makeParts(2), editor);

    expect(engine.flush()).toBe(true);

    expect(editor.value).toContain('<file name="owner_repo.part1of2.md">');
    expect(editor.value).toContain('<file name="owner_repo.part2of2.md">');
    expect(editor.value.startsWith('review this')).toBe(true);
    expect(engine.pending).toBe(0);
    expect(onFlushed).toHaveBeenCalledWith({ count: 2, chars: expect.any(Number) });

    engine.dispose();
  });

  it('notifies when the last card is removed by hand', () => {
    const onEmptied = vi.fn();
    const engine = new PseudoFileEngine({ lang: 'zh-CN', theme: 'light', onEmptied });
    engine.mount(makeParts(1), makeComposer());

    const removeBtn = document.querySelector<HTMLButtonElement>('.aigi-pseudo-remove');
    removeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(onEmptied).toHaveBeenCalledTimes(1);
    expect(engine.pending).toBe(0);

    engine.dispose();
  });

  it('disposes without throwing when nothing was mounted', () => {
    const engine = new PseudoFileEngine({ lang: 'en', theme: 'dark' });
    expect(() => engine.dispose()).not.toThrow();
  });
});
