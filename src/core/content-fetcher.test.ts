import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileMetadata, GitHubTarget } from '../types';
import { buildRawUrl, fetchRawFiles, type RawFetchOptions } from './content-fetcher';

const target: GitHubTarget = {
  owner: 'o',
  repo: 'r',
  ref: 'feature/x',
  subpath: '/',
  type: 'branch_root',
  canonicalUrl: 'https://github.com/o/r/tree/feature/x',
};

function file(path: string, size = 10): FileMetadata {
  return { path, size, isConfigFile: false, isReadme: false, truncated: false };
}

function options(overrides: Partial<RawFetchOptions> = {}): RawFetchOptions {
  return { maxBytes: 1024, lang: 'en', ...overrides };
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}

interface Recorded {
  readonly calls: string[];
  inFlight: number;
  peak: number;
}

/** Stub fetch with a handler that also tracks concurrency. */
function stubFetch(handler: (url: string) => Promise<Response>): Recorded {
  const recorded: Recorded = { calls: [], inFlight: 0, peak: 0 };
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input);
    recorded.calls.push(url);
    recorded.inFlight += 1;
    recorded.peak = Math.max(recorded.peak, recorded.inFlight);
    return handler(url).finally(() => {
      recorded.inFlight -= 1;
    });
  });
  return recorded;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildRawUrl', () => {
  it('encodes owner, repo, ref segments, and path segments', () => {
    expect(buildRawUrl(target, 'src/a b/c#d.ts')).toBe(
      'https://raw.githubusercontent.com/o/r/feature/x/src/a%20b/c%23d.ts',
    );
  });

  it('keeps ref separators while encoding each ref segment', () => {
    const tagged: GitHubTarget = { ...target, ref: 'release/1.0 beta' };
    expect(buildRawUrl(tagged, 'README.md')).toBe(
      'https://raw.githubusercontent.com/o/r/release/1.0%20beta/README.md',
    );
  });
});

describe('fetchRawFiles transport', () => {
  it('returns decoded bodies in input order', async () => {
    stubFetch((url) => Promise.resolve(textResponse(`body:${url.split('/').pop()}`)));

    const result = await fetchRawFiles(target, [file('b.ts'), file('a.ts')], options());

    expect(result.files.map((entry) => entry.path)).toEqual(['b.ts', 'a.ts']);
    expect(result.files[0].content).toBe('body:b.ts');
    expect(result.failed).toBe(0);
    expect(result.truncated).toBe(0);
  });

  it('sends the token as a bearer header only when present', async () => {
    const seen: (string | undefined)[] = [];
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string> | undefined)?.Authorization);
      return Promise.resolve(textResponse('ok'));
    });

    await fetchRawFiles(target, [file('a.ts')], options({ token: '  tok  ' }));
    await fetchRawFiles(target, [file('a.ts')], options({ token: '   ' }));

    expect(seen).toEqual(['Bearer tok', undefined]);
  });

  it('turns HTTP failures into a placeholder instead of rejecting', async () => {
    stubFetch(() => Promise.resolve(new Response('nope', { status: 404 })));

    const result = await fetchRawFiles(target, [file('gone.ts', 42)], options());

    expect(result.failed).toBe(1);
    expect(result.entries[0].status).toBe('failed');
    expect(result.files[0].content).toContain('gone.ts');
    expect(result.files[0].content).toContain('HTTP 404');
    expect(result.files[0].size).toBe(42);
  });

  it('turns network rejections into a placeholder', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));

    const result = await fetchRawFiles(target, [file('net.ts')], options());

    expect(result.failed).toBe(1);
    expect(result.files[0].content).toContain('offline');
  });

  it('rethrows aborts so the caller can cancel the whole run', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    stubFetch(() => Promise.reject(abort));

    await expect(fetchRawFiles(target, [file('a.ts')], options())).rejects.toThrow('aborted');
  });
});

describe('fetchRawFiles limits', () => {
  it('truncates oversized bodies at the byte cap', async () => {
    stubFetch(() => Promise.resolve(textResponse('x'.repeat(2048))));

    const result = await fetchRawFiles(target, [file('big.ts', 2048)], options({ maxBytes: 64 }));

    expect(result.truncated).toBe(1);
    expect(result.entries[0].status).toBe('truncated');
    expect(result.files[0].content.startsWith('x'.repeat(64))).toBe(true);
    expect(result.files[0].content).toContain('big.ts');
  });

  it('never splits a multi-byte code point at the cap', async () => {
    // Each CJK character is three UTF-8 bytes; a 64-byte cap lands mid-glyph.
    stubFetch(() => Promise.resolve(textResponse('字'.repeat(100))));

    const result = await fetchRawFiles(target, [file('cjk.ts', 300)], options({ maxBytes: 64 }));

    const body = result.files[0].content.split('\n\n')[0];
    expect(body).toBe('字'.repeat(21));
    expect(body).not.toContain('\uFFFD');
  });

  it('treats the cap as a hard ceiling even when a caller asks for more', async () => {
    stubFetch(() => Promise.resolve(textResponse('y'.repeat(70 * 1024))));

    const result = await fetchRawFiles(target, [file('huge.ts')], options({ maxBytes: 1e9 }));

    expect(result.entries[0].status).toBe('truncated');
    expect(result.files[0].content.length).toBeLessThan(70 * 1024);
  });

  it('rejects binary bodies by their NUL marker', async () => {
    stubFetch(() => Promise.resolve(new Response(new Uint8Array([65, 0, 66]))));

    const result = await fetchRawFiles(target, [file('img.png')], options());

    expect(result.binary).toBe(1);
    expect(result.entries[0].status).toBe('binary');
    expect(result.files[0].content).toContain('Binary file');
  });
});

describe('fetchRawFiles scheduling', () => {
  it('keeps the request pool bounded and reports progress once per file', async () => {
    const recorded = stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(textResponse('ok')), 5);
        }),
    );
    const progress: number[] = [];
    const files = Array.from({ length: 20 }, (_, index) => file(`f${index}.ts`));

    const result = await fetchRawFiles(
      target,
      files,
      options({ concurrency: 99, onProgress: (done) => progress.push(done) }),
    );

    expect(recorded.calls).toHaveLength(20);
    expect(recorded.peak).toBeLessThanOrEqual(6);
    expect(progress).toHaveLength(20);
    expect(progress[progress.length - 1]).toBe(20);
    expect(result.files.map((entry) => entry.path)).toEqual(files.map((entry) => entry.path));
  });

  it('makes no request for an empty file list', async () => {
    const recorded = stubFetch(() => Promise.resolve(textResponse('ok')));

    const result = await fetchRawFiles(target, [], options());

    expect(recorded.calls).toHaveLength(0);
    expect(result).toEqual({ files: [], entries: [], failed: 0, truncated: 0, binary: 0 });
  });
});
