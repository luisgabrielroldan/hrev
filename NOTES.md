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
| 10 | Session 8bd98730 (commit 104b71d), split view: a comment with Ask now on a removed line (`internal/web/app.css` old line 1). | Passed on the agent side. The event arrived with side `old`, line 1 and the old text (c1). The agent replied (c2). |

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
- Replace: `open --replace 89a72dc9` refused, because the old session had 1 pending comment (c12). After the user said "replace", `--force` replaced it with session 8bd98730 (review of commit 104b71d). The old `open` and the old `wait` printed "was replaced by 8bd98730".
- The tab of a replaced session only showed "Reconnecting to reviewit…", and the replace opened a second tab. The user asked to reuse the same tab.
  - Change: the old server sends the new viewer URL to its open tabs (SSE event `replaced`), and each tab loads the new session in place. The tab accepts only a `http://127.0.0.1:<port>/?t=<token>` address. The new server opens a browser tab only when no tab connects within 4 seconds. Test: `TestReplacedTabMoves`.
- Request: a blue + button on the hovered line, as on GitHub. A click comments on that line, and a drag from the button selects a range.
  - Change: 1 floating button follows the line under the pointer. The drag now changes only the row classes, without a full page render, so it stays fast on a large diff. The drag from a line number still works.
  - The first position covered the +/− sign and touched the code text ("ugly"). A second position on the number edge covered the line number. After a screen recording of GitHub from the user, the final behavior follows GitHub: the button sits in the gap between the line number and the +/− sign, and the sign stays visible (the sign column is 44 px wide, before: 20 px). During a drag, a second button stays on the first line of the range, and a vertical line in the button color joins the 2 buttons. The selected lines are amber with a blue left edge, also while the comment panel is open (before: blue).
  - Verified in headless Chrome with real mouse events: the button appeared on hovered line 3; a drag from it to line 5 marked 3 rows; the comment panel opened with "Lines 3–5".
- Request: no blue border on the new comment box. Change: removed `.thread.draft{border-color:var(--focus)}`. The text field keeps a blue focus border.
- Request: no amber color on a line number under the pointer. Change: removed the `.num[data-line]:hover` rule. Only selected lines are amber.
- Request: a lighter focus border on the text fields. The focus style drew a blue border and a 2 px blue outline with a gap. Change: only the 1 px blue border stays.
- Request: Markdown in comments, Write and Preview tabs, a suggestion block, and pasted images that the agent can see and that survive a reload.
  - Change: a small Markdown renderer in the viewer (the text is escaped first; links only http/https; images only session attachments). Every comment box has Write and Preview tabs and a suggestion button on line comments, which inserts a ```` ```suggestion ```` block with the selected lines. Pasted images (PNG, JPEG, GIF, WebP, at most 10 MB) are stored in `attachments/` in the session folder. `wait` and `state` list their local paths in `images`. The skill tells the agent how to handle suggestions and images.
  - Verified: `TestAttachment` (upload, download, path in the `wait` output). Headless Chrome: suggestion insert, preview with bold, code, link, list, suggestion box and image; `<img onerror>` showed as text; the pasted image showed again after a reload.
  - Real test: the user pasted a screenshot into comment c3 with Ask now. `wait` listed the local image path, and the agent read the image (the GitHub toolbar).
- Request (from that image): the GitHub toolbar. Change: heading, bold, italic, quote, code and link buttons after the suggestion button. Verified in headless Chrome: each button produces the expected Markdown.
  - Not done: drag and drop of images.
- Request: a Cancel button on the comment box. Change: a thread shows a closed "Reply…" field next to Resolve. A click opens the editor with Ask now, Save comment and Cancel. Cancel clears the text and closes the editor. Verified in headless Chrome.
- Problem: the agent needed a permission prompt to read a pasted image, because the images were in `~/.reviewit`, outside the project.
  - Change: `open` requires `--dir <folder>`. The session data lives in `<folder>/<id>/`; `~/.reviewit/<id>.path` points to it, so all other commands still take only the id. The skill tells the agent to pass its scratchpad. Cleanup removes old sessions with their pointers, and pointers whose folder is gone. Older sessions in `~/.reviewit/<id>/` still work. Test: `TestCreateAndCleanup`.
  - Applied: session 8bd98730 was replaced by session 7292b58c in the scratchpad. The open tab switched to the new session by itself (`window_open: true` after 1.5 seconds).
  - Agent mistake: a reply to comment c5 used the comment id instead of the thread id c3. reviewit rejected it, and the parallel replace refused, because c5 was still unanswered. Nothing was lost.
- Request: smaller text in the text boxes. Change: 13 px (before: 14 px) in the text fields, the "Reply…" field and the preview.
- Request: higher text boxes. Change: the new-comment box and the preview are 100 px high at least (before: 72 px); reply and edit boxes 72 px (before: 44 px).
- Defect: the Heading and Quote buttons selected the whole changed line, so typing replaced `### `. Correction: without a selection, the caret goes right after the prefix; with a selection, to the end of the changed lines. Verified in headless Chrome: Heading on an empty box, then typing "Title", gives `### Title`.
- Request: a better suggestion icon. First change: a hand-drawn sheet with a plus and a minus. Final change: the exact SVG path that the user gave (a filled 16×16 icon).
- Request: better Italic and Quote ("bullets") icons. Change: filled 16×16 icons in the GitHub style for Italic, Quote and Bold. Bold changed after a misreading of "ballots" and stayed for a matching look.
- Request: icons on Ask now and Save comment. Design discussed first; the user chose a speech bubble with a lightning bolt (Ask now) and a speech bubble with a plus (Save comment). Change: done in the new-comment box and the reply box. The bubble body first sat about 2 px above the text center, because the tail takes the lower part of the icon box. The icons now move down 1.5 px.
- Request: simpler button names. Change: "Save comment" is now "Comment", with an empty speech bubble (the plus is removed). "Send pending comments" is now "Send comments". The spec uses the new names.
- Request: file icons in the tree with the sheet of the suggestion icon; a modified file uses the exact suggestion icon (plus and minus). Change: done. Added files show the sheet with a plus (green), deleted files with a minus (red), renamed files with an arrow.
- Request: a lower file header with less rounded corners, and 1 corner radius for the whole page. Change: `--radius: 6px` everywhere (before: 5, 6 and 8 px); circles and pill badges keep their shape. The file header padding is 4 px top and bottom (before: 8 px).
- Defect: while the file header was stuck, rows that scrolled below it showed through its rounded top corners. Correction: the header has square corners, and the card clips its content to its round corners with `overflow: clip` (which keeps the header sticky). Verified in headless Chrome after a scroll: the header sticks with no gaps.
- Request: less space at the sides of the diff area. Change: 16 px at the sides, the same as at the top (before: 24 px).
- Request (with a GitHub screenshot): the + button sits on the edge between the line numbers and the sign, and the sign column has no empty space. Change: the sign column is 20 px again (before: 44 px) with a centered sign; the button (22 px) is centered on the number/sign edge and covers part of the sign; the line numbers have 14 px right padding (before: 10 px). Verified in headless Chrome: hover, drag with 2 buttons and the line between them, and the comment panel.
- Risk: the agent can forget `refresh` after a code change, and the viewer then shows an old diff. Change: the header shows the diff age ("updated 3 min ago") from the modification time of `diff.patch`; the skill says to refresh after every code change. Test: `TestDiffTime`.
- Request: an arrow cursor over the code. Change: `.code` uses `cursor: default`.
- Request: the file header always above the + button. Change: the + button and the drag line use z-index 1, below the sticky header (2). Verified in headless Chrome: at the top edge of a button on a row half under the header, the element on top is the header.
- Request: the blue a little more teal and a little less bright. Change: every blue color turned 12° toward teal, with 15% less saturation and 5% less lightness (accent `#2F5FD0` → `#3879BA`, focus `#5B8CFF` → `#57A4F1`, link `#8AB0FF` → `#81BEF5`, and the badge colors).
- Request: the comment box buttons on the right, in the order Cancel, Comment, Ask now, with Cancel as an outlined button. Change: done in the new-comment box and the reply box.
- The status bar is not visible while the agent listens. The test instructions described it as always visible, which confused the user.
