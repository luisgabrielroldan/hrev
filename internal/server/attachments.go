package server

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	"github.com/luisgabrielroldan/hrev/internal/store"
)

// MaxAttachment is the largest image that the viewer can attach to a comment.
const MaxAttachment = 10 << 20

// Pasted images are stored in <session>/attachments/<random hex>.<ext>. A comment refers to an image with the
// Markdown text ![image](attachments/<name>).
var (
	attachmentName = regexp.MustCompile(`^[0-9a-f]{16}\.(png|jpg|gif|webp)$`)
	attachmentRef  = regexp.MustCompile(`attachments/([0-9a-f]{16}\.(?:png|jpg|gif|webp))`)
	imageTypes     = map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
	imageExts      = map[string]string{"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
)

func attachmentDir(id string) (string, error) {
	dir, err := store.Dir(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "attachments"), nil
}

// handleUpload stores 1 image from the request body. The Content-Type header gives the image type.
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	ext, ok := imageTypes[r.Header.Get("Content-Type")]
	if !ok {
		http.Error(w, "only PNG, JPEG, GIF and WebP images can be attached", http.StatusUnsupportedMediaType)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxAttachment))
	if err != nil {
		http.Error(w, "the image is larger than 10 MB", http.StatusRequestEntityTooLarge)
		return
	}
	if len(data) == 0 {
		http.Error(w, "the image is empty", http.StatusBadRequest)
		return
	}
	dir, err := attachmentDir(s.st.ID)
	if err == nil {
		err = os.MkdirAll(dir, 0o700)
	}
	name := store.RandomHex(8) + "." + ext
	if err == nil {
		err = os.WriteFile(filepath.Join(dir, name), data, 0o600)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"name": name, "markdown": "![image](attachments/" + name + ")"})
}

func (s *Server) handleAttachment(w http.ResponseWriter, r *http.Request) {
	m := attachmentName.FindStringSubmatch(r.PathValue("name"))
	dir, err := attachmentDir(s.st.ID)
	if m == nil || err != nil {
		http.NotFound(w, r)
		return
	}
	data, err := os.ReadFile(filepath.Join(dir, m[0]))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", imageExts[m[1]])
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Write(data)
}

// imagePaths returns the local paths of the stored images that a comment body refers to, for the agent.
func imagePaths(id, body string) []string {
	dir, err := attachmentDir(id)
	if err != nil {
		return nil
	}
	var out []string
	for _, m := range attachmentRef.FindAllStringSubmatch(body, -1) {
		p := filepath.Join(dir, m[1])
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}
