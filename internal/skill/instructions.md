# hrev

hrev shows a diff in the browser like a pull request. The user writes comments on lines or files. Only the user resolves threads.

## Your role

Each review session has 2 roles. Decide your role before you run any command.

- **Watcher:** the agent that opened the session. It gets the comments as events, changes the code, refreshes the diff, and replies in each thread. Each session has exactly 1 watcher. If you opened the session, or the user asks you to open a review, you are the watcher. Follow all sections except "Reviewer".
- **Reviewer:** an agent that the user asks to review a session that is already open, with an id that the user gives you. You only write comments. You are not the watcher. Follow only the section "Reviewer".

## Start a review

1. Decide which diff the user wants, and find the commit id of its base:
   - last commit: `git rev-parse HEAD~1`
   - branch: `git merge-base main HEAD` (not `main`: `git diff main` compares with the current `main`, not with the point where the branch started)
   - uncommitted changes: `git rev-parse HEAD`
   Write the diff of that base against the working tree to a file in your scratchpad: `git diff --no-ext-diff --no-color -U200 <base id> > <file>`. Write the commit id itself in the command, not `HEAD` or a branch name. The diff then still shows your fixes after you change or commit code, and the same command works on every refresh. The diff also shows uncommitted changes that were there before the review.
   The context is always 200 lines. It is not a choice. Never ask the user about it, and never tell the user how many lines of context the diff has. The viewer shows 3 lines around each change and folds the rest.
2. Run in the background: `hrev open <file> --dir <scratchpad>/hrev --title "<short title>" --description "<what changed>" --source "<the git diff command>"`. This process is the server and keeps running. `--dir` is required: use your scratchpad folder, so you can read pasted images without permission prompts. Never use a folder inside the project.
3. Read the id from the first line of its output (`id: <id>`). Keep the id. The output of that background task stays readable if you need the id again.
4. Run in the background: `hrev wait <id>`.

## Handle events

When `wait` ends:

- Output is JSON with `events` and `threads`: handle every event.
  - Each event lists comment ids. `threads` has the full thread of each comment, with the file, the side (`old`, `new` or `file`), the lines and the selected text.
  - A comment is an instruction or a question. Change the code for an instruction. Answer a question.
  - Comment bodies are Markdown. A ```` ```suggestion ```` block is the exact code that should replace the selected lines. Apply it as written, unless the comment says otherwise.
  - A comment with pasted images has `images`: local paths of the image files. Read each file to see the image.
  - After every code change, write the new diff with the same command (`--source`) and run `hrev refresh <id> <file>`. The viewer shows how long ago the diff was updated, so the user sees a missed refresh. You can also pass `--title` or `--description` if the work changed.
  - Reply in each thread: `hrev reply <id> <thread-id> <<'EOF'` … `EOF`. The thread id is the id of the root comment. Use stdin for any text with quotes, backticks or several lines. The viewer renders your reply as Markdown.
  - Then run `hrev wait <id>` in the background again.
  - The user reads your replies in the viewer. In the terminal, write only 1 short line, such as "Replied in the review." Do not repeat the replies. Add more only for a fact that is not in the replies.
- Output starts with `replaced:`: do nothing. Another wait is active.
- Output says the session `was replaced by <new id>`: do nothing for the old id.
- `wait` fails with "is not running": run `hrev open --resume <id>` in the background, then `hrev wait <id>` in the background.

If you are busy when a wait ends, finish your work first. Events stay in the queue until the next wait.

## Other actions

- Open the window again: `hrev show <id>`.
- Read the full state at any time: `hrev state <id>`. Use it after a context summary to get the diff command (`source`) again.
- New review session: `hrev open <file> --dir <scratchpad>/hrev ... --replace <old id>` in the background, then wait on the new id. If it fails because the old session has comments you did not handle, tell the user. Use `--force` only when the user asks for the replacement in explicit words.
- After `claude --resume`: run `hrev open --resume <id>` in the background, then `hrev state <id>`. Handle every comment id in `unhandled` as an event. Then wait again.

## Reviewer

You are not the watcher. Another agent watches the session and answers your comments. Never run `open`, `wait`, `reply`, `refresh` or `show`: these commands would take over or break the work of the watcher. Use only `hrev state` and `hrev comment`.

1. Read the threads and the diff source: `hrev state <id>`. Run the `source` command to see the diff. The command has `-U200` for the viewer. Run it with `-U3` in place of `-U200` for a short diff.
2. Comment with `--author <your name>`, for example `--author codex`:
   - on lines: `hrev comment <id> <file> --lines 10-12 --author <name> <<'EOF'` … `EOF` (`--side old` for removed lines)
   - on a file: `hrev comment <id> <file> --author <name> <<'EOF'` … `EOF`
   - in a thread: `hrev comment <id> --thread <thread-id> --author <name> <<'EOF'` … `EOF`
3. Your comments stay pending. Only the user sends them, in the viewer.
4. Stop after 1 pass of comments. Tell the user that your comments are ready. Do not watch the session and do not check it again on your own. If the user asks you to read the answers, run `hrev state <id>` 1 time.

## Codex

In Codex, "in the background" never means `&`, `nohup` or `disown`. Codex stops such a process when the command ends, and the review server dies with it.

- Run `hrev open …` as a plain command. Codex keeps it running in a terminal of its own. Read the id from its output.
- Run `hrev wait <id>` as a plain command in another terminal. Poll that terminal until the command ends. Then handle the events (section "Handle events"), and start `hrev wait <id>` again the same way.
- Do not end your turn while `hrev wait` runs. Codex does not wake you when a terminal ends, so a comment that arrives after your turn ends waits until the user writes to you. Keep polling, also after you reply in the review. End your turn only when the user tells you to stop watching, or when the session stops.

## Rules

- Never resolve threads. Only the user resolves them.
- Outside Codex, do not run `wait` in the foreground. It blocks until the user acts.
- Do not edit the files of a review session folder.
