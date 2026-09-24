/**
 * W2c (F13) — Game-tab device preset dropdown. Chrome-device-mode-style:
 * picking a preset constrains the game mount to that device's CSS resolution
 * + DPR (letterboxed/scaled by `GamePanel`), phone/tablet presets add the
 * safe-area overlay + `--vgai-safe-area-inset-*` CSS vars and auto-enable
 * pointer-as-touch. State lives in `../device-preview.ts`; this component is
 * pure UI over it.
 */

import { faMobileScreenButton } from '@fortawesome/free-solid-svg-icons';
import { AnchoredMenu, Button, EditorIcon, MenuItem, Text } from '@volter/editor-sdk/widgets';
import { useRef, useState } from 'react';
import {
  DEVICE_PRESETS,
  type DevicePreset,
  devicePreset,
  setTouchEmulationOverride,
  touchEmulationActive,
} from './device-preview';

export function DevicePresetPicker({
  onPresetChange,
}: {
  /** Owner applies the preset (device-preview store + game resolution). */
  onPresetChange: (preset: DevicePreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const active = devicePreset();
  const isFit = active.kind === 'fit';

  return (
    <div className="vgai-playbar-popover-anchor">
      <Button
        ref={ref}
        variant="ghost"
        size="comfortable"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'vgai-device-preset-menu' : undefined}
        data-testid="device-preset-picker"
        onClick={() => setOpen((value) => !value)}
        title={
          'Device preview — constrain the game to a device resolution + DPR. Phone/tablet presets show the safe area, set --vgai-safe-area-inset-top/right/bottom/left CSS vars on the game mount, and send mouse input as touch.'
        }
      >
        <EditorIcon icon={faMobileScreenButton} size="md" />
        <Text variant="code">{isFit ? 'Device' : `${active.width}×${active.height}`}</Text>
      </Button>
      {open && (
        <AnchoredMenu
          id="vgai-device-preset-menu"
          anchorRef={ref}
          className="vgai-resolution-menu"
          gap={4}
          onDismiss={() => setOpen(false)}
        >
          {DEVICE_PRESETS.map((candidate) => (
            <MenuItem
              key={candidate.id}
              role="menuitemradio"
              aria-checked={candidate.id === active.id}
              data-testid={`device-preset-${candidate.id}`}
              onSelect={() => {
                onPresetChange(candidate);
                setOpen(false);
              }}
            >
              {candidate.label}
            </MenuItem>
          ))}
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={touchEmulationActive()}
            data-testid="device-touch-toggle"
            onSelect={() => setTouchEmulationOverride(!touchEmulationActive())}
          >
            {touchEmulationActive() ? '✓ ' : '  '}Pointer as touch
          </MenuItem>
        </AnchoredMenu>
      )}
    </div>
  );
}
