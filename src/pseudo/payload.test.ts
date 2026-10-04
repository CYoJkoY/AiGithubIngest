import { describe, expect, it } from 'vitest';
import type { PseudoFile } from '../types';
import {
  MAX_PAYLOAD_CHARS,
  buildPlaceholder,
  formatBytes,
  formatTokens,
  replacePlaceholders,
  sanitizeFileName,
  synthesizePayload,
  utf8ByteLength,
  wrapFileBlock,
} from './payload';

function makeFile(id: string, name: string, content: string): PseudoFile {
  return {
    id,
    name,
    size: utf8ByteLength(content),
    content,
    tokenEstimate: 1,
  };
}

describe('placeholder envelope', () => {
  it('builds a resolvable handle for a file id', () => {
    expect(buildPlaceholder('pf_abc1')).toBe('__PSEUDO_FILE_pf_abc1__');
  });

  it('round-trips through the global pattern without leaking lastIndex', () => {
    const input = `before ${buildPlaceholder('pf_1')} after ${buildPlaceholder('pf_2')}`;
    const files = new Map([
      ['pf_1', makeFile('pf_1', 'a.md', 'AAA')],
      ['pf_2', makeFile('pf_2', 'b.md', 'BBB')],
    ]);

    const first = replacePlaceholders(input, (id) => files.get(id));
    const second = replacePlaceholders(input, (id) => files.get(id));

    expect(first).toBe(second);
    expect(first).toContain('<file name="a.md">');
    expect(first).toContain('<file name="b.md">');
  });

  it('leaves unknown placeholders untouched', () => {
    const input = buildPlaceholder('pf_missing');
    expect(replacePlaceholders(input, () => undefined)).toBe(input);
  });

  it('ignores text without placeholders', () => {
    expect(replacePlaceholders('plain prompt', () => undefined)).toBe('plain prompt');
  });
});

describe('wrapFileBlock', () => {
  it('escapes a hostile file name so it cannot break out of the block', () => {
    const block = wrapFileBlock('evil" onerror="alert(1)', 'body');
    expect(block).toContain('name="evil&quot; onerror=&quot;alert(1)"');
    expect(block).not.toContain('onerror="alert(1)');
  });
});

describe('synthesizePayload', () => {
  it('returns an empty string for an empty registry', () => {
    expect(synthesizePayload([])).toBe('');
  });

  it('wraps every part in a named block separated by a blank line', () => {
    const files = [
      makeFile('pf_1', 'a.part1of2.md', 'ONE'),
      makeFile('pf_2', 'a.part2of2.md', 'TWO'),
    ];
    const payload = synthesizePayload(files);
    expect(payload).toBe(
      '<file name="a.part1of2.md">\nONE\n</file>\n\n<file name="a.part2of2.md">\nTWO\n</file>',
    );
  });

  it('prepends the preamble when supplied', () => {
    const payload = synthesizePayload([makeFile('pf_1', 'a.md', 'X')], { preamble: 'HEAD' });
    expect(payload.startsWith('HEAD\n\n<file')).toBe(true);
  });

  it('truncates instead of exceeding the character cap', () => {
    const huge = makeFile('pf_1', 'big.md', 'x'.repeat(500));
    const payload = synthesizePayload([huge], { maxChars: 120 });
    expect(payload.length).toBeLessThanOrEqual(120);
    expect(payload).toContain('truncated="true"');
  });

  it('produces nothing when the cap is already exhausted', () => {
    const files = [makeFile('pf_1', 'big.md', 'x'.repeat(50))];
    expect(synthesizePayload(files, { preamble: 'y'.repeat(200), maxChars: 200 })).toBe(
      'y'.repeat(200),
    );
  });

  it('never exceeds the default cap for a realistic multi-megabyte digest', () => {
    const files = [makeFile('pf_1', 'a.md', 'x'.repeat(MAX_PAYLOAD_CHARS + 10_000))];
    expect(synthesizePayload(files).length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
  });
});

describe('formatBytes', () => {
  it('formats the byte→KB→MB ladder', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20.00 MB');
  });

  it('is defensive about non-finite or negative input', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('formatTokens', () => {
  it('compresses large counts', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});

describe('sanitizeFileName', () => {
  it('strips path separators so a name can never escape a directory', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
  });

  it('strips markup used for injection', () => {
    expect(sanitizeFileName('a<b>c"d\'e`f.md')).toBe('abcdef.md');
  });

  it('caps runaway lengths', () => {
    expect(sanitizeFileName(`${'a'.repeat(200)}.md`).length).toBe(96);
  });

  it('falls back to a sane default for empty results', () => {
    expect(sanitizeFileName('')).toBe('digest.md');
    expect(sanitizeFileName('   ')).toBe('digest.md');
  });

  it('collapses whitespace but keeps a normal name intact', () => {
    expect(sanitizeFileName('owner_repo.part1of3.md')).toBe('owner_repo.part1of3.md');
    expect(sanitizeFileName('owner   repo.md')).toBe('owner repo.md');
  });
});
