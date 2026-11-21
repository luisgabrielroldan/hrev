// The state of the viewer and the actions that change it. Each piece of state is a signal: a component that
// reads a signal redraws only when that signal changes. The text of each open editor is its own signal, so
// typing redraws only the editor and not the diff.
import { batch, computed, signal, type Signal } from '@preact/signals';
import { api, connectEvents, type SaveMode } from './api.ts';
import {
  fileDraftKey,
  findFile,
  lineDraftKey,
  reconcileDrafts,
  selectionLines,
  type Range,
} from './lib/diff.ts';
import { draftEditorId, editEditorId, fileId, replyEditorId } from './lib/html.ts';
import { clampTreeWidth, loadTreeOpen, loadTreeWidth, saveTreeOpen, saveTreeWidth } from './lib/storage.ts';
import type { Draft, DragSelection, Session, Side, Thread, ViewMode } from './types.ts';

/** An open draft. Its text is a signal of its own. */
export type DraftState = Omit<Draft, 'text'> & { text: Signal<string> };

// ---------- state ----------

export const session = signal<Session | null>(null);
export const loadError = signal('');
export const connected = signal(true);
export const error = signal('');

export const view = signal<ViewMode>('unified');
export const treeOpen = signal(loadTreeOpen());
export const treeWidth = signal(loadTreeWidth());
export const treeFilter = signal('');
export const onlyThreads = signal(false);
export const closedFolders = signal<ReadonlySet<string>>(new Set());
export const collapsedFiles = signal<ReadonlySet<string>>(new Set());
export const currentFile = signal<string | null>(null);
/** compact is true when the page is scrolled: the header shows only the title and the send controls. */
export const compact = signal(false);

export const drafts = signal<Readonly<Record<string, DraftState>>>({});
/** Open reply editors: thread id -> reply text. */
export const replies = signal<Readonly<Record<string, Signal<string>>>>({});
/** Open edit editors: comment id -> comment text. */
export const edits = signal<Readonly<Record<string, Signal<string>>>>({});
/** Threads that the user opened or closed: thread id -> open. Other threads use open_default. */
export const expanded = signal<Readonly<Record<string, boolean>>>({});
export const drag = signal<DragSelection | null>(null);
/** The id of the editor that takes the focus when it shows. */
export const focusRequest = signal<string | null>(null);
/**
 * The ids of the editors that show the Preview tab. The flag is in the store, not in the editor, because a new
 * diff can move a thread to another row: the editor then shows again as a new component.
 */
export const previews = signal<ReadonlySet<string>>(new Set());

export const threadsByFile = computed(() => {
  const out = new Map<string, Thread[]>();
  for (const t of session.value?.threads ?? []) {
    const list = out.get(t.file);
    if (list) list.push(t);
    else out.set(t.file, [t]);
  }
  return out;
});

export const isExpanded = (t: Thread): boolean => expanded.value[t.id] ?? t.open_default;

/** selectedRanges lists the ranges to highlight in 1 file: the current drag and the drafts on lines. */
export function selectedRanges(path: string): Range[] {
  const out: Range[] = [];
  const d = drag.value;
  if (d && d.file === path) out.push({ side: d.side, lo: Math.min(d.a, d.b), hi: Math.max(d.a, d.b) });
  for (const x of Object.values(drafts.value)) {
    if (x.file === path && x.side !== 'file') out.push({ side: x.side, lo: x.start, hi: x.end });
  }
  return out;
}

// ---------- helpers ----------

const without = <T>(rec: Readonly<Record<string, T>>, key: string): Record<string, T> => {
  const { [key]: _removed, ...rest } = rec;
  return rest;
};

const toggled = (set: ReadonlySet<string>, key: string, on: boolean): Set<string> => {
  const out = new Set(set);
  if (on) out.add(key);
  else out.delete(key);
  return out;
};

let errorTimer: ReturnType<typeof setTimeout> | undefined;

export function showError(message: string): void {
  error.value = message;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => (error.value = ''), 6000);
}

/** run calls the server. A failure shows an error and keeps the editors open with their text. */
async function run(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (e) {
    showError(`Could not save: ${(e as Error).message}`);
    return false;
  }
}

function focusEditor(id: string): void {
  focusRequest.value = id;
}

export function setPreview(editorId: string, on: boolean): void {
  if (previews.value.has(editorId) !== on) previews.value = toggled(previews.value, editorId, on);
}

/**
 * keepFocus saves the focused text field and its selection. The returned function gives the focus back after
 * the redraw, if the field shows as a new element with the same id, for example a reply editor whose thread
 * moved to another row.
 */
function keepFocus(): () => void {
  const el = document.activeElement;
  if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) || !el.id) return () => {};
  const { id, selectionStart, selectionEnd } = el;
  return () =>
    requestAnimationFrame(() => {
      const now = document.getElementById(id);
      if (!(now instanceof HTMLTextAreaElement || now instanceof HTMLInputElement) || now === document.activeElement) return;
      now.focus({ preventScroll: true });
      now.setSelectionRange(selectionStart, selectionEnd);
    });
}

/**
 * reuse keeps the objects of the previous state that did not change, so that a component that gets the same
 * object can skip its redraw. The diff is the same while rev is the same. A thread is reused when its JSON is equal.
 */
function reuse(prev: Session | null, next: Session): Session {
  if (!prev) return next;
  const files = prev.rev === next.rev ? prev.files : next.files;
  const old = new Map(prev.threads.map((t) => [t.id, t]));
  const threads = next.threads.map((t) => {
    const p = old.get(t.id);
    return p && JSON.stringify(p) === JSON.stringify(t) ? p : t;
  });
  return { ...next, files, threads };
}

// ---------- session ----------

export async function load(): Promise<void> {
  const s = reuse(session.peek(), await api.state());
  const restoreFocus = keepFocus();
  batch(() => {
    session.value = s;
    if (!currentFile.value && s.files.length) currentFile.value = s.files[0]!.path;
    syncDrafts(s);
  });
  restoreFocus();
}

/** syncDrafts applies reconcileDrafts to the draft signals. A draft that keeps its key keeps its text signal. */
function syncDrafts(s: Session): void {
  const plain: Record<string, Draft> = {};
  for (const [k, d] of Object.entries(drafts.value)) plain[k] = { ...d, text: d.text.value };
  const next = reconcileDrafts(plain, s);
  const out: Record<string, DraftState> = {};
  let changed = Object.keys(next).length !== Object.keys(plain).length;
  for (const [k, d] of Object.entries(next)) {
    const old = drafts.value[k];
    if (old) {
      if (old.text.value !== d.text) old.text.value = d.text;
      out[k] = old;
    } else {
      out[k] = { ...d, text: signal(d.text) };
      changed = true;
    }
  }
  if (changed) drafts.value = out;
}

export function start(): void {
  load().catch((e: Error) => (loadError.value = `Could not load the review session: ${e.message}`));
  connectEvents({
    onUpdate: () => {
      connected.value = true;
      load().catch(() => (connected.value = false));
    },
    onDisconnect: () => (connected.value = false),
  });
}

export const sendComments = () => run(api.send);

// ---------- layout ----------

export function setView(v: ViewMode): void {
  view.value = v;
}

export function toggleTree(): void {
  treeOpen.value = !treeOpen.value;
  saveTreeOpen(treeOpen.value);
}

export function setTreeWidth(w: number, save: boolean): void {
  treeWidth.value = clampTreeWidth(w);
  if (save) saveTreeWidth(treeWidth.value);
}

export function toggleFolder(path: string): void {
  closedFolders.value = toggled(closedFolders.value, path, !closedFolders.value.has(path));
}

export function toggleFile(path: string): void {
  collapsedFiles.value = toggled(collapsedFiles.value, path, !collapsedFiles.value.has(path));
}

export function gotoFile(path: string): void {
  batch(() => {
    currentFile.value = path;
    collapsedFiles.value = toggled(collapsedFiles.value, path, false);
  });
  requestAnimationFrame(() => document.getElementById(fileId(path))?.scrollIntoView({ block: 'start' }));
}

export function toggleThread(t: Thread): void {
  expanded.value = { ...expanded.value, [t.id]: !isExpanded(t) };
}

// ---------- drafts ----------

export function openFileComment(path: string): void {
  const key = fileDraftKey(path);
  batch(() => {
    if (!drafts.value[key]) {
      drafts.value = { ...drafts.value, [key]: { key, file: path, side: 'file', start: 0, end: 0, sel: [], text: signal('') } };
    }
    collapsedFiles.value = toggled(collapsedFiles.value, path, false);
  });
  focusEditor(draftEditorId(key));
}

export function cancelDraft(key: string): void {
  drafts.value = without(drafts.value, key);
  setPreview(draftEditorId(key), false);
}

export async function saveDraft(key: string, mode: SaveMode): Promise<void> {
  const d = drafts.value[key];
  if (!d) return;
  if (!d.text.value.trim()) return showError('The comment is empty.');
  const ok = await run(() =>
    api.createComment({ file: d.file, side: d.side, start_line: d.start, end_line: d.end, body: d.text.value, action: mode }),
  );
  if (!ok) return;
  cancelDraft(key);
  await run(load);
}

// ---------- line selection ----------

export function startDrag(file: string, side: Side, line: number): void {
  drag.value = { file, side, a: line, b: line };
}

export function extendDrag(line: number): void {
  const d = drag.value;
  if (d && d.b !== line) drag.value = { ...d, b: line };
}

/** endDrag opens a draft on the selected lines: the consecutive lines from the first line of the range. */
export function endDrag(): void {
  const d = drag.value;
  if (!d) return;
  const s = session.value;
  const f = s && findFile(s, d.file);
  const lines = f ? selectionLines(f, d.side, Math.min(d.a, d.b), Math.max(d.a, d.b)) : [];
  if (!f || !lines.length) {
    drag.value = null;
    return;
  }
  const start = lines[0]!.num;
  const end = lines[lines.length - 1]!.num;
  const key = lineDraftKey(f.path, d.side, start, end);
  batch(() => {
    drag.value = null;
    if (!drafts.value[key]) {
      const draft: DraftState = { key, file: f.path, side: d.side, start, end, sel: lines.map((l) => l.text), text: signal('') };
      drafts.value = { ...drafts.value, [key]: draft };
    }
  });
  focusEditor(draftEditorId(key));
}

// ---------- replies ----------

export function openReply(threadId: string): void {
  if (!replies.value[threadId]) replies.value = { ...replies.value, [threadId]: signal('') };
  focusEditor(replyEditorId(threadId));
}

export function cancelReply(threadId: string): void {
  replies.value = without(replies.value, threadId);
  setPreview(replyEditorId(threadId), false);
}

export async function sendReply(threadId: string, mode: SaveMode): Promise<void> {
  const text = replies.value[threadId]?.value ?? '';
  if (!text.trim()) return showError('The reply is empty.');
  if (!(await run(() => api.reply(threadId, text, mode)))) return;
  cancelReply(threadId);
  await run(load);
}

export async function resolveThread(threadId: string, resolved: boolean): Promise<void> {
  if (!(await run(() => api.resolve(threadId, resolved)))) return;
  expanded.value = without(expanded.value, threadId);
  await run(load);
}

// ---------- edits ----------

export function startEdit(commentId: string, body: string): void {
  edits.value = { ...edits.value, [commentId]: signal(body) };
  focusEditor(editEditorId(commentId));
}

export function cancelEdit(commentId: string): void {
  edits.value = without(edits.value, commentId);
  setPreview(editEditorId(commentId), false);
}

export async function saveEdit(commentId: string): Promise<void> {
  const text = edits.value[commentId]?.value ?? '';
  if (!(await run(() => api.editComment(commentId, text)))) return;
  cancelEdit(commentId);
  await run(load);
}

export async function deleteComment(commentId: string): Promise<void> {
  if (await run(() => api.deleteComment(commentId))) await run(load);
}
