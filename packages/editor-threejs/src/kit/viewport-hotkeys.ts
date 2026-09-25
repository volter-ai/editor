/**
 * THE THREE VIEWPORT'S KEYBOARD ACTIONS (the gizmo-mode trio, snap, pivot, the
 * numpad views, vertex snap). Only a three stage has an `EditorViewport`, so the
 * stage binds these while it is mounted (`components/stage-keyboard.tsx`). They
 * reach the keyboard through the host door (`host.keyboard`): the viewport says
 * what each action does, and the active KEYMAP decides which keys land on it —
 * W/E/R under `vgai`, G/R/S under `blender`.
 */
import { editorHost } from '@volter/editor-sdk/host';
import { getActiveScope, installHotkeys, setActiveScope } from '@volter/editor-sdk/kit/hotkeys';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import type { EditorShellStore, TransformMode } from './editor-shell-store';
import type { EditorViewport } from './editor-viewport';
import { requestTransformMode } from '@volter/editor-sdk/kit/transform-mode-request';

export function registerViewportHotkeys(
  store: EditorShellStore,
  viewport: EditorViewport,
  canvas: HTMLCanvasElement,
): () => void {
  const { keyboard } = editorHost();
  const transformMode = (mode: TransformMode) => () => {
    if (!viewport.isFlying) requestTransformMode(store.shell, mode);
  };
  const unbind = keyboard.bindActions([
    { id: 'transform.select', scope: 'stage', run: transformMode('select') },
    { id: 'transform.combined', scope: 'stage', run: transformMode('combined') },
    { id: 'transform.translate', scope: 'stage', run: transformMode('translate') },
    { id: 'transform.rotate', scope: 'stage', run: transformMode('rotate') },
    { id: 'transform.scale', scope: 'stage', run: transformMode('scale') },
    // Snap has a key and says what it did: a human build session asked "how
    // do you toggle the snap" with the magnet button on screen the whole time.
    // The hint names the ACTIVE keymap's key, never a remembered literal.
    // Holding Ctrl/⌘ during a drag snaps temporarily (editor-viewport.ts).
    {
      id: 'viewport.toggleSnap',
      scope: 'stage',
      run: () => {
        store.shell.toggleSnap();
        const { translate, rotate, scale } = store.shell.snapValues;
        const toggles = `${keyboard.shortcutFor('viewport.toggleSnap') ?? ''} toggles; hold Ctrl while dragging to snap once`;
        showTransientHint(
          store.shell.snapEnabled
            ? `Snap on — ${translate} units, ${rotate}°, ×${scale} (${toggles})`
            : `Snap off (${toggles})`,
        );
      },
    },
    { id: 'viewport.frameSelection', scope: 'stage', run: () => store.shell.focusOnSelection() },
    {
      id: 'viewport.cyclePivot',
      scope: 'stage',
      run: () => {
        const pivotModes = ['active-element', 'median-point', 'individual-origins'] as const;
        const idx = pivotModes.indexOf(store.shell.pivotMode);
        store.shell.setPivotMode(pivotModes[(idx + 1) % pivotModes.length]!);
      },
    },
    { id: 'view.top', scope: 'stage', run: () => viewport.setViewPreset('top') },
    { id: 'view.front', scope: 'stage', run: () => viewport.setViewPreset('front') },
    { id: 'view.right', scope: 'stage', run: () => viewport.setViewPreset('right') },
    { id: 'view.perspective', scope: 'stage', run: () => viewport.setViewPreset('perspective') },
    { id: 'viewport.snapToFloor', scope: 'stage', run: () => viewport.snapSelectionToFloor() },
  ]);

  const onPointerDown = () => setActiveScope('viewport');
  canvas.addEventListener('pointerdown', onPointerDown);
  installHotkeys();

  // Vertex snap: HOLD to activate. A keybinding fires once per keydown and has
  // no held concept, so this pair reads the same keymap entry directly rather
  // than a literal key.
  const isVertexSnapKey = (e: KeyboardEvent): boolean =>
    keyboard.chordsFor('viewport.vertexSnapHold').some((chord) => chord.key === e.key.toLowerCase());
  const onKeyDown = (e: KeyboardEvent) => {
    if (isVertexSnapKey(e) && !e.metaKey && !e.ctrlKey && !e.repeat) {
      // THE STAGE'S OWN SCOPE, which is what keeps this from being a second
      // keyboard owner: it fires only while the viewport holds the editor's
      // scope, the same fact the frame publishes as `vgai.stage.focused`.
      if (getActiveScope() !== 'viewport') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      store.setVertexSnapActive(true);
      viewport.activateVertexSnap();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (isVertexSnapKey(e) && !e.metaKey && !e.ctrlKey) {
      store.setVertexSnapActive(false);
      viewport.deactivateVertexSnap();
    }
  };
  // Not a second keyboard owner: it consumes nothing — no `preventDefault`, no
  // action table — reads only whether a chord is DOWN, and fires only while the
  // viewport holds the editor's own scope, like `editor-viewport.ts`'s fly keys.
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return () => {
    unbind();
    canvas.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
  };
}
