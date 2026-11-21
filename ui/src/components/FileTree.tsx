import { useComputed } from '@preact/signals';
import { plural } from '../lib/html.ts';
import { treeRows } from '../lib/tree.ts';
import {
  closedFolders,
  currentFile,
  gotoFile,
  onlyThreads,
  session,
  setTreeWidth,
  threadsByFile,
  toggleFolder,
  treeFilter,
  treeWidth,
} from '../store.ts';
import { ChevronIcon, CommentIcon, FileIcon, FilterIcon, FolderIcon, SearchIcon } from './icons.tsx';

const indent = (depth: number) => ({ paddingLeft: `${8 + depth * 20}px` });

export function FileTree() {
  const rows = useComputed(() => {
    const q = treeFilter.value.trim().toLowerCase();
    const threads = threadsByFile.value;
    const files = session.value?.files ?? [];
    const shown = files.filter((f) => (!q || f.path.toLowerCase().includes(q)) && (!onlyThreads.value || threads.has(f.path)));
    return treeRows(shown, closedFolders.value);
  });

  return (
    <nav class="tree" aria-label="Changed files">
      <div class="tree-top">
        <label class="filter">
          <SearchIcon />
          <span class="sr">Filter files</span>
          <input
            id="tree-filter"
            type="text"
            placeholder="Filter files…"
            value={treeFilter.value}
            onInput={(e) => (treeFilter.value = e.currentTarget.value)}
          />
        </label>
        <button
          class={`iconbtn ${onlyThreads.value ? 'on' : ''}`}
          type="button"
          aria-pressed={onlyThreads.value}
          aria-label="Show only files with comments"
          title="Show only files with comments"
          onClick={() => (onlyThreads.value = !onlyThreads.value)}
        >
          <FilterIcon />
        </button>
      </div>
      <div class="tree-list">
        {rows.value.length === 0 && <p class="tree-empty">No files match.</p>}
        {rows.value.map((row) => {
          if (row.kind === 'folder') {
            return (
              <button key={`d:${row.path}`} class="node" type="button" aria-expanded={row.open} style={indent(row.depth)} onClick={() => toggleFolder(row.path)}>
                <span class={`chev ${row.open ? '' : 'closed'}`}>
                  <ChevronIcon />
                </span>
                <FolderIcon open={row.open} />
                <span class="name">{row.name}</span>
              </button>
            );
          }
          const n = threadsByFile.value.get(row.file.path)?.length ?? 0;
          return (
            <button
              key={`f:${row.file.path}`}
              class={`node ${currentFile.value === row.file.path ? 'on' : ''}`}
              type="button"
              style={indent(row.depth)}
              onClick={() => gotoFile(row.file.path)}
            >
              <span class="chev" />
              <FileIcon status={row.file.status} />
              <span class="name">{row.name}</span>
              {n > 0 && (
                <span class="tcount" title={plural(n, 'thread')}>
                  <CommentIcon />
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** TreeResizer resizes the file list: drag the handle, or press the arrow keys when the handle has the focus. */
export function TreeResizer() {
  const onPointerDown = (e: PointerEvent) => {
    const handle = e.currentTarget as HTMLElement;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('active');
    const left = handle.parentElement!.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => setTreeWidth(ev.clientX - left, false);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.classList.remove('active');
      setTreeWidth(treeWidth.value, true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!step) return;
    e.preventDefault();
    setTreeWidth(treeWidth.value + step, true);
  };
  return (
    <div
      class="tree-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the file list"
      title="Drag to resize the file list"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
