(() => {
  'use strict';

  const token = new URLSearchParams(location.search).get('t') || '';
  const ui = {
    view: 'unified',
    collapsed: {},   // file path -> true when the file is closed
    folders: {},     // folder path -> false when the folder is closed
    filter: '',
    onlyThreads: false,
    expanded: {},    // thread id -> true/false, overrides open_default
    drafts: {},      // draft key -> {file, side, start, end, text, sel}
    replies: {},     // thread id -> reply text
    editing: {},     // comment id -> text
    current: null,   // current file path
    drag: null,      // {file, side, a, b}
    connected: true,
    error: '',
    compact: false,  // true when the diff is scrolled: the header shows only the title and the send controls
    treeW: loadTreeWidth(),
    treeOpen: loadTreeOpen(),
    preview: {},     // editor id -> true when the Preview tab is open
    replyOpen: {},   // thread id -> true when its reply editor is open
  };
  let data = null;

  // The width of the file list is a per-viewer convenience. Storage can be missing, so every access is guarded.
  function loadTreeWidth() {
    try { const w = parseInt(localStorage.getItem('reviewit.treeWidth'), 10); if (w > 0) return w; } catch (e) { /* no storage */ }
    return 300;
  }
  function saveTreeWidth(w) {
    try { localStorage.setItem('reviewit.treeWidth', String(w)); } catch (e) { /* no storage */ }
  }
  function loadTreeOpen() {
    try { return localStorage.getItem('reviewit.treeOpen') !== 'false'; } catch (e) { return true; }
  }
  function saveTreeOpen(v) {
    try { localStorage.setItem('reviewit.treeOpen', String(v)); } catch (e) { /* no storage */ }
  }
  const clampTreeWidth = (w) => Math.round(Math.max(180, Math.min(w, window.innerWidth * 0.6)));
  let errorTimer = null;

  // ---------- helpers ----------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const idFor = (s) => String(s).replace(/[^a-zA-Z0-9]/g, '_');
  const fileId = (path) => 'file-' + idFor(path);

  async function api(path, body) {
    const opts = { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Reviewit-Token': token } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let r;
    try {
      r = await fetch(path, opts);
    } catch (e) {
      throw new Error('The server did not answer.');
    }
    if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
    return r.json();
  }

  function showError(msg) {
    ui.error = msg;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { ui.error = ''; render(); }, 6000);
    render();
  }

  function findFile(path) {
    return data.files.find((f) => f.path === path) || data.files.find((f) => f.old_path === path) || null;
  }

  function sideLines(f, side) {
    const out = [];
    for (const h of f.hunks || []) {
      for (const l of h.lines) {
        if (side === 'new' && l.new) out.push({ num: l.new, text: l.text, kind: l.kind });
        if (side === 'old' && l.old) out.push({ num: l.old, text: l.text, kind: l.kind });
      }
    }
    return out;
  }

  // Consecutive lines from start, as the server stores them.
  function selectionLines(f, side, start, end) {
    const lines = sideLines(f, side).filter((l) => l.num >= start && l.num <= end);
    let n = 1;
    while (n < lines.length && lines[n].num === lines[n - 1].num + 1) n++;
    return lines.slice(0, n);
  }

  function where(t) {
    if (t.side === 'file') return 'File comment';
    const lines = t.start_line === t.end_line ? `Line ${t.start_line}` : `Lines ${t.start_line}–${t.end_line}`;
    return t.side === 'old' ? `${lines} (old)` : lines;
  }

  const firstLine = (s) => { const l = String(s).split('\n')[0]; return l.length > 80 ? l.slice(0, 80) + '…' : l; };

  function isExpanded(t) {
    return ui.expanded[t.id] ?? t.open_default;
  }

  // ---------- data ----------

  async function load() {
    data = await api('/api/state');
    if (!ui.current && data.files.length) ui.current = data.files[0].path;
    reconcileDrafts();
    render();
  }

  // A draft keeps its lines if they are still in the diff. If not, it moves under the file header.
  function reconcileDrafts() {
    for (const [key, d] of Object.entries(ui.drafts)) {
      if (d.side === 'file') continue;
      const f = findFile(d.file);
      if (!f) continue;
      const lines = selectionLines(f, d.side, d.start, d.end);
      const same = lines.length === d.sel.length && lines.every((l, i) => l.text === d.sel[i]);
      if (same) continue;
      delete ui.drafts[key];
      const fk = `${f.path}|file`;
      if (ui.drafts[fk]) {
        ui.drafts[fk].text = [ui.drafts[fk].text, d.text].filter(Boolean).join('\n\n');
      } else {
        ui.drafts[fk] = { file: f.path, side: 'file', text: d.text, sel: [] };
      }
    }
  }

  // ---------- icons ----------

  const icon = {
    copy: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>',
    // Speech bubble icons for the 2 comment buttons: with a bolt for Ask now (sent at once), empty for Comment (saved as pending).
    askNow: '<svg class="btn-ic" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/><path d="M8.95 3.2 5.9 7.05h2l-.85 3.15 3.1-3.95H8.1Z"/></svg>',
    saveComment: '<svg class="btn-ic" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>',
    suggest: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z"/></svg>',
    gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
    sidebar: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 2.5v11"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3.5 3.5"/></svg>',
    filter: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2"/></svg>',
    comment: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5h-.5a1 1 0 0 1-1-1z"/></svg>',
    folderOpen: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" style="color:var(--muted);flex:0 0 18px"><path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5a1 1 0 0 1 1 1v1.5h-8.2a1 1 0 0 0-.95.68L1.5 12.5z" fill="currentColor"/><path d="M4.3 7.2a1 1 0 0 1 .95-.7h9.4a.6.6 0 0 1 .57.8l-1.8 5.5a1 1 0 0 1-.95.7H1.9z" fill="currentColor" opacity=".75"/></svg>',
    folderClosed: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" style="color:var(--muted);flex:0 0 18px"><path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
    // File icons: the sheet of the suggestion icon. A modified file shows the same plus and minus as that icon.
    file(status) {
      const sheet = 'M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073Z';
      const map = {
        added: ['var(--plus)', 'Added file', 'M8 5.5a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 8 5.5Z'],
        deleted: ['var(--minus)', 'Deleted file', 'M5 8.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.5Z'],
        renamed: ['var(--muted)', 'Renamed file', 'M5 8.5a.75.75 0 0 1 .75-.75h3.19l-.97-.97a.75.75 0 0 1 1.06-1.06l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06-1.06l.97-.97H5.75A.75.75 0 0 1 5 8.5Z'],
        modified: ['var(--muted)', 'Modified file', 'M8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z'],
      };
      const [color, label, mark] = map[status] || map.modified;
      return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" role="img" aria-label="${label}" style="color:${color};flex:0 0 16px"><path d="${sheet}"/><path d="${mark}"/></svg>`;
    },
  };

  // ---------- render ----------

  function render() {
    const app = document.getElementById('app');
    if (!data) return;
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    addBtn.hidden = true;
    const treeList = document.querySelector('.tree-list');
    const scroll = [window.scrollY, treeList ? treeList.scrollTop : 0];

    app.innerHTML = `<div class="topbar">${headerHTML()}${statusHTML()}</div><div class="layout" style="--tree-w:${ui.treeW}px">${ui.treeOpen ? treeHTML() + '<div class="tree-resize" role="separator" aria-orientation="vertical" aria-label="Resize the file list" title="Drag to resize the file list" tabindex="0" data-resize></div>' : ''}${diffHTML()}</div>`;

    const tree2 = document.querySelector('.tree-list');
    watchTopbar();
    window.scrollTo(0, scroll[0]);
    if (tree2) tree2.scrollTop = scroll[1];
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus({ preventScroll: true });
        if (caret && typeof el.setSelectionRange === 'function') el.setSelectionRange(caret[0], caret[1]);
      }
    }
    document.title = (data.title || 'Review session') + ' · reviewit';
  }

  // Full header: the title and the texts use the full width. Below a separator, a bar holds the file list button
  // on the left and the pending count with the Send button on the right. When the page is scrolled, only the bar
  // stays, and it shows the title.
  function headerHTML() {
    const n = data.pending;
    const title = esc(data.title || 'Review session');
    const label = `${ui.treeOpen ? 'Hide' : 'Show'} the file list`;
    return `<header class="header ${ui.compact ? 'compact' : ''}">
      <div class="header-main">
        <h1>${title}</h1>
        ${data.description ? `<p class="desc">${esc(data.description)}</p>` : ''}
        ${data.source || data.diff_time ? `<p class="source">${data.source ? `Diff: <span class="mono">${esc(data.source)}</span>` : 'Diff'}${diffAgeHTML()}</p>` : ''}
      </div>
      <div class="header-bar">
        <button class="iconbtn sm ${ui.treeOpen ? 'on' : ''}" type="button" data-action="toggle-tree" aria-pressed="${ui.treeOpen}" aria-label="${label}" title="${label}">${icon.sidebar}</button>
        <span class="bar-title" aria-hidden="true">${title}</span>
        <span class="spacer"></span>
        <span class="pending-count"><strong>${n}</strong> pending comment${n === 1 ? '' : 's'}</span>
        <button class="btn btn-primary" type="button" data-action="send" ${n === 0 ? 'disabled' : ''}>Send comments</button>
        <div class="menu-wrap">
          <button class="iconbtn sm" type="button" data-action="toggle-menu" aria-haspopup="menu" aria-expanded="false" aria-label="Settings" title="Settings">${icon.gear}</button>
          <div class="menu" role="menu" hidden>
            <p class="menu-label">Layout</p>
            ${['unified', 'split'].map((v) => `<button class="menu-item" type="button" role="menuitemradio" aria-checked="${ui.view === v}" data-action="view" data-view="${v}"><span class="menu-check">${ui.view === v ? icon.check : ''}</span>${v === 'unified' ? 'Unified' : 'Split'}</button>`).join('')}
          </div>
        </div>
      </div>
    </header>`;
  }

  // The age of the diff: the agent must run refresh after each code change, so an old diff is visible.
  function ago(iso) {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  }
  function diffAgeHTML() {
    if (!data.diff_time) return '';
    return ` · <span class="diff-age" title="Last diff update: ${esc(new Date(data.diff_time).toLocaleString())}">updated ${ago(data.diff_time)}</span>`;
  }
  setInterval(() => {
    const el = document.querySelector('.diff-age');
    if (el && data && data.diff_time) el.textContent = `updated ${ago(data.diff_time)}`;
  }, 30000);

  function statusHTML() {
    if (!ui.connected) return '<div class="status status-disconnected" role="status">Reconnecting to reviewit… Your comments are safe. New comments can be saved when the connection returns.</div>';
    if (ui.error) return `<div class="status status-error" role="alert">${esc(ui.error)}</div>`;
    if (data.agent === 'working') return '<div class="status status-working" role="status">The agent is working on your comments</div>';
    if (data.agent === 'idle') return '<div class="status status-idle" role="status">The agent is not listening right now. Your comments are saved. The agent gets them when it listens again.</div>';
    return '';
  }

  // ---------- tree ----------

  function threadCount(path) {
    return data.threads.filter((t) => t.file === path).length;
  }

  function treeRowsHTML() {
    const q = ui.filter.trim().toLowerCase();
    const files = data.files.filter((f) => (!q || f.path.toLowerCase().includes(q)) && (!ui.onlyThreads || threadCount(f.path) > 0));
    const root = { dirs: {}, files: [] };
    for (const f of files) {
      const parts = f.path.split('/');
      let node = root;
      let prefix = '';
      for (const p of parts.slice(0, -1)) {
        prefix = prefix ? prefix + '/' + p : p;
        node.dirs[p] = node.dirs[p] || { dirs: {}, files: [], path: prefix };
        node = node.dirs[p];
      }
      node.files.push(f);
    }
    const rows = [];
    const walk = (node, depth) => {
      for (const name of Object.keys(node.dirs).sort()) {
        const d = node.dirs[name];
        const open = ui.folders[d.path] !== false;
        rows.push(`<button class="node" type="button" data-action="toggle-folder" data-path="${esc(d.path)}" aria-expanded="${open}" style="padding-left:${8 + depth * 20}px">
          <span class="chev ${open ? '' : 'closed'}">${icon.chev}</span>${open ? icon.folderOpen : icon.folderClosed}<span class="name">${esc(name)}</span></button>`);
        if (open) walk(d, depth + 1);
      }
      for (const f of node.files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
        const name = f.path.split('/').pop();
        const n = threadCount(f.path);
        const count = n ? `<span class="tcount" title="${n} thread${n === 1 ? '' : 's'}">${icon.comment}${n}</span>` : '';
        rows.push(`<button class="node ${ui.current === f.path ? 'on' : ''}" type="button" data-action="goto-file" data-path="${esc(f.path)}" style="padding-left:${8 + depth * 20}px">
          <span class="chev"></span>${icon.file(f.status)}<span class="name">${esc(name)}</span>${count}</button>`);
      }
    };
    walk(root, 0);
    return rows.join('') || '<p class="tree-empty">No files match.</p>';
  }

  function treeHTML() {
    return `<nav class="tree" aria-label="Changed files">
      <div class="tree-top">
        <label class="filter">${icon.search}<span class="sr">Filter files</span><input id="tree-filter" type="text" placeholder="Filter files…" value="${esc(ui.filter)}" data-input="filter"></label>
        <button class="iconbtn ${ui.onlyThreads ? 'on' : ''}" type="button" data-action="toggle-only-threads" aria-pressed="${ui.onlyThreads}" aria-label="Show only files with comments" title="Show only files with comments">${icon.filter}</button>
      </div>
      <div class="tree-list">${treeRowsHTML()}</div>
    </nav>`;
  }

  // The filter and the folders change only the tree. Redrawing only the tree keeps typing fast on a large diff.
  function renderTree() {
    const list = document.querySelector('.tree-list');
    if (!list) return render();
    list.innerHTML = treeRowsHTML();
    const btn = document.querySelector('[data-action="toggle-only-threads"]');
    if (btn) {
      btn.classList.toggle('on', ui.onlyThreads);
      btn.setAttribute('aria-pressed', String(ui.onlyThreads));
    }
  }


  // ---------- markdown ----------
  // A small Markdown renderer for comments. The text is escaped first, so a comment can never inject HTML.
  // Images render only from the session attachments; links open only http and https addresses.

  function mdInline(text) {
    const codes = [];
    let t = String(text).replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    t = esc(t);
    t = t.replace(/!\[([^\]]*)\]\((attachments\/[0-9a-f]{16}\.(?:png|jpg|gif|webp))\)/g,
      (m, alt, src) => `<a href="/api/${src}?t=${encodeURIComponent(token)}" target="_blank" rel="noopener"><img class="md-img" alt="${alt}" src="/api/${src}?t=${encodeURIComponent(token)}"></a>`);
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[Number(i)])}</code>`);
  }

  function md(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    const flush = () => { if (para.length) { out.push(`<p>${para.map(mdInline).join('<br>')}</p>`); para = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
      if (fence) {
        flush();
        const code = [];
        for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) code.push(lines[i]);
        const body = esc(code.join('\n'));
        out.push(fence[1] === 'suggestion'
          ? `<div class="suggestion"><div class="suggestion-head">Suggested change</div><pre><code>${body || ' '}</code></pre></div>`
          : `<pre class="md-code"><code>${body}</code></pre>`);
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flush(); out.push(`<p class="md-h md-h${h[1].length}">${mdInline(h[2])}</p>`); continue; }
      if (/^\s*>/.test(line)) {
        flush();
        const q = [];
        for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''));
        i--;
        out.push(`<blockquote>${md(q.join('\n'))}</blockquote>`);
        continue;
      }
      const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      if (li) {
        flush();
        const ordered = /\d/.test(li[1]);
        const items = [];
        for (; i < lines.length; i++) {
          const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
          if (!m || /\d/.test(m[1]) !== ordered) break;
          const task = m[2].match(/^\[([ xX])\]\s+(.*)$/);
          items.push(task ? `<li class="md-task"><input type="checkbox" disabled ${task[1] === ' ' ? '' : 'checked'}> ${mdInline(task[2])}</li>` : `<li>${mdInline(m[2])}</li>`);
        }
        i--;
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      para.push(line);
    }
    flush();
    return out.join('');
  }

  // ---------- comment editor ----------
  // 1 editor for new comments, replies and edits: Write and Preview tabs, a suggestion button, and image paste.
  // input names the state field ('draft', 'reply' or 'edit'); ref is the draft key, thread id or comment id.
  function editorHTML({ id, input, ref, value, placeholder, label, small, suggest }) {
    const preview = !!ui.preview[id];
    const refAttr = input === 'draft' ? `data-key="${esc(ref)}"` : `data-id="${esc(ref)}"`;
    return `<div class="editor ${preview ? 'previewing' : ''}" data-editor="${id}">
      <div class="editor-bar" role="tablist">
        <button type="button" role="tab" class="editor-tab ${preview ? '' : 'on'}" aria-selected="${!preview}" data-action="editor-tab" data-editor="${id}" data-tab="write">Write</button>
        <button type="button" role="tab" class="editor-tab ${preview ? 'on' : ''}" aria-selected="${preview}" data-action="editor-tab" data-editor="${id}" data-tab="preview">Preview</button>
        <span class="spacer"></span>
        ${suggest ? `<button type="button" class="editor-tool" data-action="suggest" data-editor="${id}" title="Add a suggestion: the code that should replace the selected lines" aria-label="Add a suggestion">${icon.suggest}</button>` : ''}
        ${FORMATS.map((f) => `<button type="button" class="editor-tool" data-action="format" data-format="${f.name}" data-editor="${id}" title="${f.label}" aria-label="${f.label}">${f.icon}</button>`).join('')}
      </div>
      <label class="sr" for="${id}">${esc(label)}</label>
      <textarea id="${id}" class="ta ${small ? 'small' : ''}" placeholder="${esc(placeholder)}" data-input="${input}" ${refAttr} ${preview ? 'hidden' : ''}>${esc(value)}</textarea>
      <div class="md editor-preview" ${preview ? '' : 'hidden'}>${preview ? (md(value) || '<p class="muted">Nothing to preview</p>') : ''}</div>
      <p class="editor-hint">Markdown is supported. Paste an image to attach it.</p>
    </div>`;
  }

  // Toolbar formats, as on GitHub. Each one wraps the selected text, or inserts a sample text and selects it.
  const svg = (d) => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const FORMATS = [
    { name: 'heading', label: 'Heading', icon: svg('<path d="M4 3v10M12 3v10M4 8h8"/>'), line: '### ' },
    { name: 'bold', label: 'Bold', icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2h4.5a3.501 3.501 0 0 1 2.852 5.53A3.499 3.499 0 0 1 9.5 14H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 7v3h4.5a1.5 1.5 0 0 0 0-3Zm3.5-2a1.5 1.5 0 0 0 0-3H5v3Z"/></svg>`, wrap: ['**', '**'], sample: 'bold text' },
    { name: 'italic', label: 'Italic', icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M6 2.75A.75.75 0 0 1 6.75 2h6.5a.75.75 0 0 1 0 1.5h-2.505l-3.858 9H9.25a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.505l3.858-9H6.75A.75.75 0 0 1 6 2.75Z"/></svg>`, wrap: ['_', '_'], sample: 'italic text' },
    { name: 'quote', label: 'Quote', icon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.75 2.5h10.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Zm4 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2.5 7.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 1.5 0Z"/></svg>`, line: '> ' },
    { name: 'code', label: 'Code', icon: svg('<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>'), wrap: ['`', '`'], block: true, sample: 'code' },
    { name: 'link', label: 'Link', icon: svg('<path d="M7 9a3 3 0 0 0 4.2.2l2-2a3 3 0 0 0-4.2-4.2l-1 1M9 7a3 3 0 0 0-4.2-.2l-2 2A3 3 0 0 0 7 13l1-1"/>'), link: true },
  ];

  function applyFormat(ta, f) {
    const a = ta.selectionStart ?? ta.value.length;
    const b = ta.selectionEnd ?? a;
    const sel = ta.value.slice(a, b);
    let text, selStart, selEnd;
    if (f.line) {
      // Line formats prefix each selected line, or the current line when nothing is selected.
      const ls = ta.value.lastIndexOf('\n', a - 1) + 1;
      const le = b > a && ta.value[b - 1] === '\n' ? b - 1 : (ta.value.indexOf('\n', b) === -1 ? ta.value.length : ta.value.indexOf('\n', b));
      const block = ta.value.slice(ls, le).split('\n').map((l) => f.line + l).join('\n');
      ta.value = ta.value.slice(0, ls) + block + ta.value.slice(le);
      // Without a selection, the caret goes right after the prefix; with one, to the end of the changed lines.
      ta.selectionStart = ta.selectionEnd = a === b ? a + f.line.length : ls + block.length;
    } else {
      if (f.link) { text = `[${sel || 'text'}](url)`; selStart = a + text.length - 4; selEnd = a + text.length - 1; }
      else if (f.block && sel.includes('\n')) { text = '```\n' + sel + '\n```'; selStart = a + 4; selEnd = selStart + sel.length; }
      else { const inner = sel || f.sample; text = f.wrap[0] + inner + f.wrap[1]; selStart = a + f.wrap[0].length; selEnd = selStart + inner.length; }
      ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
      ta.selectionStart = selStart; ta.selectionEnd = selEnd;
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }

  // The selected code of a draft, reply or edit, for a suggestion block. A file comment has no selected code.
  function selectedCodeFor(ta) {
    if (ta.dataset.input === 'draft') {
      const d = ui.drafts[ta.dataset.key];
      return d && d.side !== 'file' ? d.sel.join('\n') : null;
    }
    const tid = ta.dataset.input === 'reply' ? ta.dataset.id : (data.threads.find((t) => t.comments.some((c) => c.id === ta.dataset.id)) || {}).id;
    const t = data.threads.find((x) => x.id === tid);
    return t && t.side !== 'file' ? (t.selected_text || '') : null;
  }

  // insertText puts text at the caret and updates the state through the normal input event.
  function insertText(ta, text) {
    const a = ta.selectionStart ?? ta.value.length;
    const b = ta.selectionEnd ?? a;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }

  function setEditorTab(id, tab) {
    const box = document.querySelector(`.editor[data-editor="${id}"]`);
    if (!box) return;
    const ta = box.querySelector('textarea');
    const pv = box.querySelector('.editor-preview');
    const preview = tab === 'preview';
    if (preview) ui.preview[id] = true; else delete ui.preview[id];
    box.classList.toggle('previewing', preview);
    box.querySelectorAll('.editor-tab').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    ta.hidden = preview;
    pv.hidden = !preview;
    if (preview) pv.innerHTML = md(ta.value) || '<p class="muted">Nothing to preview</p>';
    else ta.focus();
  }

  // A pasted image is stored by the server; the comment gets a Markdown image link to it.
  document.addEventListener('paste', async (e) => {
    const ta = e.target;
    if (!ta.matches || !ta.matches('.editor textarea')) return;
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((x) => x.kind === 'file' && /^image\/(png|jpeg|gif|webp)$/.test(x.type));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    const mark = '![Uploading image…]()';
    insertText(ta, mark);
    try {
      const r = await fetch('/api/attachments', { method: 'POST', headers: { 'X-Reviewit-Token': token, 'Content-Type': file.type }, body: file });
      if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
      const res = await r.json();
      ta.value = ta.value.replace(mark, res.markdown);
    } catch (err) {
      ta.value = ta.value.replace(mark, '');
      showError(`Could not attach the image: ${err.message}`);
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // ---------- diff ----------

  function diffHTML() {
    const body = data.files.length ? data.files.map(fileHTML).join('') : '<div class="card empty-diff">No changes</div>';
    return `<main class="diffpane" aria-label="Diff">${body}</main>`;
  }

  function fileHTML(f) {
    const open = !ui.collapsed[f.path];
    const threads = data.threads.filter((t) => t.file === f.path);
    const newNums = new Set(sideLines(f, 'new').map((l) => l.num));
    const oldNums = new Set(sideLines(f, 'old').map((l) => l.num));
    const inline = (t) => !t.outdated && t.side !== 'file' && (t.side === 'new' ? newNums : oldNums).has(t.end_line);
    const top = threads.filter((t) => !inline(t));
    const drafts = Object.entries(ui.drafts).filter(([, d]) => d.file === f.path);
    const fileDraft = drafts.find(([, d]) => d.side === 'file');
    const note = f.binary ? 'binary' : { added: 'new file', deleted: 'deleted', renamed: 'renamed' }[f.status] || '';
    const title = f.status === 'renamed' && f.old_path !== f.path ? `${f.old_path} → ${f.path}` : f.path;

    let inner = '';
    if (open) {
      const topParts = top.map(threadHTML);
      if (fileDraft) topParts.push(draftHTML(fileDraft[0], fileDraft[1]));
      if (topParts.length) inner += `<div class="tslot file">${topParts.join('')}</div>`;
      if (f.binary) inner += '<div class="note-row">Binary file changed</div>';
      else if (!f.hunks.length) inner += '<div class="note-row">No line changes</div>';
      else inner += ui.view === 'split' ? splitRows(f, threads.filter(inline), drafts) : unifiedRows(f, threads.filter(inline), drafts);
    }

    return `<section class="card ${open ? 'open' : ''}" id="${fileId(f.path)}">
      <div class="filehead">
        <h3 class="filename"><button class="filetoggle" type="button" data-action="toggle-file" data-path="${esc(f.path)}" aria-expanded="${open}"><span class="chev ${open ? '' : 'closed'}">${icon.chev}</span><span class="mono">${esc(title)}</span></button></h3><button class="copybtn" type="button" data-action="copy-path" data-path="${esc(f.path)}" aria-label="Copy the file name" title="Copy the file name">${icon.copy}</button>
        <div class="filetools">
          ${note ? `<span class="note">${note}</span>` : ''}
          <span class="counter"><span class="plus">+${f.adds}</span> <span class="minus">−${f.dels}</span></span>
          <button class="iconbtn" type="button" data-action="file-comment" data-path="${esc(f.path)}" aria-label="Comment on this file" title="Comment on this file">${icon.comment}</button>
        </div>
      </div>
      ${open ? `<div class="filebody">${inner}</div>` : ''}
    </section>`;
  }

  function isSelected(file, side, num) {
    if (!num) return false;
    const d = ui.drag;
    if (d && d.file === file && d.side === side && num >= Math.min(d.a, d.b) && num <= Math.max(d.a, d.b)) return true;
    return Object.values(ui.drafts).some((x) => x.file === file && x.side === side && num >= x.start && num <= x.end);
  }

  function numCell(f, side, num) {
    if (!num) return '<span class="num"></span>';
    return `<span class="num" data-file="${esc(f.path)}" data-side="${side}" data-line="${num}">${num}</span>`;
  }

  function slotsAfter(side, num, threads, drafts, cls) {
    if (!num) return '';
    const parts = threads.filter((t) => t.side === side && t.end_line === num).map(threadHTML);
    for (const [key, d] of drafts) {
      if (d.side === side && d.end === num) parts.push(draftHTML(key, d));
    }
    return parts.length ? `<div class="tslot ${cls || ''}">${parts.join('')}</div>` : '';
  }

  // The server sends html with syntax color spans for known languages; other lines are plain text.
  const codeHTML = (l) => l.html || esc(l.text);
  const sign = (k) => (k === 'add' ? '+' : k === 'del' ? '−' : '');

  function unifiedRows(f, threads, drafts) {
    let out = '';
    for (const h of f.hunks) {
      out += `<div class="row hunk"><span class="num"></span><span class="num"></span><span class="sign"></span><span class="code">${esc(h.header)}</span></div>`;
      for (const l of h.lines) {
        const sel = isSelected(f.path, 'old', l.old) || isSelected(f.path, 'new', l.new);
        out += `<div class="row ${l.kind} ${sel ? 'sel' : ''}">${numCell(f, 'old', l.old)}${numCell(f, 'new', l.new)}<span class="sign">${sign(l.kind)}</span><span class="code">${codeHTML(l)}</span></div>`;
        out += slotsAfter('old', l.kind === 'del' ? l.old : 0, threads, drafts);
        out += slotsAfter('new', l.new, threads, drafts);
        if (l.kind === 'ctx') out += slotsAfter('old', l.old, threads, drafts);
      }
    }
    return `<div class="rows">${out}</div>`;
  }

  function pairs(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      if (lines[i].kind === 'ctx') { out.push([lines[i], lines[i]]); i++; continue; }
      const dels = [];
      const adds = [];
      while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
      while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
      for (let j = 0; j < Math.max(dels.length, adds.length); j++) out.push([dels[j] || null, adds[j] || null]);
    }
    return out;
  }

  function sideCell(f, side, l) {
    if (!l) return '<div class="side empty"><span class="num"></span><span class="sign"></span><span class="code"></span></div>';
    const num = side === 'old' ? l.old : l.new;
    const kind = l.kind === 'ctx' ? 'ctx' : l.kind;
    return `<div class="side ${kind} ${isSelected(f.path, side, num) ? 'sel' : ''}">${numCell(f, side, num)}<span class="sign">${sign(l.kind)}</span><span class="code">${codeHTML(l)}</span></div>`;
  }

  function splitRows(f, threads, drafts) {
    let out = '';
    for (const h of f.hunks) {
      out += `<div class="srow hunk"><div class="side"><span class="num"></span><span class="sign"></span><span class="code">${esc(h.header)}</span></div><div class="side"></div></div>`;
      for (const [l, r] of pairs(h.lines)) {
        out += `<div class="srow">${sideCell(f, 'old', l)}${sideCell(f, 'new', r)}</div>`;
        out += slotsAfter('old', l ? l.old : 0, threads, drafts, 'split-old');
        out += slotsAfter('new', r ? r.new : 0, threads, drafts, 'split-new');
      }
    }
    return `<div class="rows split">${out}</div>`;
  }

  // ---------- threads ----------

  function badgeFor(c) {
    if (c.author !== 'user') return '';
    if (c.state === 'pending') return '<span class="badge b-pending">Pending</span>';
    if (c.state === 'sent') return '<span class="badge b-sent">Sent</span>';
    return '';
  }

  // A thread with a sent comment waits for the agent. When wait has delivered the comment, the agent is working on it.
  function agentWork(t) {
    const sent = t.comments.filter((c) => c.author === 'user' && c.state === 'sent');
    if (!sent.length) return '';
    return sent.some((c) => c.printed) ? 'working' : 'waiting';
  }

  function workHTML(t) {
    const w = agentWork(t);
    if (w === 'working') return '<div class="work" role="status"><span class="pulse"></span>The agent is working on this…</div>';
    if (w === 'waiting') return '<div class="work" role="status">Waiting for the agent to pick this up</div>';
    return '';
  }

  function threadHTML(t) {
    const root = t.comments[0];
    const n = t.comments.length;
    const work = agentWork(t) === 'working' ? '<span class="badge b-sent"><span class="pulse"></span>Agent working</span>' : '';
    const label = (t.resolved ? '<span class="badge b-resolved">Resolved</span>' : t.outdated ? '<span class="badge b-outdated">Outdated</span>' : '') + work;
    if (!isExpanded(t)) {
      return `<div class="thread"><button class="collapsed" type="button" data-action="toggle-thread" data-id="${t.id}" aria-expanded="false">${label}<span class="sum">${esc(where(t))} · “${esc(firstLine(root.body))}” · ${n} message${n === 1 ? '' : 's'}</span><span class="spacer"></span><span>Show</span></button></div>`;
    }
    let out = '<div class="thread">';
    if (t.resolved || t.outdated) {
      out += `<button class="collapsed" type="button" data-action="toggle-thread" data-id="${t.id}" aria-expanded="true">${label}<span class="sum">${esc(where(t))}</span><span class="spacer"></span><span>Hide</span></button>`;
    }
    if (t.outdated && t.original && t.original.length) {
      out += '<p class="snippet-label">Original code when you wrote the comment</p><div class="snippet">';
      for (const l of t.original) {
        out += `<div class="row ${l.kind}"><span class="num">${l.num}</span><span class="sign">${sign(l.kind)}</span><span class="code">${codeHTML(l)}</span></div>`;
      }
      out += '</div>';
    }
    t.comments.forEach((c, i) => { out += messageHTML(t, c, i === 0); });
    out += workHTML(t);
    if (t.resolved) {
      out += `<div class="composer"><div class="actions"><span class="meta">You resolved this conversation.</span><span class="spacer"></span><button class="btn btn-ghost" type="button" data-action="resolve" data-id="${t.id}" data-value="false">Unresolve</button></div></div>`;
    } else {
      const rid = 'reply-' + idFor(t.id);
      if (ui.replyOpen[t.id] || ui.replies[t.id]) {
        out += `<div class="composer">
          ${editorHTML({ id: rid, input: 'reply', ref: t.id, value: ui.replies[t.id] || '', placeholder: 'Reply…', label: 'Reply to this thread', small: true, suggest: t.side !== 'file' })}
          <div class="actions">
            <span class="spacer"></span>
            <button class="btn" type="button" data-action="reply-cancel" data-id="${t.id}">Cancel</button>
            <button class="btn" type="button" data-action="reply" data-mode="save" data-id="${t.id}">${icon.saveComment}Comment</button>
            <button class="btn btn-primary" type="button" data-action="reply" data-mode="ask" data-id="${t.id}">${icon.askNow}Ask now</button>
          </div>
        </div>`;
      } else {
        // A closed reply box: 1 field that opens the editor, as on GitHub.
        out += `<div class="composer composer-closed">
          <button class="reply-open" type="button" data-action="reply-open" data-id="${t.id}">Reply…</button>
          <button class="btn btn-ghost" type="button" data-action="resolve" data-id="${t.id}" data-value="true">Resolve</button>
        </div>`;
      }
    }
    return out + '</div>';
  }

  function messageHTML(t, c, isRoot) {
    const user = c.author === 'user';
    let body;
    if (c.id in ui.editing) {
      const eid = 'edit-' + idFor(c.id);
      body = editorHTML({ id: eid, input: 'edit', ref: c.id, value: ui.editing[c.id], placeholder: '', label: 'Edit comment', small: true, suggest: t.side !== 'file' }) + `
        <div class="msg-actions"><button class="btn btn-primary btn-small" type="button" data-action="edit-save" data-id="${c.id}">Save</button><button class="btn btn-ghost btn-small" type="button" data-action="edit-cancel" data-id="${c.id}">Cancel</button></div>`;
    } else {
      body = `<div class="body md">${md(c.body)}</div>`;
      if (user && c.state === 'pending') {
        body += `<div class="msg-actions"><button class="btn btn-ghost btn-small" type="button" data-action="edit" data-id="${c.id}">Edit</button><button class="btn btn-ghost btn-small" type="button" data-action="delete" data-id="${c.id}">Delete</button></div>`;
      }
    }
    return `<div class="msg">
      <div class="av ${user ? 'av-user' : 'av-agent'}" aria-hidden="true">${user ? 'YOU' : 'AI'}</div>
      <div class="msg-main">
        <div class="meta"><span class="who">${user ? 'You' : 'Agent'}</span>${isRoot ? `<span>${esc(where(t))}</span>` : ''}${badgeFor(c)}</div>
        ${body}
      </div>
    </div>`;
  }

  function draftHTML(key, d) {
    const did = 'draft-' + idFor(key);
    const w = d.side === 'file' ? 'File comment' : where({ side: d.side, start_line: d.start, end_line: d.end });
    return `<div class="thread draft"><div class="composer">
      <div class="meta"><span class="who">New comment</span><span>${esc(w)}</span></div>
      ${editorHTML({ id: did, input: 'draft', ref: key, value: d.text, placeholder: 'Ask a question or describe a change', label: 'New comment', suggest: d.side !== 'file' })}
      <div class="actions">
        <span class="spacer"></span>
        <button class="btn" type="button" data-action="draft-cancel" data-key="${esc(key)}">Cancel</button>
        <button class="btn" type="button" data-action="draft" data-mode="save" data-key="${esc(key)}">${icon.saveComment}Comment</button>
        <button class="btn btn-primary" type="button" data-action="draft" data-mode="ask" data-key="${esc(key)}">${icon.askNow}Ask now</button>
      </div>
    </div></div>`;
  }

  function focusLater(id) {
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.focus();
    });
  }

  // ---------- actions ----------

  const actions = {
    async send() { await api('/api/send', {}); },
    view(el) { ui.view = el.dataset.view; render(); },
    'reply-open'(el) { ui.replyOpen[el.dataset.id] = true; render(); focusLater('reply-' + idFor(el.dataset.id)); },
    'reply-cancel'(el) {
      const id = el.dataset.id;
      delete ui.replyOpen[id];
      delete ui.replies[id];
      delete ui.preview['reply-' + idFor(id)];
      render();
    },
    'editor-tab'(el) { setEditorTab(el.dataset.editor, el.dataset.tab); },
    suggest(el) {
      const ta = document.getElementById(el.dataset.editor);
      if (!ta) return;
      if (ui.preview[ta.id]) setEditorTab(ta.id, 'write');
      const code = selectedCodeFor(ta);
      if (code === null) return;
      const before = ta.value && !ta.value.endsWith('\n') && ta.selectionStart === ta.value.length ? '\n' : '';
      insertText(ta, `${before}\`\`\`suggestion\n${code}\n\`\`\`\n`);
    },
    format(el) {
      const ta = document.getElementById(el.dataset.editor);
      const f = FORMATS.find((x) => x.name === el.dataset.format);
      if (!ta || !f) return;
      if (ui.preview[ta.id]) setEditorTab(ta.id, 'write');
      applyFormat(ta, f);
    },
    // Copy the file path; the icon shows a check mark for a moment.
    async 'copy-path'(el) {
      try { await navigator.clipboard.writeText(el.dataset.path); } catch (e) { showError('Could not copy the file name.'); return; }
      el.innerHTML = icon.check;
      el.classList.add('done');
      setTimeout(() => { el.innerHTML = icon.copy; el.classList.remove('done'); }, 1500);
    },
    'toggle-menu'(el) { setMenu(el.getAttribute('aria-expanded') !== 'true'); },
    'toggle-file'(el) { const p = el.dataset.path; ui.collapsed[p] = !ui.collapsed[p]; render(); },
    'toggle-folder'(el) { const p = el.dataset.path; ui.folders[p] = ui.folders[p] === false; renderTree(); },
    'toggle-tree'() { ui.treeOpen = !ui.treeOpen; saveTreeOpen(ui.treeOpen); render(); },
    'toggle-only-threads'() { ui.onlyThreads = !ui.onlyThreads; renderTree(); },
    'goto-file'(el) {
      const p = el.dataset.path;
      ui.current = p;
      ui.collapsed[p] = false;
      render();
      const target = document.getElementById(fileId(p));
      if (target) target.scrollIntoView({ block: 'start' });
    },
    'file-comment'(el) {
      const p = el.dataset.path;
      const key = `${p}|file`;
      if (!ui.drafts[key]) ui.drafts[key] = { file: p, side: 'file', text: '', sel: [] };
      ui.collapsed[p] = false;
      render();
      focusLater('draft-' + idFor(key));
    },
    async draft(el) {
      const key = el.dataset.key;
      const d = ui.drafts[key];
      if (!d || !d.text.trim()) { showError('The comment is empty.'); return; }
      const body = { file: d.file, side: d.side, start_line: d.start || 0, end_line: d.end || 0, body: d.text, action: el.dataset.mode };
      await api('/api/comments', body);
      delete ui.drafts[key];
      await load();
    },
    'draft-cancel'(el) { delete ui.drafts[el.dataset.key]; render(); },
    async reply(el) {
      const id = el.dataset.id;
      const text = ui.replies[id] || '';
      if (!text.trim()) { showError('The reply is empty.'); return; }
      await api('/api/comments', { thread_id: id, body: text, action: el.dataset.mode });
      delete ui.replies[id];
      delete ui.replyOpen[id];
      delete ui.preview['reply-' + idFor(id)];
      await load();
    },
    async resolve(el) {
      const id = el.dataset.id;
      const value = el.dataset.value === 'true';
      await api(`/api/threads/${encodeURIComponent(id)}/resolve`, { resolved: value });
      delete ui.expanded[id];
      await load();
    },
    'toggle-thread'(el) {
      const t = data.threads.find((x) => x.id === el.dataset.id);
      if (t) ui.expanded[t.id] = !isExpanded(t);
      render();
    },
    edit(el) {
      const id = el.dataset.id;
      for (const t of data.threads) for (const c of t.comments) if (c.id === id) ui.editing[id] = c.body;
      render();
      focusLater('edit-' + idFor(id));
    },
    'edit-cancel'(el) { delete ui.editing[el.dataset.id]; render(); },
    async 'edit-save'(el) {
      const id = el.dataset.id;
      await api(`/api/comments/${encodeURIComponent(id)}/edit`, { body: ui.editing[id] || '' });
      delete ui.editing[id];
      await load();
    },
    async delete(el) {
      await api(`/api/comments/${encodeURIComponent(el.dataset.id)}/delete`, {});
      await load();
    },
  };

  // The settings menu opens and closes without a full render, so it stays fast on a large diff.
  function setMenu(open) {
    const btn = document.querySelector('[data-action="toggle-menu"]');
    const menu = document.querySelector('.menu');
    if (!btn || !menu) return;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('on', open);
    menu.hidden = !open;
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('.menu-wrap')) setMenu(false);
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    try {
      await fn(el);
    } catch (err) {
      showError(`Could not save: ${err.message}`);
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    switch (el.dataset.input) {
      case 'draft': if (ui.drafts[el.dataset.key]) ui.drafts[el.dataset.key].text = el.value; break;
      case 'reply': ui.replies[el.dataset.id] = el.value; break;
      case 'edit': ui.editing[el.dataset.id] = el.value; break;
      case 'filter': ui.filter = el.value; renderTree(); break;
    }
  });

  // ---------- line selection ----------
  // A drag on the line numbers, or from the blue + button, selects lines. During the drag only the row classes
  // change, so a large diff stays fast. The comment panel opens on mouseup.

  // lineAt returns the line number cell under the pointer: on the given side, or on the new side first.
  function lineAt(target, side) {
    if (!target.closest) return null;
    const direct = target.closest('.num[data-line]');
    if (direct && (!side || direct.dataset.side === side)) return direct;
    const box = target.closest('.side') || target.closest('.row');
    if (!box || !box.closest('.diffpane')) return null;
    if (side) return box.querySelector(`.num[data-line][data-side="${side}"]`);
    return box.querySelector('.num[data-line][data-side="new"]') || box.querySelector('.num[data-line][data-side="old"]');
  }

  function startDrag(file, side, line) {
    ui.drag = { file, side, a: line, b: line };
    const num = document.querySelector(`.num[data-line="${line}"][data-side="${side}"][data-file="${CSS.escape(file)}"]`);
    moveButton(anchorBtn, num);
    paintDrag();
  }

  function paintDrag() {
    document.querySelectorAll('.drag-sel').forEach((el) => el.classList.remove('drag-sel', 'sel'));
    const d = ui.drag;
    if (!d) return;
    const lo = Math.min(d.a, d.b);
    const hi = Math.max(d.a, d.b);
    document.querySelectorAll(`.num[data-line][data-side="${d.side}"]`).forEach((n) => {
      const line = Number(n.dataset.line);
      if (n.dataset.file !== d.file || line < lo || line > hi) return;
      const box = n.closest('.side') || n.closest('.row');
      if (box && !box.classList.contains('sel')) box.classList.add('sel', 'drag-sel');
    });
  }

  // The blue + button: 1 element outside the app, placed on the row under the pointer.
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'add-comment';
  addBtn.setAttribute('aria-label', 'Comment on this line; drag to select more lines');
  addBtn.title = 'Comment on this line. Drag to select more lines.';
  addBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="pointer-events:none"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  addBtn.hidden = true;
  document.body.appendChild(addBtn);

  // The button sits on the edge between the line number and the +/− sign, as on GitHub. During a drag, a second
  // button stays on the first line of the range.
  const anchorBtn = addBtn.cloneNode(true);
  anchorBtn.classList.add('anchor');
  anchorBtn.setAttribute('aria-hidden', 'true');
  anchorBtn.removeAttribute('title');
  document.body.appendChild(anchorBtn);
  // A vertical line in the button color joins the 2 buttons during a drag.
  const dragLine = document.createElement('div');
  dragLine.className = 'drag-line';
  dragLine.hidden = true;
  document.body.appendChild(dragLine);

  function placeDragLine() {
    if (anchorBtn.hidden || addBtn.hidden) { dragLine.hidden = true; return; }
    const a = parseFloat(anchorBtn.style.top);
    const b = parseFloat(addBtn.style.top);
    dragLine.style.left = (parseFloat(anchorBtn.style.left) + 10) + 'px';
    dragLine.style.top = (Math.min(a, b) + 11) + 'px';
    dragLine.style.height = Math.abs(a - b) + 'px';
    dragLine.hidden = a === b;
  }

  function moveButton(btn, num) {
    const box = num && (num.closest('.side') || num.closest('.row'));
    const sign = box && box.querySelector(':scope > .sign');
    if (!sign) { btn.hidden = true; return false; }
    const r = sign.getBoundingClientRect();
    // Centered on the edge between the line number and the sign, as on GitHub; it covers part of the sign.
    btn.style.top = (r.top + window.scrollY + (r.height - 22) / 2) + 'px';
    btn.style.left = (r.left + window.scrollX - 11) + 'px';
    btn.hidden = false;
    return true;
  }

  function placeAddButton(num) {
    if (!moveButton(addBtn, num)) return;
    addBtn.dataset.file = num.dataset.file;
    addBtn.dataset.side = num.dataset.side;
    addBtn.dataset.line = num.dataset.line;
  }

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (addBtn.contains(e.target)) {
      e.preventDefault();
      startDrag(addBtn.dataset.file, addBtn.dataset.side, Number(addBtn.dataset.line));
      return;
    }
    const el = e.target.closest && e.target.closest('.num[data-line]');
    if (!el) return;
    e.preventDefault();
    startDrag(el.dataset.file, el.dataset.side, Number(el.dataset.line));
  });

  document.addEventListener('mouseover', (e) => {
    if (addBtn.contains(e.target)) return;
    if (!ui.drag) { placeAddButton(lineAt(e.target)); return; }
    const el = lineAt(e.target, ui.drag.side);
    if (!el || el.dataset.file !== ui.drag.file) return;
    moveButton(addBtn, el);
    placeDragLine();
    const line = Number(el.dataset.line);
    if (line !== ui.drag.b) { ui.drag.b = line; paintDrag(); }
  });

  // Resize the file list by dragging the handle, or with the arrow keys when the handle has focus.
  function setTreeWidth(w, save) {
    ui.treeW = clampTreeWidth(w);
    const layout = document.querySelector('.layout');
    if (layout) layout.style.setProperty('--tree-w', ui.treeW + 'px');
    if (save) saveTreeWidth(ui.treeW);
  }
  document.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-resize]');
    if (!h) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    h.classList.add('active');
    const left = document.querySelector('.layout').getBoundingClientRect().left;
    const move = (ev) => setTreeWidth(ev.clientX - left, false);
    const up = () => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.classList.remove('active');
      saveTreeWidth(ui.treeW);
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenu(false);
    if (!e.target.closest || !e.target.closest('[data-resize]')) return;
    if (e.key === 'ArrowLeft') { setTreeWidth(ui.treeW - 16, true); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setTreeWidth(ui.treeW + 16, true); e.preventDefault(); }
  });

  // The page has 1 scroll. The top bar (header and status) sticks to the top. The file tree and the file
  // headers stick below it, so the CSS needs the current height of the top bar in --top-h.
  const topbarObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      for (const en of entries) document.documentElement.style.setProperty('--top-h', en.target.offsetHeight + 'px');
    })
    : null;
  function watchTopbar() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    document.documentElement.style.setProperty('--top-h', bar.offsetHeight + 'px');
    if (topbarObserver) { topbarObserver.disconnect(); topbarObserver.observe(bar); }
  }

  // Compact header: after 24px of page scroll the header shows only the title and the send controls.
  // It becomes full size again at the top.
  window.addEventListener('scroll', () => {
    const top = window.scrollY;
    const compact = ui.compact ? top > 0 : top > 24;
    if (compact === ui.compact) return;
    ui.compact = compact;
    const header = document.querySelector('.header');
    if (header) header.classList.toggle('compact', compact);
  });

  document.addEventListener('mouseup', () => {
    const d = ui.drag;
    if (!d) return;
    ui.drag = null;
    addBtn.hidden = true;
    anchorBtn.hidden = true;
    dragLine.hidden = true;
    const f = findFile(d.file);
    if (!f) { render(); return; }
    const lines = selectionLines(f, d.side, Math.min(d.a, d.b), Math.max(d.a, d.b));
    if (!lines.length) { render(); return; }
    const start = lines[0].num;
    const end = lines[lines.length - 1].num;
    const key = `${f.path}|${d.side}|${start}|${end}`;
    if (!ui.drafts[key]) ui.drafts[key] = { file: f.path, side: d.side, start, end, text: '', sel: lines.map((l) => l.text) };
    render();
    focusLater('draft-' + idFor(key));
  });

  // ---------- live connection ----------

  function connect() {
    const es = new EventSource('/api/events?t=' + encodeURIComponent(token));
    es.addEventListener('update', () => {
      ui.connected = true;
      load().catch(() => { ui.connected = false; render(); });
    });
    // The session was replaced by a new one: load the new session in this tab. Only a local address is accepted.
    es.addEventListener('replaced', (e) => {
      es.close();
      if (/^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+$/.test(e.data)) location.replace(e.data);
    });
    es.onerror = () => {
      ui.connected = false;
      render();
    };
  }

  load().catch((err) => {
    document.getElementById('app').innerHTML = `<p class="loading">Could not load the review session: ${esc(err.message)}</p>`;
  });
  connect();
})();
