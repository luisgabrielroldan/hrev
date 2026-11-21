// Package diffparse parses unified diffs, as produced by git diff or diff -u.
package diffparse

import (
	"fmt"
	"strconv"
	"strings"
)

// Line kinds.
const (
	Ctx = "ctx"
	Add = "add"
	Del = "del"
)

// File statuses.
const (
	Added    = "added"
	Modified = "modified"
	Deleted  = "deleted"
	Renamed  = "renamed"
)

// Line is one line of a hunk. Old and New are 0 when the line has no number on that side.
type Line struct {
	Kind string `json:"kind"`
	Old  int    `json:"old,omitempty"`
	New  int    `json:"new,omitempty"`
	Text string `json:"text"`
	// HTML is the text with syntax color spans, set by package highlight. Empty means plain text.
	HTML string `json:"html,omitempty"`
}

// Hunk is one @@ block.
type Hunk struct {
	Header string `json:"header"`
	Lines  []Line `json:"lines"`
}

// File is one file in the diff. Path is the new path, or the old path for a deleted file.
type File struct {
	Path    string `json:"path"`
	OldPath string `json:"old_path"`
	Status  string `json:"status"`
	Binary  bool   `json:"binary"`
	Adds    int    `json:"adds"`
	Dels    int    `json:"dels"`
	Hunks   []Hunk `json:"hunks"`
}

// Parse parses a unified diff. An empty input gives an empty list.
func Parse(input string) ([]*File, error) {
	input = strings.ReplaceAll(input, "\r\n", "\n")
	lines := strings.Split(input, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}

	var files []*File
	var cur *File
	var hunk *Hunk
	oldLeft, newLeft, oldN, newN := 0, 0, 0, 0

	finish := func() {
		if cur == nil {
			return
		}
		if cur.Path == "" {
			cur.Path = cur.OldPath
		}
		if cur.OldPath == "" {
			cur.OldPath = cur.Path
		}
		if cur.Status == Modified && cur.OldPath != cur.Path {
			cur.Status = Renamed
		}
		if cur.Path != "" {
			files = append(files, cur)
		}
		cur = nil
	}
	start := func() {
		finish()
		cur = &File{Status: Modified}
		hunk = nil
	}

	for i, l := range lines {
		// Inside a hunk: the counters say how many lines remain.
		if hunk != nil && (oldLeft > 0 || newLeft > 0) {
			if strings.HasPrefix(l, "\\") {
				continue
			}
			kind, text := Ctx, ""
			switch {
			case l == "":
				kind = Ctx
			case l[0] == ' ':
				kind, text = Ctx, l[1:]
			case l[0] == '+':
				kind, text = Add, l[1:]
			case l[0] == '-':
				kind, text = Del, l[1:]
			default:
				return nil, fmt.Errorf("line %d: unexpected line inside a hunk: %q", i+1, l)
			}
			ln := Line{Kind: kind, Text: text}
			switch kind {
			case Ctx:
				ln.Old, ln.New = oldN, newN
				oldN++
				newN++
				oldLeft--
				newLeft--
			case Add:
				ln.New = newN
				newN++
				newLeft--
				cur.Adds++
			case Del:
				ln.Old = oldN
				oldN++
				oldLeft--
				cur.Dels++
			}
			hunk.Lines = append(hunk.Lines, ln)
			cur.Hunks[len(cur.Hunks)-1] = *hunk
			continue
		}
		if strings.HasPrefix(l, "\\") {
			continue
		}

		switch {
		case strings.HasPrefix(l, "diff --git "):
			start()
			rest := strings.TrimPrefix(l, "diff --git ")
			if idx := strings.LastIndex(rest, " b/"); idx >= 0 {
				cur.OldPath = strings.TrimPrefix(unquote(rest[:idx]), "a/")
				cur.Path = unquote(rest[idx+3:])
			}
		case strings.HasPrefix(l, "new file mode"):
			ensure(&cur)
			cur.Status = Added
		case strings.HasPrefix(l, "deleted file mode"):
			ensure(&cur)
			cur.Status = Deleted
		case strings.HasPrefix(l, "rename from "):
			ensure(&cur)
			cur.OldPath = unquote(strings.TrimPrefix(l, "rename from "))
		case strings.HasPrefix(l, "rename to "):
			ensure(&cur)
			cur.Path = unquote(strings.TrimPrefix(l, "rename to "))
		case strings.HasPrefix(l, "Binary files ") || strings.HasPrefix(l, "GIT binary patch"):
			ensure(&cur)
			cur.Binary = true
		case strings.HasPrefix(l, "--- "):
			// A plain diff -u has no "diff --git" line: "---" starts a new file.
			if cur == nil || len(cur.Hunks) > 0 {
				start()
			}
			p := pathOf(strings.TrimPrefix(l, "--- "), "a/")
			if p == "/dev/null" {
				cur.Status = Added
			} else {
				cur.OldPath = p
			}
		case strings.HasPrefix(l, "+++ "):
			ensure(&cur)
			p := pathOf(strings.TrimPrefix(l, "+++ "), "b/")
			if p == "/dev/null" {
				cur.Status = Deleted
			} else {
				cur.Path = p
			}
		case strings.HasPrefix(l, "@@ "):
			ensure(&cur)
			os, oc, ns, nc, err := parseHunkHeader(l)
			if err != nil {
				return nil, fmt.Errorf("line %d: %v", i+1, err)
			}
			oldN, oldLeft, newN, newLeft = os, oc, ns, nc
			cur.Hunks = append(cur.Hunks, Hunk{Header: l})
			hunk = &cur.Hunks[len(cur.Hunks)-1]
		default:
			// index, mode, similarity and other header lines are ignored.
		}
	}
	finish()
	if files == nil {
		files = []*File{}
	}
	return files, nil
}

func ensure(cur **File) {
	if *cur == nil {
		*cur = &File{Status: Modified}
	}
}

func pathOf(s, prefix string) string {
	if i := strings.Index(s, "\t"); i >= 0 {
		s = s[:i]
	}
	s = unquote(strings.TrimSpace(s))
	return strings.TrimPrefix(s, prefix)
}

func unquote(s string) string {
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		if u, err := strconv.Unquote(s); err == nil {
			return u
		}
	}
	return s
}

// parseHunkHeader reads "@@ -a,b +c,d @@ ...". A missing count means 1.
func parseHunkHeader(l string) (oldStart, oldCount, newStart, newCount int, err error) {
	parts := strings.Fields(l)
	if len(parts) < 3 || !strings.HasPrefix(parts[1], "-") || !strings.HasPrefix(parts[2], "+") {
		return 0, 0, 0, 0, fmt.Errorf("bad hunk header: %q", l)
	}
	oldStart, oldCount, err = rangeOf(parts[1][1:])
	if err != nil {
		return
	}
	newStart, newCount, err = rangeOf(parts[2][1:])
	return
}

func rangeOf(s string) (int, int, error) {
	a, b, found := strings.Cut(s, ",")
	start, err := strconv.Atoi(a)
	if err != nil {
		return 0, 0, fmt.Errorf("bad range %q", s)
	}
	count := 1
	if found {
		if count, err = strconv.Atoi(b); err != nil {
			return 0, 0, fmt.Errorf("bad range %q", s)
		}
	}
	return start, count, nil
}
