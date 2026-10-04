import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_PSEUDO_FILES,
  PseudoFileManager,
  type PseudoFileManagerOptions,
} from './pseudo-file-manager';
import { utf8ByteLength } from './payload';

/** Deterministic clock: ids become predictable without touching global time. */
function makeManager(options: PseudoFileManagerOptions = {}): PseudoFileManager {
  let tick = 1_700_000_000_000;
  return new PseudoFileManager({ now: () => tick++, ...options });
}

describe('PseudoFileManager.register', () => {
  it('assigns a pf_-prefixed unique id', () => {
    const manager = makeManager();
    const first = manager.register('a.md', 'A');
    const second = manager.register('b.md', 'B');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.file.id).toMatch(/^pf_[0-9a-z]+$/);
    expect(first.file.id).not.toBe(second.file.id);
  });

  it('measures size in UTF-8 bytes, not UTF-16 code units', () => {
    const manager = makeManager();
    const result = manager.register('zh.md', '中文内容');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 4 CJK glyphs × 3 bytes; String.length would have reported 4.
    expect(result.file.size).toBe(utf8ByteLength('中文内容'));
    expect(result.file.size).toBe(12);
  });

  it('estimates tokens for the payload', () => {
    const manager = makeManager();
    const result = manager.register('a.md', 'const value = 42;\n'.repeat(20));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.tokenEstimate).toBeGreaterThan(0);
  });

  it('rejects empty and whitespace-only payloads', () => {
    const manager = makeManager();
    expect(manager.register('a.md', '')).toEqual({ ok: false, reason: 'EMPTY_CONTENT' });
    expect(manager.register('a.md', '   \n\t ')).toEqual({ ok: false, reason: 'EMPTY_CONTENT' });
  });

  it('sanitizes the stored name', () => {
    const manager = makeManager();
    const result = manager.register('../../etc/passwd', 'payload');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.name).toBe('.._.._etc_passwd');
  });

  it('enforces the file-count guard', () => {
    const manager = makeManager({ maxFiles: 2 });
    expect(manager.register('a.md', 'A').ok).toBe(true);
    expect(manager.register('b.md', 'B').ok).toBe(true);
    expect(manager.register('c.md', 'C')).toEqual({ ok: false, reason: 'FILE_LIMIT' });
  });

  it('enforces the resident-byte budget and rejects only the overflowing file', () => {
    const manager = makeManager({ maxTotalBytes: 10 });
    expect(manager.register('a.md', '12345').ok).toBe(true);
    expect(manager.register('b.md', '12345').ok).toBe(true);
    expect(manager.register('c.md', '1')).toEqual({ ok: false, reason: 'BYTE_LIMIT' });
    expect(manager.count).toBe(2);
    expect(manager.totalBytes).toBe(10);
  });

  it('defaults to a budget large enough for a realistic multi-part digest', () => {
    const manager = new PseudoFileManager();
    for (let i = 0; i < DEFAULT_MAX_PSEUDO_FILES - 1; i++) {
      expect(manager.register(`part${i}.md`, 'x'.repeat(1024 * 1024)).ok).toBe(true);
    }
    expect(manager.count).toBe(DEFAULT_MAX_PSEUDO_FILES - 1);
  });
});

describe('PseudoFileManager memory lifecycle', () => {
  it('preserves registration order so split parts stay in sequence', () => {
    const manager = makeManager();
    for (const name of ['a.part1of3.md', 'a.part2of3.md', 'a.part3of3.md']) {
      manager.register(name, name);
    }
    expect(manager.list().map((f) => f.name)).toEqual([
      'a.part1of3.md',
      'a.part2of3.md',
      'a.part3of3.md',
    ]);
  });

  it('releases bytes on remove', () => {
    const manager = makeManager();
    const result = manager.register('a.md', '12345');
    if (!result.ok) throw new Error('setup failed');

    expect(manager.totalBytes).toBe(5);
    expect(manager.remove(result.file.id)).toBe(true);
    expect(manager.totalBytes).toBe(0);
    expect(manager.count).toBe(0);
  });

  it('is a no-op when removing an unknown id', () => {
    const manager = makeManager();
    expect(manager.remove('pf_nope')).toBe(false);
    expect(manager.remove('')).toBe(false);
    expect(manager.get('')).toBeUndefined();
  });

  it('clears everything on GC', () => {
    const manager = makeManager();
    manager.register('a.md', 'A');
    manager.register('b.md', 'B');

    manager.clear();

    expect(manager.count).toBe(0);
    expect(manager.totalBytes).toBe(0);
    expect(manager.totalTokens).toBe(0);
    expect(manager.list()).toHaveLength(0);
  });

  it('does not alias the internal registry through list()', () => {
    const manager = makeManager();
    manager.register('a.md', 'A');
    const snapshot = manager.list();
    manager.clear();
    expect(snapshot).toHaveLength(1);
  });

  it('sums token estimates across files', () => {
    const manager = makeManager();
    const a = manager.register('a.md', 'AAAA');
    const b = manager.register('b.md', 'BBBB');
    if (!a.ok || !b.ok) throw new Error('setup failed');
    expect(manager.totalTokens).toBe(a.file.tokenEstimate + b.file.tokenEstimate);
  });
});
