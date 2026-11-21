// Per-viewer conveniences in localStorage. Storage can be missing, so every access is guarded.

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no storage */
  }
}

const TREE_WIDTH = 'hrev.treeWidth';
const TREE_OPEN = 'hrev.treeOpen';

export function loadTreeWidth(): number {
  const w = parseInt(read(TREE_WIDTH) ?? '', 10);
  return w > 0 ? w : 300;
}

export const saveTreeWidth = (w: number): void => write(TREE_WIDTH, String(w));
export const loadTreeOpen = (): boolean => read(TREE_OPEN) !== 'false';
export const saveTreeOpen = (open: boolean): void => write(TREE_OPEN, String(open));

export const clampTreeWidth = (w: number): number => Math.round(Math.max(180, Math.min(w, window.innerWidth * 0.6)));
