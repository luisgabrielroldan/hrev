import { useMemo } from 'preact/hooks';
import { token } from '../api.ts';
import { markdown } from '../lib/markdown.ts';

interface Props {
  source: string;
  class?: string;
  /** The text to show when the source renders to nothing. */
  empty?: string;
}

/** Markdown shows a comment. markdown() escapes all text, so the HTML is safe to insert. */
export function Markdown({ source, class: cls = '', empty }: Props) {
  const html = useMemo(() => markdown(source, token), [source]);
  if (!html && empty) {
    return (
      <div class={`md ${cls}`}>
        <p class="muted">{empty}</p>
      </div>
    );
  }
  return <div class={`md ${cls}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
