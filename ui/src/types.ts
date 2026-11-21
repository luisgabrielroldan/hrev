// The JSON shapes of GET /api/state. They match the Go types in internal/server, internal/store and
// internal/diffparse.

export type Side = 'old' | 'new';
export type ThreadSide = Side | 'file';
export type LineKind = 'ctx' | 'add' | 'del';
export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified';
export type AgentStatus = 'working' | 'listening' | 'idle';

export interface DiffLine {
  kind: LineKind;
  old?: number;
  new?: number;
  text: string;
  /** The text with syntax color spans, made by the server. Missing for an unknown language. */
  html?: string;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  old_path: string;
  status: FileStatus;
  binary: boolean;
  adds: number;
  dels: number;
  hunks: Hunk[];
}

export interface CodeLine {
  kind: LineKind;
  num: number;
  text: string;
}

export interface Comment {
  id: string;
  author: 'user' | 'agent';
  /** A reviewer name, set on a user-side comment from `hrev comment --author`. */
  name?: string;
  body: string;
  state?: 'pending' | 'sent' | 'answered';
  /** wait printed the event of this comment: the agent works on it. */
  printed?: boolean;
}

export interface Thread {
  id: string;
  file: string;
  side: ThreadSide;
  start_line?: number;
  end_line?: number;
  selected_text?: string;
  original?: CodeLine[];
  outdated: boolean;
  resolved: boolean;
  comments: Comment[];
  open_default: boolean;
}

export interface Session {
  id: string;
  title: string;
  description: string;
  source: string;
  diff_time?: string;
  rev: number;
  files: DiffFile[];
  threads: Thread[];
  pending: number;
  agent: AgentStatus;
}

/** A new comment that the user writes and has not saved yet. */
export interface Draft {
  key: string;
  file: string;
  side: ThreadSide;
  start: number;
  end: number;
  text: string;
  /** The text of the selected lines, to detect a changed diff. Empty for a file comment. */
  sel: string[];
}

/** A line selection while the user drags on the line numbers. a is the first line, b the current line. */
export interface DragSelection {
  file: string;
  side: Side;
  a: number;
  b: number;
}

export type ViewMode = 'unified' | 'split';
