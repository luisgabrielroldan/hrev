package store

import (
	"testing"

	"hrev/internal/diffparse"
)

func fileWith(path string, newLines ...string) []*diffparse.File {
	h := diffparse.Hunk{Header: "@@"}
	for i, s := range newLines {
		h.Lines = append(h.Lines, diffparse.Line{Kind: diffparse.Add, New: i + 1, Text: s})
	}
	return []*diffparse.File{{Path: path, OldPath: path, Status: diffparse.Modified, Hunks: []diffparse.Hunk{h}}}
}

func TestPlace(t *testing.T) {
	th := &Thread{ID: "c1", File: "a.go", Side: SideNew, StartLine: 5, EndLine: 6, SelectedText: "x\ny",
		Comments: []*Comment{{ID: "c1", Author: User, Rev: 1}}}
	st := &State{Rev: 2, Threads: []*Thread{th}}

	// 2 matches: the match nearest to line 5 wins.
	st.Place(fileWith("a.go", "x", "y", "-", "-", "-", "x", "y"))
	if th.Outdated || th.StartLine != 6 || th.EndLine != 7 {
		t.Fatalf("after move: %+v", th)
	}

	// No match: outdated, collapsed, position kept.
	st.Rev = 3
	st.Place(fileWith("a.go", "x", "z"))
	if !th.Outdated || th.OutdatedRev != 3 || th.StartLine != 6 || th.OpenByDefault() {
		t.Fatalf("after outdated: %+v", th)
	}

	// An agent reply after the refresh opens the outdated thread.
	th.Comments = append(th.Comments, &Comment{ID: "c2", Author: Agent, Rev: 3})
	if !th.OpenByDefault() {
		t.Fatal("outdated thread with a newer reply must be open")
	}

	// The text returns: current again.
	st.Rev = 4
	st.Place(fileWith("a.go", "x", "y"))
	if th.Outdated || th.StartLine != 1 {
		t.Fatalf("after return: %+v", th)
	}

	// The file leaves the diff: outdated.
	st.Place(fileWith("b.go", "x", "y"))
	if !th.Outdated {
		t.Fatal("thread must be outdated when its file leaves the diff")
	}
}
