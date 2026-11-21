const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** esc makes text safe to put in HTML. */
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** idFor makes a string safe to use in an element id. */
export const idFor = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, '_');

export const fileId = (path: string): string => 'file-' + idFor(path);
export const draftEditorId = (key: string): string => 'draft-' + idFor(key);
export const replyEditorId = (threadId: string): string => 'reply-' + idFor(threadId);
export const editEditorId = (commentId: string): string => 'edit-' + idFor(commentId);

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
