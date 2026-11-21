// Folds: a diff can carry more context than the viewer shows, for example with git diff -U200. The viewer shows
// CONTEXT lines around each change and folds the other context lines. The user opens a fold STEP lines at a time,
// or all at once. With a normal diff (3 lines of context), no line folds.
import type { DiffLine } from '../types.ts';

/** The context lines that show on each side of a change. */
export const CONTEXT = 3;
/** The lines that 1 click on an expand button shows. */
export const STEP = 20;
/** The smallest fold. A fold row in place of 1 line saves no space, so that line shows. */
export const MIN_FOLD = 2;

/**
 * An item of a folded hunk: a line that shows, or a fold. A fold holds the lines from index `from` up to `to`
 * (not included). `up` is true when a line shows below the fold, so the fold can open upward from that line.
 * `down` is true when a line shows above the fold, so the fold can open downward.
 */
export type FoldItem = { kind: 'line'; index: number } | { kind: 'fold'; from: number; to: number; up: boolean; down: boolean };

export type FoldDirection = 'up' | 'down' | 'all';

/**
 * foldHunk lists the lines and the folds of 1 hunk. A line shows when it is a change, when it is at most CONTEXT
 * lines from a change, or when keep returns true for it (a revealed line, or a line with a thread or a draft).
 * A run of hidden lines shorter than MIN_FOLD shows too.
 */
export function foldHunk(lines: DiffLine[], keep: (l: DiffLine) => boolean): FoldItem[] {
  const n = lines.length;
  // dist[i]: the number of lines from line i to the nearest change of the hunk.
  const dist = new Array<number>(n).fill(Infinity);
  for (let i = 0, last = -Infinity; i < n; i++) {
    if (lines[i]!.kind !== 'ctx') last = i;
    dist[i] = i - last;
  }
  for (let i = n - 1, next = Infinity; i >= 0; i--) {
    if (lines[i]!.kind !== 'ctx') next = i;
    dist[i] = Math.min(dist[i]!, next - i);
  }

  const items: FoldItem[] = [];
  let i = 0;
  while (i < n) {
    const shows = (j: number) => dist[j]! <= CONTEXT || keep(lines[j]!);
    if (shows(i)) {
      items.push({ kind: 'line', index: i });
      i++;
      continue;
    }
    const from = i;
    while (i < n && !shows(i)) i++;
    if (i - from < MIN_FOLD) {
      for (let j = from; j < i; j++) items.push({ kind: 'line', index: j });
      continue;
    }
    items.push({ kind: 'fold', from, to: i, up: i < n, down: from > 0 });
  }
  return items;
}

/**
 * revealedBy returns the new-side line numbers that 1 click shows. up shows the last STEP lines of the fold (next to
 * the line below it), down shows the first STEP lines, and all shows every line. A fold holds only context lines,
 * and each context line has a new-side number.
 */
export function revealedBy(lines: DiffLine[], fold: { from: number; to: number }, dir: FoldDirection): number[] {
  const from = dir === 'up' ? Math.max(fold.from, fold.to - STEP) : fold.from;
  const to = dir === 'down' ? Math.min(fold.to, fold.from + STEP) : fold.to;
  return lines.slice(from, to).map((l) => l.new!);
}
