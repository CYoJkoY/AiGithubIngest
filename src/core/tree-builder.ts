import { FileSystemNode } from '../types';

export class TreeBuilder {
  public static build(
    files: Array<{ path: string; size: number }>,
    rootSlug: string,
  ): FileSystemNode {
    const root: FileSystemNode = {
      name: rootSlug,
      type: 'DIRECTORY',
      path: '',
      size: 0,
      fileCount: 0,
      dirCount: 0,
      children: [],
    };

    for (const f of files) {
      const parts = f.path.split('/').filter(Boolean);
      let curr = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLeaf = i === parts.length - 1;

        if (isLeaf) {
          curr.children.push({
            name: part,
            type: 'FILE',
            path: f.path,
            size: f.size,
            fileCount: 1,
            dirCount: 0,
            children: [],
          });
          curr.size += f.size;
          curr.fileCount += 1;
        } else {
          let childDir = curr.children.find((c) => c.type === 'DIRECTORY' && c.name === part);
          if (!childDir) {
            childDir = {
              name: part,
              type: 'DIRECTORY',
              path: parts.slice(0, i + 1).join('/'),
              size: 0,
              fileCount: 0,
              dirCount: 0,
              children: [],
            };
            curr.children.push(childDir);
            curr.dirCount += 1;
          }
          childDir.size += f.size;
          childDir.fileCount += 1;
          curr = childDir;
        }
      }
    }

    this.sortRecursive(root);
    return root;
  }

  /**
   * Sort children deterministically:
   * 0 = README, 1 = normal file, 2 = dotfile, 3 = normal dir, 4 = dot-dir
   */
  private static sortRecursive(node: FileSystemNode): void {
    if (node.type !== 'DIRECTORY' || node.children.length === 0) return;

    node.children.sort((a, b) => {
      const getPriority = (item: FileSystemNode): [number, string] => {
        const lowerName = item.name.toLowerCase();
        if (item.type === 'FILE') {
          if (lowerName === 'readme' || lowerName.startsWith('readme.')) {
            return [0, lowerName];
          }
          return [lowerName.startsWith('.') ? 2 : 1, lowerName];
        }
        return [lowerName.startsWith('.') ? 4 : 3, lowerName];
      };

      const [pA, nA] = getPriority(a);
      const [pB, nB] = getPriority(b);

      if (pA !== pB) return pA - pB;
      return nA.localeCompare(nB, undefined, { sensitivity: 'base' });
    });

    for (const child of node.children) {
      if (child.type === 'DIRECTORY') {
        this.sortRecursive(child);
      }
    }
  }

  public static renderAscii(
    node: FileSystemNode,
    prefix: string = '',
    isLast: boolean = true,
  ): string {
    let result = '';
    const currentPrefix = isLast ? '└── ' : '├── ';
    const displayName = node.type === 'DIRECTORY' ? `${node.name}/` : node.name;

    result += `${prefix}${currentPrefix}${displayName}\n`;

    if (node.type === 'DIRECTORY' && node.children.length > 0) {
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      const total = node.children.length;
      for (let i = 0; i < total; i++) {
        const child = node.children[i];
        result += this.renderAscii(child, nextPrefix, i === total - 1);
      }
    }

    return result;
  }
}
