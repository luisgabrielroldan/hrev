// Package web holds the viewer. The viewer source is the TypeScript app in ui/. Its build writes 1 HTML file
// with inline CSS and JavaScript to dist/index.html, and this package embeds that file. The page loads no
// other files, so every request carries the token in the URL of the page only.
//
// Build the viewer before the Go binary: run "make build", or "npm run build" in ui/.
package web

import (
	"embed"
)

//go:embed all:dist
var dist embed.FS

// missing is the page of a binary that was built without the viewer.
var missing = []byte(`<!doctype html><meta charset="utf-8"><title>hrev</title>` +
	`<p style="font-family:sans-serif">The hrev viewer is not built. Run "make build" in the hrev source folder.</p>`)

// Page returns the viewer page.
func Page() []byte {
	page, err := dist.ReadFile("dist/index.html")
	if err != nil {
		return missing
	}
	return page
}
