package skill

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestInstall(t *testing.T) {
	dir := t.TempDir()

	// New install.
	target, err := Install(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	// An existing stub needs --force.
	if _, err := Install(dir, false); !errors.Is(err, ErrExists) {
		t.Fatalf("second install without force: %v", err)
	}
	// --force replaces the folder content.
	os.WriteFile(filepath.Join(target, "old.txt"), []byte("x"), 0o644)
	if _, err := Install(dir, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(target, "old.txt")); !os.IsNotExist(err) {
		t.Fatal("--force must remove the old files")
	}
	// A folder without the marker is never replaced, also with --force.
	other := t.TempDir()
	os.MkdirAll(filepath.Join(other, Name), 0o755)
	os.WriteFile(filepath.Join(other, Name, "SKILL.md"), []byte("someone else"), 0o644)
	if _, err := Install(other, true); err == nil {
		t.Fatal("a folder without the marker must not be replaced")
	}
	if b, _ := os.ReadFile(filepath.Join(other, Name, "SKILL.md")); string(b) != "someone else" {
		t.Fatal("the foreign SKILL.md changed")
	}
}
