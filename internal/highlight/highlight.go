// Package highlight adds syntax colors to the lines of a parsed diff. The lexer comes from the file name.
package highlight

import (
	"html"
	"strings"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/lexers"

	"github.com/luisgabrielroldan/hrev/internal/diffparse"
)

// Files sets Line.HTML for every line of a file with a known language. Other lines keep only Text.
func Files(files []*diffparse.File) {
	for _, f := range files {
		lexer := lexers.Match(baseName(f.Path))
		if lexer == nil {
			continue
		}
		lexer = chroma.Coalesce(lexer)
		for i := range f.Hunks {
			hunk(lexer, &f.Hunks[i])
		}
	}
}

// hunk colors the old side and the new side of a hunk as whole blocks, so that multi-line
// strings and comments inside the hunk get the correct colors.
func hunk(lexer chroma.Lexer, h *diffparse.Hunk) {
	var oldIdx, newIdx []int
	for i, l := range h.Lines {
		if l.Kind != diffparse.Add {
			oldIdx = append(oldIdx, i)
		}
		if l.Kind != diffparse.Del {
			newIdx = append(newIdx, i)
		}
	}
	oldHTML := block(lexer, h.Lines, oldIdx)
	newHTML := block(lexer, h.Lines, newIdx)
	for k, i := range newIdx {
		if newHTML != nil {
			h.Lines[i].HTML = newHTML[k]
		}
	}
	for k, i := range oldIdx {
		if oldHTML != nil && h.Lines[i].Kind == diffparse.Del {
			h.Lines[i].HTML = oldHTML[k]
		}
	}
}

// block returns the HTML of each line in idx, or nil when the lexer fails.
func block(lexer chroma.Lexer, lines []diffparse.Line, idx []int) []string {
	if len(idx) == 0 {
		return nil
	}
	texts := make([]string, len(idx))
	for k, i := range idx {
		texts[k] = lines[i].Text
	}
	it, err := lexer.Tokenise(nil, strings.Join(texts, "\n")+"\n")
	if err != nil {
		return nil
	}
	split := chroma.SplitTokensIntoLines(it.Tokens())
	out := make([]string, len(idx))
	for k := range idx {
		if k >= len(split) {
			break
		}
		var b strings.Builder
		for _, t := range split[k] {
			v := strings.TrimSuffix(t.Value, "\n")
			if v == "" {
				continue
			}
			if c := class(t.Type); c != "" {
				b.WriteString(`<span class="hl-` + c + `">` + html.EscapeString(v) + `</span>`)
			} else {
				b.WriteString(html.EscapeString(v))
			}
		}
		out[k] = b.String()
	}
	return out
}

// class maps a token type to 1 of a few color classes. An empty class means plain text.
func class(t chroma.TokenType) string {
	switch {
	case t == chroma.GenericHeading || t == chroma.GenericSubheading:
		return "h"
	case t == chroma.GenericStrong:
		return "st"
	case t.InCategory(chroma.Comment):
		return "c"
	case t.InSubCategory(chroma.LiteralString):
		return "s"
	case t.InSubCategory(chroma.LiteralNumber):
		return "n"
	case t == chroma.KeywordType || t == chroma.NameClass || t == chroma.NameNamespace:
		return "t"
	case t.InCategory(chroma.Keyword), t == chroma.NameTag, t == chroma.OperatorWord:
		return "k"
	case t == chroma.NameFunction || t == chroma.NameFunctionMagic:
		return "f"
	case t == chroma.NameBuiltin || t == chroma.NameBuiltinPseudo || t == chroma.NameConstant || t == chroma.NameDecorator:
		return "b"
	case t == chroma.NameAttribute || t == chroma.NameProperty || t == chroma.NameLabel:
		return "a"
	case t == chroma.NameVariable || t == chroma.NameVariableInstance || t == chroma.NameVariableGlobal:
		return "v"
	}
	return ""
}

func baseName(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}
