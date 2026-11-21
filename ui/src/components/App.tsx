import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { compact, loadError, session, treeOpen, treeWidth } from '../store.ts';
import type { DiffFile } from '../types.ts';
import { FileCard } from './FileCard.tsx';
import { FileTree, TreeResizer } from './FileTree.tsx';
import { Header } from './Header.tsx';
import { LineSelection } from './LineSelection.tsx';
import { StatusBar } from './StatusBar.tsx';

export function App() {
  const s = session.value;
  useCompactHeader();
  useEffect(() => {
    document.title = (s?.title || 'Review session') + ' · hrev';
  }, [s?.title]);

  if (loadError.value) return <p class="loading">{loadError.value}</p>;
  if (!s) return <p class="loading">Loading…</p>;

  const layoutStyle = { '--tree-w': `${treeWidth.value}px` } as JSX.CSSProperties;
  return (
    <>
      <Topbar>
        <Header session={s} />
        <StatusBar agent={s.agent} />
      </Topbar>
      <div class="layout" style={layoutStyle}>
        {treeOpen.value && (
          <>
            <FileTree />
            <TreeResizer />
          </>
        )}
        <DiffPane files={s.files} />
      </div>
      <LineSelection />
    </>
  );
}

function DiffPane({ files }: { files: DiffFile[] }) {
  return (
    <main class="diffpane" aria-label="Diff">
      {files.length ? files.map((f) => <FileCard key={f.path} file={f} />) : <div class="card empty-diff">No changes</div>}
    </main>
  );
}

/**
 * Topbar holds the header and the status. The page has 1 scroll: the top bar sticks to the top, and the file
 * tree and the file headers stick below it. The CSS gets the current height of the top bar in --top-h.
 */
function Topbar({ children }: { children: JSX.Element[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current!;
    const set = () => document.documentElement.style.setProperty('--top-h', `${bar.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  return (
    <div class="topbar" ref={ref}>
      {children}
    </div>
  );
}

/** After 24px of page scroll, the header shows only the title and the send controls. It is full size again at the top. */
function useCompactHeader() {
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      compact.value = compact.peek() ? y > 0 : y > 24;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
}
