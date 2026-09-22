import { Button, EditorPopover, TextInput } from '../design-system';
/**
 * FontPicker — a searchable, windowed (virtualized-by-hand, no new dep) font
 * list (spec 27 §5 C1). Ported from `visual-edit/inspector.tsx`'s
 * `FontPicker` (:1958-2093); the reference fetched fonts async through its
 * `ParentBridge.getAvailableFonts()` (an iframe-bridge RPC this editor has no
 * equivalent of) — here `fonts` is passed in directly by the caller, wired
 * at C2 to the editor's OWN font source, `ui-source/inspect.ts:
 * getAvailableFonts()` (browser `document.fonts` + the web-safe fallback
 * list, already merged/sorted there — no re-implementation needed).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DisclosureIcon } from '../design-system';
import { type ChangeHandlers, THEME } from './shared';

const ITEM_HEIGHT = 28;
const MAX_VISIBLE = 10;

export interface FontPickerProps extends ChangeHandlers<string> {
  /** The available font families — wire to `getAvailableFonts()` at C2. */
  fonts: readonly string[];
  /** Root-element test id. Defaults to the stable `font-picker`; a node with a
   *  fontFamily on BOTH the style row and a component prop renders two, so the
   *  inspector passes a per-row id to keep the roots distinct (spec 27 §5 C2, S1). */
  testId?: string | undefined;
}

export function FontPicker({
  value,
  onChange,
  disabled,
  fonts,
  testId = 'font-picker',
}: FontPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search) return fonts;
    const q = search.toLowerCase();
    return fonts.filter((f) => f.toLowerCase().includes(q));
  }, [fonts, search]);

  const totalHeight = filtered.length * ITEM_HEIGHT;
  const startIndex = Math.floor(scrollTop / ITEM_HEIGHT);
  const endIndex = Math.min(filtered.length, startIndex + MAX_VISIBLE + 2);
  const visible = filtered.slice(startIndex, endIndex);

  const select = (font: string): void => {
    onChange(font);
    setOpen(false);
    setSearch('');
  };

  const displayValue = value.replace(/^["']|["']$/g, '');

  return (
    <div ref={containerRef} data-testid={testId} style={{ position: 'relative', flex: 1 }}>
      <Button
        type="button"
        variant="secondary"
        className="vgai-field-trigger"
        /* This trigger opens a listbox popover and never said so: the ARIA was
           missing, which is both an a11y defect and — since the widget classes
           landed — what decides whether it paints as a menu well or a
           pushbutton (`theme.css`, the `wcol_menu` rule). */
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        data-testid="font-picker-input"
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayValue || '—'}
        </span>
        <DisclosureIcon direction="down" tone="muted" style={{ marginLeft: 4 }} />
      </Button>
      {open && (
        <EditorPopover
          data-testid="font-picker-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 'var(--vgai-z-dropdown)',
            marginTop: 2,
          }}
        >
          <div style={{ padding: 4 }}>
            <TextInput
              ref={searchRef}
              type="text"
              data-testid="font-picker-search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setScrollTop(0);
              }}
              placeholder="Search fonts…"
              data-density="compact"
              style={{
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div
            data-testid="font-picker-list"
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
            style={{ maxHeight: MAX_VISIBLE * ITEM_HEIGHT, overflowY: 'auto' }}
          >
            <div style={{ height: totalHeight, position: 'relative' }}>
              {visible.map((font, i) => {
                const actualIndex = startIndex + i;
                const isActive = font.toLowerCase() === displayValue.toLowerCase();
                return (
                  <div
                    key={font}
                    data-testid={`font-picker-option-${font}`}
                    onClick={() => select(font)}
                    style={{
                      position: 'absolute',
                      top: actualIndex * ITEM_HEIGHT,
                      left: 0,
                      right: 0,
                      height: ITEM_HEIGHT,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 8px',
                      cursor: 'pointer',
                      fontSize: 12,
                      background: isActive ? THEME.accent : 'transparent',
                      color: isActive ? THEME.onAccent : THEME.text,
                    }}
                  >
                    <span
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {font}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {filtered.length === 0 && (
            <div
              style={{
                padding: '8px 12px',
                color: THEME.textMuted,
                fontSize: 10,
                textAlign: 'center',
              }}
            >
              No matching fonts
            </div>
          )}
        </EditorPopover>
      )}
    </div>
  );
}
