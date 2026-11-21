package store

import (
	"os"
	"path/filepath"
	"testing"
)

// A session lives in the folder that open --dir gives; the root folder keeps only a pointer to it.
// Cleanup removes an old session with its pointer, and a pointer whose folder is already gone.
func TestCreateAndCleanup(t *testing.T) {
	root := t.TempDir()
	t.Setenv("REVIEWIT_HOME", root)
	base := t.TempDir()

	dir, err := Create("aaaa1111", base)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := Dir("aaaa1111"); got != dir || filepath.Dir(dir) != base {
		t.Fatalf("Dir = %s, want %s in %s", got, dir, base)
	}
	if err := Save(&State{ID: "aaaa1111"}); err != nil {
		t.Fatal(err)
	}
	if !Exists("aaaa1111") {
		t.Fatal("the session must exist")
	}
	gone, _ := Create("bbbb2222", base)
	os.RemoveAll(gone)

	Cleanup(0)
	for _, p := range []string{dir, filepath.Join(root, "aaaa1111.path"), filepath.Join(root, "bbbb2222.path")} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("%s must be removed", p)
		}
	}
	if _, err := Dir("../x"); err == nil {
		t.Fatal("an id with a path must be rejected")
	}
}
