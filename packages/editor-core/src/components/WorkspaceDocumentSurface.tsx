import {
  stageTransformsVersion,
  subscribeStageTransforms,
} from '@volter/editor-sdk/contributions';
import type { EditorMaterialId } from '@volter/editor-sdk/widgets';
import { Suspense, useSyncExternalStore } from 'react';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '@volter/editor-sdk/kit/authoring/active-adapter';
import {
  documentViewport,
  documentViewportsVersion,
  subscribeDocumentViewports,
} from '@volter/editor-sdk/kit/document-viewports';
import { useEditorStore } from '@volter/editor-sdk/kit/editor-runtime';
import { useViewportChrome } from '@volter/editor-sdk/kit/native-selection-style';
import type {
  WorkspaceDocumentDescriptor,
  WorkspaceDocumentKind,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { assetDocumentSpec } from '@volter/editor-sdk/kit/components/asset-documents';
import { DocumentHeaderStrip } from './DocumentHeaderStrip';
import { DocumentShelfRail } from './DocumentShelfRail';

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
  // What the host's transform tools drive, and the tools themselves, are the
  // STAGE's answer for this document (`@volter/editor-sdk/kit/document-viewports`):
  // a three stage draws its gizmo's strip and wells, a stage that transforms
  // through its own door takes the modal arm, and a document with no stage has
  // none.
  const store = useEditorStore();
  useSyncExternalStore(store.subscribe, store.getShellSnapshot ?? store.getSnapshot);
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion, activeAuthoringVersion);
  useSyncExternalStore(subscribeDocumentViewports, documentViewportsVersion, documentViewportsVersion);
  useSyncExternalStore(subscribeStageTransforms, stageTransformsVersion, stageTransformsVersion);
  const stage = documentViewport(descriptor.id);
  const driver = active && descriptor.kind !== 'game' ? (stage?.transformTools?.() ?? 'none') : 'none';
  const TransformTools = stage?.TransformTools;
  const TransformControls = stage?.TransformControls;
  // WHERE THE STAGE'S OWN CONTROLS SIT is the look's (`StageContribution.chrome`): the content
  // box carries it, and the stylesheet places the shelf, the display controls and the bar by it
  // (`workspace-surfaces.css`, "THE STAGE'S BAR"). The tools' place applies only where this
  // host draws them.
  const stageChrome = useViewportChrome();
  // Only a 3D stage takes it (the one kind of document that registers a stage here), and not a
  // backdrop world, whose overlays already clear the floating header by their own offset.
  const placesStage = chrome && stage !== null && stage !== undefined && !backdrop;
  // The transform tools alone move to the bar; a document's own shelf stays on its rail.
  const toolsOnBar = placesStage && stageChrome.bar !== 'none' && stageChrome.tools !== 'shelf';
  const transformTools =
    driver === 'none' || !TransformTools ? null : (
      <Suspense fallback={null}>
        <TransformTools documentId={descriptor.id} />
      </Suspense>
    );
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
            driver === 'gizmo' && TransformControls ? (
              <Suspense fallback={null}>
                <TransformControls documentId={descriptor.id} />
              </Suspense>
            ) : null
          }
        >
          {Toolbar ? <Toolbar documentId={descriptor.id} active={active} /> : null}
        </DocumentHeaderStrip>
      )}
      <div
        className="vgai-dock-document-content"
        data-workspace-document-id={descriptor.id}
        data-workspace-view-id={viewId}
        data-vgai-stage-bar={placesStage && stageChrome.bar !== 'none' ? stageChrome.bar : undefined}
        data-vgai-stage-display={placesStage ? stageChrome.display : undefined}
        data-vgai-stage-tools={placesStage && driver !== 'none' ? stageChrome.tools : undefined}
        // Whether the shelf rail draws anything, so a control placed at the stage's left edge
        // (Godot's view pill) stands past it only when it is there.
        data-vgai-stage-rail={chrome && ((transformTools && !toolsOnBar) || Shelf) ? undefined : 'empty'}
      >
        <Content documentId={descriptor.id} {...(viewId ? { viewId } : {})} active={active} />
        {/* THE STAGE'S BAR, when the look draws one: only its band; the controls it carries
            are placed over it by the stylesheet. */}
        {placesStage && stageChrome.bar !== 'none' ? (
          <div className="vgai-stage-bar" data-form={stageChrome.bar} aria-hidden="true" />
        ) : null}
        {chrome && (
          <DocumentShelfRail documentId={descriptor.id}>
            {(transformTools && !toolsOnBar) || Shelf ? (
              <>
                {toolsOnBar ? null : transformTools}
                {Shelf ? <Shelf documentId={descriptor.id} active={active} /> : null}
              </>
            ) : null}
          </DocumentShelfRail>
        )}
        {chrome && toolsOnBar && transformTools ? (
          <div className="vgai-stage-bar-tools" data-testid={`stage-bar-tools:${descriptor.id}`}>
            {transformTools}
          </div>
        ) : null}
      </div>
    </div>
  );
}
