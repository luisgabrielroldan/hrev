# Interaction test notes

Session: 89a72dc9. The diff is the full project, compared with an empty folder.

## Results

| Step | Test | Result |
|---|---|---|
| 1 | A question with Ask now on `internal/skill/skill.go` lines 43–49. | Passed on the agent side. The `ask_now` event arrived with the correct file, lines and selected text. The agent replied in the thread (c2). |
| 2 | An instruction with Ask now on `skill.go` line 37: "Rename this to ErrInstalled". | Passed on the agent side. The agent renamed the error, refreshed the diff and replied (c4). The refresh marked the thread as outdated, because the selected line (the doc comment) changed. The user confirmed both threads in the viewer after the server restart. |
| 3 | 2 saved comments (`main.go` 49–68, `internal/store/store.go` 17–23), then Send. | Passed on the agent side. 1 `send` event arrived with both comments (c5, c6). The agent replied to both (c7, c8). |
| 4 | A file comment on `go.mod` with Ask now. | Passed on the agent side. The `ask_now` event arrived with side `file` (c9). The agent replied (c10). Minor: the `wait` output shows `start_line`, `end_line` and `selected_text` as `null` for a file comment. |
| 5 | Edit and delete pending comments in `SPEC.md`, without Send. | Passed. The server keeps 1 pending comment (c12, line 10). The deleted comment is gone. The agent received no event. The user confirmed the edit. |
| 6 | A reply with Ask now in the answered thread c1: "add a comment in the code". | Passed on the agent side. The event had only c13, with the full thread. The agent added 2 comment lines above the block and refreshed. The thread moved from lines 43–49 to 45–51 and stayed current. The pending comment c12 stayed pending. |
| 7 | Resolve, then Unresolve, the file thread on `go.mod`. | Passed. The user confirmed the Resolved label and the Unresolve. The agent received no event. |
| 8 | Close the tab, then `reviewit show`. | Passed. `reviewit state` reported `window_open: false` after the close. `show` opened a tab at the same address. The user confirmed all threads and the pending comment. |

## Findings

- Ask now needs a visible working indicator. The status bar shows "The agent is working on your comments" only between the end of `wait` and the next `wait`. A quick reply makes that time too short to see. The status bar is also not near the thread.
  - Change: each thread with a sent comment now shows a line under the last message. "Waiting for the agent to pick this up" means that `wait` has not delivered the comment yet. "The agent is working on this…" with a pulsing dot means that `wait` delivered the comment and the agent has not replied yet. A collapsed thread shows an "Agent working" badge. The indicator uses the existing comment state and printed flag. The agent runs no extra command.
- The diff of the full project must come from git (`git diff <empty tree>`), not from `git diff --no-index`. After `git init`, `--no-index` also included the `.git` folder.
- A server restart opened a new tab and left the old tab disconnected. The user thought that a new session had started. The "not listening" warning also made the user think that the session was lost.
  - Change: `open --resume` uses the saved port and token again. The open tab reconnects by itself within about 1 second, and the browser opens a tab only when no tab connects within 4 seconds. "Not listening" appears after 30 seconds, not 5. The messages are calmer: "Reconnecting to reviewit…" and "The agent is not listening right now. Your comments are saved."
  - Verified: after a restart of session 89a72dc9 on port 63254, the open tab reconnected (`window_open: true`) and no new tab was needed.
- `wait` failed with "not running" when it started right after `open --resume`, because the server was not ready yet.
  - Change: `wait` tries to connect again for up to 5 seconds.
- Typing in the tree filter was slow. Each keystroke rebuilt the whole page, with all diff lines (about 9,000 in this diff). The filter sends nothing to the server.
  - Change: the filter, the "files with threads" button and the folder toggles redraw only the tree list.
  - Other actions still rebuild the whole page. A very large diff can still feel slow on those actions.
- Request from the user: show the thread count of each file in the tree, with a comment icon on the right side (as in GitHub).
  - Change: done.
- The step 9 instruction said that the filter also filters the diff. The filter changes only the tree.
- The second restart on the same address worked without manual help: the tab reconnected (`window_open: true`), and the `wait` started right after `open --resume` did not fail. A reconnected tab keeps the old viewer code until the user reloads the page. Only a new reviewit build changes that code.
- Request: a handle to change the width of the file list.
  - Change: a drag handle between the tree and the diff. The arrow keys also work when the handle has focus. The width stays between 180 px and 60% of the window. The browser remembers the width for that viewer.
- Request: a compact header while the diff is scrolled. At the top, the header stays full size. After a scroll, the header shows only the title, the pending count and the send button.
  - Change: done. The header becomes compact after 24 px of scroll and full again at the top.
- The page had a second, outer scrollbar with a very small thumb. The hidden screen-reader labels (`.sr`, `position:absolute`) escaped the scroll containers, because the diff pane and the tree were not positioned. Their positions deep in the diff made the page very tall. The labels of the new thread reply boxes made this visible.
  - Change: the diff pane and the tree are now positioned. The later change to 1 page scroll replaced the rest of this correction.
- Request: 1 scroll for the whole page, as on GitHub. The diff scrolls with the page. The header sticks to the top and becomes compact. The file tree stays beside the diff.
  - Change: the page is the only main scroll. The top bar (header and status) is sticky. The file tree and the resize handle stick below the top bar, with the full remaining height, and the tree has its own scroll. File headers stick below the top bar. The CSS gets the top bar height from a ResizeObserver (`--top-h`).
  - Verified in headless Chrome at 1400×900: no horizontal overflow; after a scroll the header is compact (53 px), the tree top is at 53 px, and the file header sticks below the header.
- Request: a button on the left of the top bar to hide the file list.
  - First version: a button left of the title. The user rejected that layout.
  - Change: the full header has the title and the texts with the full width. Below a separator line, a bar has the file list button on the left, and the pending count and the Send button on the right. After a scroll, only the bar stays, with the title. A hidden file list gives the diff the full width. The browser remembers the choice.
- Request: a smaller filter box. Change: the filter box and its button are 30 px high (before: 36 px and 38 px).
- Request: a gear button right of Send, with a menu to select the layout (Unified or Split), as on GitHub. The view toggles above the diff are removed.
  - Change: done. The menu opens and closes without a full page render. A click outside the menu or Escape closes it.
- Request: the GitHub sans-serif font stack. Change: the UI text uses `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"` (before: Inter first). The code font did not change.
- Request: smaller buttons. Change: all buttons and icon buttons are 30 px high (before: 36–38 px). The icon buttons in the file headers are 28 px. The collapsed thread bars are 36 px (before: 44 px).
- Request: less bright white text. Change: `--text` from `#E6E8EC` to `#CDD3DC`.
- Incident: a malformed `pkill` (options after the pattern, BSD syntax) killed unrelated user processes, including browser tab processes. Rule: stop processes only by their exact PID.
- The status bar is not visible while the agent listens. The test instructions described it as always visible, which confused the user.
