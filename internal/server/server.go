// Package server is the HTTP server of one review session. It serves the viewer and the CLI.
package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"reviewit/internal/diffparse"
	"reviewit/internal/highlight"
	"reviewit/internal/store"
	"reviewit/internal/web"
)

// NotListeningDelay is how long no wait must be active before the viewer shows "not listening".
const NotListeningDelay = 30 * time.Second

// Agent status values sent to the viewer.
const (
	StatusWorking   = "working"
	StatusListening = "listening"
	StatusIdle      = "idle"
)

// WaitResult is the answer of /cli/wait.
type WaitResult struct {
	Events     []store.Event `json:"events,omitempty"`
	Threads    []OutThread   `json:"threads,omitempty"`
	Message    string        `json:"message,omitempty"`     // "replaced": a newer wait started
	ReplacedBy string        `json:"replaced_by,omitempty"` // the session was replaced
}

type waiter struct{ ch chan WaitResult }

// Server serves 1 review session.
type Server struct {
	Token string
	Port  int

	mu         sync.Mutex
	st         *store.State
	files      []*diffparse.File
	clients    map[chan struct{}]struct{}
	waiter     *waiter
	working    bool
	waiterGone time.Time
	stopped    chan string // receives the id of the replacing session, or ""
	stopOnce   sync.Once
	httpServer *http.Server
	listener   net.Listener
	OpenURL    func(url string) // opens the browser
}

// New creates a server for a loaded state and its diff.
func New(st *store.State, files []*diffparse.File, token string) *Server {
	highlight.Files(files)
	return &Server{
		Token:      token,
		st:         st,
		files:      files,
		clients:    map[chan struct{}]struct{}{},
		waiterGone: time.Now(),
		stopped:    make(chan string, 1),
		OpenURL:    func(string) {},
	}
}

// Listen opens a listener on 127.0.0.1. It tries the given port first, then any free port.
func (s *Server) Listen(port int) error {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil && port != 0 {
		l, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		return err
	}
	s.listener = l
	s.Port = l.Addr().(*net.TCPAddr).Port
	return nil
}

// URL is the address of the viewer, with the token.
func (s *Server) URL() string {
	return fmt.Sprintf("http://127.0.0.1:%d/?t=%s", s.Port, s.Token)
}

// Serve serves until Stop is called. It returns the id of the replacing session, or "".
func (s *Server) Serve() string {
	s.httpServer = &http.Server{Handler: s.Handler()}
	go s.httpServer.Serve(s.listener)
	return <-s.stopped
}

// Stop stops the server. replacedBy is the id of the new session, or "".
func (s *Server) Stop(replacedBy string) {
	s.stopOnce.Do(func() {
		s.mu.Lock()
		if s.waiter != nil {
			if replacedBy != "" {
				s.waiter.ch <- WaitResult{ReplacedBy: replacedBy}
			}
			s.waiter = nil
		}
		s.mu.Unlock()
		go func() {
			// Give a waiting CLI call time to get its answer.
			time.Sleep(200 * time.Millisecond)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if s.httpServer != nil {
				s.httpServer.Shutdown(ctx)
			}
			s.stopped <- replacedBy
		}()
	})
}

// Handler returns the HTTP handler with the token check.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /api/state", s.handleViewState)
	mux.HandleFunc("GET /api/events", s.handleSSE)
	mux.HandleFunc("POST /api/comments", s.handleCreateComment)
	mux.HandleFunc("POST /api/comments/{id}/edit", s.handleEditComment)
	mux.HandleFunc("POST /api/comments/{id}/delete", s.handleDeleteComment)
	mux.HandleFunc("POST /api/threads/{id}/resolve", s.handleResolve)
	mux.HandleFunc("POST /api/send", s.handleSend)
	mux.HandleFunc("GET /cli/ping", s.handlePing)
	mux.HandleFunc("GET /cli/state", s.handleCLIState)
	mux.HandleFunc("POST /cli/wait", s.handleWait)
	mux.HandleFunc("POST /cli/reply", s.handleReply)
	mux.HandleFunc("POST /cli/refresh", s.handleRefresh)
	mux.HandleFunc("POST /cli/show", s.handleShow)
	mux.HandleFunc("POST /cli/stop", s.handleStop)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Reviewit-Session", s.st.ID)
		tok := r.Header.Get("X-Reviewit-Token")
		if tok == "" {
			tok = r.URL.Query().Get("t")
		}
		if subtle.ConstantTimeCompare([]byte(tok), []byte(s.Token)) != 1 {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// ---------- viewer ----------

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(web.Page())
}

// ViewThread is a thread as the viewer gets it.
type ViewThread struct {
	*store.Thread
	OpenDefault bool `json:"open_default"`
}

func (s *Server) handleViewState(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	threads := make([]ViewThread, len(s.st.Threads))
	for i, t := range s.st.Threads {
		threads[i] = ViewThread{Thread: t, OpenDefault: t.OpenByDefault()}
	}
	writeJSON(w, map[string]any{
		"id":          s.st.ID,
		"title":       s.st.Title,
		"description": s.st.Description,
		"source":      s.st.Source,
		"rev":         s.st.Rev,
		"files":       s.files,
		"threads":     threads,
		"pending":     s.st.PendingCount(),
		"agent":       s.agentStatusLocked(),
	})
}

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	ch := make(chan struct{}, 1)
	s.mu.Lock()
	s.clients[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.clients, ch)
		s.mu.Unlock()
	}()
	fmt.Fprint(w, "retry: 1000\nevent: update\ndata: {}\n\n")
	flusher.Flush()
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ch:
			fmt.Fprint(w, "event: update\ndata: {}\n\n")
			flusher.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

type createReq struct {
	ThreadID  string `json:"thread_id"`
	File      string `json:"file"`
	Side      string `json:"side"`
	StartLine int    `json:"start_line"`
	EndLine   int    `json:"end_line"`
	Body      string `json:"body"`
	Action    string `json:"action"` // "ask" or "save"
}

func (s *Server) handleCreateComment(w http.ResponseWriter, r *http.Request) {
	var req createReq
	if !readJSON(w, r, &req) {
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		http.Error(w, "the comment is empty", http.StatusBadRequest)
		return
	}
	if req.Action != "ask" && req.Action != "save" {
		http.Error(w, "action must be ask or save", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c := &store.Comment{Author: store.User, Body: req.Body, State: store.Pending, Rev: s.st.Rev, Created: time.Now()}
	var t *store.Thread
	if req.ThreadID != "" {
		t = s.st.Thread(req.ThreadID)
		if t == nil {
			http.Error(w, "unknown thread", http.StatusNotFound)
			return
		}
		if t.Resolved {
			http.Error(w, "the thread is resolved", http.StatusBadRequest)
			return
		}
		c.ID = s.st.NextCommentID()
		t.Comments = append(t.Comments, c)
	} else {
		var err error
		t, err = s.newThreadLocked(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		c.ID = t.ID
		t.Comments = []*store.Comment{c}
		s.st.Threads = append(s.st.Threads, t)
	}
	if req.Action == "ask" {
		// Ask now also sends the pending comments of the same thread.
		var ids []string
		for _, tc := range t.Comments {
			if tc.Author == store.User && tc.State == store.Pending {
				tc.State = store.Sent
				ids = append(ids, tc.ID)
			}
		}
		s.enqueueLocked(store.Event{Type: "ask_now", Comments: ids})
	}
	if !s.saveLocked(w) {
		return
	}
	s.broadcastLocked()
	writeJSON(w, map[string]string{"id": c.ID, "thread_id": t.ID})
}

func (s *Server) newThreadLocked(req createReq) (*store.Thread, error) {
	f := store.FindFile(s.files, req.File)
	if f == nil {
		return nil, errors.New("unknown file")
	}
	t := &store.Thread{ID: s.st.NextCommentID(), File: f.Path, Side: req.Side}
	switch req.Side {
	case store.SideFile:
	case store.SideOld, store.SideNew:
		if req.StartLine > req.EndLine {
			req.StartLine, req.EndLine = req.EndLine, req.StartLine
		}
		lines := store.LinesInRange(f, req.Side, req.StartLine, req.EndLine)
		if len(lines) == 0 {
			return nil, errors.New("no lines in the selection")
		}
		t.StartLine, t.EndLine = lines[0].Num, lines[len(lines)-1].Num
		t.Original = lines
		// The selected text uses only consecutive lines from the start, so that placement can find it.
		end := 1
		for end < len(lines) && lines[end].Num == lines[end-1].Num+1 {
			end++
		}
		t.EndLine = lines[end-1].Num
		t.Original = lines[:end]
		t.SelectedText = store.JoinText(lines[:end])
	default:
		return nil, errors.New("side must be old, new or file")
	}
	return t, nil
}

func (s *Server) handleEditComment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Body string `json:"body"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		http.Error(w, "the comment is empty", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, c := s.st.Comment(r.PathValue("id"))
	if c == nil || c.Author != store.User || c.State != store.Pending {
		http.Error(w, "only a pending comment can be edited", http.StatusBadRequest)
		return
	}
	c.Body = req.Body
	if !s.saveLocked(w) {
		return
	}
	s.broadcastLocked()
	writeJSON(w, map[string]string{"id": c.ID})
}

func (s *Server) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := r.PathValue("id")
	t, c := s.st.Comment(id)
	if c == nil || c.Author != store.User || c.State != store.Pending {
		http.Error(w, "only a pending comment can be deleted", http.StatusBadRequest)
		return
	}
	if t.ID == id {
		// Deleting the root comment deletes the thread.
		for i, x := range s.st.Threads {
			if x == t {
				s.st.Threads = append(s.st.Threads[:i], s.st.Threads[i+1:]...)
				break
			}
		}
	} else {
		for i, x := range t.Comments {
			if x == c {
				t.Comments = append(t.Comments[:i], t.Comments[i+1:]...)
				break
			}
		}
	}
	if !s.saveLocked(w) {
		return
	}
	s.broadcastLocked()
	writeJSON(w, map[string]string{"id": id})
}

func (s *Server) handleResolve(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Resolved bool `json:"resolved"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.st.Thread(r.PathValue("id"))
	if t == nil {
		http.Error(w, "unknown thread", http.StatusNotFound)
		return
	}
	t.Resolved = req.Resolved
	if !s.saveLocked(w) {
		return
	}
	s.broadcastLocked()
	writeJSON(w, map[string]string{"id": t.ID})
}

func (s *Server) handleSend(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var ids []string
	for _, t := range s.st.Threads {
		for _, c := range t.Comments {
			if c.Author == store.User && c.State == store.Pending {
				c.State = store.Sent
				ids = append(ids, c.ID)
			}
		}
	}
	if len(ids) == 0 {
		http.Error(w, "there are no pending comments", http.StatusBadRequest)
		return
	}
	s.enqueueLocked(store.Event{Type: "send", Comments: ids})
	if !s.saveLocked(w) {
		return
	}
	s.broadcastLocked()
	writeJSON(w, map[string]int{"sent": len(ids)})
}

// ---------- CLI ----------

func (s *Server) handlePing(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"id": s.st.ID})
}

// OutComment and OutThread are the JSON shapes of specification section 7.1.
type OutComment struct {
	ID     string `json:"id"`
	Author string `json:"author"`
	Body   string `json:"body"`
	State  string `json:"state,omitempty"`
}

// OutThread is a thread in the output of wait and state.
type OutThread struct {
	ID           string       `json:"id"`
	File         string       `json:"file"`
	Side         string       `json:"side"`
	StartLine    *int         `json:"start_line"`
	EndLine      *int         `json:"end_line"`
	SelectedText *string      `json:"selected_text"`
	Outdated     bool         `json:"outdated"`
	Resolved     bool         `json:"resolved"`
	Comments     []OutComment `json:"comments"`
}

func outThread(t *store.Thread) OutThread {
	o := OutThread{ID: t.ID, File: t.File, Side: t.Side, Outdated: t.Outdated, Resolved: t.Resolved, Comments: []OutComment{}}
	if t.Side != store.SideFile {
		start, end, text := t.StartLine, t.EndLine, t.SelectedText
		o.StartLine, o.EndLine, o.SelectedText = &start, &end, &text
	}
	for _, c := range t.Comments {
		o.Comments = append(o.Comments, OutComment{ID: c.ID, Author: c.Author, Body: c.Body, State: c.State})
	}
	return o
}

func (s *Server) handleCLIState(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	threads := []OutThread{}
	for _, t := range s.st.Threads {
		threads = append(threads, outThread(t))
	}
	writeJSON(w, map[string]any{
		"id":          s.st.ID,
		"title":       s.st.Title,
		"description": s.st.Description,
		"source":      s.st.Source,
		"window_open": len(s.clients) > 0,
		"threads":     threads,
		"unhandled":   s.st.Unhandled(),
	})
}

func (s *Server) handleWait(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	if s.waiter != nil {
		s.waiter.ch <- WaitResult{Message: "replaced"}
	}
	me := &waiter{ch: make(chan WaitResult, 1)}
	s.waiter = me
	s.working = false
	if len(s.st.Queue) > 0 {
		res := s.takeQueueLocked()
		if err := store.Save(s.st); err != nil {
			s.mu.Unlock()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		s.broadcastLocked()
		s.mu.Unlock()
		writeJSON(w, res)
		return
	}
	s.broadcastLocked()
	s.mu.Unlock()

	select {
	case res := <-me.ch:
		writeJSON(w, res)
	case <-r.Context().Done():
		s.mu.Lock()
		if s.waiter == me {
			s.waiter = nil
			s.waiterGone = time.Now()
			s.scheduleStatusLocked()
			s.broadcastLocked()
		}
		s.mu.Unlock()
	}
}

// takeQueueLocked removes all events from the queue and marks their comments as printed.
// The caller must clear s.waiter or answer it.
func (s *Server) takeQueueLocked() WaitResult {
	res := WaitResult{Events: s.st.Queue, Threads: []OutThread{}}
	seen := map[string]bool{}
	for _, e := range s.st.Queue {
		for _, id := range e.Comments {
			t, c := s.st.Comment(id)
			if c == nil {
				continue
			}
			c.Printed = true
			if !seen[t.ID] {
				seen[t.ID] = true
				res.Threads = append(res.Threads, outThread(t))
			}
		}
	}
	s.st.Queue = nil
	s.waiter = nil
	s.working = true
	return res
}

// enqueueLocked adds an event. If a wait is active, the wait gets the queue at once.
func (s *Server) enqueueLocked(e store.Event) {
	s.st.Queue = append(s.st.Queue, e)
	if s.waiter != nil {
		w := s.waiter
		w.ch <- s.takeQueueLocked()
	}
}

func (s *Server) handleReply(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ThreadID string `json:"thread_id"`
		Body     string `json:"body"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		http.Error(w, "the reply is empty", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.st.Thread(req.ThreadID)
	if t == nil {
		http.Error(w, fmt.Sprintf("unknown thread %q; use the id of the root comment", req.ThreadID), http.StatusNotFound)
		return
	}
	c := &store.Comment{ID: s.st.NextCommentID(), Author: store.Agent, Body: req.Body, Rev: s.st.Rev, Created: time.Now()}
	t.Comments = append(t.Comments, c)
	for _, x := range t.Comments {
		if x.Author == store.User && x.State == store.Sent {
			x.State = store.Answered
		}
	}
	if !s.saveLocked(w) {
		return
	}
	s.broadcastLocked()
	writeJSON(w, map[string]string{"id": c.ID})
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Diff        string  `json:"diff"`
		Title       *string `json:"title"`
		Description *string `json:"description"`
		Source      *string `json:"source"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	files, err := diffparse.Parse(req.Diff)
	if err != nil {
		http.Error(w, "the diff is not valid: "+err.Error(), http.StatusBadRequest)
		return
	}
	highlight.Files(files)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := store.WriteDiff(s.st.ID, req.Diff); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.files = files
	if req.Title != nil {
		s.st.Title = *req.Title
	}
	if req.Description != nil {
		s.st.Description = *req.Description
	}
	if req.Source != nil {
		s.st.Source = *req.Source
	}
	s.st.Rev++
	s.st.Place(files)
	if !s.saveLocked(w) {
		return
	}
	s.broadcastLocked()
	outdated := 0
	for _, t := range s.st.Threads {
		if t.Outdated {
			outdated++
		}
	}
	writeJSON(w, map[string]int{"files": len(files), "threads": len(s.st.Threads), "outdated": outdated})
}

// OpenIfNoViewer opens the browser after the delay, unless a viewer tab connected in that time.
func (s *Server) OpenIfNoViewer(delay time.Duration) {
	time.AfterFunc(delay, func() {
		s.mu.Lock()
		open := len(s.clients) > 0
		s.mu.Unlock()
		if !open {
			s.OpenURL(s.URL())
		}
	})
}

func (s *Server) handleShow(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	open := len(s.clients) > 0
	s.mu.Unlock()
	if !open {
		s.OpenURL(s.URL())
	}
	writeJSON(w, map[string]bool{"opened": !open})
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ReplacedBy string `json:"replaced_by"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	writeJSON(w, map[string]bool{"stopping": true})
	s.Stop(req.ReplacedBy)
}

// ---------- status ----------

func (s *Server) agentStatusLocked() string {
	switch {
	case s.working:
		return StatusWorking
	case s.waiter != nil:
		return StatusListening
	case time.Since(s.waiterGone) < NotListeningDelay:
		return StatusListening
	default:
		return StatusIdle
	}
}

// scheduleStatusLocked updates the viewers when the "not listening" delay ends.
func (s *Server) scheduleStatusLocked() {
	time.AfterFunc(NotListeningDelay+100*time.Millisecond, func() {
		s.mu.Lock()
		s.broadcastLocked()
		s.mu.Unlock()
	})
}

// StartStatusTimer must run once after the start, so that "not listening" appears without a wait.
func (s *Server) StartStatusTimer() {
	s.mu.Lock()
	s.waiterGone = time.Now()
	s.scheduleStatusLocked()
	s.mu.Unlock()
}

func (s *Server) broadcastLocked() {
	for ch := range s.clients {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (s *Server) saveLocked(w http.ResponseWriter) bool {
	if err := store.Save(s.st); err != nil {
		http.Error(w, "could not save the state: "+err.Error(), http.StatusInternalServerError)
		return false
	}
	return true
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
