import type { Signal } from '@preact/signals';
import { agentWork, firstLine, sign, threadWhere, where } from '../lib/diff.ts';
import { draftEditorId, editEditorId, plural, replyEditorId } from '../lib/html.ts';
import {
  cancelDraft,
  cancelEdit,
  cancelReply,
  deleteComment,
  edits,
  isExpanded,
  openReply,
  replies,
  resolveThread,
  saveDraft,
  saveEdit,
  sendReply,
  startEdit,
  toggleThread,
  type DraftState,
} from '../store.ts';
import type { Comment, Thread } from '../types.ts';
import { Editor } from './Editor.tsx';
import { AskNowIcon, SaveCommentIcon } from './icons.tsx';
import { Code } from './Code.tsx';
import { Markdown } from './Markdown.tsx';

export function ThreadView({ thread: t }: { thread: Thread }) {
  const working = agentWork(t) === 'working';
  const label = (
    <>
      {t.resolved ? <span class="badge b-resolved">Resolved</span> : t.outdated ? <span class="badge b-outdated">Outdated</span> : null}
      {working && (
        <span class="badge b-sent">
          <span class="pulse" />
          Agent working
        </span>
      )}
    </>
  );

  if (!isExpanded(t)) {
    const n = t.comments.length;
    return (
      <div class="thread">
        <button class="collapsed" type="button" aria-expanded="false" onClick={() => toggleThread(t)}>
          {label}
          <span class="sum">
            {threadWhere(t)} · “{firstLine(t.comments[0]?.body ?? '')}” · {plural(n, 'message')}
          </span>
          <span class="spacer" />
          <span>Show</span>
        </button>
      </div>
    );
  }

  return (
    <div class="thread">
      {(t.resolved || t.outdated) && (
        <button class="collapsed" type="button" aria-expanded="true" onClick={() => toggleThread(t)}>
          {label}
          <span class="sum">{threadWhere(t)}</span>
          <span class="spacer" />
          <span>Hide</span>
        </button>
      )}
      {t.outdated && !!t.original?.length && (
        <>
          <p class="snippet-label">Original code when you wrote the comment</p>
          <div class="snippet">
            {t.original.map((l, i) => (
              <div key={i} class={`row ${l.kind}`}>
                <span class="num">{l.num}</span>
                <span class="sign">{sign(l.kind)}</span>
                <Code text={l.text} />
              </div>
            ))}
          </div>
        </>
      )}
      {t.comments.map((c, i) => (
        <Message key={c.id} thread={t} comment={c} isRoot={i === 0} />
      ))}
      <AgentWork thread={t} />
      {t.resolved ? <ResolvedBar thread={t} /> : <ReplyBox thread={t} />}
    </div>
  );
}

function AgentWork({ thread }: { thread: Thread }) {
  switch (agentWork(thread)) {
    case 'working':
      return (
        <div class="work" role="status">
          <span class="pulse" />
          The agent is working on this…
        </div>
      );
    case 'waiting':
      return (
        <div class="work" role="status">
          Waiting for the agent to pick this up
        </div>
      );
    default:
      return null;
  }
}

function ResolvedBar({ thread }: { thread: Thread }) {
  return (
    <div class="composer">
      <div class="actions">
        <span class="meta">You resolved this conversation.</span>
        <span class="spacer" />
        <button class="btn btn-ghost" type="button" onClick={() => resolveThread(thread.id, false)}>
          Unresolve
        </button>
      </div>
    </div>
  );
}

const suggestFor = (t: Thread): string | null => (t.side === 'file' ? null : (t.selected_text ?? ''));

function ReplyBox({ thread: t }: { thread: Thread }) {
  const text = replies.value[t.id];
  if (!text) {
    // A closed reply box: 1 field that opens the editor, as on GitHub.
    return (
      <div class="composer composer-closed">
        <button class="reply-open" type="button" onClick={() => openReply(t.id)}>
          Reply…
        </button>
        <button class="btn btn-ghost" type="button" onClick={() => resolveThread(t.id, true)}>
          Resolve
        </button>
      </div>
    );
  }
  return (
    <div class="composer">
      <Editor id={replyEditorId(t.id)} text={text} label="Reply to this thread" placeholder="Reply…" small suggestCode={suggestFor(t)} />
      <SaveButtons onCancel={() => cancelReply(t.id)} onSave={(mode) => sendReply(t.id, mode)} />
    </div>
  );
}

/** SaveButtons: Cancel, Comment (saved as pending) and Ask now (sent at once). */
function SaveButtons({ onCancel, onSave }: { onCancel: () => void; onSave: (mode: 'save' | 'ask') => void }) {
  return (
    <div class="actions">
      <span class="spacer" />
      <button class="btn" type="button" onClick={onCancel}>
        Cancel
      </button>
      <button class="btn" type="button" onClick={() => onSave('save')}>
        <SaveCommentIcon />
        Comment
      </button>
      <button class="btn btn-primary" type="button" onClick={() => onSave('ask')}>
        <AskNowIcon />
        Ask now
      </button>
    </div>
  );
}

function Message({ thread: t, comment: c, isRoot }: { thread: Thread; comment: Comment; isRoot: boolean }) {
  const user = c.author === 'user';
  const editing: Signal<string> | undefined = edits.value[c.id];
  const name = user ? c.name || 'You' : 'Agent';
  const initials = user ? (c.name ? c.name.slice(0, 2).toUpperCase() : 'YOU') : 'AI';
  return (
    <div class="msg">
      <div class={`av ${user ? 'av-user' : 'av-agent'}`} aria-hidden="true">
        {initials}
      </div>
      <div class="msg-main">
        <div class="meta">
          <span class="who">{name}</span>
          {isRoot && <span>{threadWhere(t)}</span>}
          {user && c.state === 'pending' && <span class="badge b-pending">Pending</span>}
          {user && c.state === 'sent' && <span class="badge b-sent">Sent</span>}
        </div>
        {editing ? (
          <>
            <Editor id={editEditorId(c.id)} text={editing} label="Edit comment" small suggestCode={suggestFor(t)} />
            <div class="msg-actions">
              <button class="btn btn-primary btn-small" type="button" onClick={() => saveEdit(c.id)}>
                Save
              </button>
              <button class="btn btn-ghost btn-small" type="button" onClick={() => cancelEdit(c.id)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <Markdown class="body" source={c.body} />
            {user && c.state === 'pending' && (
              <div class="msg-actions">
                <button class="btn btn-ghost btn-small" type="button" onClick={() => startEdit(c.id, c.body)}>
                  Edit
                </button>
                <button class="btn btn-ghost btn-small" type="button" onClick={() => deleteComment(c.id)}>
                  Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function DraftView({ draft: d }: { draft: DraftState }) {
  return (
    <div class="thread draft">
      <div class="composer">
        <div class="meta">
          <span class="who">New comment</span>
          <span>{where(d.side, d.start, d.end)}</span>
        </div>
        <Editor
          id={draftEditorId(d.key)}
          text={d.text}
          label="New comment"
          placeholder="Ask a question or describe a change"
          suggestCode={d.side === 'file' ? null : d.sel.join('\n')}
        />
        <SaveButtons onCancel={() => cancelDraft(d.key)} onSave={(mode) => saveDraft(d.key, mode)} />
      </div>
    </div>
  );
}
