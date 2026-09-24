import { faDesktop } from '@fortawesome/free-solid-svg-icons';
import { AnchoredMenu, Button, EditorIcon, MenuItem, Text } from '@vgai/editor-sdk/widgets';
import { useRef, useState } from 'react';

export interface Resolution {
  label: string;
  width: number | null;
  height: number | null;
}

export const RESOLUTIONS: Resolution[] = [
  { label: 'Fill', width: null, height: null },
  { label: 'iPhone SE — 375×667', width: 375, height: 667 },
  { label: 'iPhone 14 — 390×844', width: 390, height: 844 },
  { label: 'iPhone 14 Pro Max — 430×932', width: 430, height: 932 },
  { label: 'iPad Mini — 768×1024', width: 768, height: 1024 },
  { label: 'iPad Pro 11″ — 834×1194', width: 834, height: 1194 },
  { label: 'Laptop — 1366×768', width: 1366, height: 768 },
  { label: 'Desktop — 1920×1080', width: 1920, height: 1080 },
];

/** Shared preview-resolution picker for Game and isolated story documents. */
export function ResolutionPicker({
  resolution,
  onResolutionChange,
  scale,
  title = 'Change preview resolution',
  options = RESOLUTIONS,
}: {
  resolution: Resolution;
  onResolutionChange: (resolution: Resolution) => void;
  scale: number;
  title?: string;
  /** Menu entries. Callers with a project-declared resolution swap the list
   *  so the declared entry is offered and unreachable choices are not. */
  options?: Resolution[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const isFill = resolution.width === null;
  const label = isFill ? 'Fill' : `${resolution.width}×${resolution.height}`;

  return (
    <div className="vgai-playbar-popover-anchor">
      <Button
        ref={ref}
        variant="ghost"
        size="comfortable"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'vgai-resolution-picker-menu' : undefined}
        onClick={() => setOpen((value) => !value)}
        title={title}
      >
        <EditorIcon icon={faDesktop} size="md" />
        <Text variant="code">{label}</Text>
        {!isFill && scale < 1 && (
          <Text variant="caption" tone="dim">
            {Math.round(scale * 100)}%
          </Text>
        )}
      </Button>
      {open && (
        <AnchoredMenu
          id="vgai-resolution-picker-menu"
          anchorRef={ref}
          className="vgai-resolution-menu"
          gap={4}
          onDismiss={() => setOpen(false)}
        >
          {options.map((candidate) => (
            <MenuItem
              key={candidate.label}
              role="menuitemradio"
              aria-checked={candidate.label === resolution.label}
              onSelect={() => {
                onResolutionChange(candidate);
                setOpen(false);
              }}
            >
              {candidate.label}
            </MenuItem>
          ))}
        </AnchoredMenu>
      )}
    </div>
  );
}
