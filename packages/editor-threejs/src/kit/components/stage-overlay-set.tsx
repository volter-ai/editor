/** Shell overlays for document stages: selection controls, camera readout,
 * hints and statistics. Package documents supply their own chrome. */

import { useSyncExternalStore } from 'react';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import {
  object3DDocumentSessionsVersion,
  subscribeObject3DDocumentSessions,
} from '../authoring/object3d-document-session-registry';
import type { EditorShellStore } from '../editor-shell-store';
import type { EditorViewport } from '../editor-viewport';
import { documentStageContext, type StageChrome, threeSelectionToolsApply } from '@volter/editor-sdk/kit/stage-context';
import {
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import {
  subscribeViewportPresentation,
  viewPresentation,
  viewportPresentationVersion,
} from '@volter/editor-sdk/kit/viewport-presentation';
import { CameraInfo } from './CameraInfo';
import { StatsOverlay } from './StatsOverlay';
import { TransientHintOverlay } from '@volter/editor-sdk/kit/components/TransientHint';
import { ViewportOverlay } from './ViewportOverlay';

/** What the HOST hands over about the stage itself — its own store, the
 *  viewport the hotkeys drive and the canvas that claims their scope. Null
 *  until the stage has finished building. */
export interface StageHandle {
  readonly store: EditorShellStore;
  readonly viewport: EditorViewport;
  readonly canvas: HTMLCanvasElement;
}

export interface StageOverlaySetProps {
  readonly store: EditorShellStore;
  readonly documentId: string;
  /** This stage's own handle; `null` while it is still building. */
  readonly stage: StageHandle | null;
  /** Whether this stage's document is the ACTIVE centre tab. */
  readonly active: boolean;
  /** The host's own answer to `StageContext.chrome`. */
  readonly chrome: StageChrome;

}

export function StageOverlaySet({
  store,
  documentId,
  stage,
  active,
  chrome,
}: StageOverlaySetProps) {
  /** THIS stage's own store — the shell's until the stage has finished
   *  building, which is the same store every overlay read before unit 4. */
  const stageStore = stage?.store ?? store;
  useSyncExternalStore(store.shell.subscribe, store.shell.getShellSnapshot ?? store.shell.getSnapshot);
  // The stage's own state (its grid, helpers, stats, tool mode) lives on ITS
  // store, so the overlays that read it subscribe there too.
  useSyncExternalStore(stageStore.shell.subscribe, stageStore.shell.getShellSnapshot ?? stageStore.shell.getSnapshot);
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion);
  useSyncExternalStore(subscribeObject3DDocumentSessions, object3DDocumentSessionsVersion);
  useSyncExternalStore(subscribeWorkspaceDocuments, workspaceDocumentRegistryVersion);
  // THIS stage's context — not the focused one. A capability is present where
  // its condition holds, and the condition is asked of the stage that would
  // draw it (ARCHITECTURE-CORE §One stage).
  const ctx = documentStageContext(store.shell, documentId, chrome);
  /** Whether the selection tools draw here — and that is the WHOLE condition:
   *  they read THIS stage's own store (`stage.store`, the one the shared
   *  panels reach through `focusedStageStore()`), so a prefab's grid button
   *  toggles the prefab's grid and its readout reports the camera its reader
   *  is looking through. */
  const showsSelectionTools = threeSelectionToolsApply(ctx);
  // The camera readout is the editor's own; a view whose target draws none leaves it off
  // (`overlays.cameraReadout`).
  useSyncExternalStore(subscribeViewportPresentation, viewportPresentationVersion, viewportPresentationVersion);
  const cameraReadout = viewPresentation(documentId).overlays.cameraReadout;
  return (
    <>
      {/* THE STAGE'S OWN KEYBOARD is no longer mounted here: this module is
          reached only by a stage that has the shell above it, and a
          package-contributed document (the Model document) has none — so it
          answered no stage key at all. It is `StageHost.tsx`'s now, beside
          the stage handle, under the same activation condition
          (`stage-keyboard.tsx` carries the measurement). */}
      {showsSelectionTools ? (
        <>
          <ViewportOverlay store={stageStore} documentId={documentId} />
          {cameraReadout ? <CameraInfo /> : null}
        </>
      ) : null}
      {ctx.surface === 'three' && stageStore.showStats && <StatsOverlay />}
      {/* H2 — the ONE transient hint channel. Lives here because a refused
          transform is a viewport gesture; the overlay is absent from the DOM
          entirely until something has a reason to say. ONE channel means one
          mount — the ACTIVE stage's — so a hint never draws twice. */}
      {active ? <TransientHintOverlay /> : null}
      {/* W4 (inventory row V9): the scene document mounts NO network overlay.
          Compact connection state lives in the status bar
          (`status-contributions.tsx`); the detailed surface is the `network`
          workspace utility (`NetworkInspectorPanel`), revealed from there. */}
    </>
  );
}
