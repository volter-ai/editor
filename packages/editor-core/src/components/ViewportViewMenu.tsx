import { faCamera, faCaretDown } from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  EditorIcon,
  EditorPopover,
  IconButton,
  Inline,
  Stack,
  Text,
  Tooltip,
} from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorShellStore } from '../editor-shell-store';
import {
  setThreeViewportProjection,
  subscribeThreeViewportPresentation,
  threeViewportPresentation,
} from '@volter/editor-sdk/kit/three-viewport-presentation';

/** The standard Scene-view camera menu: projection and axis views in one
 * place. These are editor-camera choices only. */
/** The stage's projection + axis-view presets. `store` is the STAGE's own
 *  store, so a preset drives the stage the control is mounted over
 *  (ARCHITECTURE-CORE §One stage unit 4) — its `setViewPreset` reaches that
 *  stage's viewport through its own action bus. */
export function ViewportViewMenu({ store }: { readonly store: EditorShellStore }) {
  const state = useSyncExternalStore(
    subscribeThreeViewportPresentation,
    threeViewportPresentation,
    threeViewportPresentation,
  );
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const preset = (view: 'top' | 'front' | 'right'): void => {
    setThreeViewportProjection('orthographic');
    store.setViewPreset(view);
  };

  return (
    <div ref={anchor} className="vgai-viewport-popover-anchor">
      <Tooltip text={state.projection === 'perspective' ? 'Perspective' : 'Orthographic'}>
        <IconButton
          aria-label="Viewport views"
          aria-expanded={open}
          size="comfortable"
          onClick={() => setOpen((value) => !value)}
        >
          <EditorIcon icon={open ? faCaretDown : faCamera} size="md" />
        </IconButton>
      </Tooltip>
      {open ? (
        <EditorPopover style={{ minWidth: 230 }}>
          <Stack gap={3}>
            <Text variant="caption" tone="muted">
              Projection
            </Text>
            <Inline gap={1}>
              <Button
                size="compact"
                variant={state.projection === 'perspective' ? 'primary' : 'ghost'}
                onClick={() => setThreeViewportProjection('perspective')}
              >
                Perspective
              </Button>
              <Button
                size="compact"
                variant={state.projection === 'orthographic' ? 'primary' : 'ghost'}
                onClick={() => setThreeViewportProjection('orthographic')}
              >
                Orthographic
              </Button>
            </Inline>
            <Text variant="caption" tone="muted">
              Axis View
            </Text>
            <Inline gap={1}>
              <Button size="compact" variant="ghost" onClick={() => preset('top')}>
                Top
              </Button>
              <Button size="compact" variant="ghost" onClick={() => preset('front')}>
                Front
              </Button>
              <Button size="compact" variant="ghost" onClick={() => preset('right')}>
                Right
              </Button>
            </Inline>
          </Stack>
        </EditorPopover>
      ) : null}
    </div>
  );
}
