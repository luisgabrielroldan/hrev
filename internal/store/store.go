// Package store holds the state of a review session and saves it in ~/.reviewit/<id>/.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// Comment authors and user comment states.
const (
	User     = "user"
	Agent    = "agent"
	Pending  = "pending"
	Sent     = "sent"
	Answered = "answered"
)

// Thread sides.
const (
	SideOld  = "old"
	SideNew  = "new"
	SideFile = "file"
)

// CodeLine is a line of code saved with a thread, to show the original code.
type CodeLine struct {
	Kind string `json:"kind"`
	Num  int    `json:"num"`
	Text string `json:"text"`
}

// Comment is a user comment or an agent reply.
type Comment struct {
	ID      string    `json:"id"`
	Author  string    `json:"author"`
	Body    string    `json:"body"`
	State   string    `json:"state,omitempty"`   // user comments only
	Printed bool      `json:"printed,omitempty"` // wait printed the event of this comment
	Rev     int       `json:"rev"`               // diff revision when the comment was written
	Created time.Time `json:"created"`
}

// Thread is a root comment and its replies.
type Thread struct {
	ID           string     `json:"id"`
	File         string     `json:"file"`
	Side         string     `json:"side"`
	StartLine    int        `json:"start_line,omitempty"`
	EndLine      int        `json:"end_line,omitempty"`
	SelectedText string     `json:"selected_text,omitempty"`
	Original     []CodeLine `json:"original,omitempty"`
	Outdated     bool       `json:"outdated"`
	OutdatedRev  int        `json:"outdated_rev,omitempty"`
	Resolved     bool       `json:"resolved"`
	Comments     []*Comment `json:"comments"`
}

// Event is a message from the viewer to the agent.
type Event struct {
	Type     string   `json:"type"` // ask_now or send
	Comments []string `json:"comments"`
}

// State is the saved state of a review session.
type State struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Source      string    `json:"source"`
	Rev         int       `json:"rev"`
	NextID      int       `json:"next_id"`
	Threads     []*Thread `json:"threads"`
	Queue       []Event   `json:"queue"`
	Created     time.Time `json:"created"`
	// Port and Token are the last viewer address. A restarted server uses them again, so an open tab reconnects.
	Port  int    `json:"port,omitempty"`
	Token string `json:"token,omitempty"`
}

// ServerInfo is written to server.json while a server runs.
type ServerInfo struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
}

// Root is the folder that holds all review sessions. REVIEWIT_HOME overrides it.
func Root() (string, error) {
	if h := os.Getenv("REVIEWIT_HOME"); h != "" {
		return h, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".reviewit"), nil
}

// Dir is the folder of one review session.
func Dir(id string) (string, error) {
	root, err := Root()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, id), nil
}

// NewID returns a random id of 8 hex characters.
func NewID() string { return RandomHex(4) }

// RandomHex returns n random bytes as hex.
func RandomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// Exists reports whether the folder of a review session exists.
func Exists(id string) bool {
	dir, err := Dir(id)
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(dir, "state.json"))
	return err == nil
}

// Load reads the state of a review session.
func Load(id string) (*State, error) {
	dir, err := Dir(id)
	if err != nil {
		return nil, err
	}
	var st State
	if err := readJSON(filepath.Join(dir, "state.json"), &st); err != nil {
		return nil, err
	}
	return &st, nil
}

// Save writes the state of a review session atomically.
func Save(st *State) error {
	dir, err := Dir(st.ID)
	if err != nil {
		return err
	}
	return writeJSON(filepath.Join(dir, "state.json"), st, 0o600)
}

// ReadDiff reads the saved copy of the current diff.
func ReadDiff(id string) (string, error) {
	dir, err := Dir(id)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(filepath.Join(dir, "diff.patch"))
	return string(b), err
}

// WriteDiff saves a copy of the current diff.
func WriteDiff(id, diff string) error {
	dir, err := Dir(id)
	if err != nil {
		return err
	}
	return writeFile(filepath.Join(dir, "diff.patch"), []byte(diff), 0o600)
}

// ReadServer reads server.json.
func ReadServer(id string) (*ServerInfo, error) {
	dir, err := Dir(id)
	if err != nil {
		return nil, err
	}
	var si ServerInfo
	if err := readJSON(filepath.Join(dir, "server.json"), &si); err != nil {
		return nil, err
	}
	return &si, nil
}

// WriteServer writes server.json, readable only by the user.
func WriteServer(id string, si *ServerInfo) error {
	dir, err := Dir(id)
	if err != nil {
		return err
	}
	return writeJSON(filepath.Join(dir, "server.json"), si, 0o600)
}

// ErrLocked means that a server already runs for the review session.
var ErrLocked = errors.New("review session is locked by a running server")

// Lock takes the lock of a review session. The operating system releases it when the process ends.
func Lock(id string) (*os.File, error) {
	dir, err := Dir(id)
	if err != nil {
		return nil, err
	}
	return lockFile(filepath.Join(dir, "lock"))
}

func lockFile(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, ErrLocked
		}
		return nil, err
	}
	return f, nil
}

// Cleanup removes review sessions whose last file change is older than maxAge and whose lock is free.
func Cleanup(maxAge time.Duration) {
	root, err := Root()
	if err != nil {
		return
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(root, e.Name())
		if time.Since(lastChange(dir)) < maxAge {
			continue
		}
		f, err := lockFile(filepath.Join(dir, "lock"))
		if err != nil {
			continue
		}
		os.RemoveAll(dir)
		f.Close()
	}
}

func lastChange(dir string) time.Time {
	var last time.Time
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() == "lock" {
			continue
		}
		if info, err := e.Info(); err == nil && info.ModTime().After(last) {
			last = info.ModTime()
		}
	}
	if last.IsZero() {
		if info, err := os.Stat(dir); err == nil {
			last = info.ModTime()
		}
	}
	return last
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func writeJSON(path string, v any, mode os.FileMode) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeFile(path, b, mode)
}

func writeFile(path string, b []byte, mode os.FileMode) error {
	tmp := fmt.Sprintf("%s.tmp-%s", path, RandomHex(4))
	if err := os.WriteFile(tmp, b, mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
