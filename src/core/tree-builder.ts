import { FileSystemNode } from '../types';

interface FileInput {
  readonly path: string;
  readonly size: number;
}

export class TreeBuilder {
  public static build(files: FileInput[], rootSlug: string): FileSystemNode {
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
      this.insertFile(root, f);
    }

    this.aggregate(root);
    this.sortRecursive(root);
    return root;
  }

  /**
   * 将单个文件插入目录树（不进行 size/fileCount 累加，由 aggregate 统一处理）。
   */
  private static insertFile(root: FileSystemNode, f: FileInput): void {
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
        }
        curr = childDir;
      }
    }
  }

  /**
   * 自底向上汇总：目录的 size / fileCount 递归累加所有后代文件；
   * dirCount 统计**直接**子目录数。
   */
  private static aggregate(node: FileSystemNode): void {
    if (node.type !== 'DIRECTORY') return;

    let size = 0;
    let fileCount = 0;
    let dirCount = 0;

    for (const child of node.children) {
      if (child.type === 'FILE') {
        size += child.size;
        fileCount += 1;
      } else {
        this.aggregate(child);
        size += child.size;
        fileCount += child.fileCount;
        dirCount += 1;
      }
    }

    node.size = size;
    node.fileCount = fileCount;
    node.dirCount = dirCount;
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
