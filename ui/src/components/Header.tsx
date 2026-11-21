// The full header: the title and the texts use the full width. Below a separator, a bar holds the file list
// button on the left, and the pending count with the Send button on the right. When the page is scrolled, only
// the bar stays, and it shows the title.
import { useEffect, useRef, useState } from 'preact/hooks';
import { ago } from '../lib/diff.ts';
import { compact, sendComments, setView, toggleTree, treeOpen, view } from '../store.ts';
import type { Session, ViewMode } from '../types.ts';
import { CopyButton } from './CopyButton.tsx';
import { CheckIcon, GearIcon, SidebarIcon } from './icons.tsx';

export function Header({ session: s }: { session: Session }) {
  const title = s.title || 'Review session';
  const treeLabel = `${treeOpen.value ? 'Hide' : 'Show'} the file list`;
  return (
    <header class={`header ${compact.value ? 'compact' : ''}`}>
      <div class="header-main">
        <div class="title-row">
          <h1>{title}</h1>
          <CopyButton
            class="btn btn-small copy-session"
            text={`hrev session ${s.id}`}
            label="Copy session"
            title={`Copy "hrev session ${s.id}", to give the session to a reviewer agent`}
            failure="Could not copy the session."
            caption={['Copy session', 'Copied']}
          />
        </div>
        {s.description && <p class="desc">{s.description}</p>}
        {(s.source || s.diff_time) && (
          <p class="source">
            {s.source ? (
              <>
                Diff: <span class="mono">{s.source}</span>
              </>
            ) : (
              'Diff'
            )}
            {s.diff_time && <DiffAge time={s.diff_time} />}
          </p>
        )}
      </div>
      <div class="header-bar">
        <button
          class={`iconbtn sm ${treeOpen.value ? 'on' : ''}`}
          type="button"
          aria-pressed={treeOpen.value}
          aria-label={treeLabel}
          title={treeLabel}
          onClick={toggleTree}
        >
          <SidebarIcon />
        </button>
        <span class="bar-title" aria-hidden="true">
          {title}
        </span>
        <span class="spacer" />
        <span class="pending-count">
          <strong>{s.pending}</strong> pending comment{s.pending === 1 ? '' : 's'}
        </span>
        <button class="btn btn-primary" type="button" disabled={s.pending === 0} onClick={sendComments}>
          Send comments
        </button>
        <SettingsMenu />
      </div>
    </header>
  );
}

/** DiffAge shows the age of the diff and updates it every 30 seconds. */
function DiffAge({ time }: { time: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <>
      {' · '}
      <span class="diff-age" title={`Last diff update: ${new Date(time).toLocaleString()}`}>
        updated {ago(time)}
      </span>
    </>
  );
}

const VIEWS: { mode: ViewMode; label: string }[] = [
  { mode: 'unified', label: 'Unified' },
  { mode: 'split', label: 'Split' },
];

/** SettingsMenu closes on a click outside it and on Escape. */
function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div class="menu-wrap" ref={wrap}>
      <button
        class={`iconbtn sm ${open ? 'on' : ''}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen(!open)}
      >
        <GearIcon />
      </button>
      <div class="menu" role="menu" hidden={!open}>
        <p class="menu-label">Layout</p>
        {VIEWS.map(({ mode, label }) => (
          <button
            key={mode}
            class="menu-item"
            type="button"
            role="menuitemradio"
            aria-checked={view.value === mode}
            onClick={() => {
              setView(mode);
              setOpen(false);
            }}
          >
            <span class="menu-check">{view.value === mode && <CheckIcon />}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
