package diffparse

import (
	"encoding/json"
	"strings"
	"testing"
)

const sample = `diff --git a/src/a.go b/src/a.go
index 1111111..2222222 100644
--- a/src/a.go
+++ b/src/a.go
@@ -1,4 +1,4 @@
 package a
--- a removed line that looks like a header
+++ an added line that looks like a header

 func A() {}
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+one
+two
\ No newline at end of file
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old/name.go b/new/name.go
similarity index 90%
rename from old/name.go
rename to new/name.go
diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`

func TestParse(t *testing.T) {
	files, err := Parse(sample)
	if err != nil {
		t.Fatal(err)
	}
	type want struct {
		path, old, status string
		binary            bool
		adds, dels        int
	}
	wants := []want{
		{"src/a.go", "src/a.go", Modified, false, 1, 1},
		{"new.txt", "new.txt", Added, false, 2, 0},
		{"gone.txt", "gone.txt", Deleted, false, 0, 1},
		{"new/name.go", "old/name.go", Renamed, false, 0, 0},
		{"img.png", "img.png", Modified, true, 0, 0},
	}
	if len(files) != len(wants) {
		t.Fatalf("got %d files, want %d", len(files), len(wants))
	}
	for i, w := range wants {
		f := files[i]
		if f.Path != w.path || f.OldPath != w.old || f.Status != w.status || f.Binary != w.binary || f.Adds != w.adds || f.Dels != w.dels {
			t.Errorf("file %d = %+v, want %+v", i, *f, w)
		}
	}
	// A file without changed lines, such as a pure rename, has an empty hunk list in JSON, not null.
	if b, _ := json.Marshal(files[3]); !strings.Contains(string(b), `"hunks":[]`) {
		t.Errorf("rename JSON = %s, want \"hunks\":[]", b)
	}
	// Line numbers: the empty context line counts on both sides.
	lines := files[0].Hunks[0].Lines
	last := lines[len(lines)-1]
	if last.Kind != Ctx || last.Old != 4 || last.New != 4 || last.Text != "func A() {}" {
		t.Errorf("last line = %+v", last)
	}
}
