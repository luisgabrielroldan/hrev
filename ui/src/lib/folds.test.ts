import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DiffLine } from '../types.ts';
import { foldHunk, revealedBy, type FoldItem } from './folds.ts';

// A hunk from a pattern: '.' is a context line, '+' an added line. Context lines are numbered from 1 on the new side.
function hunk(pattern: string): DiffLine[] {
  let num = 0;
  return [...pattern].map((c) => (c === '+' ? { kind: 'add' as const, new: ++num, text: '' } : { kind: 'ctx' as const, old: num + 1, new: ++num, text: '' }));
}

// Shows the items as text: each shown line as its character, each fold as [size up/down].
const show = (lines: DiffLine[], items: FoldItem[]) =>
  items.map((it) => (it.kind === 'line' ? (lines[it.index]!.kind === 'add' ? '+' : '.') : `[${it.to - it.from}${it.up ? '↑' : ''}${it.down ? '↓' : ''}]`)).join('');

test('foldHunk shows 3 context lines around each change and folds runs of 2 or more other lines', () => {
  const rows: [string, string][] = [
    ['...+...', '...+...'],
    ['..........+..........', '[7↑]...+...[7↓]'],
    ['+.........+', '+...[3↑↓]...+'],
    ['+.......+', '+.......+'],
    ['+........+', '+...[2↑↓]...+'],
  ];
  for (const [pattern, want] of rows) {
    const lines = hunk(pattern);
    assert.equal(show(lines, foldHunk(lines, () => false)), want, pattern);
  }
});

test('foldHunk keeps a line that keep selects, and splits the fold around it', () => {
  const lines = hunk('+.............+');
  assert.equal(show(lines, foldHunk(lines, (l) => l.new === 8)), '+...[3↑↓].[3↑↓]...+');
});

test('revealedBy shows 20 lines next to the line below (up), next to the line above (down), or all', () => {
  const lines = hunk('.'.repeat(50) + '+');
  const [fold] = foldHunk(lines, () => false) as [Extract<FoldItem, { kind: 'fold' }>];
  assert.deepEqual([fold.from, fold.to], [0, 47]);
  const range = (nums: number[]) => `${nums[0]}-${nums[nums.length - 1]} (${nums.length})`;
  assert.equal(range(revealedBy(lines, fold, 'up')), '28-47 (20)');
  assert.equal(range(revealedBy(lines, fold, 'down')), '1-20 (20)');
  assert.equal(range(revealedBy(lines, fold, 'all')), '1-47 (47)');
});
