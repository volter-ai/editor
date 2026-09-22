import { faCaretDown, faCheck, faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import {
  EditorIcon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  SplitButtonGroup,
  Tooltip,
} from '@volter/editor-sdk/widgets';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface ViewportOverlayChoice {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}

/**
 * BLENDER'S OVERLAY MARK, transcribed from `modeling-edit-none.png` at its
 * native 2x (the 3D View header's Show Overlays toggle, ink x 2424..2455,
 * y 64..91): a filled disc up and to the right, a stroked ring down and to
 * the left, and a GAP between them where the ring passes in front — the gap
 * is what keeps the ring readable against the disc, and without it the two
 * merge into one blob at 14 px. The disc-minus-gap is traced as one boundary
 * (the disc's far arc, then the gap circle's arc back) rather than knocked
 * out, because a knockout drawn over a single fill leaks wherever it reaches
 * past that fill's edge.
 *
 * Drawn here rather than through `EditorIcon`: the icon-set seam is keyed by
 * Font Awesome name, and no name in the set carries two overlapping circles —
 * hanging this mark on `clone` or `layer-group` would move those marks too.
 */
export function ViewportOverlaysGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="vgai-viewport-overlays-glyph"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5.24 4.51 A5.3 5.3 0 1 1 11.89 11.16 A5.85 5.85 0 0 0 5.24 4.51 Z"
        fill="currentColor"
      />
      <circle cx="6.1" cy="10.3" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function ViewportOverlaysMenu({
  label = 'Overlays',
  choices,
  master,
  glyph,
}: {
  readonly label?: string;
  readonly choices: readonly ViewportOverlayChoice[];
  readonly master?: { readonly enabled: boolean; readonly onToggle: () => void };
  /** Replaces the eye — a caller whose overlays have Blender's own mark. */
  readonly glyph?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const anyEnabled = choices.some((choice) => choice.enabled);
  const active = master?.enabled ?? anyEnabled;
  const mark = glyph ?? <EditorIcon icon={active ? faEye : faEyeSlash} size="md" />;

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const menu = open ? (
    <Menu className="vgai-helpers-menu" onDismiss={() => setOpen(false)}>
      {master ? (
        <>
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={master.enabled}
            onSelect={master.onToggle}
          >
            <span className="vgai-menu-check">
              {master.enabled && <EditorIcon icon={faCheck} size="xs" />}
            </span>
            Show {label}
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      {choices.map((choice) => (
        <MenuItem
          key={choice.id}
          role="menuitemcheckbox"
          aria-checked={choice.enabled}
          disabled={choice.disabled}
          onSelect={choice.onToggle}
        >
          <span className="vgai-menu-check">
            {choice.enabled && <EditorIcon icon={faCheck} size="xs" />}
          </span>
          {choice.label}
        </MenuItem>
      ))}
    </Menu>
  ) : null;

  return (
    <div ref={ref} className="vgai-viewport-popover-anchor">
      {master ? (
        <SplitButtonGroup>
          <Tooltip text={`${label}: ${active ? 'On' : 'Off'}`}>
            <IconButton
              aria-label={`Toggle ${label.toLowerCase()}`}
              aria-pressed={active}
              size="comfortable"
              onClick={master.onToggle}
            >
              {mark}
            </IconButton>
          </Tooltip>
          <IconButton
            aria-label={`Choose ${label.toLowerCase()}`}
            aria-expanded={open}
            size="comfortable"
            onClick={() => setOpen(!open)}
          >
            <EditorIcon icon={faCaretDown} size="xs" />
          </IconButton>
        </SplitButtonGroup>
      ) : (
        <Tooltip text={`${label}: ${active ? 'On' : 'Off'}`}>
          <IconButton
            aria-label={`Choose ${label.toLowerCase()}`}
            aria-expanded={open}
            aria-pressed={active}
            size="comfortable"
            onClick={() => setOpen(!open)}
          >
            {mark}
          </IconButton>
        </Tooltip>
      )}
      {menu}
    </div>
  );
}
