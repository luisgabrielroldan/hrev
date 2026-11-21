// Text changes of the comment editor, as pure functions on the text and the selection.

/** A textarea value and its selection. */
export interface TextState {
  value: string;
  start: number;
  end: number;
}

export type FormatName = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link';

type Format =
  | { kind: 'line'; prefix: string }
  | { kind: 'wrap'; before: string; after: string; sample: string; block?: boolean }
  | { kind: 'link' };

const FORMATS: Record<FormatName, Format> = {
  heading: { kind: 'line', prefix: '### ' },
  bold: { kind: 'wrap', before: '**', after: '**', sample: 'bold text' },
  italic: { kind: 'wrap', before: '_', after: '_', sample: 'italic text' },
  quote: { kind: 'line', prefix: '> ' },
  code: { kind: 'wrap', before: '`', after: '`', sample: 'code', block: true },
  link: { kind: 'link' },
};

/**
 * applyFormat applies a toolbar format, as on GitHub. A line format prefixes each selected line, or the current
 * line. Other formats wrap the selected text, or insert a sample text and select it.
 */
export function applyFormat(s: TextState, name: FormatName): TextState {
  const f = FORMATS[name];
  const { value, start: a, end: b } = s;
  const sel = value.slice(a, b);

  if (f.kind === 'line') {
    const lineStart = value.lastIndexOf('\n', a - 1) + 1;
    const next = value.indexOf('\n', b);
    const lineEnd = b > a && value[b - 1] === '\n' ? b - 1 : next === -1 ? value.length : next;
    const block = value.slice(lineStart, lineEnd).split('\n').map((l) => f.prefix + l).join('\n');
    // Without a selection, the caret goes right after the prefix. With one, to the end of the changed lines.
    const caret = a === b ? a + f.prefix.length : lineStart + block.length;
    return { value: value.slice(0, lineStart) + block + value.slice(lineEnd), start: caret, end: caret };
  }

  let text: string;
  let selStart: number;
  let selEnd: number;
  if (f.kind === 'link') {
    text = `[${sel || 'text'}](url)`;
    selStart = a + text.length - 4;
    selEnd = a + text.length - 1;
  } else if (f.block && sel.includes('\n')) {
    text = '```\n' + sel + '\n```';
    selStart = a + 4;
    selEnd = selStart + sel.length;
  } else {
    const inner = sel || f.sample;
    text = f.before + inner + f.after;
    selStart = a + f.before.length;
    selEnd = selStart + inner.length;
  }
  return { value: value.slice(0, a) + text + value.slice(b), start: selStart, end: selEnd };
}

/** insertText puts text at the selection and places the caret after it. */
export function insertText(s: TextState, text: string): TextState {
  const caret = s.start + text.length;
  return { value: s.value.slice(0, s.start) + text + s.value.slice(s.end), start: caret, end: caret };
}

/** suggestionBlock is the text of the suggestion button: a suggestion block with the selected code. */
export function suggestionBlock(s: TextState, code: string): string {
  const newline = s.value && !s.value.endsWith('\n') && s.start === s.value.length ? '\n' : '';
  return `${newline}\`\`\`suggestion\n${code}\n\`\`\`\n`;
}
