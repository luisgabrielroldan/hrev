// The line selection. A drag on the line numbers, or from the blue + button, selects lines. The + button shows
// on the row under the pointer, on the edge between the line number and the +/− sign, as on GitHub. During a
// drag, a second button stays on the first line of the range, and a vertical line joins the 2 buttons. The
// comment editor opens on mouseup.
import { useSignalEffect } from '@preact/signals';
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { drag, endDrag, extendDrag, session, startDrag } from '../store.ts';
import type { Side } from '../types.ts';
import { PlusIcon } from './icons.tsx';

const BUTTON = 22;

interface Spot {
  top: number;
  left: number;
}

interface Hover {
  spot: Spot;
  num: HTMLElement;
}

/** lineAt returns the line number cell under the pointer: on the given side, or on the new side first. */
function lineAt(target: EventTarget | null, side?: Side): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const direct = target.closest<HTMLElement>('.num[data-line]');
  if (direct && (!side || direct.dataset.side === side)) return direct;
  const box = target.closest('.side') ?? target.closest('.row');
  if (!box || !box.closest('.diffpane')) return null;
  if (side) return box.querySelector<HTMLElement>(`.num[data-line][data-side="${side}"]`);
  return box.querySelector<HTMLElement>('.num[data-line][data-side="new"]') ?? box.querySelector<HTMLElement>('.num[data-line][data-side="old"]');
}

/** spotFor places a button on the sign cell of the row of a line number. */
function spotFor(num: HTMLElement | null): Spot | null {
  const box = num && (num.closest('.side') ?? num.closest('.row'));
  const sign = box?.querySelector(':scope > .sign');
  if (!sign) return null;
  const r = sign.getBoundingClientRect();
  return { top: r.top + window.scrollY + (r.height - BUTTON) / 2, left: r.left + window.scrollX - BUTTON / 2 };
}

const lineOf = (num: HTMLElement) => ({ file: num.dataset.file!, side: num.dataset.side as Side, line: Number(num.dataset.line) });

export function LineSelection() {
  const [hover, setHover] = useState<Hover | null>(null);
  const [anchor, setAnchor] = useState<Spot | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;

  // A new diff moves the rows, so the button hides until the pointer moves again.
  useSignalEffect(() => {
    void session.value;
    setHover(null);
  });

  useEffect(() => {
    const begin = (num: HTMLElement) => {
      const { file, side, line } = lineOf(num);
      startDrag(file, side, line);
      setAnchor(spotFor(num));
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const fromButton = button.current?.contains(e.target as Node) ? hoverRef.current?.num : null;
      const num = fromButton ?? (e.target instanceof Element ? e.target.closest<HTMLElement>('.num[data-line]') : null);
      if (!num) return;
      e.preventDefault();
      begin(num);
    };
    const onOver = (e: MouseEvent) => {
      if (button.current?.contains(e.target as Node)) return;
      const d = drag.peek();
      const num = lineAt(e.target, d?.side);
      if (d && (!num || num.dataset.file !== d.file)) return;
      const spot = spotFor(num);
      setHover(spot && num ? { spot, num } : null);
      if (d && num) extendDrag(lineOf(num).line);
    };
    const onUp = () => {
      if (!drag.peek()) return;
      setHover(null);
      setAnchor(null);
      endDrag();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const dragging = anchor && hover;
  return createPortal(
    <>
      <button
        ref={button}
        type="button"
        class="add-comment"
        hidden={!hover}
        aria-label="Comment on this line; drag to select more lines"
        title="Comment on this line. Drag to select more lines."
        style={hover ? { top: `${hover.spot.top}px`, left: `${hover.spot.left}px` } : undefined}
      >
        <PlusIcon />
      </button>
      {anchor && (
        <button type="button" class="add-comment anchor" aria-hidden="true" tabIndex={-1} style={{ top: `${anchor.top}px`, left: `${anchor.left}px` }}>
          <PlusIcon />
        </button>
      )}
      {dragging && anchor.top !== hover.spot.top && (
        <div
          class="drag-line"
          style={{
            left: `${anchor.left + 10}px`,
            top: `${Math.min(anchor.top, hover.spot.top) + 11}px`,
            height: `${Math.abs(anchor.top - hover.spot.top)}px`,
          }}
        />
      )}
    </>,
    document.body,
  );
}
