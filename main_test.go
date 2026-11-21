package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

// The diffs of the watcher cycle: diff B adds 1 line at the top, so the thread on line 2 moves to line 3.
const cycleDiffA = `diff --git a/a.go b/a.go
--- a/a.go
+++ b/a.go
@@ -1,2 +1,3 @@
 package a
+var x = 1
 var y = 2
`

const cycleDiffB = `diff --git a/a.go b/a.go
--- a/a.go
+++ b/a.go
@@ -1,2 +1,4 @@
+// Package a is small.
 package a
+var x = 1
 var y = 2
`

// buildHrev builds the binary for the test. HREV_BIN names a binary to use instead, such as the coverage build of
// make coverage.
func buildHrev(t *testing.T) string {
	t.Helper()
	if bin := os.Getenv("HREV_BIN"); bin != "" {
		return bin
	}
	bin := filepath.Join(t.TempDir(), "hrev")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	return bin
}

// The watcher cycle works through the CLI: open, comment, send (by the user, in the viewer), wait, reply,
// refresh and state.
func TestWatcherCycleThroughCLI(t *testing.T) {
	bin := buildHrev(t)
	dir := t.TempDir()
	env := append(os.Environ(), "HREV_HOME="+t.TempDir(), "HREV_NO_BROWSER=1")
	write := func(name, text string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	run := func(args ...string) string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, bin, args...)
		cmd.Env = env
		cmd.Stdin = strings.NewReader("")
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("hrev %s: %v\n%s", strings.Join(args, " "), err, out)
		}
		return string(out)
	}

	open := exec.Command(bin, "open", write("a.diff", cycleDiffA), "--dir", filepath.Join(dir, "sessions"), "--title", "Cycle", "--source", "cat a.diff")
	open.Env = env
	stdout, err := open.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := open.Start(); err != nil {
		t.Fatal(err)
	}
	// SIGTERM, not a kill: the server then exits normally, and a coverage build writes its data. Windows has no
	// SIGTERM, so there the test kills the server.
	t.Cleanup(func() {
		if err := open.Process.Signal(syscall.SIGTERM); err != nil {
			open.Process.Kill()
		}
		open.Wait()
	})
	lines := bufio.NewScanner(stdout)
	head := map[string]string{}
	for len(head) < 2 && lines.Scan() {
		if k, v, ok := strings.Cut(lines.Text(), ": "); ok {
			head[k] = v
		}
	}
	if err := lines.Err(); err != nil {
		t.Fatal(err)
	}
	id, viewer := head["id"], head["url"]
	if id == "" || viewer == "" {
		t.Fatalf("open printed %v, want id and url", head)
	}

	if out := run("comment", id, "a.go", "--lines", "2", "Rename x."); !strings.Contains(out, "commented: c1 in thread c1 (pending)") {
		t.Fatalf("comment: %s", out)
	}
	u, _ := url.Parse(viewer)
	req, _ := http.NewRequest("POST", u.Scheme+"://"+u.Host+"/api/send", strings.NewReader("{}"))
	req.Header.Set("X-Hrev-Token", u.Query().Get("t"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("send: %v %v", err, resp)
	}
	resp.Body.Close()

	if out := run("wait", id); !strings.Contains(out, `"Rename x."`) || !strings.Contains(out, `"send"`) {
		t.Fatalf("wait did not print the sent comment:\n%s", out)
	}
	if out := run("reply", id, "c1", "Renamed."); !strings.Contains(out, "replied:") {
		t.Fatalf("reply: %s", out)
	}
	if out := run("refresh", id, write("b.diff", cycleDiffB)); !strings.Contains(out, "refreshed: 1 files, 1 threads, 0 outdated") {
		t.Fatalf("refresh: %s", out)
	}

	var st struct {
		Threads []struct {
			StartLine *int `json:"start_line"`
			Comments  []struct {
				Author string `json:"author"`
				Body   string `json:"body"`
			} `json:"comments"`
		} `json:"threads"`
	}
	if err := json.Unmarshal([]byte(run("state", id)), &st); err != nil {
		t.Fatal(err)
	}
	if len(st.Threads) != 1 || st.Threads[0].StartLine == nil || *st.Threads[0].StartLine != 3 {
		t.Fatalf("state threads = %+v, want 1 thread on line 3", st.Threads)
	}
	if c := st.Threads[0].Comments; len(c) != 2 || c[1].Author != "agent" || c[1].Body != "Renamed." {
		t.Fatalf("state comments = %+v, want the agent reply", c)
	}
}
