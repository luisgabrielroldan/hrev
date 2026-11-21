// Command reviewit opens a local review of a diff in the browser, for a review together with Claude Code.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"reviewit/internal/diffparse"
	"reviewit/internal/server"
	"reviewit/internal/skill"
	"reviewit/internal/store"
)

const usage = `reviewit: review a diff in the browser, together with an agent.

Usage:
  reviewit open <file.diff> --dir <folder> [--title T] [--description D] [--source CMD] [--replace ID [--force]]
  reviewit open --resume <id>
  reviewit refresh <id> <file.diff> [--title T] [--description D] [--source CMD]
  reviewit show <id>
  reviewit wait <id>
  reviewit state <id>
  reviewit reply <id> <thread-id> [<text>]     (without <text>, the text comes from stdin)
  reviewit skill                               (prints the agent instructions)
  reviewit skill install <dir> [--force]       (writes a stub skill to <dir>/reviewit)

"open" keeps running: it is the server of the review session. Run it in the background.
"--dir" is the folder for the session data, such as the agent scratchpad (not the project).
"wait" prints all queued events as JSON and exits.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	cmd, rest := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "open":
		err = cmdOpen(rest)
	case "refresh":
		err = cmdRefresh(rest)
	case "show":
		err = cmdShow(rest)
	case "wait":
		err = cmdWait(rest)
	case "state":
		err = cmdState(rest)
	case "reply":
		err = cmdReply(rest)
	case "skill":
		err = cmdSkill(rest)
	case "help", "-h", "--help":
		fmt.Print(usage)
	default:
		err = fmt.Errorf("unknown command %q\n\n%s", cmd, usage)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "reviewit:", err)
		os.Exit(1)
	}
}

// ---------- arguments ----------

type args struct {
	pos   []string
	flags map[string]string
	bools map[string]bool
}

// parseArgs accepts flags before and after positional arguments.
func parseArgs(argv []string, valueFlags, boolFlags []string) (args, error) {
	a := args{flags: map[string]string{}, bools: map[string]bool{}}
	isValue := map[string]bool{}
	for _, f := range valueFlags {
		isValue[f] = true
	}
	isBool := map[string]bool{}
	for _, f := range boolFlags {
		isBool[f] = true
	}
	for i := 0; i < len(argv); i++ {
		s := argv[i]
		if s == "--" {
			a.pos = append(a.pos, argv[i+1:]...)
			break
		}
		if !strings.HasPrefix(s, "--") || s == "-" {
			a.pos = append(a.pos, s)
			continue
		}
		name, value, hasValue := strings.Cut(strings.TrimPrefix(s, "--"), "=")
		switch {
		case isBool[name]:
			a.bools[name] = true
		case isValue[name]:
			if !hasValue {
				if i+1 >= len(argv) {
					return a, fmt.Errorf("--%s needs a value", name)
				}
				i++
				value = argv[i]
			}
			a.flags[name] = value
		default:
			return a, fmt.Errorf("unknown option --%s", name)
		}
	}
	return a, nil
}

func (a args) ptr(name string) *string {
	if v, ok := a.flags[name]; ok {
		return &v
	}
	return nil
}

func needPos(a args, n int, form string) error {
	if len(a.pos) != n {
		return fmt.Errorf("usage: reviewit %s", form)
	}
	return nil
}

// ---------- open ----------

func cmdOpen(argv []string) error {
	a, err := parseArgs(argv, []string{"dir", "title", "description", "source", "replace", "resume"}, []string{"force"})
	if err != nil {
		return err
	}
	if id, ok := a.flags["resume"]; ok {
		if len(a.pos) != 0 {
			return errors.New("usage: reviewit open --resume <id>")
		}
		return resume(id)
	}
	if err := needPos(a, 1, "open <file.diff> --dir <folder> [--title T] [--description D] [--source CMD] [--replace ID [--force]]"); err != nil {
		return err
	}
	base := a.flags["dir"]
	if base == "" {
		return errors.New("open needs --dir <folder>: the folder for the session data, such as your scratchpad. Use a folder outside the project that you can read without permission prompts")
	}
	diffText, files, err := readDiff(a.pos[0])
	if err != nil {
		return err
	}
	replace := a.flags["replace"]
	if replace != "" && store.Exists(replace) {
		old, err := store.Load(replace)
		if err != nil {
			return fmt.Errorf("cannot read review session %s: %v", replace, err)
		}
		if n := old.CountUnsent(); n > 0 && !a.bools["force"] {
			return fmt.Errorf("review session %s has %d comment(s) that the agent did not handle (pending or sent); nothing was created. Tell the user. Use --force only when the user asks for the replacement in explicit words", replace, n)
		}
	}

	store.Cleanup(7 * 24 * time.Hour)
	id := store.NewID()
	if _, err := store.Create(id, base); err != nil {
		return err
	}
	lock, err := store.Lock(id)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := store.WriteDiff(id, diffText); err != nil {
		return err
	}
	st := &store.State{
		ID:          id,
		Title:       a.flags["title"],
		Description: a.flags["description"],
		Source:      a.flags["source"],
		Rev:         1,
		Threads:     []*store.Thread{},
		Created:     time.Now(),
	}
	if err := store.Save(st); err != nil {
		return err
	}
	return run(st, files, replace)
}

func resume(id string) error {
	if !store.Exists(id) {
		return fmt.Errorf("review session %s does not exist", id)
	}
	lock, err := store.Lock(id)
	if errors.Is(err, store.ErrLocked) {
		msg := fmt.Sprintf("review session %s is already running", id)
		if si, err := store.ReadServer(id); err == nil {
			msg += fmt.Sprintf(": http://127.0.0.1:%d/?t=%s", si.Port, si.Token)
		}
		return errors.New(msg)
	}
	if err != nil {
		return err
	}
	defer lock.Close()
	st, err := store.Load(id)
	if err != nil {
		return err
	}
	diffText, err := store.ReadDiff(id)
	if err != nil {
		return err
	}
	files, err := diffparse.Parse(diffText)
	if err != nil {
		return err
	}
	return run(st, files, "")
}

// run serves a review session until the server stops.
func run(st *store.State, files []*diffparse.File, replace string) error {
	resumed := st.Token != ""
	if !resumed {
		st.Token = store.RandomHex(16)
	}
	srv := server.New(st, files, st.Token)
	srv.OpenURL = openBrowser
	if err := srv.Listen(st.Port); err != nil {
		return err
	}
	st.Port = srv.Port
	if err := store.Save(st); err != nil {
		return err
	}
	if err := store.WriteServer(st.ID, &store.ServerInfo{Port: srv.Port, Token: srv.Token, PID: os.Getpid()}); err != nil {
		return err
	}
	if replace != "" {
		stopServer(replace, st.ID, srv.URL())
	}
	srv.StartStatusTimer()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		<-sig
		srv.Stop("")
	}()

	fmt.Printf("id: %s\nurl: %s\n", st.ID, srv.URL())
	if resumed || replace != "" {
		// After a resume, an open tab reconnects by itself to the same address. After a replace, the old
		// server sends its open tabs to the new address. Open a tab only when none arrives.
		srv.OpenIfNoViewer(4 * time.Second)
	} else {
		openBrowser(srv.URL())
	}
	replacedBy := srv.Serve()

	if dir, err := store.Dir(st.ID); err == nil {
		os.Remove(dir + "/server.json")
	}
	if replacedBy != "" {
		fmt.Printf("review session %s was replaced by %s; the server stopped\n", st.ID, replacedBy)
	} else {
		fmt.Println("the server stopped")
	}
	return nil
}

// stopServer asks the server of an old session to stop. Errors are ignored: the old server may not run.
func stopServer(oldID, newID, newURL string) {
	si, err := store.ReadServer(oldID)
	if err != nil {
		return
	}
	c := &client{id: oldID, si: si}
	c.do("POST", "/cli/stop", map[string]string{"replaced_by": newID, "url": newURL}, nil, 2*time.Second)
}

func readDiff(path string) (string, []*diffparse.File, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", nil, err
	}
	files, err := diffparse.Parse(string(b))
	if err != nil {
		return "", nil, fmt.Errorf("%s is not a valid diff: %v", path, err)
	}
	return string(b), files, nil
}

func openBrowser(url string) {
	if os.Getenv("REVIEWIT_NO_BROWSER") != "" {
		return
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err == nil {
		go cmd.Wait()
	}
}

// ---------- client commands ----------

type client struct {
	id string
	si *store.ServerInfo
}

func notRunning(id string) error {
	return fmt.Errorf("review session %s is not running; run: reviewit open --resume %s", id, id)
}

func connect(id string) (*client, error) {
	if !store.Exists(id) {
		return nil, fmt.Errorf("review session %s does not exist", id)
	}
	si, err := store.ReadServer(id)
	if err != nil {
		return nil, notRunning(id)
	}
	c := &client{id: id, si: si}
	if err := c.do("GET", "/cli/ping", nil, nil, 2*time.Second); err != nil {
		return nil, err
	}
	return c, nil
}

// do sends a request. A timeout of 0 means no timeout.
func (c *client) do(method, path string, body, out any, timeout time.Duration) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, fmt.Sprintf("http://127.0.0.1:%d%s", c.si.Port, path), rd)
	if err != nil {
		return err
	}
	req.Header.Set("X-Reviewit-Token", c.si.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return notRunning(c.id)
	}
	defer resp.Body.Close()
	if resp.Header.Get("X-Reviewit-Session") != c.id {
		return notRunning(c.id)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return notRunning(c.id)
	}
	if resp.StatusCode != http.StatusOK {
		return errors.New(strings.TrimSpace(string(data)))
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

func cmdRefresh(argv []string) error {
	a, err := parseArgs(argv, []string{"title", "description", "source"}, nil)
	if err != nil {
		return err
	}
	if err := needPos(a, 2, "refresh <id> <file.diff> [--title T] [--description D] [--source CMD]"); err != nil {
		return err
	}
	diffText, _, err := readDiff(a.pos[1])
	if err != nil {
		return err
	}
	c, err := connect(a.pos[0])
	if err != nil {
		return err
	}
	var res struct {
		Files    int `json:"files"`
		Threads  int `json:"threads"`
		Outdated int `json:"outdated"`
	}
	body := map[string]any{"diff": diffText, "title": a.ptr("title"), "description": a.ptr("description"), "source": a.ptr("source")}
	if err := c.do("POST", "/cli/refresh", body, &res, 30*time.Second); err != nil {
		return err
	}
	fmt.Printf("refreshed: %d files, %d threads, %d outdated\n", res.Files, res.Threads, res.Outdated)
	return nil
}

func cmdShow(argv []string) error {
	a, err := parseArgs(argv, nil, nil)
	if err != nil {
		return err
	}
	if err := needPos(a, 1, "show <id>"); err != nil {
		return err
	}
	c, err := connect(a.pos[0])
	if err != nil {
		return err
	}
	var res struct {
		Opened bool `json:"opened"`
	}
	if err := c.do("POST", "/cli/show", struct{}{}, &res, 5*time.Second); err != nil {
		return err
	}
	if res.Opened {
		fmt.Println("opened the window")
	} else {
		fmt.Println("the window is already open")
	}
	return nil
}

func cmdWait(argv []string) error {
	a, err := parseArgs(argv, nil, nil)
	if err != nil {
		return err
	}
	if err := needPos(a, 1, "wait <id>"); err != nil {
		return err
	}
	// The agent can start wait right after open or open --resume. Give the server a few seconds to start.
	c, err := connect(a.pos[0])
	for i := 0; err != nil && store.Exists(a.pos[0]) && i < 20; i++ {
		time.Sleep(250 * time.Millisecond)
		c, err = connect(a.pos[0])
	}
	if err != nil {
		return err
	}
	var res server.WaitResult
	if err := c.do("POST", "/cli/wait", struct{}{}, &res, 0); err != nil {
		return err
	}
	switch {
	case res.Message == "replaced":
		fmt.Println("replaced: a newer wait is active on this review session; do nothing")
	case res.ReplacedBy != "":
		fmt.Printf("review session %s was replaced by %s; use the new id\n", c.id, res.ReplacedBy)
	default:
		return printJSON(map[string]any{"events": res.Events, "threads": res.Threads})
	}
	return nil
}

func cmdState(argv []string) error {
	a, err := parseArgs(argv, nil, nil)
	if err != nil {
		return err
	}
	if err := needPos(a, 1, "state <id>"); err != nil {
		return err
	}
	c, err := connect(a.pos[0])
	if err != nil {
		return err
	}
	var res json.RawMessage
	if err := c.do("GET", "/cli/state", nil, &res, 10*time.Second); err != nil {
		return err
	}
	return printJSON(res)
}

func cmdReply(argv []string) error {
	a, err := parseArgs(argv, nil, nil)
	if err != nil {
		return err
	}
	if len(a.pos) != 2 && len(a.pos) != 3 {
		return errors.New("usage: reviewit reply <id> <thread-id> [<text>]")
	}
	text := ""
	if len(a.pos) == 3 {
		text = a.pos[2]
	} else {
		b, err := io.ReadAll(os.Stdin)
		if err != nil {
			return err
		}
		text = string(b)
	}
	if strings.TrimSpace(text) == "" {
		return errors.New("the reply is empty")
	}
	c, err := connect(a.pos[0])
	if err != nil {
		return err
	}
	var res struct {
		ID string `json:"id"`
	}
	if err := c.do("POST", "/cli/reply", map[string]string{"thread_id": a.pos[1], "body": text}, &res, 10*time.Second); err != nil {
		return err
	}
	fmt.Printf("replied: %s\n", res.ID)
	return nil
}

func cmdSkill(argv []string) error {
	a, err := parseArgs(argv, nil, []string{"force"})
	if err != nil {
		return err
	}
	if len(a.pos) == 0 {
		fmt.Print(skill.Instructions)
		return nil
	}
	if a.pos[0] != "install" || len(a.pos) != 2 {
		return errors.New("usage: reviewit skill | reviewit skill install <dir> [--force]")
	}
	target, err := skill.Install(a.pos[1], a.bools["force"])
	if err != nil {
		return err
	}
	fmt.Printf("installed the reviewit skill at %s\n", target)
	return nil
}

func printJSON(v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(b))
	return nil
}
