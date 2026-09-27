import { describe, it, expect } from 'vitest';
import { TreeBuilder } from './tree-builder';

describe('TreeBuilder.build', () => {
  it('builds a nested directory tree with recursive aggregation', () => {
    const tree = TreeBuilder.build(
      [
        { path: 'src/index.ts', size: 10 },
        { path: 'src/lib/util.ts', size: 20 },
        { path: 'README.md', size: 5 },
      ],
      'root',
    );

    expect(tree.name).toBe('root');
    expect(tree.type).toBe('DIRECTORY');
    // size is recursively aggregated across all descendants
    expect(tree.size).toBe(35);
    // fileCount counts all descendant files recursively
    expect(tree.fileCount).toBe(3);
    // dirCount counts direct child directories only
    expect(tree.dirCount).toBe(1);
    // README.md + src/
    expect(tree.children.length).toBe(2);

    const src = tree.children.find((c) => c.name === 'src');
    expect(src?.type).toBe('DIRECTORY');
    expect(src?.size).toBe(30);
    expect(src?.fileCount).toBe(2);
    expect(src?.dirCount).toBe(1);

    const lib = src?.children.find((c) => c.name === 'lib');
    expect(lib?.type).toBe('DIRECTORY');
    expect(lib?.size).toBe(20);
    expect(lib?.fileCount).toBe(1);
    expect(lib?.dirCount).toBe(0);
  });

  it('counts files and sizes recursively per directory level', () => {
    const tree = TreeBuilder.build(
      [
        { path: 'a.ts', size: 1 },
        { path: 'b.ts', size: 2 },
        { path: 'sub/c.ts', size: 3 },
      ],
      'root',
    );

    expect(tree.size).toBe(6); // 1 + 2 + 3
    expect(tree.fileCount).toBe(3); // a.ts + b.ts + sub/c.ts
    expect(tree.dirCount).toBe(1); // sub/

    const sub = tree.children.find((c) => c.name === 'sub');
    expect(sub?.type).toBe('DIRECTORY');
    expect(sub?.size).toBe(3);
    expect(sub?.fileCount).toBe(1);
    expect(sub?.dirCount).toBe(0);
  });

  it('sorts README first, then files, then directories', () => {
    const tree = TreeBuilder.build(
      [
        { path: 'zeta.ts', size: 1 },
        { path: 'alpha.ts', size: 1 },
        { path: 'README.md', size: 1 },
        { path: 'subdir/x.ts', size: 1 },
      ],
      'root',
    );
    const names = tree.children.map((c) => c.name);
    expect(names[0].toLowerCase()).toContain('readme');
    expect(names.indexOf('subdir')).toBeGreaterThan(names.indexOf('alpha.ts'));
  });
});

describe('TreeBuilder.renderAscii', () => {
  it('renders directory tree with box-drawing characters', () => {
    const tree = TreeBuilder.build([{ path: 'src/index.ts', size: 1 }], 'root');
    const ascii = TreeBuilder.renderAscii(tree);
    expect(ascii).toContain('root/');
    expect(ascii).toContain('src/');
    expect(ascii).toContain('index.ts');
    expect(ascii).toMatch(/[├└]──/);
  });
});
