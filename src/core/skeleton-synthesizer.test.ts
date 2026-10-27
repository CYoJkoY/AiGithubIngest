import { describe, expect, it } from 'vitest';
import type { FileMetadata, GitHubTarget, IngestFileResult, PreflightReport } from '../types';
import { SKELETON_ENTRY_EXCERPT_CHARS, SKELETON_INDEX_LIMIT } from './constants';
import {
  isSkeletonTruncated,
  selectSkeletonPaths,
  skeletonFetchPaths,
  synthesizeSkeleton,
} from './skeleton-synthesizer';

const target: GitHubTarget = {
  owner: 'acme',
  repo: 'widget',
  ref: 'main',
  subpath: '/',
  type: 'branch_root',
  canonicalUrl: 'https://github.com/acme/widget/tree/main',
};

interface MetaOptions {
  readonly config?: boolean;
  readonly readme?: boolean;
  readonly size?: number;
}

function meta(path: string, options: MetaOptions = {}): FileMetadata {
  return {
    path,
    size: options.size ?? 10,
    isConfigFile: options.config ?? false,
    isReadme: options.readme ?? false,
    truncated: false,
  };
}

function report(overrides: Partial<PreflightReport> = {}): PreflightReport {
  return {
    target,
    totalBlobs: 1,
    validFiles: [meta('src/index.ts')],
    estimatedTokens: 1234,
    recommendedStrategy: 'skeleton',
    stackConfigs: [],
    entrypoints: ['src/index.ts'],
    truncated: false,
    ...overrides,
  };
}

function body(path: string, content: string): IngestFileResult {
  return { path, content, size: content.length };
}

describe('selectSkeletonPaths', () => {
  it('picks a README, every config, and caps entrypoints and the index', () => {
    const validFiles = [
      meta('z/README.md', { readme: true }),
      meta('a/readme.md', { readme: true }),
      meta('package.json', { config: true }),
      meta('build.zig', { config: true }),
      ...Array.from({ length: SKELETON_INDEX_LIMIT }, (_, i) => meta(`src/f${i}.ts`)),
    ];
    const entrypoints = Array.from({ length: 9 }, (_, i) => `src/main${i}.ts`);

    const paths = selectSkeletonPaths(report({ validFiles, entrypoints }));

    expect(paths.readme).toBe('a/readme.md');
    expect(paths.configs).toEqual(['build.zig', 'package.json']);
    expect(paths.entrypoints).toHaveLength(5);
    expect(paths.index).toHaveLength(SKELETON_INDEX_LIMIT);
    expect(paths.index[0]).toBe('a/readme.md');
  });

  it('deduplicates repeated config and entrypoint paths', () => {
    const validFiles = [meta('b.json', { config: true }), meta('a.json', { config: true })];
    const paths = selectSkeletonPaths(
      report({ validFiles, entrypoints: ['src/z.ts', 'src/z.ts', 'src/a.ts'] }),
    );

    expect(paths.configs).toEqual(['a.json', 'b.json']);
    expect(paths.entrypoints).toEqual(['src/a.ts', 'src/z.ts']);
  });
});

describe('skeletonFetchPaths', () => {
  it('returns one sorted path per required body', () => {
    const paths = selectSkeletonPaths(
      report({
        validFiles: [meta('README.md', { readme: true }), meta('index.ts', { config: true })],
        entrypoints: ['index.ts', 'src/z.ts'],
      }),
    );

    expect(skeletonFetchPaths(paths)).toEqual(['README.md', 'index.ts', 'src/z.ts']);
  });

  it('returns an empty list when nothing is selected', () => {
    expect(
      skeletonFetchPaths(selectSkeletonPaths(report({ validFiles: [], entrypoints: [] }))),
    ).toEqual([]);
  });
});

describe('isSkeletonTruncated', () => {
  it('stays false while the index and every excerpt fit', () => {
    const source = report();
    const files = [body('src/index.ts', 'x'.repeat(SKELETON_ENTRY_EXCERPT_CHARS))];

    expect(isSkeletonTruncated(source, files)).toBe(false);
  });

  it('detects a capped file index', () => {
    const validFiles = Array.from({ length: SKELETON_INDEX_LIMIT + 1 }, (_, i) => meta(`f${i}.ts`));

    expect(isSkeletonTruncated(report({ validFiles }), [])).toBe(true);
  });

  it('detects a trimmed entrypoint body', () => {
    const files = [body('src/index.ts', 'x'.repeat(SKELETON_ENTRY_EXCERPT_CHARS + 1))];

    expect(isSkeletonTruncated(report(), files)).toBe(true);
  });

  it('ignores long bodies that are not entrypoints', () => {
    const files = [body('docs/notes.md', 'x'.repeat(12_000))];

    expect(isSkeletonTruncated(report(), files)).toBe(false);
  });
});

describe('synthesizeSkeleton', () => {
  it('emits the four required sections in order', () => {
    const output = synthesizeSkeleton({
      report: report({
        validFiles: [meta('README.md', { readme: true }), meta('package.json', { config: true })],
      }),
      files: [body('README.md', '# Widget'), body('package.json', '{"name":"widget"}')],
      treeVisual: 'widget\n└── README.md',
      lang: 'en',
    });

    expect(output).toMatch(/^# Repository Analysis: acme\/widget/);
    const headings = output.match(/^## \d\. .+$/gm) ?? [];
    expect(headings).toEqual([
      '## 1. Directory Tree',
      '## 2. Project Specification & Dependencies',
      '## 3. Readme',
      '## 4. File Index',
    ]);
    const order = headings.map((heading) => output.indexOf(heading));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('renders config bodies inside a language fence and the README verbatim', () => {
    const output = synthesizeSkeleton({
      report: report({
        validFiles: [meta('README.md', { readme: true }), meta('Cargo.toml', { config: true })],
      }),
      files: [body('README.md', '# Widget\nPlain prose.'), body('Cargo.toml', '[package]')],
      treeVisual: 'tree',
      lang: 'en',
    });

    expect(output).toContain('### File: `Cargo.toml`');
    expect(output).toContain('```toml\n[package]\n```');
    expect(output).toContain('## 3. Readme\n# Widget\nPlain prose.');
  });

  it('widens the fence past the longest backtick run in the body', () => {
    const content = 'before\n```js\nconst x = 1;\n```\nafter';
    const output = synthesizeSkeleton({
      report: report({ validFiles: [meta('package.json', { config: true })] }),
      files: [body('package.json', content)],
      treeVisual: 'tree',
      lang: 'en',
    });

    expect(output).toContain(`${'`'.repeat(4)}json\n${content}\n${'`'.repeat(4)}`);
  });
});

describe('synthesizeSkeleton fallbacks', () => {
  it('notes the excerpt limit when an entrypoint is trimmed', () => {
    const long = 'q'.repeat(SKELETON_ENTRY_EXCERPT_CHARS + 20);
    const output = synthesizeSkeleton({
      report: report(),
      files: [body('src/index.ts', long)],
      treeVisual: 'tree',
      lang: 'en',
    });

    expect(output).toContain('### Entrypoint: `src/index.ts`');
    expect(output).not.toContain(long);
    const fence = String.fromCharCode(96, 96, 96);
    expect(output).toContain(
      `${fence}typescript\n${'q'.repeat(SKELETON_ENTRY_EXCERPT_CHARS)}\n${fence}`,
    );
    expect(output).toContain(`first ${SKELETON_ENTRY_EXCERPT_CHARS} characters`);
  });

  it('falls back to explanatory notes when nothing is recognized', () => {
    const output = synthesizeSkeleton({
      report: report({ validFiles: [meta('src/a.ts')], entrypoints: [] }),
      files: [],
      treeVisual: '',
      lang: 'en',
    });

    expect(output).toContain('No README file was found in this scope.');
    expect(output).toContain('No supported build or dependency configuration was found');
    expect(output).toContain('No common entrypoint file was recognized in this scope.');
    expect(output).toContain('## 1. Directory Tree\n```text\n```');
  });

  it('marks bodies that never arrived instead of inventing content', () => {
    const output = synthesizeSkeleton({
      report: report({
        validFiles: [meta('README.md', { readme: true }), meta('package.json', { config: true })],
        entrypoints: [],
      }),
      files: [],
      treeVisual: 'tree',
      lang: 'en',
    });

    expect(output.match(/File content fetch failed/g)).toHaveLength(2);
    expect(output).toContain('`README.md`');
    expect(output).toContain('`package.json`');
  });

  it('states the token estimate, the file count, and a scope hint', () => {
    const output = synthesizeSkeleton({
      report: report({
        validFiles: Array.from({ length: 7 }, (_, i) => meta(`f${i}.ts`)),
        estimatedTokens: 12345,
      }),
      files: [],
      treeVisual: 'tree',
      lang: 'en',
    });

    expect(output).toContain('7 valid files');
    expect(output).toContain('12,345 tokens');
    expect(output).toContain('https://github.com/acme/widget/tree/main');
  });

  it('caps the index and says how many entries were left out', () => {
    const validFiles = Array.from({ length: SKELETON_INDEX_LIMIT + 5 }, (_, i) =>
      meta(`f${String(i).padStart(4, '0')}.ts`),
    );
    const output = synthesizeSkeleton({
      report: report({ validFiles, entrypoints: [] }),
      files: [],
      treeVisual: 'tree',
      lang: 'en',
    });

    expect(output).toContain('f0199.ts');
    expect(output).not.toContain('f0200.ts');
    expect(output).toContain(`lists ${SKELETON_INDEX_LIMIT} of ${SKELETON_INDEX_LIMIT + 5}`);
  });
});
