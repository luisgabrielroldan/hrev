// Package skill holds the agent instructions inside the binary, and installs a small stub skill
// that points the agent to them.
package skill

import (
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Instructions is the full skill text, printed by "hrev skill".
//
//go:embed instructions.md
var Instructions string

// Name is the folder name of the installed skill.
const Name = "hrev"

// Marker identifies a stub that hrev wrote. Only a folder with this marker is replaced.
const Marker = "<!-- hrev-skill-stub -->"

// Stub is the SKILL.md that "hrev skill install" writes.
const Stub = `---
name: hrev
description: Open a local code review of a diff in the browser with hrev, then answer the user's review comments and change the code. Use when the user asks to open a review, review the last commit, review a branch, or review uncommitted changes in a local review viewer. Also use when the user asks you to comment on an hrev review session that is already open: then you are a reviewer, not the watcher.
---
` + Marker + `

# hrev

Run ` + "`hrev skill`" + ` and follow its output. The hrev binary prints the current instructions, so they always match the installed version.
`

// ErrInstalled means that the skill is already installed and --force was not given.
var ErrInstalled = errors.New("already installed")

// Install writes the stub to <dir>/hrev/SKILL.md and returns the path of the folder.
// An existing folder is replaced only when it holds the marker and force is true.
func Install(dir string, force bool) (string, error) {
	// The shell expands ~ and ~user before hrev gets the path. This only handles a quoted path such as
	// "~/.claude/skills". ~user/ is not handled: installing into another user's home is not a use case.
	if strings.HasPrefix(dir, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dir = filepath.Join(home, dir[2:])
	}
	target := filepath.Join(dir, Name)
	if _, err := os.Stat(target); err == nil {
		b, err := os.ReadFile(filepath.Join(target, "SKILL.md"))
		if err != nil || !strings.Contains(string(b), Marker) {
			return target, fmt.Errorf("%s exists and hrev did not create it; nothing changed", target)
		}
		if !force {
			return target, fmt.Errorf("the skill is %w at %s; run again with --force to replace it", ErrInstalled, target)
		}
		if err := os.RemoveAll(target); err != nil {
			return target, err
		}
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return target, err
	}
	return target, os.WriteFile(filepath.Join(target, "SKILL.md"), []byte(Stub), 0o644)
}
