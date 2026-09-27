import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, map, flatMap } from './result';

describe('Result', () => {
  it('ok / err factories', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('type guards', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(ok(1))).toBe(false);
    expect(isOk(err('x'))).toBe(false);
    expect(isErr(err('x'))).toBe(true);
  });

  it('map transforms Ok values only', () => {
    expect(map(ok(2), (n) => n * 2)).toEqual({ ok: true, value: 4 });
    expect(map(err('e'), (n: number) => n * 2)).toEqual({ ok: false, error: 'e' });
  });

  it('flatMap chains Ok results', () => {
    expect(flatMap(ok(2), (n) => ok(n + 1))).toEqual({ ok: true, value: 3 });
    expect(flatMap(err('e'), (n: number) => ok(n))).toEqual({ ok: false, error: 'e' });
  });
});
