import { threeStateOf } from '../three-state';
import {
  stageTransformDoor,
  stageTransformsVersion,
  subscribeStageTransforms,
} from '@volter/editor-sdk/contributions';
import type { EditorMaterialId } from '@volter/editor-sdk/widgets';
import { useEffect, useSyncExternalStore } from 'react';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '../authoring/active-adapter';
import {
  object3DDocumentSessionsVersion,
  subscribeObject3DDocumentSessions,
} from '../authoring/object3d-document-session-registry';
import { useEditorStore } from '../editor-runtime';
import type { EditorShellStore } from '../editor-shell-store';
import { nativeViewportShelfTool } from '@volter/editor-sdk/kit/native-selection-style';
import { documentStageContext, stageTransformDriver } from '../stage-context';
import { stageStore, stageStoresVersion, subscribeStageStores } from '../stage-store-registry';
import type {
  WorkspaceDocumentDescriptor,
  WorkspaceDocumentKind,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { assetDocumentSpec } from './asset-documents';
import { DocumentHeaderStrip } from './DocumentHeaderStrip';
import { DocumentShelfRail } from './DocumentShelfRail';
import { ToolStrip, TransformHeaderControls } from './Toolbar';

/**
 * THE STAGES WHOSE SHELF HAS ALREADY OPENED — the one piece of bookkeeping
 * behind {@link armShelfBootTool}, and a `WeakSet` because a store outlives
 * nothing here: it is the stage's, and when the stage goes so does the entry.
 */
const shelfOpened = new WeakSet<EditorShellStore>();

/**
 * THE SHELF'S BOOT TOOL IS THE LOOK'S, applied the first time this stage's
 * shelf draws.
 *
 * Blender's tool shelf opens on Select Box, so a selected object carries no
 * transform gizmo until one is armed (`DensityContribution.viewport.shelfTool`
 * in `@volter/editor-sdk/looks`, which cites the frames); this editor's opens on
 * the combined gizmo, which is what every look that names nothing keeps. It is a BOOT default and never a
 * standing switch — the tool is one click away in the rail below, and once a
 * person arms one the `WeakSet` above keeps this from ever second-guessing
 * them, through a document tab switch, a workspace change or a look change.
 *
 * WHY HERE AND NOT WHERE THE STORE IS MINTED: `StageHost` is the gizmo
 * viewport's own module and its value-import closure is PINNED
 * (`scripts/validate-editor-closure.mjs`). This is the panel that DRAWS the
 * shelf, so it is where the shelf's opening tool belongs; the reader it uses
 * is the same leaf the viewport reads its gizmo size through, which costs that
 * closure nothing either way.
 */
function armShelfBootTool(store: EditorShellStore | null): void {
  if (store === null || shelfOpened.has(store)) return;
  shelfOpened.add(store);
  if (nativeViewportShelfTool() === 'select') store.setTransformMode('select');
}

export type WorkspaceDocumentFamily = 'world' | 'resource';
export type WorkspaceDocumentPlacement =
  | 'center-document'
  | 'center-overlay'
  /** A workspace's own EDITOR AREA — a second editor group beside or below
   *  the centre document, holding the document its workspace declared
   *  (`WorkspaceDocumentDescriptor.area`). */
  | 'workspace-area';

/** Semantic document family used by layout, hotkeys, and glass chrome. */
export function workspaceDocumentFamily(kind: WorkspaceDocumentKind): WorkspaceDocumentFamily {
  return kind === 'game' || kind === 'scene' || kind === 'world' ? 'world' : 'resource';
}

/** Resolve semantic document role against the material and the LAYOUT'S OWN
 *  SHAPE: `backdrop` is true when the document is the workspace's background
 *  — the grid is this one group and every other panel floats over it. A
 *  workspace task then reads as an overlay card rather than a center tab. */
export function workspaceDocumentPlacement(
  descriptor: WorkspaceDocumentDescriptor,
  material: EditorMaterialId,
  backdrop: boolean,
): WorkspaceDocumentPlacement {
  // AN AREA WINS OVER EVERY OTHER PLACEMENT. A workspace that declared this
  // document an area is stating where Blender's own screen puts it, and no
  // material or backdrop reading may move it into the centre strip — that
  // would put two editors on one tab rail and lose the split the ratio is a
  // measurement of.
  if (descriptor.area) return 'workspace-area';
  return descriptor.workspaceRole === 'workspace-task' && material === 'glass' && backdrop
    ? 'center-overlay'
    : 'center-document';
}

/**
 * Canonical host for a production document descriptor.
 *
 * The descriptor continues to own its content and optional toolbar. This
 * host owns only the application-wide shell rules that every consumer must
 * agree on: family, hotkey scope, toolbar placement, and content lifecycle.
 */
export function WorkspaceDocumentSurface({
  viewId,
  descriptor,
  active,
  backdrop = false,
  chrome = true,
}: {
  readonly descriptor: WorkspaceDocumentDescriptor;
  viewId?: string;
  readonly active: boolean;
  /** The document is the workspace's background (see
   *  {@link workspaceDocumentPlacement}), so its header floats as an island
   *  over the world rather than sitting in a strip above it. */
  readonly backdrop?: boolean;
  readonly chrome?: boolean;
}) {
  const Content = descriptor.Content;
  const Toolbar = descriptor.Toolbar;
  const Shelf = descriptor.Shelf;
  const family = workspaceDocumentFamily(descriptor.kind);
  // The shelf is built the way Blender's is: the host's transform TOOLS on
  // top for any document whose active surface is a three stage (selection or
  // not), the document's own operators beneath (`Shelf`). The transform
  // CONTROLS that used to trail those tools (orientation, pivot, snap,
  // options) ride the header instead — Blender's own placement.
  // WHAT THOSE TOOLS DRIVE, and whether the header's wells are drawn at all,
  // is `stageTransformDriver`'s one answer below: the wells configure the
  // editor viewport's gizmo, so they follow the GIZMO arm and never appear
  // over a stage that transforms through its own modal door.
  const store = threeStateOf(useEditorStore());
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion, activeAuthoringVersion);
  useSyncExternalStore(
    subscribeObject3DDocumentSessions,
    object3DDocumentSessionsVersion,
    object3DDocumentSessionsVersion,
  );
  useSyncExternalStore(subscribeStageTransforms, stageTransformsVersion, stageTransformsVersion);
  useSyncExternalStore(subscribeStageStores, stageStoresVersion, stageStoresVersion);
  // A document with its OWN three stage (a model, an asset) carries the rail
  // whatever the shell's roots say — a models project declares none. That is
  // not a second rule: `stage-context.ts` answers what THIS document's stage is
  // showing, and a document stage is a three stage.
  const driver =
    active && descriptor.kind !== 'game'
      ? stageTransformDriver(documentStageContext(store, descriptor.id))
      : 'none';
  const door = driver === 'modal' ? stageTransformDoor(descriptor.id) : null;
  // THE STORE THE GIZMO ARM WRITES — this stage's own, which for the world
  // root IS the shell store (`StageHost.tsx`'s world-root install) and for
  // every other stage is not. The shell is the fallback for a stage that has
  // registered none yet, which is the state these controls used to write into
  // permanently.
  const gizmoStore = stageStore(descriptor.id) ?? store;
  // THIS STAGE'S OWN store only — the shell's is the session's and arrives
  // with whatever the world root was left at ({@link armShelfBootTool}). In an
  // effect rather than in the body because arming notifies the store, and a
  // store notification during another component's render is React's own
  // "cannot update while rendering" case.
  const ownStageStore = stageStore(descriptor.id);
  useEffect(() => {
    if (driver === 'gizmo') armShelfBootTool(ownStageStore);
  }, [driver, ownStageStore]);
  return (
    <div
      className="vgai-dock-document"
      data-testid={`workspace-doc:${descriptor.id}`}
      data-editor-hotkey-scope={family === 'world' ? 'viewport' : 'workspace'}
      data-vgai-document-family={family}
    >
      {chrome && (
        <DocumentHeaderStrip
          documentId={descriptor.id}
          runtime={descriptor.kind === 'game'}
          island={backdrop && family === 'world'}
          assetPath={assetDocumentSpec(descriptor.id)?.assetPath}
          transformControls={
            driver === 'gizmo' ? <TransformHeaderControls store={gizmoStore} /> : null
          }
        >
          {Toolbar ? <Toolbar documentId={descriptor.id} active={active} /> : null}
        </DocumentHeaderStrip>
      )}
      <div
        className="vgai-dock-document-content"
        data-workspace-document-id={descriptor.id}
        data-workspace-view-id={viewId}
      >
        <Content documentId={descriptor.id} {...(viewId ? { viewId } : {})} active={active} />
        {chrome && (
          <DocumentShelfRail documentId={descriptor.id}>
            {driver !== 'none' || Shelf ? (
              <>
                {driver === 'none' ? null : (
                  <ToolStrip store={gizmoStore} {...(door ? { door } : {})} />
                )}
                {Shelf ? <Shelf documentId={descriptor.id} active={active} /> : null}
              </>
            ) : null}
          </DocumentShelfRail>
        )}
      </div>
    </div>
  );
}
