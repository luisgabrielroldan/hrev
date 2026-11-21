import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffFile, Draft, Session } from '../types.ts';
import { reconcileDrafts, selectionLines } from './diff.ts';

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
