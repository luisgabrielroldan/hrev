# hrev

hrev ("human review") is a local code review for coding agents. It shows a diff in your browser like a pull request. You comment on lines or files, and the agent changes the code and replies in each thread. Nothing is pushed anywhere: the diff, the comments and the server stay on your machine.

## How it works

1. You ask the agent for a review, for example "open a review of the last commit".
2. The agent writes the diff to a file and runs `hrev open` in the background. Your browser opens the review.
3. You write comments. Hover a line and click the **+** button to comment on it, or drag the button to select a range. Comments support Markdown, suggestion blocks and pasted images.
4. You click **Send comments**, or **Ask now** on a single comment.
5. The agent gets the comments, changes the code, refreshes the diff and replies in each thread.
6. You read the replies and resolve the threads. Only you resolve threads.

The agent learns all of this from the hrev skill.

## Install

You need Go 1.24 or later.

```sh
git clone <repository-url> hrev
cd hrev
go build -o ~/.local/bin/hrev .
```

Put `hrev` in a folder on your `PATH`. Then install the skill for your agent:

```sh
hrev skill install ~/.claude/skills   # Claude Code
hrev skill install ~/.codex/skills    # Codex
```

The skill is a small stub that tells the agent to run `hrev skill`. The full instructions come from the binary, so they always match the installed version.

## A second reviewer

Another agent can review the same session. Click **Copy session** in the viewer and give the copied text to the other agent, for example "review hrev session 05546204". That agent adds comments with `hrev comment --author <name>`. Its comments stay pending until you send them.

## Commands

```
hrev open <file.diff> --dir <folder> [--title T] [--description D] [--source CMD] [--replace ID [--force]]
hrev open --resume <id>
hrev refresh <id> <file.diff> [--title T] [--description D] [--source CMD]
hrev show <id>
hrev wait <id>
hrev state <id>
hrev reply <id> <thread-id> [<text>]
hrev comment <id> <file> [--lines N[-M]] [--side old|new] [--author NAME] [<text>]
hrev comment <id> --thread <thread-id> [--author NAME] [<text>]
hrev skill
hrev skill install <dir> [--force]
```

The agent runs these commands. You do not need them for a normal review. [SPEC.md](SPEC.md) describes the full behavior.

## Security

The server listens only on `127.0.0.1`. The viewer URL contains a random token, and the server rejects every request without it. Other web pages in your browser therefore cannot send comments to your agent.

## License

[MIT](LICENSE)
