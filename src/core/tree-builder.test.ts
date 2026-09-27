import { describe, it, expect } from 'vitest';
import { TreeBuilder } from './tree-builder';

describe('TreeBuilder.build', () => {
  it('builds a nested directory tree', () => {
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
    expect(tree.fileCount).toBe(3);
    expect(tree.children.length).toBe(2);
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
