/**
 * AssetSlotPicker — the widget for a `PropertyDescriptor.type: 'asset'` row:
 * ONE slot on the inspected thing that either holds a project asset or is
 * empty (a material's `map`, `normalMap`, …).
 *
 * Kit-pure like every other widget here (`index.ts`): it takes the candidate
 * paths and a preview-URL function from its caller and imports no editor
 * state, so the same control serves any lane that can name its own assets.
 *
 * Deliberately NOT a second asset browser. The choices are a flat list of
 * project-relative paths in a `<Select>` — the Asset Browser panel remains the
 * place to look through, tag, import and preview assets; this is the one-click
 * assignment at the point of use, which is the gesture a material author is
 * making. The thumbnail is the assigned file itself, so the row shows WHAT is
 * assigned and not only its name.
 */

import { faXmark } from '@fortawesome/free-solid-svg-icons';
import type React from 'react';
import { EditorIcon, IconButton, Select, themeVars } from '../design-system';
import { THEME } from './shared';

const THUMB = 22;

const thumbStyle: React.CSSProperties = {
  width: THUMB,
  height: THUMB,
  flex: `0 0 ${THUMB}px`,
  borderRadius: THEME.radiusSmall,
  border: `1px solid ${THEME.border}`,
  background: THEME.inputBg,
  objectFit: 'cover',
  // A checker under a transparent PNG, so an alpha map does not read as white.
  backgroundImage:
    'linear-gradient(45deg,rgba(128,128,128,.35) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.35) 75%),' +
    'linear-gradient(45deg,rgba(128,128,128,.35) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.35) 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 4px 4px',
};

export interface AssetSlotPickerProps {
  /** The assigned asset's project path, or `''` when the slot is empty. */
  readonly value: string;
  /** Assign a path, or `''` to CLEAR the slot. */
  readonly onChange: (value: string) => void;
  /** The paths this slot may be filled from, already filtered by the caller to
   *  the kinds it can honor. */
  readonly options: readonly string[];
  /** Browser URL for a path's preview image. */
  readonly previewUrlFor: (path: string) => string;
  readonly disabled?: boolean | undefined;
  /**
   * What the last assignment ANSWERED — the write ack's own sentence when it
   * did not persist. Rendered under the control because an edit whose file half
   * silently did not happen is exactly the invisible failure the write pipe
   * exists to make loud.
   */
  readonly note?: string | undefined;
  readonly testId: string;
}

export function AssetSlotPicker({
  value,
  onChange,
  options,
  previewUrlFor,
  disabled,
  note,
  testId,
}: AssetSlotPickerProps): React.ReactElement {
  // A value assigned outside this list (a texture the game's own code loaded,
  // or a file since deleted) must still be SHOWN — dropping it from the select
  // would silently redisplay the slot as empty while it is not.
  const choices = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        {value ? (
          <img
            src={previewUrlFor(value)}
            alt=""
            style={thumbStyle}
            data-testid={`${testId}-thumb`}
          />
        ) : (
          <span style={thumbStyle} aria-hidden="true" />
        )}
        <Select
          data-testid={testId}
          disabled={disabled}
          value={value}
          title={value || 'No texture assigned'}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        >
          <option value="">—</option>
          {choices.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </Select>
        <IconButton
          data-testid={`${testId}-clear`}
          aria-label="Clear this texture slot"
          title="Clear this texture slot"
          disabled={disabled || !value}
          onClick={() => onChange('')}
        >
          <EditorIcon icon={faXmark} />
        </IconButton>
      </div>
      {note && (
        <span
          data-testid={`${testId}-note`}
          style={{ fontSize: 'var(--vgai-font-sm)', color: themeVars.content.muted }}
        >
          {note}
        </span>
      )}
    </div>
  );
}
