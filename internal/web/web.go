// Package web holds the viewer files. The page is 1 HTML document with inline CSS and JavaScript,
// so that every request carries the token in the URL of the page only.
package web

import (
	"bytes"
	_ "embed"
)

//go:embed index.html
var indexHTML []byte

//go:embed app.css
var appCSS []byte

//go:embed app.js
var appJS []byte

// Page returns the viewer page.
func Page() []byte {
	out := bytes.Replace(indexHTML, []byte("/*CSS*/"), appCSS, 1)
	return bytes.Replace(out, []byte("/*JS*/"), appJS, 1)
}
