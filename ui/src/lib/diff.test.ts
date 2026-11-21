import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffFile, Draft, Session } from '../types.ts';
import { hunkGap, reconcileDrafts, selectionLines } from './diff.ts';

const file = (path: string, lines: [number, string][]): DiffFile => ({
  path, old_path: path, status: 'modified', binary: false, adds: 0, dels: 0,
  hunks: [{ header: '@@', lines: lines.map(([n, text]) => ({ kind: 'add' as const, new: n, text })) }],
});
const session = (files: DiffFile[]): Session => ({
  id: 's', title: '', description: '', source: '', rev: 1, files, threads: [], pending: 0, agent: 'listening',
});

test('selectionLines keeps the consecutive lines from the start and stops at the first gap', () => {
  const f = file('a.go', [[1, 'a'], [2, 'b'], [5, 'c']]);
  assert.deepEqual(selectionLines(f, 'new', 1, 5).map((l) => l.num), [1, 2]);
});

test('reconcileDrafts keeps a draft on unchanged lines and moves a draft on changed lines into the file draft', () => {
  const draft = (key: string, start: number, sel: string[], text: string): Draft => ({ key, file: 'a.go', side: 'new', start, end: start, sel, text });
  const drafts: Record<string, Draft> = {
    kept: draft('kept', 1, ['a'], 'keep me'),
    moved: draft('moved', 2, ['old text'], 'move me'),
    'a.go|file': { key: 'a.go|file', file: 'a.go', side: 'file', start: 0, end: 0, sel: [], text: 'file note' },
  };
  const out = reconcileDrafts(drafts, session([file('a.go', [[1, 'a'], [2, 'new text']])]));
  assert.deepEqual(Object.keys(out).sort(), ['a.go|file', 'kept']);
  assert.equal(out['a.go|file']!.text, 'file note\n\nmove me');
});

test('hunkGap counts the file lines that are not in the diff, before the first hunk and between hunks', () => {
  const h = (header: string, from: number, count: number) => ({
    header,
    lines: Array.from({ length: count }, (_, i) => ({ kind: 'ctx' as const, old: from + i, new: from + i, text: '' })),
  });
  const hunks = [h('@@ -10,5 +10,5 @@', 10, 5), h('@@ -30,5 +30,5 @@ func Run() {', 30, 5), h('@@ -35,2 +35,2 @@', 35, 2)];
  assert.deepEqual(hunkGap(hunks, 0), { lines: 9, section: '' });
  assert.deepEqual(hunkGap(hunks, 1), { lines: 15, section: 'func Run() {' });
  assert.equal(hunkGap(hunks, 2), null);
  assert.equal(hunkGap([h('@@ -1,3 +1,3 @@', 1, 3)], 0), null);
});
