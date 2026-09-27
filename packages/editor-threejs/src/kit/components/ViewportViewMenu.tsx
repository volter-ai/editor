import { faCamera, faCaretDown, faEllipsisVertical } from '@fortawesome/free-solid-svg-icons';
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
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';
import {
  setThreeViewportProjection,
  subscribeThreeViewportPresentation,
  threeViewportPresentation,
} from '@volter/editor-sdk/kit/three-viewport-presentation';
import {
  object3DDocumentSession,
  object3DDocumentSessionsVersion,
  subscribeObject3DDocumentSessions,
} from '../authoring/object3d-document-session-registry';

const NO_SESSION_SUBSCRIBE = () => () => {};
const ZERO = () => 0;

/** The standard Scene-view camera menu: projection and axis views in one
 * place. These are editor-camera choices only. */
/** The stage's projection + axis-view presets. `shell` is the STAGE's own
 *  store's shell, so a preset drives the stage the control is mounted over
 *  (ARCHITECTURE-CORE §One stage unit 4).
 *
 *  A DOCUMENT STAGE IS PAINTED BY ITS SESSION (`Object3DDocumentSession.camera()`), and the
 *  editor-wide projection (`setThreeViewportProjection`) reaches only the world root's stage
 *  (`world-root-stage.ts` is its one subscriber): over a document the Perspective and
 *  Orthographic buttons changed nothing, the defect `ViewportFurniture`'s projection toggle
 *  records. With `documentId` naming a stage that has a session, the menu drives that session,
 *  as the document toolbar's view menu does; the world root keeps the editor-wide value.
 *
 *  `label` draws the trigger as the view's NAME (the look's `stage.chrome.viewName`: Godot's
 *  "⋮ Perspective", Unreal's "Perspective" pill) instead of the camera icon; `kebab` puts
 *  Godot's three dots before it. */
export function ViewportViewMenu({
  shell,
  documentId,
  label,
  kebab = false,
}: {
  readonly shell: Pick<ShellStore, 'setViewPreset'>;
  readonly documentId?: string;
  readonly label?: string;
  readonly kebab?: boolean;
}) {
  const state = useSyncExternalStore(
    subscribeThreeViewportPresentation,
    threeViewportPresentation,
    threeViewportPresentation,
  );
  useSyncExternalStore(subscribeObject3DDocumentSessions, object3DDocumentSessionsVersion);
  const session = documentId ? object3DDocumentSession(documentId) : null;
  useSyncExternalStore(session?.subscribe ?? NO_SESSION_SUBSCRIBE, session?.getSnapshot ?? ZERO, session?.getSnapshot ?? ZERO);
  const projection = session ? session.projection() : state.projection;
  const setProjection = (next: 'perspective' | 'orthographic'): void => {
    if (session) session.setProjection(next);
    else setThreeViewportProjection(next);
  };
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
    if (session) {
      session.setViewPreset(view, 'view');
      return;
    }
    setThreeViewportProjection('orthographic');
    shell.setViewPreset(view);
  };

  return (
    <div ref={anchor} className="vgai-viewport-popover-anchor">
      {label === undefined ? (
        <Tooltip text={projection === 'perspective' ? 'Perspective' : 'Orthographic'}>
          <IconButton
            aria-label="Viewport views"
            aria-expanded={open}
            size="comfortable"
            onClick={() => setOpen((value) => !value)}
          >
            <EditorIcon icon={open ? faCaretDown : faCamera} size="md" />
          </IconButton>
        </Tooltip>
      ) : (
        <Button
          size="comfortable"
          variant="ghost"
          aria-label="Viewport views"
          aria-expanded={open}
          data-testid="viewport-view-name"
          onClick={() => setOpen((value) => !value)}
        >
          {kebab ? <EditorIcon icon={faEllipsisVertical} size="sm" /> : null}
          {label}
        </Button>
      )}
      {open ? (
        <EditorPopover style={{ minWidth: 230 }}>
          <Stack gap={3}>
            <Text variant="caption" tone="muted">
              Projection
            </Text>
            <Inline gap={1}>
              <Button
                size="compact"
                variant={projection === 'perspective' ? 'primary' : 'ghost'}
                onClick={() => setProjection('perspective')}
              >
                Perspective
              </Button>
              <Button
                size="compact"
                variant={projection === 'orthographic' ? 'primary' : 'ghost'}
                onClick={() => setProjection('orthographic')}
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
