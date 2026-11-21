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
  };
  let data = null;
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
    chev: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3.5 3.5"/></svg>',
    filter: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 4h12M4.5 8h7M7 12h2"/></svg>',
    comment: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5h-.5a1 1 0 0 1-1-1z"/></svg>',
    folderOpen: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" style="color:var(--muted);flex:0 0 18px"><path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5a1 1 0 0 1 1 1v1.5h-8.2a1 1 0 0 0-.95.68L1.5 12.5z" fill="currentColor"/><path d="M4.3 7.2a1 1 0 0 1 .95-.7h9.4a.6.6 0 0 1 .57.8l-1.8 5.5a1 1 0 0 1-.95.7H1.9z" fill="currentColor" opacity=".75"/></svg>',
    folderClosed: '<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" style="color:var(--muted);flex:0 0 18px"><path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
    file(status) {
      const doc = '<path d="M3.5 1.5h6l3 3v10h-9z"/>';
      const map = {
        added: ['var(--plus)', 'Added file', '<path d="M8 7v5M5.5 9.5h5"/>'],
        deleted: ['var(--minus)', 'Deleted file', '<path d="M5.5 9.5h5"/>'],
        renamed: ['var(--muted)', 'Renamed file', '<path d="M5.5 9.5h5M8.5 7.5l2 2-2 2"/>'],
        modified: ['var(--muted)', 'Modified file', '<circle cx="8" cy="9.5" r="1.6" fill="currentColor"/>'],
      };
      const [color, label, mark] = map[status] || map.modified;
      return `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" role="img" aria-label="${label}" style="color:${color};flex:0 0 18px">${doc}${mark}</svg>`;
    },
  };

  // ---------- render ----------

  function render() {
    const app = document.getElementById('app');
    if (!data) return;
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    const pane = document.querySelector('.diffpane');
    const treeList = document.querySelector('.tree-list');
    const scroll = [pane ? pane.scrollTop : 0, treeList ? treeList.scrollTop : 0];

    app.innerHTML = headerHTML() + statusHTML() + `<div class="layout">${treeHTML()}${diffHTML()}</div>`;

    const pane2 = document.querySelector('.diffpane');
    const tree2 = document.querySelector('.tree-list');
    if (pane2) pane2.scrollTop = scroll[0];
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

  function headerHTML() {
    const n = data.pending;
    return `<header class="header">
      <div class="header-main">
        <h1>${esc(data.title || 'Review session')}</h1>
        ${data.description ? `<p class="desc">${esc(data.description)}</p>` : ''}
        ${data.source ? `<p class="source">Diff: <span class="mono">${esc(data.source)}</span></p>` : ''}
      </div>
      <div class="header-actions">
        <span class="pending-count"><strong>${n}</strong> pending comment${n === 1 ? '' : 's'}</span>
        <button class="btn btn-primary" type="button" data-action="send" ${n === 0 ? 'disabled' : ''}>Send pending comments</button>
      </div>
    </header>`;
  }

  function statusHTML() {
    if (!ui.connected) return '<div class="status status-disconnected" role="status">Disconnected from reviewit. New comments cannot be saved.</div>';
    if (ui.error) return `<div class="status status-error" role="alert">${esc(ui.error)}</div>`;
    if (data.agent === 'working') return '<div class="status status-working" role="status">The agent is working on your comments</div>';
    if (data.agent === 'idle') return '<div class="status status-idle" role="status">The agent is not listening. Your comments are saved, but the agent will not get them until it listens again.</div>';
    return '';
  }

  // ---------- tree ----------

  function threadCount(path) {
    return data.threads.filter((t) => t.file === path).length;
  }

  function treeHTML() {
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
        rows.push(`<button class="node ${ui.current === f.path ? 'on' : ''}" type="button" data-action="goto-file" data-path="${esc(f.path)}" style="padding-left:${8 + depth * 20}px">
          <span class="chev"></span>${icon.file(f.status)}<span class="name">${esc(name)}</span></button>`);
      }
    };
    walk(root, 0);
    return `<nav class="tree" aria-label="Changed files">
      <div class="tree-top">
        <label class="filter">${icon.search}<span class="sr">Filter files</span><input id="tree-filter" type="text" placeholder="Filter files…" value="${esc(ui.filter)}" data-input="filter"></label>
        <button class="iconbtn ${ui.onlyThreads ? 'on' : ''}" type="button" data-action="toggle-only-threads" aria-pressed="${ui.onlyThreads}" aria-label="Show only files with comments" title="Show only files with comments">${icon.filter}</button>
      </div>
      <div class="tree-list">${rows.join('') || '<p class="tree-empty">No files match.</p>'}</div>
    </nav>`;
  }

  // ---------- diff ----------

  function diffHTML() {
    const toolbar = `<div class="toolbar"><span class="label">View</span><div class="seg" role="group" aria-label="Diff view">
      <button type="button" class="${ui.view === 'unified' ? 'on' : ''}" aria-pressed="${ui.view === 'unified'}" data-action="view" data-view="unified">Unified</button>
      <button type="button" class="${ui.view === 'split' ? 'on' : ''}" aria-pressed="${ui.view === 'split'}" data-action="view" data-view="split">Split</button>
    </div></div>`;
    const body = data.files.length ? data.files.map(fileHTML).join('') : '<div class="card empty-diff">No changes</div>';
    return `<main class="diffpane" aria-label="Diff">${toolbar}${body}</main>`;
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
        <h3 style="margin:0;min-width:0"><button class="filetoggle" type="button" data-action="toggle-file" data-path="${esc(f.path)}" aria-expanded="${open}"><span class="chev ${open ? '' : 'closed'}">${icon.chev}</span><span class="mono">${esc(title)}</span></button></h3>
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

  function threadHTML(t) {
    const root = t.comments[0];
    const n = t.comments.length;
    const label = t.resolved ? '<span class="badge b-resolved">Resolved</span>' : t.outdated ? '<span class="badge b-outdated">Outdated</span>' : '';
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
    if (t.resolved) {
      out += `<div class="composer"><div class="actions"><span class="meta">You resolved this conversation.</span><span class="spacer"></span><button class="btn btn-ghost" type="button" data-action="resolve" data-id="${t.id}" data-value="false">Unresolve</button></div></div>`;
    } else {
      const rid = 'reply-' + idFor(t.id);
      out += `<div class="composer">
        <label class="sr" for="${rid}">Reply to this thread</label>
        <textarea id="${rid}" class="ta small" placeholder="Reply…" data-input="reply" data-id="${t.id}">${esc(ui.replies[t.id] || '')}</textarea>
        <div class="actions">
          <button class="btn btn-primary" type="button" data-action="reply" data-mode="ask" data-id="${t.id}">Ask now</button>
          <button class="btn" type="button" data-action="reply" data-mode="save" data-id="${t.id}">Save comment</button>
          <span class="spacer"></span>
          <button class="btn btn-ghost" type="button" data-action="resolve" data-id="${t.id}" data-value="true">Resolve</button>
        </div>
      </div>`;
    }
    return out + '</div>';
  }

  function messageHTML(t, c, isRoot) {
    const user = c.author === 'user';
    let body;
    if (c.id in ui.editing) {
      const eid = 'edit-' + idFor(c.id);
      body = `<label class="sr" for="${eid}">Edit comment</label><textarea id="${eid}" class="ta small" data-input="edit" data-id="${c.id}">${esc(ui.editing[c.id])}</textarea>
        <div class="msg-actions"><button class="btn btn-primary btn-small" type="button" data-action="edit-save" data-id="${c.id}">Save</button><button class="btn btn-ghost btn-small" type="button" data-action="edit-cancel" data-id="${c.id}">Cancel</button></div>`;
    } else {
      body = `<p class="body">${esc(c.body)}</p>`;
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
      <label class="sr" for="${did}">New comment</label>
      <textarea id="${did}" class="ta" placeholder="Ask a question or describe a change" data-input="draft" data-key="${esc(key)}">${esc(d.text)}</textarea>
      <div class="actions">
        <button class="btn btn-primary" type="button" data-action="draft" data-mode="ask" data-key="${esc(key)}">Ask now</button>
        <button class="btn" type="button" data-action="draft" data-mode="save" data-key="${esc(key)}">Save comment</button>
        <span class="spacer"></span>
        <button class="btn btn-ghost" type="button" data-action="draft-cancel" data-key="${esc(key)}">Cancel</button>
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
    'toggle-file'(el) { const p = el.dataset.path; ui.collapsed[p] = !ui.collapsed[p]; render(); },
    'toggle-folder'(el) { const p = el.dataset.path; ui.folders[p] = ui.folders[p] === false; render(); },
    'toggle-only-threads'() { ui.onlyThreads = !ui.onlyThreads; render(); },
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

  document.addEventListener('click', async (e) => {
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
      case 'filter': ui.filter = el.value; render(); break;
    }
  });

  // ---------- line selection ----------

  document.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.num[data-line]');
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const line = Number(el.dataset.line);
    ui.drag = { file: el.dataset.file, side: el.dataset.side, a: line, b: line };
    render();
  });

  document.addEventListener('mouseover', (e) => {
    if (!ui.drag) return;
    const el = e.target.closest('.num[data-line]');
    if (!el || el.dataset.file !== ui.drag.file || el.dataset.side !== ui.drag.side) return;
    const line = Number(el.dataset.line);
    if (line !== ui.drag.b) { ui.drag.b = line; render(); }
  });

  document.addEventListener('mouseup', () => {
    const d = ui.drag;
    if (!d) return;
    ui.drag = null;
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
