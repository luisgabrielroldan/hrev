package store

import (
	"fmt"
	"strings"

	"hrev/internal/diffparse"
)

// NextCommentID returns a new comment id, such as "c7".
func (st *State) NextCommentID() string {
	st.NextID++
	return fmt.Sprintf("c%d", st.NextID)
}

// Thread returns the thread with the given id, or nil.
func (st *State) Thread(id string) *Thread {
	for _, t := range st.Threads {
		if t.ID == id {
			return t
		}
	}
	return nil
}

// Comment returns a comment and its thread, or nil.
func (st *State) Comment(id string) (*Thread, *Comment) {
	for _, t := range st.Threads {
		for _, c := range t.Comments {
			if c.ID == id {
				return t, c
			}
		}
	}
	return nil, nil
}

// PendingCount counts pending user comments.
func (st *State) PendingCount() int {
	n := 0
	for _, t := range st.Threads {
		for _, c := range t.Comments {
			if c.Author == User && c.State == Pending {
				n++
			}
		}
	}
	return n
}

// CountUnsent counts user comments that the agent did not handle: pending or sent.
func (st *State) CountUnsent() int {
	n := 0
	for _, t := range st.Threads {
		for _, c := range t.Comments {
			if c.Author == User && (c.State == Pending || c.State == Sent) {
				n++
			}
		}
	}
	return n
}

// Unhandled lists sent comments whose event wait printed, without an agent reply after it.
func (st *State) Unhandled() []string {
	out := []string{}
	for _, t := range st.Threads {
		for _, c := range t.Comments {
			if c.Author == User && c.State == Sent && c.Printed {
				out = append(out, c.ID)
			}
		}
	}
	return out
}

// FindFile finds a file in a diff by its new or old path.
func FindFile(files []*diffparse.File, path string) *diffparse.File {
	for _, f := range files {
		if f.Path == path {
			return f
		}
	}
	for _, f := range files {
		if f.OldPath == path {
			return f
		}
	}
	return nil
}

// SideLines returns the lines of one side of a file, in order, with their numbers.
func SideLines(f *diffparse.File, side string) []CodeLine {
	var out []CodeLine
	for _, h := range f.Hunks {
		for _, l := range h.Lines {
			switch {
			case side == SideNew && l.New > 0:
				out = append(out, CodeLine{Kind: l.Kind, Num: l.New, Text: l.Text})
			case side == SideOld && l.Old > 0:
				out = append(out, CodeLine{Kind: l.Kind, Num: l.Old, Text: l.Text})
			}
		}
	}
	return out
}

// LinesInRange returns the lines of one side with numbers from start to end.
func LinesInRange(f *diffparse.File, side string, start, end int) []CodeLine {
	var out []CodeLine
	for _, l := range SideLines(f, side) {
		if l.Num >= start && l.Num <= end {
			out = append(out, l)
		}
	}
	return out
}

// JoinText joins the text of code lines with newlines.
func JoinText(lines []CodeLine) string {
	parts := make([]string, len(lines))
	for i, l := range lines {
		parts[i] = l.Text
	}
	return strings.Join(parts, "\n")
}

// Place places every thread in a new diff (specification section 5.6).
// st.Rev must already be the revision of the new diff.
func (st *State) Place(files []*diffparse.File) {
	for _, t := range st.Threads {
		f := FindFile(files, t.File)
		if f == nil {
			st.markOutdated(t)
			continue
		}
		if t.Side == SideFile {
			t.File = f.Path
			t.Outdated = false
			continue
		}
		start, ok := Match(SideLines(f, t.Side), strings.Split(t.SelectedText, "\n"), t.StartLine)
		if !ok {
			st.markOutdated(t)
			continue
		}
		n := strings.Count(t.SelectedText, "\n")
		t.File = f.Path
		t.StartLine, t.EndLine = start, start+n
		t.Outdated = false
	}
}

func (st *State) markOutdated(t *Thread) {
	if !t.Outdated {
		t.Outdated = true
		t.OutdatedRev = st.Rev
	}
}

// Match finds the exact sequence of texts in lines with consecutive numbers.
// With more than 1 match, it returns the match nearest to near.
func Match(lines []CodeLine, texts []string, near int) (int, bool) {
	best, found := 0, false
	n := len(texts)
	for i := 0; i+n <= len(lines); i++ {
		ok := true
		for j := 0; j < n; j++ {
			l := lines[i+j]
			if l.Text != texts[j] || (j > 0 && l.Num != lines[i+j-1].Num+1) {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		if !found || abs(lines[i].Num-near) < abs(best-near) {
			best, found = lines[i].Num, true
		}
	}
	return best, found
}

// OpenByDefault reports whether an outdated thread shows open: its last message is newer
// than the refresh that made it outdated (specification section 5.5).
func (t *Thread) OpenByDefault() bool {
	if t.Resolved {
		return false
	}
	if !t.Outdated {
		return true
	}
	last := t.Comments[len(t.Comments)-1]
	return last.Rev >= t.OutdatedRev
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
