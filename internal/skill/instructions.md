# reviewit

reviewit shows a diff in the browser like a pull request. The user writes comments on lines or files. You get the comments as events, change the code, refresh the diff, and reply in each thread. Only the user resolves threads.

## Start a review

1. Decide which diff the user wants. Write it to a file in your scratchpad. Always disable external diff tools and colors:
   - last commit: `git diff --no-ext-diff --no-color HEAD~1 HEAD > <file>`
   - branch with uncommitted changes: `git diff --no-ext-diff --no-color $(git merge-base main HEAD) > <file>`
   - uncommitted changes only: `git diff --no-ext-diff --no-color HEAD > <file>`
   Note: `git diff main` compares with the current `main`, not with the point where the branch started. Use `git merge-base` for a branch.
2. Run in the background: `reviewit open <file> --dir <scratchpad>/reviewit --title "<short title>" --description "<what changed>" --source "<the git diff command>"`. This process is the server and keeps running. `--dir` is required: use your scratchpad folder, so you can read pasted images without permission prompts. Never use a folder inside the project.
3. Read the id from the first line of its output (`id: <id>`). Keep the id. The output of that background task stays readable if you need the id again.
4. Run in the background: `reviewit wait <id>`.

## Handle events

When `wait` ends:

- Output is JSON with `events` and `threads`: handle every event.
  - Each event lists comment ids. `threads` has the full thread of each comment, with the file, the side (`old`, `new` or `file`), the lines and the selected text.
  - A comment is an instruction or a question. Change the code for an instruction. Answer a question.
  - Comment bodies are Markdown. A ```` ```suggestion ```` block is the exact code that should replace the selected lines. Apply it as written, unless the comment says otherwise.
  - A comment with pasted images has `images`: local paths of the image files. Read each file to see the image.
  - After every code change, write the new diff with the same command (`--source`) and run `reviewit refresh <id> <file>`. The viewer shows how long ago the diff was updated, so the user sees a missed refresh. You can also pass `--title` or `--description` if the work changed.
  - Reply in each thread: `reviewit reply <id> <thread-id> <<'EOF'` … `EOF`. The thread id is the id of the root comment. Use stdin for any text with quotes, backticks or several lines. The viewer renders your reply as Markdown.
  - Then run `reviewit wait <id>` in the background again.
- Output starts with `replaced:`: do nothing. Another wait is active.
- Output says the session `was replaced by <new id>`: do nothing for the old id.
- `wait` fails with "is not running": run `reviewit open --resume <id>` in the background, then `reviewit wait <id>` in the background.

If you are busy when a wait ends, finish your work first. Events stay in the queue until the next wait.

## Other actions

- Open the window again: `reviewit show <id>`.
- Read the full state at any time: `reviewit state <id>`. Use it after a context summary to get the diff command (`source`) again.
- New review session: `reviewit open <file> --dir <scratchpad>/reviewit ... --replace <old id>` in the background, then wait on the new id. If it fails because the old session has comments you did not handle, tell the user. Use `--force` only when the user asks for the replacement in explicit words.
- After `claude --resume`: run `reviewit open --resume <id>` in the background, then `reviewit state <id>`. Handle every comment id in `unhandled` as an event. Then wait again.

## Rules

- Never resolve threads. Only the user resolves them.
- Do not run `wait` in the foreground. It blocks until the user acts.
- Do not edit files in `~/.reviewit/`.
