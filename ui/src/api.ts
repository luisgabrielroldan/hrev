// The HTTP API of the hrev server. Every request carries the token of the page URL.
import type { Session, ThreadSide } from './types.ts';

export const token = new URLSearchParams(location.search).get('t') ?? '';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers: { 'X-Hrev-Token': token, ...init.headers } });
  } catch {
    throw new Error('The server did not answer.');
  }
  if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
  return r.json() as Promise<T>;
}

const post = <T = unknown>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** ask sends the comment to the agent at once. save keeps it pending until Send. */
export type SaveMode = 'ask' | 'save';

export interface NewComment {
  file: string;
  side: ThreadSide;
  start_line: number;
  end_line: number;
  body: string;
  action: SaveMode;
}

export const api = {
  state: () => request<Session>('/api/state'),
  send: () => post('/api/send', {}),
  createComment: (c: NewComment) => post('/api/comments', c),
  reply: (threadId: string, body: string, action: SaveMode) => post('/api/comments', { thread_id: threadId, body, action }),
  editComment: (id: string, body: string) => post(`/api/comments/${encodeURIComponent(id)}/edit`, { body }),
  deleteComment: (id: string) => post(`/api/comments/${encodeURIComponent(id)}/delete`, {}),
  resolve: (threadId: string, resolved: boolean) => post(`/api/threads/${encodeURIComponent(threadId)}/resolve`, { resolved }),
  /** uploadImage stores a pasted image and returns the Markdown that shows it. */
  uploadImage: (file: File) =>
    request<{ markdown: string }>('/api/attachments', { method: 'POST', headers: { 'Content-Type': file.type }, body: file }),
};

export interface EventHandlers {
  onUpdate: () => void;
  onDisconnect: () => void;
}

/**
 * connectEvents keeps a live connection to the server. When the session is replaced by a new one, the tab loads
 * the new session. Only a local address is accepted.
 */
export function connectEvents({ onUpdate, onDisconnect }: EventHandlers): () => void {
  const es = new EventSource('/api/events?t=' + encodeURIComponent(token));
  es.addEventListener('update', onUpdate);
  es.addEventListener('replaced', (e) => {
    es.close();
    const url = (e as MessageEvent<string>).data;
    if (/^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+$/.test(url)) location.replace(url);
  });
  es.onerror = onDisconnect;
  return () => es.close();
}
