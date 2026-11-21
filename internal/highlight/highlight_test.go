package highlight

import (
	"strings"
	"testing"

	"hrev/internal/diffparse"
)

// A comment that spans lines keeps its color on every line, each side uses its own text,
// and a file with an unknown language stays plain.
func TestFiles(t *testing.T) {
	diff := `diff --git a/a.go b/a.go
--- a/a.go
+++ b/a.go
@@ -1,4 +1,4 @@
 /* start
-old <b>
+new <b>
 end */
 func x() {}
diff --git a/notes.unknownext b/notes.unknownext
--- a/notes.unknownext
+++ b/notes.unknownext
@@ -1 +1 @@
-a
+b
`
	files, err := diffparse.Parse(diff)
	if err != nil {
		t.Fatal(err)
	}
	Files(files)
	l := files[0].Hunks[0].Lines
	for i := 0; i < 4; i++ {
		if !strings.HasPrefix(l[i].HTML, `<span class="hl-c">`) {
			t.Fatalf("line %d is not a comment: %q", i, l[i].HTML)
		}
	}
	if !strings.Contains(l[1].HTML, "old &lt;b&gt;") || !strings.Contains(l[2].HTML, "new &lt;b&gt;") {
		t.Fatalf("wrong side or no escaping: %q / %q", l[1].HTML, l[2].HTML)
	}
	if !strings.Contains(l[4].HTML, `<span class="hl-k">func</span>`) {
		t.Fatalf("keyword not colored: %q", l[4].HTML)
	}
	md, _ := diffparse.Parse("--- a/r.md\n+++ b/r.md\n@@ -0,0 +1,2 @@\n+## Title\n+A **bold** word\n")
	Files(md)
	ml := md[0].Hunks[0].Lines
	if ml[0].HTML != `<span class="hl-h">## Title</span>` || !strings.Contains(ml[1].HTML, `<span class="hl-st">**bold**</span>`) {
		t.Fatalf("markdown: %q / %q", ml[0].HTML, ml[1].HTML)
	}
	if h := files[1].Hunks[0].Lines[0].HTML; h != "" {
		t.Fatalf("unknown language got html: %q", h)
	}
}
