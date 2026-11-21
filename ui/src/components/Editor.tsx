// 1 editor for new comments, replies and edits: Write and Preview tabs, a format toolbar, a suggestion button,
// and image paste.
import type { Signal } from '@preact/signals';
import { useSignalEffect } from '@preact/signals';
import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { api } from '../api.ts';
import { applyFormat, insertText, suggestionBlock, type FormatName, type TextState } from '../lib/textedit.ts';
import { focusRequest, previews, setPreview, showError } from '../store.ts';
import { BoldIcon, CodeIcon, HeadingIcon, ItalicIcon, LinkIcon, QuoteIcon, SuggestIcon } from './icons.tsx';
import { Markdown } from './Markdown.tsx';

const FORMATS: { name: FormatName; label: string; Icon: () => JSX.Element }[] = [
  { name: 'heading', label: 'Heading', Icon: HeadingIcon },
  { name: 'bold', label: 'Bold', Icon: BoldIcon },
  { name: 'italic', label: 'Italic', Icon: ItalicIcon },
  { name: 'quote', label: 'Quote', Icon: QuoteIcon },
  { name: 'code', label: 'Code', Icon: CodeIcon },
  { name: 'link', label: 'Link', Icon: LinkIcon },
];

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;
const UPLOADING = '![Uploading image…]()';

interface Props {
  id: string;
  text: Signal<string>;
  label: string;
  placeholder?: string;
  small?: boolean;
  /** The selected code, for the suggestion button. null hides the button: a file comment has no selected code. */
  suggestCode: string | null;
}

export function Editor({ id, text, label, placeholder = '', small, suggestCode }: Props) {
  const preview = previews.value.has(id);
  const ref = useRef<HTMLTextAreaElement>(null);

  // The editor takes the focus when the store asks for it, for example when the user opens a reply.
  useSignalEffect(() => {
    if (focusRequest.value !== id) return;
    focusRequest.value = null;
    setPreview(id, false);
    requestAnimationFrame(() => ref.current?.focus());
  });

  const current = (): TextState => {
    const ta = ref.current!;
    return { value: ta.value, start: ta.selectionStart, end: ta.selectionEnd };
  };

  const apply = (next: TextState) => {
    const ta = ref.current!;
    ta.value = next.value;
    ta.setSelectionRange(next.start, next.end);
    text.value = next.value;
    ta.focus();
  };

  // A toolbar button changes the text at once and switches back to Write. The textarea stays in the page while
  // it is hidden, so the change does not wait for the Write tab to show.
  const edit = (change: (s: TextState) => TextState) => {
    apply(change(current()));
    if (preview) {
      setPreview(id, false);
      requestAnimationFrame(() => ref.current?.focus());
    }
  };

  // A pasted image is stored by the server. The comment gets a Markdown image link to it.
  const onPaste = async (e: ClipboardEvent) => {
    const item = [...(e.clipboardData?.items ?? [])].find((x) => x.kind === 'file' && IMAGE_TYPES.test(x.type));
    const file = item?.getAsFile();
    if (!file) return;
    e.preventDefault();
    apply(insertText(current(), UPLOADING));
    let markdown = '';
    try {
      markdown = (await api.uploadImage(file)).markdown;
    } catch (err) {
      showError(`Could not attach the image: ${(err as Error).message}`);
    }
    text.value = text.value.replace(UPLOADING, markdown);
  };

  return (
    <div class={`editor ${preview ? 'previewing' : ''}`}>
      <div class="editor-bar" role="tablist">
        <Tab on={!preview} onClick={() => edit((s) => s)}>Write</Tab>
        <Tab on={preview} onClick={() => setPreview(id, true)}>Preview</Tab>
        <span class="spacer" />
        {suggestCode !== null && (
          <ToolButton label="Add a suggestion" title="Add a suggestion: the code that should replace the selected lines" onClick={() => edit((s) => insertText(s, suggestionBlock(s, suggestCode)))}>
            <SuggestIcon />
          </ToolButton>
        )}
        {FORMATS.map(({ name, label: l, Icon }) => (
          <ToolButton key={name} label={l} title={l} onClick={() => edit((s) => applyFormat(s, name))}>
            <Icon />
          </ToolButton>
        ))}
      </div>
      <label class="sr" for={id}>
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        class={`ta ${small ? 'small' : ''}`}
        placeholder={placeholder}
        value={text.value}
        hidden={preview}
        onInput={(e) => (text.value = e.currentTarget.value)}
        onPaste={onPaste}
      />
      {preview && <Markdown class="editor-preview" source={text.value} empty="Nothing to preview" />}
      <p class="editor-hint">Markdown is supported. Paste an image to attach it.</p>
    </div>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" role="tab" class={`editor-tab ${on ? 'on' : ''}`} aria-selected={on} onClick={onClick}>
      {children}
    </button>
  );
}

function ToolButton({ label, title, onClick, children }: { label: string; title: string; onClick: () => void; children: JSX.Element }) {
  return (
    <button type="button" class="editor-tool" title={title} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}
