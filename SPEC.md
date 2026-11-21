# reviewit — specification

Status: revision 3. No code exists yet.

## 1. Purpose

reviewit is a local tool to review code changes together with Claude Code, in the same way as a pull request review on GitHub, but without a push.

The user works in a Claude Code session. The agent makes changes, with or without a commit. The user asks the agent to open a review. A viewer opens in the browser and shows the diff. The user writes comments on the diff. The agent answers the comments and changes the code. The user can repeat this cycle many times before the first push.

Design rule: keep every mechanism simple and intuitive. Prefer 1 clear rule over a complete mechanism.

## 2. Terms

| Term | Meaning |
|---|---|
| Agent | The Claude Code session that uses reviewit. |
| Viewer | The web page in the browser that shows 1 review session. More than 1 tab can show the same review session. |
| Review session | The state of 1 review: the diff, the threads and the event queue. A review session has an id. |
| Thread | A root comment and all replies to it, from the user and from the agent. The id of the root comment is the thread id. |
| Comment | A text that the user writes. A root comment is on a selection of lines or on a whole file. A reply is inside a thread. A comment is an instruction or a question. |
| Ask now | A button that sends a comment to the agent immediately. |
| Save comment | A button that saves a comment as pending. |
| Send | A button that sends all pending comments to the agent at once. Send does not approve or reject. The review session stays open. |
| Event | A message from the viewer to the agent. Only Ask now and Send create events. |
| Outdated | The state of a thread whose code is not in the current diff. |
| Resolved | The state of a thread that the user closed. |

### 2.1 Comment states

| State | Meaning | Label in the viewer |
|---|---|---|
| Pending | The server saved the comment. The comment is in no event. | "Pending" |
| Sent | The comment is in an event. The agent did not reply in the thread after the event. | "Sent" |
| Answered | The agent replied in the thread after the event. | none |

The server also records whether `wait` printed the event of a sent comment. This record serves only the recovery after `open --resume` (section 9).

The header counter counts only pending comments.

## 3. Main flow

1. The user asks for a review in natural language, for example "open a review of this branch".
2. The agent decides which diff to show, writes it to a file, and runs `reviewit open` in the background.
3. The viewer opens in the default browser.
4. The user selects lines, or uses the file comment button, and writes a comment.
5. The user clicks Ask now or Save comment.
6. With Ask now, the agent gets the event, changes the code if the comment asks for a change, refreshes the diff, and replies in the thread.
7. With Save comment, the comment becomes pending. The user can add more comments.
8. The user clicks Send. The agent gets all pending comments, changes the code, refreshes the diff, and replies in each thread.
9. The review session stays open. The user can continue to comment on the new diff.

While the review is open, the agent is free. The user can also talk to the agent in the terminal. When the agent is busy with a terminal request, events wait in the queue until the agent finishes.

## 4. Review session rules

- One review session belongs to the Claude Code session that created it. The agent uses only the ids that it created. This rule is a convention for the agent. reviewit does not enforce it.
- A review session does not end in an explicit way. It stays as saved state until the automatic cleanup removes it.
- A new review session starts with no comments, also for the same diff.
- The agent can read the complete state of the review session at any time.
- Ask now and Send create events. Save comment, Edit, Delete, Resolve and Unresolve change the state but create no event.
- Closing the viewer window does not end the review session. The agent can open the window again.
- Comments stay in the review session when the diff changes.

## 5. Viewer

All text in the viewer is in English. The viewer uses a dark theme only.

### 5.1 Layout

- A header at the top shows the title, the description and the diff source, with the full width. Below a separator line, a bar shows the file tree button on the left, and the number of pending comments and the Send button on the right.
- The title, the description and the diff source come from the agent (`--title`, `--description`, `--source`).
- The Send button is disabled when there are 0 pending comments.
- When the page is scrolled, only the bar stays visible, and it also shows the title. At the top of the page, the full header returns.
- Below the header, a file tree is on the left and the diff is on the right.
- The page has 1 scroll, and the diff scrolls with the page. The header stays at the top. The file tree stays beside the diff, below the header, and has its own scroll. File headers stay below the header while their file is visible.
- A drag handle between the file tree and the diff changes the width of the file tree. The browser remembers the width.
- A gear button right of the Send button opens a settings menu. The menu has a Layout section with Unified and Split. A check mark shows the current layout.
- The file tree button hides or shows the file tree. When the file tree is hidden, the diff uses the full width. The browser remembers the choice.
- In the file tree, a file with threads shows a comment icon and the number of threads.
- At phone width, the file tree goes above the diff, and the page scrolls as 1 page.

### 5.2 File tree

- A "Filter files…" field filters the tree by file path.
- A filter button next to the field switches between all files and only the files with threads.
- Folders show an arrow and a folder icon. A click opens or closes a folder.
- An open folder shows an open-folder icon. A closed folder shows a closed-folder icon.
- File icons: added = green file with a plus; modified = file with a dot; deleted = red file with a minus; renamed = file with an arrow.
- The current file is highlighted. A click on a file scrolls the diff to that file.

### 5.3 Diff

- The Layout section of the settings menu selects the unified view or the split view. Each review session starts in the unified view.
- In the split view, the old code is on the left and the new code is on the right.
- Each file has a header with an arrow. A click on the header opens or closes the file.
- At the top right of each file header: a counter of added and removed lines, and a button to comment on the whole file.
- A binary file shows "Binary file changed" and no lines.
- An empty diff shows "No changes".

### 5.4 Comments

- The user selects lines in the diff: added, removed or context lines. A comment panel opens under the selected lines. In the split view, the panel and the thread show under the side of the lines.
- The file comment button opens the same comment panel under the file header.
- The comment panel has 3 buttons: Ask now, Save comment and Cancel.
- A reply box in a thread has the same buttons.
- Ask now on a reply also sends the pending comments of the same thread.
- A pending comment has Edit and Delete buttons.
- A thread has a Resolve button. Only the user resolves a thread. A resolved thread is collapsed, has an Unresolve button, and has no reply box. Resolve changes only the display. The agent still handles a sent comment in a resolved thread.
- The agent replies inside the thread. The viewer shows the reply under the comment.
- If the server does not confirm a save, the panel stays open with the text, and the viewer shows an error.
- When a refresh arrives while a comment panel is open, the text in the panel stays. The panel stays under its lines if the lines are still in the diff. If not, the panel moves under the file header.

### 5.5 Outdated threads

- Each root comment saves its anchor: the file, the side (old, new or file), the lines, and the selected text. It also saves a copy of the original code for display.
- On every refresh, each thread is placed again with the rule in section 5.6.
- An outdated thread is collapsed, with the label "Outdated". When the user opens it, it shows the original code.
- Exception: an outdated thread is open when its last message is newer than the refresh that made it outdated. This rule shows the agent reply to a change that the agent made.
- The user can reply in an outdated thread.

### 5.6 Placement rule

1. Find the file in the new diff. Follow a rename.
2. For a file comment: if the file is in the new diff, the thread is current. If not, the thread is outdated.
3. For a line comment: search the same side of that file for the exact sequence of the selected lines.
4. 1 match: the thread moves to that match.
5. More than 1 match: the thread moves to the match nearest to its previous position.
6. No match: the thread is outdated and keeps its previous position for display.
7. An outdated thread becomes current again when a later refresh finds a match.

### 5.7 Status bar

The viewer keeps a live connection to the server. The server computes the status from facts it already knows. The agent does not run any extra command.

| Status | Visible when |
|---|---|
| "Reconnecting to reviewit… Your comments are safe. New comments can be saved when the connection returns." | The viewer has no connection to the server. The viewer tries to connect again every second. |
| "The agent is working on your comments" | `wait` printed events, and the next `wait` did not start yet. There is no time limit. |
| "The agent is not listening right now. Your comments are saved. The agent gets them when it listens again." | No `wait` is active for 30 seconds, and the "working" status is not active. |

The window is open when at least 1 viewer tab has a live connection to the server.

Each thread with a sent comment also shows its own status under the last message. "Waiting for the agent to pick this up" means that no `wait` printed the comment yet. "The agent is working on this…" means that `wait` printed the comment and the agent did not reply yet. A collapsed thread shows an "Agent working" badge. The agent runs no extra command for this status.

## 6. Command line interface

```
reviewit open <file.diff> [--title T] [--description D] [--source CMD] [--replace ID [--force]]
reviewit open --resume <id>
reviewit refresh <id> <file.diff> [--title T] [--description D] [--source CMD]
reviewit show <id>
reviewit wait <id>
reviewit state <id>
reviewit reply <id> <thread-id> [<text>]
```

| Command | Behavior |
|---|---|
| `open <file.diff>` | Creates a review session, copies the diff file into the session folder, starts the server in the same process, opens the default browser, and prints the id and the URL. The process keeps running. The agent runs it in the background. |
| `open --replace ID` | Same as `open`. Before it creates anything, it checks session ID. If session ID has pending or sent comments, the command fails and prints the number of those comments. `--force` allows the replacement in that case. After the start, the new server tells the server of session ID to stop. If that server is not running, nothing else happens. |
| `open --resume <id>` | Starts the server again on the saved state of a review session, with the same port and token as before. An open viewer tab reconnects by itself and shows the current state. If no tab connects within 4 seconds, the command opens the browser. If the saved port is in use, the server uses a new port. If the server of that id is already running, it fails and prints the URL of the running server. |
| `refresh` | Copies a new diff file into the session folder, places the threads again (section 5.6), and updates the viewer. An option that is not given keeps its previous value. |
| `show` | Opens the browser if no viewer tab is connected. Otherwise it does nothing. |
| `wait` | Waits for events, prints all queued events as JSON (section 7.1), and exits with code 0. If events are already queued, it prints them and exits immediately. If a newer `wait` starts on the same id, the older `wait` exits with code 0, no events, and the message "replaced". If `open --replace` stops the server, `wait` exits with code 0 and the message "was replaced by <new id>". If the server stops for another reason, `wait` exits with a non-zero code and the "not running" message. |
| `state` | Prints the complete state of the review session as JSON (section 7.2). |
| `reply` | Writes an agent reply in a thread. The text comes from the argument, or from stdin when there is no argument. |

The diff is always a file. The agent produces it with git or with any other tool. reviewit does not run git.

When the server of a review session is not running, every command except `open` fails with a non-zero code and a message that says what to do, for example:

```
review session abc123 is not running; run: reviewit open --resume abc123
```

## 7. Events and state

- Ask now creates 1 event. Send creates 1 event with all pending comments.
- The server keeps a queue of events for each review session, saved in the session folder.
- `wait` prints all queued events at once. An event leaves the queue when `wait` printed it.
- Events that arrive between 2 `wait` commands stay in the queue. The next `wait` prints them immediately.
- The server saves a comment or an event to disk before it answers the browser.
- If Claude Code kills `wait` after `wait` prints but before the agent reads the output, the agent does not get those events. Their comments stay sent. After `open --resume`, the agent handles them (section 9, step 10).

### 7.1 Output of `wait`

```json
{
  "events": [
    { "type": "ask_now", "comments": ["c12"] },
    { "type": "send", "comments": ["c7", "c9", "c13"] }
  ],
  "threads": [ <thread>, ... ]
}
```

- `comments` lists the ids of the comments that the event sends.
- `threads` contains every thread that has a comment in the events, complete, so that the agent has the context.

A `<thread>`:

```json
{
  "id": "c7",
  "file": "src/review/session.ts",
  "side": "new",
  "start_line": 13,
  "end_line": 15,
  "selected_text": "...",
  "outdated": false,
  "resolved": false,
  "comments": [
    { "id": "c7", "author": "user", "body": "...", "state": "sent" },
    { "id": "c8", "author": "agent", "body": "..." }
  ]
}
```

- `side` is `old`, `new` or `file`. For `file`, the line fields and `selected_text` are null.
- `state` exists only on user comments: `pending`, `sent` or `answered`.

### 7.2 Output of `state`

```json
{
  "id": "abc123",
  "title": "...",
  "description": "...",
  "source": "git diff main",
  "window_open": true,
  "threads": [ <thread>, ... ],
  "unhandled": ["c7"]
}
```

- `unhandled` lists the sent comments whose event `wait` printed, without an agent reply after that event.

## 8. Server and storage

### 8.1 Server

- Each review session has its own server inside the process of `reviewit open`.
- The server listens only on `127.0.0.1`, on a free port that the operating system selects.
- The server stops when its process ends. Claude Code ends its background processes when it closes, so the server stops with the Claude Code session.

### 8.2 Session folder

The state is saved in `~/.reviewit/<id>/`. The folder contains:

- the state of the review session;
- the copy of the current diff file;
- the event queue;
- `server.json` with the port, the token and the process id, readable only by the user. `state.json` also keeps the last port and token, so that `open --resume` can use the same address again;
- a lock file.

### 8.3 Rules

- **Finding the server:** a command reads the port and the token from `server.json`. The server answers each request with its session id. If the connection fails or the id is different, the command gives the "not running" message.
- **One server for each session:** the server holds a lock on the lock file while it runs. The operating system releases the lock when the process ends, also after a crash. A second server cannot start on an id whose lock is held.
- **Access:** the URL of the viewer contains a random token. The server rejects every request without the correct token. Reason: a comment is an instruction to an agent that changes code, and a hostile web page in the same browser must not be able to send one.
- **Cleanup:** `reviewit open` starts with a cleanup step. The cleanup removes a session folder when its last file change is older than 7 days and its lock is not held. Other commands do not run the cleanup.

## 9. Agent workflow (for the skill)

1. Write the diff to a file.
2. Run `reviewit open <file> --title ... --description ... --source "<command>"` in the background. Read the id from the output. The output of that background task stays available if the id is needed again.
3. Run `reviewit wait <id>` in the background.
4. When `wait` ends with events, handle all events: change the code, write the new diff, run `reviewit refresh`, and run `reviewit reply` for each thread.
5. Run `reviewit wait <id>` in the background again.
6. If `wait` ends with the message "replaced", do nothing. Another `wait` is active. If `wait` or the old `open` task ends with the message "was replaced by <new id>", do nothing for the old id.
7. If `wait` or the `open` task ends because the server stopped, run `reviewit open --resume <id>` in the background, then continue at step 3.
8. To open the window again, run `reviewit show <id>`.
9. To start a new review session, run `reviewit open ... --replace <old id>` in the background, then run `wait` on the new id. If the command fails because the old session has pending or sent comments, tell the user. Use `--force` only when the user asks for the replacement in explicit words.
10. After `claude --resume`, run `reviewit open --resume <id>` in the background. Then run `reviewit state <id>` and handle every comment in `unhandled`, as in step 4. Then continue at step 3.
11. After a context summary, run `reviewit state <id>` to get the diff source again.

### 9.1 Skill distribution

- The full agent instructions are inside the binary. `reviewit skill` prints them. A binary upgrade updates them.
- `reviewit skill install <dir>` writes a small stub to `<dir>/reviewit/SKILL.md`, for example with `<dir>` = `~/.claude/skills`, `~/.codex/skills` or `.agents/skills`. The stub has the name and the description, so the agent discovers the skill. Its body says: run `reviewit skill` and follow the output.
- The stub contains the marker `<!-- reviewit-skill-stub -->`.
- If `<dir>/reviewit` exists and holds the marker, the command fails and asks for `--force`. With `--force`, the command deletes the folder and writes the stub again.
- If `<dir>/reviewit` exists without the marker, the command fails and changes nothing, also with `--force`.

## 10. Technology

- Go, to produce 1 binary.
- The viewer files are inside the binary, with the Go `embed` package.
- Syntax highlighting: the server colors the diff with the Chroma library (`github.com/alecthomas/chroma/v2`). The file name selects the language. The server colors the old side and the new side of each hunk as whole blocks. A file with an unknown language shows plain text. A string or comment that starts above a hunk can show the wrong color.
- Long lines wrap in the diff.
- All code and all text in the application are in English.

## 11. Verified assumptions

These tests used simple shell commands, not the reviewit binary.

| Assumption | Result |
|---|---|
| When a background command ends while the agent is busy, Claude Code delivers the notice after the agent finishes. | Passed. The event ended at 00:18:23 during a busy period from 00:18:08 to 00:18:48. The notice arrived after the busy period. |
| Claude Code ends its background processes when it closes. | Passed. The test process stopped writing 23 seconds before the check, and `pgrep` found no process. |

Not tested yet. Test these with the first working binary:

- When a background command ends while the agent is idle, the notice starts a new agent turn.
- A background `wait` can run for many hours, and Claude Code does not stop it.
- A notice that arrives while the agent waits for a user answer.
- Claude Code ends a Go binary and its child processes when it closes.
