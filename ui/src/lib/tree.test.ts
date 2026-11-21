import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffFile } from '../types.ts';
import { treeRows } from './tree.ts';

const f = (path: string) => ({ path }) as DiffFile;

test('treeRows lists folders before files, sorts by name, and hides the content of a closed folder', () => {
  const rows = treeRows([f('z.go'), f('b/y.go'), f('a/x.go'), f('a/c/w.go')], new Set(['a/c']));
  assert.deepEqual(
    rows.map((r) => `${r.depth}:${r.kind === 'folder' ? r.path + '/' : r.file.path}`),
    ['0:a/', '1:a/c/', '1:a/x.go', '0:b/', '1:b/y.go', '0:z.go'],
  );
});
