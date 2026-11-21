// Pure functions on the diff and the threads.
import type { DiffFile, DiffLine, Draft, Hunk, LineKind, Session, Side, Thread, ThreadSide } from '../types.ts';

export interface NumberedLine {
  num: number;
  text: string;
  kind: LineKind;
}

export function findFile(session: Session, path: string): DiffFile | null {
  return session.files.find((f) => f.path === path) ?? session.files.find((f) => f.old_path === path) ?? null;
}

/** sideLines lists the lines of 1 side of a file, with the line number of that side. */
export function sideLines(f: DiffFile, side: Side): NumberedLine[] {
  const out: NumberedLine[] = [];
  for (const h of f.hunks) {
    for (const l of h.lines) {
      const num = l[side];
      if (num) out.push({ num, text: l.text, kind: l.kind });
    }
  }
  return out;
}

/** selectionLines returns the consecutive lines from start to end, as the server stores them. A gap ends the selection. */
export function selectionLines(f: DiffFile, side: Side, start: number, end: number): NumberedLine[] {
  const lines = sideLines(f, side).filter((l) => l.num >= start && l.num <= end);
  let n = 1;
  while (n < lines.length && lines[n]!.num === lines[n - 1]!.num + 1) n++;
  return lines.slice(0, n);
}

/** where describes the place of a comment, such as "Lines 4–7 (old)". */
export function where(side: ThreadSide, start = 0, end = 0): string {
  if (side === 'file') return 'File comment';
  const lines = start === end ? `Line ${start}` : `Lines ${start}–${end}`;
  return side === 'old' ? `${lines} (old)` : lines;
}

export const threadWhere = (t: Thread): string => where(t.side, t.start_line, t.end_line);

export function firstLine(s: string): string {
  const l = s.split('\n')[0] ?? '';
  return l.length > 80 ? l.slice(0, 80) + '…' : l;
}

export const sign = (k: LineKind): string => (k === 'add' ? '+' : k === 'del' ? '−' : '');

/**
 * inlineThreadTest returns a test for the threads of 1 file. The test is true when a thread shows below its last
 * line in the diff, and false when it shows under the file header.
 */
export function inlineThreadTest(f: DiffFile): (t: Thread) => boolean {
  const nums = { new: new Set(sideLines(f, 'new').map((l) => l.num)), old: new Set(sideLines(f, 'old').map((l) => l.num)) };
  return (t) => !t.outdated && t.side !== 'file' && nums[t.side].has(t.end_line ?? 0);
}

/** pairs puts the lines of a hunk side by side: deleted lines on the left, added lines on the right. */
export function pairs(lines: DiffLine[]): [DiffLine | null, DiffLine | null][] {
  const out: [DiffLine | null, DiffLine | null][] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind === 'ctx') {
      out.push([lines[i]!, lines[i]!]);
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === 'del') dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === 'add') adds.push(lines[i++]!);
    for (let j = 0; j < Math.max(dels.length, adds.length); j++) out.push([dels[j] ?? null, adds[j] ?? null]);
  }
  return out;
}

export type AgentWork = 'working' | 'waiting' | '';

/** agentWork: a thread with a sent comment waits for the agent. When wait has delivered the comment, the agent works on it. */
export function agentWork(t: Thread): AgentWork {
  const sent = t.comments.filter((c) => c.author === 'user' && c.state === 'sent');
  if (!sent.length) return '';
  return sent.some((c) => c.printed) ? 'working' : 'waiting';
}

export const fileDraftKey = (path: string): string => `${path}|file`;
export const lineDraftKey = (path: string, side: Side, start: number, end: number): string => `${path}|${side}|${start}|${end}`;

export function newFileDraft(path: string, text = ''): Draft {
  return { key: fileDraftKey(path), file: path, side: 'file', start: 0, end: 0, text, sel: [] };
}

/**
 * reconcileDrafts runs after each new diff. A draft keeps its lines if they are still in the diff. If not, the
 * draft moves under the file header, and its text joins the file draft of that file.
 */
export function reconcileDrafts(drafts: Record<string, Draft>, session: Session): Record<string, Draft> {
  const out = { ...drafts };
  for (const d of Object.values(drafts)) {
    if (d.side === 'file') continue;
    const f = findFile(session, d.file);
    if (!f) continue;
    const lines = selectionLines(f, d.side, d.start, d.end);
    const same = lines.length === d.sel.length && lines.every((l, i) => l.text === d.sel[i]);
    if (same) continue;
    delete out[d.key];
    const fk = fileDraftKey(f.path);
    const existing = out[fk];
    out[fk] = existing
      ? { ...existing, text: [existing.text, d.text].filter(Boolean).join('\n\n') }
      : newFileDraft(f.path, d.text);
  }
  return out;
}

/** A range of selected lines on 1 side of a file. */
export interface Range {
  side: Side;
  lo: number;
  hi: number;
}

export function isSelected(ranges: Range[], side: Side, num: number | undefined): boolean {
  return !!num && ranges.some((r) => r.side === side && num >= r.lo && num <= r.hi);
}

/** ago gives the age of the diff. The agent must run refresh after each code change, so an old diff is visible. */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** A gap before a hunk: lines of the file that are not in the diff. */
export interface HunkGap {
  lines: number;
  /** The section name that git puts after the second @@ of the hunk header, such as a function name. */
  section: string;
}

const nums = (h: Hunk, side: Side) => h.lines.map((l) => l[side]).filter((n): n is number => !!n);

/**
 * hunkGap returns the lines before hunk i that are not in the diff, or null when there are none. The count comes
 * from the line numbers of the 2 hunks, on a side that both hunks have. Before the first hunk, it is the lines
 * above its first line.
 */
export function hunkGap(hunks: Hunk[], i: number): HunkGap | null {
  const h = hunks[i]!;
  let lines = 0;
  for (const side of ['new', 'old'] as const) {
    const next = nums(h, side);
    if (!next.length) continue;
    if (i === 0) {
      lines = next[0]! - 1;
      break;
    }
    const prev = nums(hunks[i - 1]!, side);
    if (!prev.length) continue;
    lines = next[0]! - prev[prev.length - 1]! - 1;
    break;
  }
  if (lines <= 0) return null;
  const section = h.header.match(/^@@[^@]*@@\s*(.*)$/)?.[1]?.trim() ?? '';
  return { lines, section };
}
