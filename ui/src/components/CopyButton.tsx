import { useEffect, useRef, useState } from 'preact/hooks';
import { showError } from '../store.ts';
import { CheckIcon, CopyIcon } from './icons.tsx';

interface Props {
  text: string;
  /** The accessible name of the button. */
  label: string;
  title?: string;
  /** The error message when the clipboard refuses the text. */
  failure: string;
  class: string;
  /** The visible text of the button, and the text after a copy. Without it, the button shows only the icon. */
  caption?: [string, string];
}

/** CopyButton copies text to the clipboard. For a moment after the copy, it shows a check mark. */
export function CopyButton({ text, label, title = label, failure, class: cls, caption }: Props) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      showError(failure);
      return;
    }
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1500);
  };

  return (
    <button class={`${cls} ${done ? 'done' : ''}`} type="button" aria-label={caption ? undefined : label} title={title} onClick={copy}>
      {done ? <CheckIcon /> : <CopyIcon />}
      {caption && <span>{done ? caption[1] : caption[0]}</span>}
    </button>
  );
}
