package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"hrev/internal/diffparse"
	"hrev/internal/store"
)

const testDiff = `diff --git a/a.go b/a.go
--- a/a.go
+++ b/a.go
@@ -1,2 +1,3 @@
 package a
+var x = 1
 var y = 2
`

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Setenv("HREV_HOME", t.TempDir())
	files, err := diffparse.Parse(testDiff)
	if err != nil {
		t.Fatal(err)
	}
	st := &store.State{ID: "s1", Rev: 1, Threads: []*store.Thread{}}
	if _, err := store.Create("s1", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	s := New(st, files, "tok")
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, ts
}

func post(t *testing.T, ts *httptest.Server, path string, body any, out any) int {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", ts.URL+path, bytes.NewReader(b))
	req.Header.Set("X-Hrev-Token", "tok")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

func comment(t *testing.T, ts *httptest.Server, body, action string) string {
	t.Helper()
	var res map[string]string
	code := post(t, ts, "/api/comments", map[string]any{"file": "a.go", "side": "new", "start_line": 2, "end_line": 2, "body": body, "action": action}, &res)
	if code != 200 {
		t.Fatalf("create comment: status %d", code)
	}
	return res["thread_id"]
}

// The full event cycle: queue between waits, delivery in bulk, replaced wait, reply, unhandled.
func TestEventCycle(t *testing.T) {
	s, ts := newTestServer(t)

	// A request without the token is rejected.
	resp, _ := http.Post(ts.URL+"/api/send", "application/json", nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("no token: status %d", resp.StatusCode)
	}

	// 2 events arrive while no wait is active: the next wait gets both at once.
	t1 := comment(t, ts, "first", "ask")
	comment(t, ts, "second", "save")
	post(t, ts, "/api/send", struct{}{}, nil)
	var res WaitResult
	post(t, ts, "/cli/wait", struct{}{}, &res)
	if len(res.Events) != 2 || res.Events[0].Type != "ask_now" || res.Events[1].Type != "send" || len(res.Threads) != 2 {
		t.Fatalf("wait result: %+v", res)
	}
	if got := s.st.Unhandled(); len(got) != 2 {
		t.Fatalf("unhandled = %v, want 2 comments", got)
	}

	// A newer wait replaces the older one; an event goes to the newer wait.
	first := make(chan WaitResult, 1)
	go func() { var r WaitResult; post(t, ts, "/cli/wait", struct{}{}, &r); first <- r }()
	waitFor(t, func() bool { s.mu.Lock(); defer s.mu.Unlock(); return s.waiter != nil })
	second := make(chan WaitResult, 1)
	go func() { var r WaitResult; post(t, ts, "/cli/wait", struct{}{}, &r); second <- r }()
	if r := <-first; r.Message != "replaced" {
		t.Fatalf("older wait: %+v", r)
	}
	comment(t, ts, "third", "ask")
	if r := <-second; len(r.Events) != 1 {
		t.Fatalf("newer wait: %+v", r)
	}

	// A reply answers the sent comments of its thread.
	post(t, ts, "/cli/reply", map[string]string{"thread_id": t1, "body": "done"}, nil)
	_, c := s.st.Comment(t1)
	if c.State != store.Answered {
		t.Fatalf("state after reply = %s", c.State)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met")
}

// When a new session replaces this one, an open viewer tab gets the new address.
func TestReplacedTabMoves(t *testing.T) {
	_, ts := newTestServer(t)
	resp, err := http.Get(ts.URL + "/api/events?t=tok")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	post(t, ts, "/cli/stop", map[string]string{"replaced_by": "s2", "url": "http://127.0.0.1:1/?t=ab"}, nil)
	b, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(b), "event: replaced\ndata: http://127.0.0.1:1/?t=ab\n") {
		t.Fatalf("stream: %q", b)
	}
}

// A pasted image is stored, served again to the viewer, and listed for the agent as a local file.
func TestAttachment(t *testing.T) {
	_, ts := newTestServer(t)
	png := []byte("\x89PNG\r\n\x1a\nfake")
	req, _ := http.NewRequest("POST", ts.URL+"/api/attachments", bytes.NewReader(png))
	req.Header.Set("X-Hrev-Token", "tok")
	req.Header.Set("Content-Type", "image/png")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var up map[string]string
	json.NewDecoder(resp.Body).Decode(&up)
	resp.Body.Close()
	if resp.StatusCode != 200 || up["markdown"] != "![image](attachments/"+up["name"]+")" {
		t.Fatalf("upload: %d %v", resp.StatusCode, up)
	}
	resp, _ = http.Get(ts.URL + "/api/attachments/" + up["name"] + "?t=tok")
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Equal(b, png) || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("download: %d %q", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	comment(t, ts, "See "+up["markdown"], "ask")
	var res WaitResult
	post(t, ts, "/cli/wait", struct{}{}, &res)
	imgs := res.Threads[0].Comments[0].Images
	if len(imgs) != 1 || !strings.HasSuffix(imgs[0], "/attachments/"+up["name"]) {
		t.Fatalf("images for the agent: %v", imgs)
	}
	if _, err := os.Stat(imgs[0]); err != nil {
		t.Fatal(err)
	}
}

// The viewer state carries the time of the last diff update, so the viewer can show how old the diff is.
func TestDiffTime(t *testing.T) {
	_, ts := newTestServer(t)
	if err := store.WriteDiff("s1", testDiff); err != nil {
		t.Fatal(err)
	}
	resp, err := http.Get(ts.URL + "/api/state?t=tok")
	if err != nil {
		t.Fatal(err)
	}
	var st struct {
		DiffTime string `json:"diff_time"`
	}
	json.NewDecoder(resp.Body).Decode(&st)
	resp.Body.Close()
	if d, err := time.Parse(time.RFC3339, st.DiffTime); err != nil || time.Since(d) > time.Minute {
		t.Fatalf("diff_time = %q", st.DiffTime)
	}
}

// A comment from another reviewer is a user comment with a name; wait and state show the name.
func TestReviewerName(t *testing.T) {
	s, ts := newTestServer(t)
	req := map[string]any{"file": "a.go", "side": "file", "body": "x", "action": "save", "name": " codex "}
	if code := post(t, ts, "/api/comments", req, nil); code != 200 {
		t.Fatalf("create comment: status %d", code)
	}
	if got := outThread("s1", s.st.Threads[0]).Comments[0]; got.Author != store.User || got.Name != "codex" || s.st.PendingCount() != 1 {
		t.Fatalf("comment = %+v, pending %d; want a pending user comment named codex", got, s.st.PendingCount())
	}
	// The limit counts characters, not bytes: "日" has 3 bytes.
	req["name"] = strings.Repeat("日", MaxNameLen)
	if code := post(t, ts, "/api/comments", req, nil); code != 200 {
		t.Fatalf("a name of %d characters: status %d, want 200", MaxNameLen, code)
	}
	req["name"] = strings.Repeat("日", MaxNameLen+1)
	if code := post(t, ts, "/api/comments", req, nil); code != http.StatusBadRequest {
		t.Fatalf("a long name: status %d, want 400", code)
	}
}
