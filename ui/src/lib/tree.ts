import type { DiffFile } from '../types.ts';

/** A row of the file list: a folder or a file, at a depth. */
export type TreeRow =
  | { kind: 'folder'; path: string; name: string; depth: number; open: boolean }
  | { kind: 'file'; file: DiffFile; name: string; depth: number };

interface Node {
  path: string;
  dirs: Map<string, Node>;
  files: DiffFile[];
}

/**
 * treeRows lists the rows of the file list. Folders come first, then files, each sorted by name.
 * A folder in closedFolders shows without its content.
 */
export function treeRows(files: DiffFile[], closedFolders: ReadonlySet<string>): TreeRow[] {
  const root: Node = { path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    let node = root;
    for (const part of f.path.split('/').slice(0, -1)) {
      let next = node.dirs.get(part);
      if (!next) {
        next = { path: node.path ? `${node.path}/${part}` : part, dirs: new Map(), files: [] };
        node.dirs.set(part, next);
      }
      node = next;
    }
    node.files.push(f);
  }

  const rows: TreeRow[] = [];
  const walk = (node: Node, depth: number) => {
    for (const name of [...node.dirs.keys()].sort()) {
      const d = node.dirs.get(name)!;
      const open = !closedFolders.has(d.path);
      rows.push({ kind: 'folder', path: d.path, name, depth, open });
      if (open) walk(d, depth + 1);
    }
    for (const f of [...node.files].sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push({ kind: 'file', file: f, name: f.path.split('/').pop()!, depth });
    }
  };
  walk(root, 0);
  return rows;
}
