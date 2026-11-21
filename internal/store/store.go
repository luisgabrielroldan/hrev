// Package store holds the state of a review session and saves it in the session folder that "open --dir" gives.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
	Name    string    `json:"name,omitempty"` // a reviewer name, such as "codex", on a user-side comment from the CLI
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

// Root is the folder that holds the pointer file of each review session: <user cache folder>/hrev, for example
// ~/Library/Caches/hrev on macOS or ~/.cache/hrev on Linux. HREV_HOME overrides it.
func Root() (string, error) {
	if h := os.Getenv("HREV_HOME"); h != "" {
		return h, nil
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cache, "hrev"), nil
}

// Dir is the folder of one review session. The pointer file <root>/<id>.path holds that folder.
func Dir(id string) (string, error) {
	if id == "" || id == "." || id == ".." || strings.ContainsAny(id, `/\`) {
		return "", fmt.Errorf("%q is not a review session id", id)
	}
	root, err := Root()
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(filepath.Join(root, id+".path"))
	if err != nil {
		return "", fmt.Errorf("no review session with id %s", id)
	}
	return strings.TrimSpace(string(b)), nil
}

// Create makes the folder of a new review session in base, and records it in the root folder. The agent passes
// a folder that it can read without permission prompts, such as its scratchpad, so that it can open the images
// of a comment.
func Create(id, base string) (string, error) {
	if strings.HasPrefix(base, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, base[2:])
	}
	abs, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(abs, id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	root, err := Root()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", err
	}
	return dir, os.WriteFile(filepath.Join(root, id+".path"), []byte(dir+"\n"), 0o600)
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

// DiffTime is the modification time of the diff copy: the time of open or of the last refresh.
func DiffTime(id string) (time.Time, error) {
	dir, err := Dir(id)
	if err != nil {
		return time.Time{}, err
	}
	info, err := os.Stat(filepath.Join(dir, "diff.patch"))
	if err != nil {
		return time.Time{}, err
	}
	return info.ModTime(), nil
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
	if err := lockExclusive(f); err != nil {
		f.Close()
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
		if !strings.HasSuffix(e.Name(), ".path") {
			continue
		}
		pointer := filepath.Join(root, e.Name())
		b, err := os.ReadFile(pointer)
		if err != nil {
			continue
		}
		dir := strings.TrimSpace(string(b))
		if _, err := os.Stat(dir); err != nil {
			os.Remove(pointer) // the folder is gone, for example after a scratchpad cleanup
			continue
		}
		if time.Since(lastChange(dir)) < maxAge {
			continue
		}
		f, err := lockFile(filepath.Join(dir, "lock"))
		if err != nil {
			continue
		}
		// Windows cannot remove an open file. The other files go first, while the lock is held, and the lock file last.
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if e.Name() != "lock" {
				os.RemoveAll(filepath.Join(dir, e.Name()))
			}
		}
		f.Close()
		os.RemoveAll(dir)
		os.Remove(pointer)
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
