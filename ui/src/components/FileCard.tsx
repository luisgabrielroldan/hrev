// 1 changed file: the sticky file header and the diff rows, with the threads and the drafts between the rows.
import { useComputed } from '@preact/signals';
import { memo } from 'preact/compat';
import { Fragment } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import { hunkGap, inlineThreadTest, pairs, sign, isSelected, type HunkGap, type Range } from '../lib/diff.ts';
import { foldHunk, revealedBy, STEP, type FoldDirection, type FoldItem } from '../lib/folds.ts';
import { fileId, plural } from '../lib/html.ts';
import {
  collapsedFiles,
  drafts,
  openFileComment,
  revealed,
  revealLines,
  selectedRanges,
  threadsByFile,
  toggleFile,
  view,
  type DraftState,
} from '../store.ts';
import type { DiffFile, DiffLine, Side, Thread } from '../types.ts';
import { Code } from './Code.tsx';
import { CopyButton } from './CopyButton.tsx';
import { ChevronIcon, CommentIcon, ExpandDownIcon, ExpandUpIcon, UnfoldIcon } from './icons.tsx';
import { DraftView, ThreadView } from './Thread.tsx';

const NOTES: Partial<Record<DiffFile['status'], string>> = { added: 'new file', deleted: 'deleted', renamed: 'renamed' };

/**
 * useStable returns a computed value that keeps its previous value while the items are the same. A file then
 * redraws only when its own threads, drafts or selection change, not when another file changes. The store
 * reuses the thread objects that did not change, so a shallow compare is enough.
 */
function useStable<T>(fn: () => T[]) {
  const prev = useRef<T[]>([]);
  return useComputed(() => {
    const next = fn();
    const old = prev.current;
    if (next.length === old.length && next.every((x, i) => sameItem(x, old[i]))) return old;
    prev.current = next;
    return next;
  });
}

function sameItem(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return Object.keys(ra).length === Object.keys(rb).length && Object.keys(ra).every((k) => ra[k] === rb[k]);
}

/** The threads and the drafts that show below 1 line. */
interface Slots {
  threads: Thread[];
  drafts: DraftState[];
}

function FileCardView({ file: f }: { file: DiffFile }) {
  // A computed boolean changes only for this file, so a click on another file does not redraw this card.
  const open = !useComputed(() => collapsedFiles.value.has(f.path)).value;
  const threads = useStable(() => threadsByFile.value.get(f.path) ?? []).value;
  const fileDrafts = useStable(() => Object.values(drafts.value).filter((d) => d.file === f.path));
  const ranges = useStable(() => selectedRanges(f.path));
  const shown = useComputed(() => revealed.value.get(f.path)).value;
  const isInline = useMemo(() => inlineThreadTest(f), [f]);

  const title = f.status === 'renamed' && f.old_path !== f.path ? `${f.old_path} → ${f.path}` : f.path;
  const note = f.binary ? 'binary' : NOTES[f.status];

  const top = threads.filter((t) => !isInline(t));
  const fileDraft = fileDrafts.value.find((d) => d.side === 'file');
  const lineDrafts = fileDrafts.value.filter((d) => d.side !== 'file');
  const inlineThreads = threads.filter(isInline);
  const slotsAt = (side: Side, num: number | undefined): Slots | null => {
    if (!num) return null;
    const t = inlineThreads.filter((x) => x.side === side && x.end_line === num);
    const d = lineDrafts.filter((x) => x.side === side && x.end === num);
    return t.length || d.length ? { threads: t, drafts: d } : null;
  };
  // A fold never hides a line with a thread or a draft, or a line that the user opened.
  const pinned: Range[] = [
    ...inlineThreads.map((t) => ({ side: t.side as Side, lo: t.start_line ?? 0, hi: t.end_line ?? 0 })),
    ...lineDrafts.map((d) => ({ side: d.side as Side, lo: d.start, hi: d.end })),
  ];
  const keep = (l: DiffLine) => !!(l.new && shown?.has(l.new)) || isSelected(pinned, 'old', l.old) || isSelected(pinned, 'new', l.new);
  const folds = f.hunks.map((h) => foldHunk(h.lines, keep));

  return (
    <section class={`card ${open ? 'open' : ''}`} id={fileId(f.path)}>
      <div class="filehead">
        <h3 class="filename">
          <button class="filetoggle" type="button" aria-expanded={open} onClick={() => toggleFile(f.path)}>
            <span class={`chev ${open ? '' : 'closed'}`}>
              <ChevronIcon />
            </span>
            <span class="mono">{title}</span>
          </button>
        </h3>
        <CopyButton class="copybtn" text={f.path} label="Copy the file name" failure="Could not copy the file name." />
        <div class="filetools">
          {note && <span class="note">{note}</span>}
          <span class="counter">
            <span class="plus">+{f.adds}</span> <span class="minus">−{f.dels}</span>
          </span>
          <button class="iconbtn" type="button" aria-label="Comment on this file" title="Comment on this file" onClick={() => openFileComment(f.path)}>
            <CommentIcon />
          </button>
        </div>
      </div>
      {open && (
        <div class="filebody">
          {(top.length > 0 || fileDraft) && (
            <div class="tslot file">
              {top.map((t) => (
                <ThreadView key={t.id} thread={t} />
              ))}
              {fileDraft && <DraftView draft={fileDraft} />}
            </div>
          )}
          {f.binary ? (
            <div class="note-row">Binary file changed</div>
          ) : !f.hunks.length ? (
            <div class="note-row">No line changes</div>
          ) : view.value === 'split' ? (
            <SplitRows file={f} ranges={ranges.value} slotsAt={slotsAt} folds={folds} />
          ) : (
            <UnifiedRows file={f} ranges={ranges.value} slotsAt={slotsAt} folds={folds} />
          )}
        </div>
      )}
    </section>
  );
}

export const FileCard = memo(FileCardView);

interface RowsProps {
  file: DiffFile;
  ranges: Range[];
  slotsAt: (side: Side, num: number | undefined) => Slots | null;
  /** The items of each hunk: the lines that show and the folds. */
  folds: FoldItem[][];
}

type Fold = Extract<FoldItem, { kind: 'fold' }>;

/**
 * DiffEnd marks the end of the lines in the diff, below the last hunk. The diff does not say how long the file is,
 * so the file can continue below it. An added or a deleted file comes complete in the diff and has no mark.
 */
function DiffEnd({ file }: { file: DiffFile }) {
  if (file.status === 'added' || file.status === 'deleted') return null;
  const label = 'The diff has no more lines here. The file can continue.';
  return <div class="diff-end" role="separator" aria-label={label} title={label} />;
}

/** GapRow marks lines of the file that are not in the diff, so 2 hunks do not look joined. It does not open. */
function GapRow({ gap }: { gap: HunkGap | null }) {
  if (!gap) return null;
  return (
    <div class="fold-row">
      <span class="fold-btns" />
      <span class="gap-label">
        {plural(gap.lines, 'line')} not shown
        {gap.section && <span class="gap-section"> · {gap.section}</span>}
      </span>
    </div>
  );
}

/**
 * FoldRow stands for hidden context lines. A small fold opens with 1 click. A larger fold opens STEP lines at a
 * time, upward from the line below it or downward from the line above it, or all at once with a click on the label.
 */
function FoldRow({ path, lines, fold }: { path: string; lines: DiffLine[]; fold: Fold }) {
  const n = fold.to - fold.from;
  const open = (dir: FoldDirection) => revealLines(path, revealedBy(lines, fold, dir));
  const all = `Show ${plural(n, 'hidden line')}`;
  return (
    <div class="fold-row">
      <span class="fold-btns">
        {n <= STEP ? (
          <button class="fold-btn" type="button" aria-label={all} title={all} onClick={() => open('all')}>
            <UnfoldIcon />
          </button>
        ) : (
          <>
            {fold.down && (
              <button class="fold-btn" type="button" aria-label={`Show ${STEP} more lines below`} title={`Show ${STEP} more lines below`} onClick={() => open('down')}>
                <ExpandDownIcon />
              </button>
            )}
            {fold.up && (
              <button class="fold-btn" type="button" aria-label={`Show ${STEP} more lines above`} title={`Show ${STEP} more lines above`} onClick={() => open('up')}>
                <ExpandUpIcon />
              </button>
            )}
          </>
        )}
      </span>
      <button class="fold-label" type="button" onClick={() => open('all')}>
        {plural(n, 'hidden line')}
      </button>
    </div>
  );
}

function SlotRow({ slots, cls = '' }: { slots: Slots | null; cls?: string }) {
  if (!slots) return null;
  return (
    <div class={`tslot ${cls}`}>
      {slots.threads.map((t) => (
        <ThreadView key={t.id} thread={t} />
      ))}
      {slots.drafts.map((d) => (
        <DraftView key={d.key} draft={d} />
      ))}
    </div>
  );
}

/** Num is a line number cell. The data attributes let the line selection find the line under the pointer. */
function Num({ file, side, num }: { file: string; side: Side; num: number | undefined }) {
  if (!num) return <span class="num" />;
  return (
    <span class="num" data-file={file} data-side={side} data-line={num}>
      {num}
    </span>
  );
}

function UnifiedRows({ file: f, ranges, slotsAt, folds }: RowsProps) {
  return (
    <div class="rows">
      {f.hunks.map((h, hi) => (
        <Fragment key={hi}>
          <GapRow gap={hunkGap(f.hunks, hi)} />
          {folds[hi]!.map((item) => {
            if (item.kind === 'fold') return <FoldRow key={`f${item.from}`} path={f.path} lines={h.lines} fold={item} />;
            const l = h.lines[item.index]!;
            const sel = isSelected(ranges, 'old', l.old) || isSelected(ranges, 'new', l.new);
            return (
              <Fragment key={`l${item.index}`}>
                <UnifiedLine path={f.path} line={l} sel={sel} />
                <SlotRow slots={slotsAt('old', l.kind === 'del' ? l.old : undefined)} />
                <SlotRow slots={slotsAt('new', l.new)} />
                {l.kind === 'ctx' && <SlotRow slots={slotsAt('old', l.old)} />}
              </Fragment>
            );
          })}
        </Fragment>
      ))}
      <DiffEnd file={f} />
    </div>
  );
}

/**
 * UnifiedLine is 1 row of the unified view. It is a memo component: a drag or a new state redraws only the rows
 * whose line or selection changed. The store keeps the same line objects while the diff is the same.
 */
const UnifiedLine = memo(function UnifiedLine({ path, line: l, sel }: { path: string; line: DiffLine; sel: boolean }) {
  return (
    <div class={`row ${l.kind} ${sel ? 'sel' : ''}`}>
      <Num file={path} side="old" num={l.old} />
      <Num file={path} side="new" num={l.new} />
      <span class="sign">{sign(l.kind)}</span>
      <Code text={l.text} html={l.html} />
    </div>
  );
});

interface SplitLineProps {
  path: string;
  left: DiffLine | null;
  right: DiffLine | null;
  selLeft: boolean;
  selRight: boolean;
}

/** SplitLine is 1 row of the split view, a memo component like UnifiedLine. */
const SplitLine = memo(function SplitLine({ path, left, right, selLeft, selRight }: SplitLineProps) {
  return (
    <div class="srow">
      <SideCell file={path} side="old" line={left} sel={selLeft} />
      <SideCell file={path} side="new" line={right} sel={selRight} />
    </div>
  );
});

function SideCell({ file, side, line, sel }: { file: string; side: Side; line: DiffLine | null; sel: boolean }) {
  if (!line) {
    return (
      <div class="side empty">
        <span class="num" />
        <span class="sign" />
        <span class="code" />
      </div>
    );
  }
  const num = line[side];
  return (
    <div class={`side ${line.kind} ${sel ? 'sel' : ''}`}>
      <Num file={file} side={side} num={num} />
      <span class="sign">{sign(line.kind)}</span>
      <Code text={line.text} html={line.html} />
    </div>
  );
}

function SplitRows({ file: f, ranges, slotsAt, folds }: RowsProps) {
  // The visible lines between 2 folds form a segment. A fold holds only context lines, so each segment pairs on
  // its own, the same as a whole hunk.
  const rowsOf = (lines: DiffLine[], items: FoldItem[]) => {
    const out = [];
    let seg: DiffLine[] = [];
    let segStart = 0;
    const flush = () => {
      pairs(seg).forEach(([l, r], pi) =>
        out.push(
          <Fragment key={`p${segStart}-${pi}`}>
            <SplitLine
              path={f.path}
              left={l}
              right={r}
              selLeft={isSelected(ranges, 'old', l?.old)}
              selRight={isSelected(ranges, 'new', r?.new)}
            />
            <SlotRow slots={slotsAt('old', l?.old)} cls="split-old" />
            <SlotRow slots={slotsAt('new', r?.new)} cls="split-new" />
          </Fragment>,
        ),
      );
      seg = [];
    };
    for (const item of items) {
      if (item.kind === 'line') {
        if (!seg.length) segStart = item.index;
        seg.push(lines[item.index]!);
        continue;
      }
      flush();
      out.push(<FoldRow key={`f${item.from}`} path={f.path} lines={lines} fold={item} />);
    }
    flush();
    return out;
  };

  return (
    <div class="rows split">
      {f.hunks.map((h, hi) => (
        <Fragment key={hi}>
          <GapRow gap={hunkGap(f.hunks, hi)} />
          {rowsOf(h.lines, folds[hi]!)}
        </Fragment>
      ))}
      <DiffEnd file={f} />
    </div>
  );
}
