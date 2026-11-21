import type { ComponentChildren } from 'preact';
import type { FileStatus } from '../types.ts';

interface SvgProps {
  children: ComponentChildren;
  size?: number;
  viewBox?: string;
  /** stroke draws outlines with currentColor. Without it, the paths are filled with currentColor. */
  stroke?: number;
  /** round gives the outlines round ends and corners. */
  round?: boolean;
  class?: string;
}

function Svg({ children, size = 16, viewBox = '0 0 16 16', stroke, round, class: cls }: SvgProps) {
  const ends = round ? { 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const } : {};
  const paint = stroke ? { fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, ...ends } : { fill: 'currentColor' };
  return (
    <svg class={cls} width={size} height={size} viewBox={viewBox} aria-hidden="true" {...paint}>
      {children}
    </svg>
  );
}

const SHEET =
  'M1 1.75C1 .784 1.784 0 2.75 0h7.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073Z';
const PLUS_MINUS =
  'M8 3.25a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0V7h-1.5a.75.75 0 0 1 0-1.5h1.5V4A.75.75 0 0 1 8 3.25Zm-3 8a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z';
const BUBBLE =
  'M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z';

export const CopyIcon = () => (
  <Svg>
    <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
    <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
  </Svg>
);

/** The speech bubble with a bolt: Ask now sends the comment at once. */
export const AskNowIcon = () => (
  <Svg class="btn-ic">
    <path d={BUBBLE} />
    <path d="M8.95 3.2 5.9 7.05h2l-.85 3.15 3.1-3.95H8.1Z" />
  </Svg>
);

/** The empty speech bubble: Comment saves the comment as pending. */
export const SaveCommentIcon = () => (
  <Svg class="btn-ic">
    <path d={BUBBLE} />
  </Svg>
);

export const SuggestIcon = () => (
  <Svg>
    <path d={SHEET} />
    <path d={PLUS_MINUS} />
  </Svg>
);

export const GearIcon = () => (
  <Svg viewBox="0 0 24 24" stroke={1.8} round>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Svg>
);

export const CheckIcon = () => (
  <Svg stroke={1.6}>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </Svg>
);

export const SidebarIcon = () => (
  <Svg stroke={1.5}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M6 2.5v11" />
  </Svg>
);

export const ChevronIcon = () => (
  <Svg stroke={1.5}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);

export const SearchIcon = () => (
  <Svg stroke={1.5}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5l3.5 3.5" />
  </Svg>
);

export const FilterIcon = () => (
  <Svg stroke={1.5}>
    <path d="M2 4h12M4.5 8h7M7 12h2" />
  </Svg>
);

export const CommentIcon = () => (
  <Svg stroke={1.5}>
    <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5h-.5a1 1 0 0 1-1-1z" />
  </Svg>
);

export const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ pointerEvents: 'none' }}>
    <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </svg>
);

export const FolderIcon = ({ open }: { open: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" class="folder-ic">
    {open ? (
      <>
        <path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5a1 1 0 0 1 1 1v1.5h-8.2a1 1 0 0 0-.95.68L1.5 12.5z" fill="currentColor" />
        <path d="M4.3 7.2a1 1 0 0 1 .95-.7h9.4a.6.6 0 0 1 .57.8l-1.8 5.5a1 1 0 0 1-.95.7H1.9z" fill="currentColor" opacity=".75" />
      </>
    ) : (
      <path d="M1.5 3.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="currentColor" />
    )}
  </svg>
);

// File icons: the sheet of the suggestion icon with a mark for the status.
const FILE_MARKS: Record<FileStatus, { color: string; label: string; mark: string }> = {
  added: {
    color: 'var(--plus)',
    label: 'Added file',
    mark: 'M8 5.5a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 8 5.5Z',
  },
  deleted: { color: 'var(--minus)', label: 'Deleted file', mark: 'M5 8.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.5Z' },
  renamed: {
    color: 'var(--muted)',
    label: 'Renamed file',
    mark: 'M5 8.5a.75.75 0 0 1 .75-.75h3.19l-.97-.97a.75.75 0 0 1 1.06-1.06l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06-1.06l.97-.97H5.75A.75.75 0 0 1 5 8.5Z',
  },
  modified: { color: 'var(--muted)', label: 'Modified file', mark: PLUS_MINUS },
};

export function FileIcon({ status }: { status: FileStatus }) {
  const { color, label, mark } = FILE_MARKS[status] ?? FILE_MARKS.modified;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" role="img" aria-label={label} style={{ color, flex: '0 0 16px' }}>
      <path d={SHEET} />
      <path d={mark} />
    </svg>
  );
}

// Toolbar icons of the comment editor.
export const HeadingIcon = () => (
  <Svg stroke={1.5} round>
    <path d="M4 3v10M12 3v10M4 8h8" />
  </Svg>
);
export const BoldIcon = () => (
  <Svg>
    <path d="M4 2h4.5a3.501 3.501 0 0 1 2.852 5.53A3.499 3.499 0 0 1 9.5 14H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 7v3h4.5a1.5 1.5 0 0 0 0-3Zm3.5-2a1.5 1.5 0 0 0 0-3H5v3Z" />
  </Svg>
);
export const ItalicIcon = () => (
  <Svg>
    <path d="M6 2.75A.75.75 0 0 1 6.75 2h6.5a.75.75 0 0 1 0 1.5h-2.505l-3.858 9H9.25a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.505l3.858-9H6.75A.75.75 0 0 1 6 2.75Z" />
  </Svg>
);
export const QuoteIcon = () => (
  <Svg>
    <path d="M1.75 2.5h10.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Zm4 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2.5 7.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 1.5 0Z" />
  </Svg>
);
export const CodeIcon = () => (
  <Svg stroke={1.5} round>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </Svg>
);
export const LinkIcon = () => (
  <Svg stroke={1.5} round>
    <path d="M7 9a3 3 0 0 0 4.2.2l2-2a3 3 0 0 0-4.2-4.2l-1 1M9 7a3 3 0 0 0-4.2-.2l-2 2A3 3 0 0 0 7 13l1-1" />
  </Svg>
);

// Fold icons: an arrow toward the lines that open, and both arrows to open all.
export const ExpandUpIcon = () => (
  <Svg stroke={1.5} round>
    <path d="M8 13V4M4.5 7.5 8 4l3.5 3.5M3 2h10" />
  </Svg>
);
export const ExpandDownIcon = () => (
  <Svg stroke={1.5} round>
    <path d="M8 3v9M4.5 8.5 8 12l3.5-3.5M3 14h10" />
  </Svg>
);
export const UnfoldIcon = () => (
  <Svg stroke={1.5} round>
    <path d="M8 1.5v4M5.5 3.5 8 1l2.5 2.5M8 14.5v-4M5.5 12.5 8 15l2.5-2.5M3 8h10" />
  </Svg>
);
