/**
 * THE THREE VIEWPORT'S RELAY VERBS — framing, the camera, view presets, the
 * open Object3D document's orbit/turntable/frame, the viewport photograph and
 * the display and transform toggles. They are the Three viewport's, so they
 * reach the relay as a command contribution (`@volter/editor-sdk/commands`,
 * `command-registry.ts`) rather than as rows of the kit's own table: a
 * composition with no Three viewport has none of them. Each budget travelled
 * with its verb from `command-table.ts`.
 */
import type {
  CommandContribution,
  CommandDerivedRefresh,
  CommandSpec,
  EditorCommandMessage,
  EditorCommandResult,
} from '@volter/editor-sdk/commands';
import { commandLine } from '@volter/editor-sdk/kit/product-command';
import { activeWorkspaceDocumentId } from '@volter/editor-sdk/kit/workspace-document-registry';
import { object3DDocumentSession } from './authoring/object3d-document-session-registry';
import { activeDocumentAuthoring } from './authoring/shell-document-ops';
import { handleAssetPreviewCommand } from './asset-preview-command';
import { captureSizeFromCommand } from './capture-size';
import type { EditorShellStore, HelperVisibility } from './editor-shell-store';
import { captureActiveEditorDocument } from './editor-view-presentation';
import { entityObject3D } from './entity-object';
import { threeStoreForHost } from './shell-store-door';
import { focusedStageStore } from './stage-context';
import { setViewGridVisible, viewPresentationBinding } from '@volter/editor-sdk/kit/viewport-presentation';

function activeObject3DDocumentSession() {
  const documentId = activeWorkspaceDocumentId();
  return documentId ? object3DDocumentSession(documentId) : null;
}

/** One verb over the session's Three store. */
function verb(
  run: (store: EditorShellStore, cmd: EditorCommandMessage) => EditorCommandResult | Promise<EditorCommandResult>,
  timeoutMs?: number,
  derivedRefresh: CommandDerivedRefresh = 'none',
): CommandSpec {
  return {
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    derivedRefresh,
    handle: (cmd) => {
      const store = threeStoreForHost();
      if (!store) return { ok: false, error: `${cmd.type} needs an editor session; none has opened yet.` };
      return run(store, cmd);
    },
  };
}

const OK: EditorCommandResult = { ok: true };

type ShadingMode = Parameters<EditorShellStore['setShadingMode']>[0];

export const viewportCommands: CommandContribution['commands'] = {
  'focus-entity': verb((store, cmd) => {
    if (!activeObject3DDocumentSession()?.frameIds([cmd['id'] as string])) {
      store.focusOnEntity(cmd['id'] as string);
    }
    return OK;
  }),
  // The STRICT entity-targeted sibling of `focus-entity`: the same edit
  // viewport framing, but an id nothing in the scene answers to is a named
  // refusal rather than the silent no-op `focus-entity` keeps. That matters for
  // a scripted flow that frames an entity and then photographs it: framing that
  // quietly did nothing hands back a confident picture of whatever the camera
  // happened to be on.
  'frame-entity': verb((store, cmd) => {
    const id = cmd['id'];
    if (typeof id !== 'string' || id.length === 0) {
      return { ok: false, error: 'frame-entity requires a string "id" (the entity to frame).' };
    }
    const documentSession = activeObject3DDocumentSession();
    if (documentSession) {
      if (!documentSession.frameIds([id])) {
        return { ok: false, error: `Entity not found: ${id}`, data: { code: 'ENTITY_NOT_FOUND' } };
      }
      return OK;
    }
    // A Canvas Scene has no Object3D by design. Its native framing answer is
    // the adapter-owned screen rect consumed by CanvasSceneControls, so strict
    // existence is the owned hierarchy node plus the rect capability. Resolved
    // against the active document just like Hierarchy/Inspector do.
    const activeAdapter = activeDocumentAuthoring(store);
    if (activeAdapter.hierarchy.node(id) !== null && activeAdapter.rects) {
      store.focusOnEntity(id);
      return OK;
    }
    // The SAME resolver the framing itself uses (`entity-object.ts`): an
    // adopted play scene's nodes are the adapter's, not the shell map's.
    if (!entityObject3D(activeAdapter, store.objectMap, id)) {
      return { ok: false, error: `Entity not found: ${id}`, data: { code: 'ENTITY_NOT_FOUND' } };
    }
    store.focusOnEntity(id);
    return OK;
  }),
  'focus-selection': verb((store) => {
    if (!activeObject3DDocumentSession()?.frameSelection()) store.focusOnSelection();
    return OK;
  }),
  'view-preset': verb((store, cmd) => {
    // An absent or unknown preset is refused BY NAME: unguarded it reached
    // `cameraPresetDirection` and threw a TypeError that named neither the
    // command nor the vocabulary (measured live, 2026-09-18).
    const requested = cmd['preset'];
    const presets = ['top', 'front', 'right', 'perspective'] as const;
    if (typeof requested !== 'string' || !(presets as readonly string[]).includes(requested)) {
      return {
        ok: false,
        error: `view-preset requires one of ${presets.join(', ')}, got ${
          requested === undefined ? 'nothing' : JSON.stringify(requested)
        }.`,
      };
    }
    const preset = requested as (typeof presets)[number];
    const documentSession = activeObject3DDocumentSession();
    if (documentSession) {
      documentSession.setViewPreset(preset === 'perspective' ? 'isometric' : preset);
    } else store.setViewPreset(preset);
    return OK;
  }),
  'set-camera': verb((store, cmd) => {
    const position = cmd['position'] as { x: number; y: number; z: number } | undefined;
    const target = cmd['target'] as { x: number; y: number; z: number } | undefined;
    const fov = cmd['fov'] as number | undefined;
    if (
      !position ||
      !target ||
      typeof position.x !== 'number' ||
      typeof position.y !== 'number' ||
      typeof position.z !== 'number' ||
      typeof target.x !== 'number' ||
      typeof target.y !== 'number' ||
      typeof target.z !== 'number'
    ) {
      return { ok: false, error: 'set-camera requires numeric {x,y,z} position and target.' };
    }
    const documentSession = activeObject3DDocumentSession();
    if (documentSession) documentSession.setCameraPose(position, target, fov);
    else store.setCameraPose(position, target, fov);
    return OK;
  }),
  // THE AGENT'S LOOKING, AS A WATCHABLE ACT. These drive the OPEN Object3D
  // document's own camera — the one the human is looking through — and
  // orbit/turntable ack only when the animated move ends, so their budget is
  // the move's own wall clock. Both refuse a length past 60 s themselves. There
  // is no Scene fallback: the Scene viewport's camera answers to
  // `view-preset`/`set-camera` and has no framed subject to circle.
  'document-orbit': verb((_store, cmd) => documentMove(cmd), 120_000),
  'document-turntable': verb((_store, cmd) => documentMove(cmd), 120_000),
  'document-frame': verb((_store, cmd) => {
    const documentSession = activeObject3DDocumentSession();
    if (!documentSession) {
      return {
        ok: false,
        error:
          'document-frame needs an Object3D document open and active. For the Scene ' +
          'viewport use `frame-entity`/`focus-selection`.',
        data: { code: 'NO_ACTIVE_OBJECT3D_DOCUMENT' },
      };
    }
    const fit = cmd['fit'];
    if (fit !== undefined && (typeof fit !== 'number' || !(fit >= 0.1 && fit <= 10))) {
      return { ok: false, error: 'document-frame: "fit" must be a number in 0.1..10.' };
    }
    if (!documentSession.frame(typeof fit === 'number' ? fit : 1)) {
      return {
        ok: false,
        error: 'Nothing to frame: the document subject has no measurable bounds.',
        data: { code: 'EMPTY_FRAME_BOUNDS' },
      };
    }
    return { ok: true, data: { ...documentSession.cameraPose() } };
  }),
  'capture-viewport': verb(async (store, cmd) => {
    // Fresh, unthrottled on-demand capture (see EditorShellStore.captureViewportImage).
    const requested = captureSizeFromCommand(cmd);
    if ('error' in requested) return { ok: false, error: requested.error };
    // AN ADOPTED SCENE IS PRESENTED BY ITS ADOPTER. The store's renderer and
    // camera are its own viewport's; re-rendering a scene another document
    // adopted through them came back white.
    if (store.hasAdoptedScene) {
      try {
        const capture = await captureActiveEditorDocument(store, requested.size);
        return { ok: true, data: { base64: capture.base64, mimeType: capture.mimeType } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    const dataUrl = store.captureViewportImage(requested.size);
    if (!dataUrl) {
      // The refusal names the MECHANISM and the door that does answer: this door
      // photographs the editor's own three.js viewport, which a canvas-surface
      // world never binds.
      return {
        ok: false,
        error:
          "This door photographs the editor's own three.js Scene viewport, and nothing has bound one " +
          '(no renderer/scene/camera). A canvas-surface world (a first-party canvas root, or a ' +
          'PixiJS/Phaser/Babylon ingest) never binds it — it draws on its own canvas in the Game ' +
          'document. Capture that through `capture-active-document` (`editor.captureActiveDocument()`) ' +
          `or the running game through \`bridge-screenshot\` (${commandLine('screenshot')}).`,
      };
    }
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    return { ok: true, data: { base64, mimeType: 'image/png' } };
  }, undefined, 'if-content-changed'),
  // The Asset Lab's photographs; the budget covers a multi-shot set's renders.
  'capture-asset-preview': verb((store, cmd) => handleAssetPreviewCommand(store, cmd), 30_000, 'if-content-changed'),
  // Display — set semantics (only toggle when the value differs).
  'set-grid': verb((_store, cmd) => {
    // The ACTIVE view's grid switch (`kit/viewport-presentation`), one per view.
    const viewId = activeWorkspaceDocumentId();
    if (!viewId || !viewPresentationBinding(viewId)) {
      return { ok: false, error: 'set-grid: the active document draws no grid.' };
    }
    setViewGridVisible(viewId, cmd['enabled'] as boolean);
    return OK;
  }),
  // Helpers and the stats tile are per-STAGE view options, read by the focused
  // stage's own viewport and its overlay set — a verb that wrote the shell's
  // copy while the person looked at a model document would toggle nothing.
  'set-helpers': verb((store, cmd) => {
    const stage = focusedStageStore(store);
    if (stage.showHelpers !== (cmd['enabled'] as boolean)) stage.toggleHelpers();
    return OK;
  }),
  'set-stats': verb((store, cmd) => {
    const stage = focusedStageStore(store);
    if (stage.showStats !== (cmd['enabled'] as boolean)) stage.toggleStats();
    return OK;
  }),
  'set-shading-mode': verb((store, cmd) => {
    const documentSession = activeObject3DDocumentSession();
    if (documentSession) documentSession.setMode(cmd['mode'] as ShadingMode);
    else store.setShadingMode(cmd['mode'] as ShadingMode);
    return OK;
  }),
  'set-helper-type': verb((store, cmd) => {
    const stage = focusedStageStore(store);
    const helperType = cmd['helperType'] as keyof HelperVisibility;
    const documentSession = activeObject3DDocumentSession();
    if (documentSession && helperType === 'bounds') {
      documentSession.setBounds(cmd['enabled'] as boolean);
      return OK;
    }
    if (documentSession && helperType === 'skeletons') {
      documentSession.setSkeleton(cmd['enabled'] as boolean);
      return OK;
    }
    if (stage.helperVisibility[helperType] !== (cmd['enabled'] as boolean)) {
      stage.toggleHelperType(helperType);
    }
    return OK;
  }),
  // Transform tools — set semantics.
  'set-transform-mode': verb((store, cmd) => {
    store.setTransformMode(cmd['mode'] as 'combined' | 'translate' | 'rotate' | 'scale');
    return OK;
  }),
  'set-transform-space': verb((store, cmd) => {
    store.setTransformSpace(cmd['space'] as 'world' | 'local');
    return OK;
  }),
  'set-snap': verb((store, cmd) => {
    if (store.snapEnabled !== (cmd['enabled'] as boolean)) store.toggleSnap();
    return OK;
  }),
};

async function documentMove(cmd: EditorCommandMessage): Promise<EditorCommandResult> {
  const documentSession = activeObject3DDocumentSession();
  if (!documentSession) {
    return {
      ok: false,
      error:
        `${cmd.type} needs an Object3D document open and active (a model, a live ` +
        'module, an entity model). Open one with `editor.openAsset(<path>)` first.',
      data: { code: 'NO_ACTIVE_OBJECT3D_DOCUMENT' },
    };
  }
  const seconds = cmd.type === 'document-orbit' ? cmd['duration'] : cmd['seconds'];
  if (seconds !== undefined && (typeof seconds !== 'number' || !(seconds >= 0 && seconds <= 60))) {
    return { ok: false, error: `${cmd.type}: the move's length must be a number of seconds in 0..60.` };
  }
  const outcome =
    cmd.type === 'document-orbit'
      ? await documentSession.orbit({
          ...(typeof cmd['azimuth'] === 'number' ? { azimuth: cmd['azimuth'] } : {}),
          ...(typeof cmd['elevation'] === 'number' ? { elevation: cmd['elevation'] } : {}),
          ...(typeof seconds === 'number' ? { duration: seconds } : {}),
        })
      : await documentSession.turntable({
          ...(typeof seconds === 'number' ? { seconds } : {}),
          ...(typeof cmd['revolutions'] === 'number' ? { revolutions: cmd['revolutions'] } : {}),
        });
  return { ok: true, data: { ...outcome } };
}
